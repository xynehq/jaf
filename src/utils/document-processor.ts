import type { Attachment } from '../core/types.js';
import * as XLSX from 'xlsx';
import * as CFB from 'cfb';
import mammoth from 'mammoth';
import Papa from 'papaparse';
import yauzl from 'yauzl';
import { PDFParse } from 'pdf-parse';

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

    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return await extractPptxContent(buffer);

    case 'application/vnd.ms-powerpoint':
      return await extractPptContent(buffer);

    case 'application/zip':
      return await extractZipContent(buffer);

    default:
      // Fallback: try to extract as text
      return extractTextContent(buffer, 'text/plain');
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

/**
 * Extract text content from PDF files using pdf-parse v2
 * Matches Python JAF behavior of extracting text and sending as text content
 */
async function extractPdfContent(buffer: Buffer): Promise<ProcessedDocument> {
  try {
    // pdf-parse v2 API: pass buffer as data parameter
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    return {
      content: result.text.trim(),
      metadata: {
        pages: result.pages.length
      }
    };
  } catch (error) {
    throw new DocumentProcessingError(
      `Failed to extract PDF content: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    );
  }
}


async function extractPptxContent(buffer: Buffer): Promise<ProcessedDocument> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new DocumentProcessingError(`Failed to read PPTX file: ${err?.message || 'No zipfile'}`));
        return;
      }

      const slides = new Map<number, string>();
      let pendingStreams = 0;
      let allEntriesRead = false;

      function tryResolve() {
        if (!allEntriesRead || pendingStreams > 0) return;
        const sortedSlides = Array.from(slides.entries()).sort((a, b) => a[0] - b[0]);
        let content = `PowerPoint Presentation:\nSlides: ${sortedSlides.length}\n\n`;
        for (const [index, slideText] of sortedSlides) {
          if (slideText.trim()) {
            content += `Slide ${index}:\n${slideText}\n\n`;
          }
        }
        resolve({
          content: content.trim(),
          metadata: { slides: sortedSlides.length }
        });
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        const slideMatch = entry.fileName.match(/^ppt\/slides\/slide(\d+)\.xml$/);
        if (slideMatch) {
          const slideIndex = parseInt(slideMatch[1], 10);
          pendingStreams++;
          zipfile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              pendingStreams--;
              tryResolve();
              zipfile.readEntry();
              return;
            }
            const chunks: Buffer[] = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('end', () => {
              const xml = Buffer.concat(chunks).toString('utf-8');
              // Extract text from <a:t> elements (DrawingML text runs)
              const textMatches = xml.match(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g) || [];
              const text = textMatches
                .map(m => m.replace(/<[^>]+>/g, '').trim())
                .filter(t => t.length > 0)
                .join(' ');
              slides.set(slideIndex, text);
              pendingStreams--;
              tryResolve();
            });
            stream.on('error', () => {
              pendingStreams--;
              tryResolve();
            });
            zipfile.readEntry();
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        allEntriesRead = true;
        tryResolve();
      });

      zipfile.on('error', (error) => {
        reject(new DocumentProcessingError(`Failed to process PPTX file: ${error.message}`, error));
      });
    });
  });
}


async function extractPptContent(buffer: Buffer): Promise<ProcessedDocument> {
  try {
    const cfbData = CFB.read(new Uint8Array(buffer), { type: 'array' });

    const pptStream = CFB.find(cfbData, 'PowerPoint Document');
    if (!pptStream || !pptStream.content) {
      throw new DocumentProcessingError('PowerPoint Document stream not found in PPT file');
    }

    const data = Buffer.from(pptStream.content as Uint8Array);
    const texts: string[] = [];

    // PPT records are hierarchical: version nibble 0xF marks a container whose
    // data payload contains more records. We must recurse to find text atoms
    // (TextCharsAtom 0x0FA0 / TextBytesAtom 0x0FA8) at any nesting depth.
    // MAX_PPT_DEPTH guards against malformed/malicious files with arbitrarily
    // deep nesting that would otherwise cause a stack overflow. Real PPT files
    // never exceed ~15 levels; 64 is a safe ceiling.
    const MAX_PPT_DEPTH = 64;

    const parseRecords = (buf: Buffer, start: number, end: number, depth: number): void => {
      if (depth > MAX_PPT_DEPTH) return;

      let offset = start;
      while (offset + 8 <= end) {
        const verAndInstance = buf.readUInt16LE(offset);
        const recVer = verAndInstance & 0x0f;
        const recType = buf.readUInt16LE(offset + 2);
        const recLen = buf.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + recLen;

        if (dataEnd > end) break;

        if (recType === 0x0fa0) {
          // TextCharsAtom: UTF-16LE
          const text = buf.subarray(dataStart, dataEnd).toString('utf16le').trim();
          if (text) texts.push(text);
        } else if (recType === 0x0fa8) {
          // TextBytesAtom: Latin-1
          const text = buf.subarray(dataStart, dataEnd).toString('latin1').trim();
          if (text) texts.push(text);
        } else if (recVer === 0xf) {
          // Container record — recurse into its children
          parseRecords(buf, dataStart, dataEnd, depth + 1);
        }

        offset = dataEnd;
      }
    }

    parseRecords(data, 0, data.length, 0);

    const content = texts.length > 0
      ? `PowerPoint Presentation:\n\n${texts.join('\n')}`
      : 'No text content found in PPT file';

    return { content, metadata: { slides: texts.length } };
  } catch (error) {
    throw new DocumentProcessingError(
      `Failed to extract PPT content: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    );
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
    'application/zip',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint'
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
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'PowerPoint presentation slide text';
    case 'application/vnd.ms-powerpoint':
      return 'PowerPoint presentation text (legacy .ppt format)';
    default:
      return 'document content';
  }
}