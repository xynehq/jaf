// Mock for pdfjs-dist to avoid Jest import issues

export const VerbosityLevel = {
  INFOS: 1,
  WARNINGS: 1,
  ERRORS: 0,
};

export const ImageKind = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3,
};

export const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  showText: 92,
  showSpacedText: 93,
  nextLine: 91,
  nextLineShowText: 94,
  nextLineSetSpacingShowText: 95,
  setTextMatrix: 79,
  moveText: 88,
  paintImageXObject: 39,
  paintInlineImageXObject: 40,
  paintImageMaskXObject: 41,
  paintImageXObjectRepeat: 43,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  clip: 29,
  eoClip: 30,
  rectangle: 19,
  shadingFill: 59,
  rawFillPath: 122,
  paintFormXObjectBegin: 31,
  paintFormXObjectEnd: 32,
  constructPath: 46,
};

export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
}

export interface PDFPageProxy {
  pageNumber: number;
  getTextContent(params?: any): Promise<any>;
  getOperatorList(): Promise<any>;
  cleanup(): void;
}

export const getDocument = jest.fn().mockImplementation(() => ({
  promise: Promise.reject(new Error('PDF parsing not available in test environment'))
}));

export default {
  VerbosityLevel,
  ImageKind,
  OPS,
  getDocument,
};