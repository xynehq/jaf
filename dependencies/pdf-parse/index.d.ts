export interface PdfParseOptions {
  pagerender?: (pageData: any) => Promise<string> | string;
  /**
   * Max number of pages to render. 0 or less means all pages.
   */
  max?: number;
  /**
   * PDF.js version folder to use, e.g. 'v1.10.100'.
   */
  version?: string;
}

export interface PdfParseResult {
  /** Total number of pages in the document */
  numpages: number;
  /** Number of pages actually rendered */
  numrender: number;
  /** Document info as provided by PDF.js metadata */
  info: any;
  /** XMP metadata if available */
  metadata: any;
  /** Concatenated text content extracted from the PDF */
  text: string;
  /** PDF.js version string */
  version: string;
}

export default function pdfParse(
  dataBuffer: Buffer | Uint8Array | ArrayBuffer,
  options?: PdfParseOptions
): Promise<PdfParseResult>;

