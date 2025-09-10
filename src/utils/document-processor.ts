import type { Attachment } from '../core/types.js';
import pdfParse from '../../dependencies/pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import Papa from 'papaparse';
import yauzl from 'yauzl';

const FETCH_TIMEOUT = 30000;
const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
const MAX_CSV_PREVIEW_ROWS = 10;
const MAX_EXCEL_SHEETS = 3;
const MAX_EXCEL_ROWS_PER_SHEET = 20;

class DocumentProcessingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}

class NetworkError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface ProcessedDocument {
  content: string;
  metadata?: {
    pages?: number;
    sheets?: string[];
    files?: string[];
    [key: string]: any;
  };
}

/**
 * Fetch content from URL and return as buffer
 */
async function fetchUrlContent(url: string): Promise<{ buffer: Buffer; contentType?: string }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'JAF-DocumentProcessor/1.0'
      },
      // 30 second timeout for large files
      signal: AbortSignal.timeout(FETCH_TIMEOUT)
    });

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`, response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || undefined;

    // Basic size check (25MB limit)
    const maxSize = 25 * 1024 * 1024;
    if (buffer.length > MAX_DOCUMENT_SIZE) {
      throw new DocumentProcessingError(`File size (${Math.round(buffer.length / 1024 / 1024)}MB) exceeds maximum allowed size (${Math.round(MAX_DOCUMENT_SIZE / 1024 / 1024)}MB)`);
    }

    return { buffer, contentType };
  } catch (error) {
    if (error instanceof Error) {
      throw new NetworkError(`Failed to fetch URL content: ${error.message}`);
    }
    throw new NetworkError('Failed to fetch URL content: Unknown error');
  }
}

/**
 * Extract text content from various document formats
 */
export async function extractDocumentContent(attachment: Attachment): Promise<ProcessedDocument> {
  let buffer: Buffer;
  let mimeType = attachment.mimeType?.toLowerCase();

  // Handle URL-based attachments
  if (attachment.url && !attachment.data) {
    const urlData = await fetchUrlContent(attachment.url);
    buffer = urlData.buffer;
    
    // Use content type from response if mimeType wasn't provided
    if (!mimeType && urlData.contentType) {
      mimeType = urlData.contentType.toLowerCase();
    }
  } 
  // Handle base64 data attachments
  else if (attachment.data) {
    buffer = Buffer.from(attachment.data, 'base64');
  } 
  // Error if neither URL nor data provided
  else {
    throw new DocumentProcessingError('No document data or URL provided');
  }

  switch (mimeType) {
    case 'application/pdf':
      return await extractPdfContent(buffer);
    
    case 'text/plain':
    case 'text/csv':
      return extractTextContent(buffer, mimeType);
    
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
      return extractExcelContent(buffer);
    
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return await extractDocxContent(buffer);
    
    case 'application/json':
      return extractJsonContent(buffer);
    
    case 'application/zip':
      return await extractZipContent(buffer);
    
    default:
      // Fallback: try to extract as text
      return extractTextContent(buffer, 'text/plain');
  }
}

async function extractPdfContent(buffer: Buffer): Promise<ProcessedDocument> {
  try {
    const data = await pdfParse(buffer);
    return {
      content: data.text.trim(),
      metadata: {
        pages: data.numpages,
        info: data.info
      }
    };
  } catch (error) {
    throw new DocumentProcessingError(`Failed to extract PDF content: ${error instanceof Error ? error.message : 'Unknown error'}`, error);
  }
}

function extractTextContent(buffer: Buffer, mimeType: string): ProcessedDocument {
  const content = buffer.toString('utf-8').trim();
  
  if (mimeType === 'text/csv') {
    // Parse CSV to provide structured overview
    try {
      const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
      const rows = parsed.data.length;
      const columns = parsed.meta.fields?.length || 0;
      
      return {
        content: `CSV File Content:\nRows: ${rows}, Columns: ${columns}\nColumns: ${parsed.meta.fields?.join(', ') || 'N/A'}\n\nFirst few rows:\n${content.split('\n').slice(0, MAX_CSV_PREVIEW_ROWS).join('\n')}`,
        metadata: {
          rows,
          columns,
          fields: parsed.meta.fields
        }
      };
    } catch (error) {
      // Fallback to raw text if CSV parsing fails
      return { content };
    }
  }
  
  return { content };
}

function extractExcelContent(buffer: Buffer): ProcessedDocument {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    
    let content = `Excel File Content:\nSheets: ${sheetNames.join(', ')}\n\n`;
    
    // Extract content from each sheet
    sheetNames.forEach((sheetName, index) => {
      if (index < MAX_EXCEL_SHEETS) { // Limit to first 3 sheets to avoid overwhelming
        const worksheet = workbook.Sheets[sheetName];
        const csvContent = XLSX.utils.sheet_to_csv(worksheet);
        
        content += `Sheet: ${sheetName}\n`;
        content += csvContent.split('\n').slice(0, MAX_EXCEL_ROWS_PER_SHEET).join('\n'); // First 20 rows
        content += '\n\n';
      }
    });
    
    return {
      content: content.trim(),
      metadata: {
        sheets: sheetNames
      }
    };
  } catch (error) {
    throw new DocumentProcessingError(`Failed to extract Excel content: ${error instanceof Error ? error.message : 'Unknown error'}`, error);
  }
}

async function extractDocxContent(buffer: Buffer): Promise<ProcessedDocument> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return {
      content: result.value.trim(),
      metadata: {
        messages: result.messages.length > 0 ? result.messages : undefined
      }
    };
  } catch (error) {
    throw new DocumentProcessingError(`Failed to extract DOCX content: ${error instanceof Error ? error.message : 'Unknown error'}`, error);
  }
}

function extractJsonContent(buffer: Buffer): ProcessedDocument {
  try {
    const jsonStr = buffer.toString('utf-8');
    const jsonObj = JSON.parse(jsonStr);
    
    // Pretty print JSON with some metadata
    const content = `JSON File Content:\n${JSON.stringify(jsonObj, null, 2)}`;
    
    return {
      content,
      metadata: {
        keys: typeof jsonObj === 'object' && jsonObj !== null ? Object.keys(jsonObj) : [],
        type: Array.isArray(jsonObj) ? 'array' : typeof jsonObj
      }
    };
  } catch (error) {
    // Fallback to raw text if JSON parsing fails
    return { content: buffer.toString('utf-8').trim() };
  }
}

async function extractZipContent(buffer: Buffer): Promise<ProcessedDocument> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new DocumentProcessingError(`Failed to read ZIP file: ${err.message}`, err));
        return;
      }

      if (!zipfile) {
        reject(new DocumentProcessingError('Failed to read ZIP file: No zipfile'));
        return;
      }

      const files: string[] = [];
      let content = 'ZIP File Contents:\n\n';

      zipfile.readEntry();
      
      zipfile.on('entry', (entry) => {
        files.push(entry.fileName);
        
        if (entry.fileName.endsWith('/')) {
          content += `DIR: ${entry.fileName}\n`;
        } else {
          const size = entry.uncompressedSize;
          content += `FILE: ${entry.fileName} (${size} bytes)\n`;
        }
        
        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        resolve({
          content: content.trim(),
          metadata: {
            files,
            totalFiles: files.length
          }
        });
      });

      zipfile.on('error', (error) => {
        reject(new DocumentProcessingError(`Failed to process ZIP file: ${error.message}`, error));
      });
    });
  });
}

/**
 * Check if a MIME type is supported for content extraction
 */
export function isDocumentSupported(mimeType?: string): boolean {
  if (!mimeType) return false;
  
  const supportedTypes = [
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/json',
    'application/zip'
  ];
  
  return supportedTypes.includes(mimeType.toLowerCase());
}

/**
 * Get a human-readable description of what content will be extracted
 */
export function getDocumentDescription(mimeType?: string): string {
  switch (mimeType?.toLowerCase()) {
    case 'application/pdf':
      return 'PDF text content';
    case 'text/plain':
      return 'plain text content';
    case 'text/csv':
      return 'CSV data structure and sample rows';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
      return 'Excel spreadsheet data';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'Word document text content';
    case 'application/json':
      return 'JSON data structure';
    case 'application/zip':
      return 'ZIP file listing';
    default:
      return 'document content';
  }
}