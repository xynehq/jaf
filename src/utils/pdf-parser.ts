import type { Attachment } from '../core/types.js';
import { createCanvas, Image as CanvasImage, ImageData } from 'canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import crypto from 'crypto';

// Configuration constants
const MIN_IMAGE_DIM_PX = parseInt(process.env.MIN_IMAGE_DIM_PX || '150', 10);
const MAX_IMAGE_FILE_SIZE_MB = 25;
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

// PDF.js setup - use empty paths since we're using legacy build
const openjpegWasmPath = '';
const qcmsWasmPath = '';

// Cache for image descriptions to avoid re-processing
const seenHashDescriptions = new Map<string, string>();

export interface PdfProcessingResult {
  text_chunks: string[];
  image_chunks: string[];
  text_chunk_pos: number[];
  image_chunk_pos: number[];
}

export interface ProcessedPdfDocument {
  content: string;
  metadata?: {
    pages?: number;
    images?: number;
    textChunks?: number;
    imageChunks?: number;
  };
}

class PdfProcessingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PdfProcessingError';
  }
}

/**
 * Normalize text by handling Unicode and control characters
 */
export function normalizeText(input: string): string {
  if (!input) return '';

  let normalized = input.normalize('NFC');

  // Strip control chars except newline/tab
  normalized = normalized.replace(/[^\P{C}\n\t]/gu, '');

  // Normalize whitespace
  normalized = normalized.replace(/\u00A0/g, ' '); // nbsp → space
  normalized = normalized.replace(/\u200B/g, ''); // zero-width space
  normalized = normalized.replace(/\t+/g, ' '); // tabs → single space

  return normalized.trim();
}

/**
 * Smart letter-spacing collapse for spaced letters like "N A S A" -> "NASA"
 */
function smartDespaceLine(line: string): string {
  if (!line) return line;

  const parts = line.split(/(\s+)/);
  const out: string[] = [];

  const isSingleAllowed = (s: string) =>
    s.length === 1 && /[\p{L}\p{N}'']/u.test(s);

  const isSingleLowerLetter = (s: string) => s.length === 1 && /\p{Ll}/u.test(s);

  let i = 0;
  while (i < parts.length) {
    const tok = parts[i];

    if (!/\s+/.test(tok) && isSingleAllowed(tok)) {
      const runTokens: string[] = [tok];
      let j = i + 1;

      while (
        j + 1 < parts.length &&
        parts[j] === ' ' &&
        !/\s+/.test(parts[j + 1]) &&
        isSingleAllowed(parts[j + 1])
      ) {
        runTokens.push(parts[j + 1]);
        j += 2;
      }

      // Join spaced letters like "N A S A" -> "NASA"
      if (runTokens.length >= 3) {
        out.push(runTokens.join(''));
        i = j;
        continue;
      }

      // Join two-letter lowercase sequences like "i s" -> "is"
      if (
        runTokens.length === 2 &&
        isSingleLowerLetter(runTokens[0]) &&
        isSingleLowerLetter(runTokens[1])
      ) {
        out.push(runTokens.join(''));
        i = j;
        continue;
      }
    }

    out.push(tok);
    i += 1;
  }

  return out.join('');
}

/**
 * Clean text by fixing hyphenation, normalizing whitespace, and applying smart spacing
 */
export function cleanText(input: string): string {
  let s = normalizeText(input);

  // Fix hyphenation across line breaks
  s = s.replace(/(\p{L})-\n(\p{L})/gu, '$1$2');

  // Trim spaces around newlines
  s = s.replace(/[ \t]*\n[ \t]*/g, '\n');

  // Turn intra-paragraph newlines into spaces, preserve paragraph breaks
  const uniqueParaPlaceholder = `\uE000XYNE_PARA_BREAK_${Math.random().toString(36).substring(2)}\uE001`;
  s = s.replace(/\n{2,}/g, uniqueParaPlaceholder);
  s = s.replace(/\n+/g, ' ');
  s = s.replace(
    new RegExp(
      uniqueParaPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g'
    ),
    '\n\n'
  );

  // Apply line-wise despacing
  s = s
    .split('\n')
    .map((line) => smartDespaceLine(line))
    .join('\n');

  // Remove spaces before punctuation
  s = s.replace(/\s+([.,;:!?])/g, '$1');

  // Cap extreme space runs, preserve 2–4 spaces
  s = s.replace(/[ ]{5,}/g, '    ');

  // Trim lines & drop empties
  s = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');

  return s.trim();
}

/**
 * Chunk text by paragraphs with specified max length and overlap
 */
function chunkTextByParagraph(text: string, maxLength: number = 512, overlap: number = 128): string[] {
  if (!text || text.length <= maxLength) {
    return text ? [text] : [];
  }

  const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const cleanParagraph = paragraph.trim();
    
    if (!cleanParagraph) continue;

    // If paragraph alone exceeds maxLength, split it
    if (cleanParagraph.length > maxLength) {
      // Save current chunk if not empty
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split large paragraph into sentences or by periods
      const sentences = cleanParagraph.split(/(?<=[.!?])\s+/);
      let sentenceChunk = '';

      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length + 1 <= maxLength) {
          sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
        } else {
          if (sentenceChunk) {
            chunks.push(sentenceChunk);
            // Add overlap from previous chunk
            const overlapText = sentenceChunk.slice(-overlap);
            sentenceChunk = overlapText + ' ' + sentence;
          } else {
            // Single sentence is too long, force split
            if (sentence.length > maxLength) {
              const words = sentence.split(' ');
              let wordChunk = '';
              for (const word of words) {
                if (wordChunk.length + word.length + 1 <= maxLength) {
                  wordChunk += (wordChunk ? ' ' : '') + word;
                } else {
                  if (wordChunk) chunks.push(wordChunk);
                  wordChunk = word;
                }
              }
              if (wordChunk) sentenceChunk = wordChunk;
            } else {
              sentenceChunk = sentence;
            }
          }
        }
      }
      
      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk;
      }
    } else {
      // Normal paragraph that fits within maxLength
      if (currentChunk.length + cleanParagraph.length + 2 <= maxLength) {
        currentChunk += (currentChunk ? '\n\n' : '') + cleanParagraph;
      } else {
        // Save current chunk and start new one
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = cleanParagraph;
      }
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Multiply two 2D transformation matrices
 */
function multiplyMatrices(
  m1: number[],
  m2: number[]
): [number, number, number, number, number, number] {
  const [a1, b1, c1, d1, e1, f1] = m1 as [number, number, number, number, number, number];
  const [a2, b2, c2, d2, e2, f2] = m2 as [number, number, number, number, number, number];
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * Process collected paragraphs into chunks
 */
function processTextParagraphs(
  paragraphs: string[],
  text_chunks: string[],
  text_chunk_pos: number[],
  globalSeq: { value: number },
  overlapBytes: number = 32
): string {
  if (paragraphs.length === 0) return '';

  const cleanedParagraphs = paragraphs
    .map(cleanText)
    .filter((p) => p.length > 0);
  
  if (cleanedParagraphs.length === 0) return '';

  const cleanedText = cleanedParagraphs.join('\n');
  const chunks = chunkTextByParagraph(cleanedText, 512, 128);

  for (const chunk of chunks) {
    text_chunks.push(chunk);
    text_chunk_pos.push(globalSeq.value);
    globalSeq.value++;
  }

  // Return overlap text for continuity across pages
  let overlapText = '';
  let overlapLen = 0;

  for (let i = cleanedText.length - 1; i >= 0; i--) {
    const charBytes = Buffer.byteLength(cleanedText[i], 'utf8');
    if (overlapLen + charBytes > overlapBytes) {
      break;
    }
    overlapText = cleanedText[i] + overlapText;
    overlapLen += charBytes;
  }

  return overlapText;
}

/**
 * Simple image description function (placeholder)
 * In a real implementation, this would call an AI service
 */
async function describeImageWithLLM(buffer: Buffer): Promise<string> {
  // This is a placeholder. In your actual implementation, you would:
  // 1. Send the image to a vision-capable AI model
  // 2. Get a description back
  // For now, return a basic description
  return 'This is an image extracted from the PDF document.';
}

/**
 * Extract text and images from PDF with chunking
 */
export async function extractTextAndImagesWithChunksFromPDF(
  data: Uint8Array,
  docid: string = crypto.randomUUID(),
  extractImages: boolean = false,
  describeImages: boolean = true,
  includeImageMarkersInText: boolean = true
): Promise<PdfProcessingResult> {
  const loadingTask = pdfjsLib.getDocument({
    data,
    // Note: Using empty paths since legacy build handles WASM differently
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });

  let pdfDocument: pdfjsLib.PDFDocumentProxy;
  try {
    pdfDocument = await loadingTask.promise;
  } catch (error) {
    const { name, message } = error as Error;
    if (message.includes('PasswordException') || name.includes('PasswordException')) {
      throw new PdfProcessingError('PDF is password protected');
    } else {
      throw new PdfProcessingError(`Failed to load PDF: ${message}`, error);
    }
  }

  try {
    const text_chunks: string[] = [];
    const image_chunks: string[] = [];
    const text_chunk_pos: number[] = [];
    const image_chunk_pos: number[] = [];

    const globalSeq = { value: 0 };
    let pageOverlap = '';

    // Build paragraphs from page using textContent API
    const buildParagraphsFromPage = async (page: pdfjsLib.PDFPageProxy): Promise<string[]> => {
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });

      // Build lines using hasEOL and Y-position changes
      const lines: string[] = [];
      let current = '';
      let prevY: number | null = null;
      let prevH: number | null = null;

      for (const item of textContent.items as any[]) {
        const str: string = item && typeof item.str === 'string' ? item.str : '';
        if (!str) continue;

        const tr = Array.isArray(item.transform) ? item.transform : [];
        const y = typeof tr[5] === 'number' ? tr[5] : null;
        const h = typeof item.height === 'number' ? item.height : null;

        let newLine = false;
        if (prevY != null && y != null) {
          const tol = Math.max(prevH || 0, h || 0, 10) * 0.4;
          if (Math.abs(y - prevY) > tol) newLine = true;
        }

        if (newLine || (item as any).hasEOL) {
          if (current.length > 0) lines.push(current);
          current = str;
        } else {
          current += str;
        }

        prevY = y;
        prevH = h;
      }
      if (current.trim().length > 0) lines.push(current);

      // Group lines into paragraphs
      const paragraphs: string[] = [];
      let buf: string[] = [];
      const pushPara = () => {
        if (buf.length === 0) return;
        paragraphs.push(buf.join('\n'));
        buf = [];
      };

      for (const ln of lines) {
        if (ln.trim().length === 0) {
          pushPara();
        } else {
          buf.push(ln);
        }
      }
      pushPara();

      return paragraphs.filter((p) => p.trim().length > 0);
    };

    // Process each page
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      
      try {
        // Extract text paragraphs
        let paragraphs: string[] = await buildParagraphsFromPage(page);

        // Handle page overlap for continuity
        if (pageOverlap && paragraphs.length > 0) {
          paragraphs[0] = `${pageOverlap} ${paragraphs[0]}`;
          pageOverlap = '';
        } else if (pageOverlap) {
          paragraphs = [pageOverlap];
          pageOverlap = '';
        }

        // Extract images if requested
        if (extractImages) {
          const opList = await page.getOperatorList();
          let currentCTM: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
          const ctmStack: [number, number, number, number, number, number][] = [];

          for (let i = 0; i < opList.fnArray.length; i++) {
            const fnId = opList.fnArray[i];
            const args = opList.argsArray[i];

            switch (fnId) {
              case pdfjsLib.OPS.transform:
                try {
                  if (Array.isArray(args) && args.length >= 6 && args.every((n: any) => typeof n === 'number')) {
                    currentCTM = multiplyMatrices(currentCTM, args as number[]);
                  }
                } catch {
                  // Silently ignore matrix transformation errors
                }
                break;

              case pdfjsLib.OPS.save:
                ctmStack.push([...currentCTM]);
                break;

              case pdfjsLib.OPS.restore:
                if (ctmStack.length) currentCTM = ctmStack.pop()!;
                break;

              case pdfjsLib.OPS.paintImageXObject:
              case pdfjsLib.OPS.paintImageXObjectRepeat:
              case pdfjsLib.OPS.paintInlineImageXObject:
              case pdfjsLib.OPS.paintImageMaskXObject:
                // Extract image processing logic would go here
                // For brevity, we'll add a simple image marker
                if (includeImageMarkersInText) {
                  text_chunks.push(`[[IMG#${globalSeq.value}]]`);
                  text_chunk_pos.push(globalSeq.value);
                }
                
                if (describeImages) {
                  image_chunks.push('Image extracted from PDF page ' + pageNum);
                  image_chunk_pos.push(globalSeq.value);
                }
                
                globalSeq.value++;
                break;
            }
          }
        }

        // Process text paragraphs
        const overlapText = processTextParagraphs(
          paragraphs,
          text_chunks,
          text_chunk_pos,
          globalSeq
        );

        pageOverlap = overlapText.trim();
      } finally {
        page.cleanup();
      }
    }

    return {
      text_chunks,
      image_chunks,
      text_chunk_pos,
      image_chunk_pos,
    };
  } finally {
    await pdfDocument.destroy();
  }
}

/**
 * Extract PDF content for document processor integration
 */
export async function extractPdfContent(buffer: Buffer): Promise<ProcessedPdfDocument> {
  try {
    const uint8Data = new Uint8Array(buffer);
    const result = await extractTextAndImagesWithChunksFromPDF(
      uint8Data,
      crypto.randomUUID(),
      false, // Don't extract images for basic content extraction
      false, // Don't describe images
      false  // Don't include image markers
    );

    // Combine all text chunks into content
    const content = result.text_chunks.join('\n\n');
    
    return {
      content: content.trim(),
      metadata: {
        pages: undefined, // Would need to track from PDF document
        textChunks: result.text_chunks.length,
        imageChunks: result.image_chunks.length,
      }
    };
  } catch (error) {
    throw new PdfProcessingError(
      `Failed to extract PDF content: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    );
  }
}