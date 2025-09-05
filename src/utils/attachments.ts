import type { Attachment } from '../core/types.js';

// Lightweight helpers for constructing attachments consistently

// Security constants
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB per attachment
const MAX_FILENAME_LENGTH = 255;
const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'
];
const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf', 'text/plain', 'text/csv', 'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

// Validation helpers
function validateBase64(data: string): boolean {
  try {
    // Basic base64 pattern check
    const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Pattern.test(data)) {
      return false;
    }
    
    // Try to decode to verify it's valid base64
    const decoded = Buffer.from(data, 'base64');
    const reencoded = decoded.toString('base64');
    
    // Account for padding differences
    const normalizedInput = data.replace(/=+$/, '');
    const normalizedReencoded = reencoded.replace(/=+$/, '');
    
    return normalizedInput === normalizedReencoded;
  } catch {
    return false;
  }
}

function validateAttachmentSize(data?: string): void {
  if (data) {
    // Estimate decoded size (base64 is ~4/3 the size of original)
    const estimatedSize = (data.length * 3) / 4;
    if (estimatedSize > MAX_ATTACHMENT_SIZE) {
      throw new Error(`Attachment size (${Math.round(estimatedSize / 1024 / 1024)}MB) exceeds maximum allowed size (${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB)`);
    }
  }
}

function validateFilename(name?: string): void {
  if (name) {
    if (name.length > MAX_FILENAME_LENGTH) {
      throw new Error(`Filename length (${name.length}) exceeds maximum allowed length (${MAX_FILENAME_LENGTH})`);
    }
    
    // Check for dangerous characters
    const dangerousChars = /[<>:"|?*\x00-\x1f]/;
    if (dangerousChars.test(name)) {
      throw new Error('Filename contains invalid characters');
    }
    
    // Check for path traversal attempts
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Filename cannot contain path separators or traversal sequences');
    }
  }
}

function validateMimeType(mimeType: string | undefined, allowedTypes: string[], kind: string): void {
  if (mimeType && !allowedTypes.includes(mimeType.toLowerCase())) {
    throw new Error(`MIME type '${mimeType}' is not allowed for ${kind} attachments. Allowed types: ${allowedTypes.join(', ')}`);
  }
}

function validateUrl(url?: string): void {
  if (url) {
    try {
      const urlObj = new URL(url);
      const allowedProtocols = ['http:', 'https:', 'data:'];
      if (!allowedProtocols.includes(urlObj.protocol)) {
        throw new Error(`URL protocol '${urlObj.protocol}' is not allowed. Allowed protocols: ${allowedProtocols.join(', ')}`);
      }
      
      // Additional validation for data URLs
      if (urlObj.protocol === 'data:') {
        const dataUrlPattern = /^data:([^;]+)(;base64)?,(.+)$/;
        if (!dataUrlPattern.test(url)) {
          throw new Error('Invalid data URL format');
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Invalid URL: ${error.message}`);
      }
      throw new Error('Invalid URL format');
    }
  }
}

function processBase64Data(data?: Buffer | string): string | undefined {
  if (!data) return undefined;
  
  const base64 = typeof data === 'string' ? data : data.toString('base64');
  
  // Validate base64 format if it was provided as string
  if (typeof data === 'string' && !validateBase64(base64)) {
    throw new Error('Invalid base64 data format');
  }
  
  return base64;
}

export function makeImageAttachment(params: {
  data?: Buffer | string; // raw Buffer or base64 string
  url?: string;           // remote or data URL
  mimeType?: string;      // e.g. image/png
  name?: string;
}): Attachment {
  // Validate inputs
  validateFilename(params.name);
  validateUrl(params.url);
  validateMimeType(params.mimeType, ALLOWED_IMAGE_MIME_TYPES, 'image');
  validateAttachmentSize(typeof params.data === 'string' ? params.data : undefined);
  
  const base64 = processBase64Data(params.data);
  
  // Ensure at least one content source
  if (!params.url && !base64) {
    throw new Error('Image attachment must have either url or data');
  }

  return {
    kind: 'image',
    mimeType: params.mimeType,
    name: params.name,
    url: params.url,
    data: base64
  };
}

export function makeFileAttachment(params: {
  data?: Buffer | string;
  url?: string;
  mimeType?: string;
  name?: string;
  format?: string; // e.g. 'pdf', 'txt'
}): Attachment {
  // Validate inputs
  validateFilename(params.name);
  validateUrl(params.url);
  validateAttachmentSize(typeof params.data === 'string' ? params.data : undefined);
  
  const base64 = processBase64Data(params.data);
  
  // Ensure at least one content source
  if (!params.url && !base64) {
    throw new Error('File attachment must have either url or data');
  }
  
  // Validate format if provided
  if (params.format && params.format.length > 10) {
    throw new Error('File format must be 10 characters or less');
  }

  return {
    kind: 'file',
    mimeType: params.mimeType,
    name: params.name,
    url: params.url,
    data: base64,
    format: params.format
  };
}

export function makeDocumentAttachment(params: {
  data?: Buffer | string;
  url?: string;
  mimeType?: string;
  name?: string;
  format?: string; // e.g. 'pdf', 'docx'
}): Attachment {
  // Additional validation for documents
  validateMimeType(params.mimeType, ALLOWED_DOCUMENT_MIME_TYPES, 'document');
  
  const attachment = makeFileAttachment({ ...params, format: params.format, mimeType: params.mimeType });
  return {
    ...attachment,
    kind: 'document'
  };
}



// Enhanced validation for existing attachments
export function validateAttachment(att: Attachment): void {
  if (!att.url && !att.data) {
    throw new Error('Attachment must have either url or data');
  }
  
  validateFilename(att.name);
  validateUrl(att.url);
  
  if (att.data) {
    validateAttachmentSize(att.data);
    if (!validateBase64(att.data)) {
      throw new Error('Invalid base64 data in attachment');
    }
  }
  
  // Validate MIME type based on attachment kind
  switch (att.kind) {
    case 'image':
      validateMimeType(att.mimeType, ALLOWED_IMAGE_MIME_TYPES, 'image');
      break;
    case 'document':
      validateMimeType(att.mimeType, ALLOWED_DOCUMENT_MIME_TYPES, 'document');
      break;
    case 'file':
      // Files can have any MIME type, but still validate format
      if (att.format && att.format.length > 10) {
        throw new Error('File format must be 10 characters or less');
      }
      break;
  }
}

// Legacy function for backwards compatibility
export function assertNonEmptyAttachment(att: Attachment): void {
  validateAttachment(att);
}

// Export validation constants for external use
export const ATTACHMENT_LIMITS = {
  MAX_SIZE: MAX_ATTACHMENT_SIZE,
  MAX_FILENAME_LENGTH,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
} as const;

