import type { Attachment } from '../core/types.js';

// Lightweight helpers for constructing attachments consistently

export function makeImageAttachment(params: {
  data?: Buffer | string; // raw Buffer or base64 string
  url?: string;           // remote or data URL
  mimeType?: string;      // e.g. image/png
  name?: string;
}): Attachment {
  const base64 =
    typeof params.data === 'string'
      ? params.data
      : params.data
        ? params.data.toString('base64')
        : undefined;

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
  const base64 =
    typeof params.data === 'string'
      ? params.data
      : params.data
        ? params.data.toString('base64')
        : undefined;

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
  return makeFileAttachment({ ...params, format: params.format, mimeType: params.mimeType });
}

export function makeAudioAttachment(params: {
  data?: Buffer | string;
  url?: string;
  mimeType?: string;
  name?: string;
}): Attachment {
  const base64 =
    typeof params.data === 'string'
      ? params.data
      : params.data
        ? params.data.toString('base64')
        : undefined;

  return {
    kind: 'audio',
    mimeType: params.mimeType,
    name: params.name,
    url: params.url,
    data: base64
  };
}

export function makeVideoAttachment(params: {
  data?: Buffer | string;
  url?: string;
  mimeType?: string;
  name?: string;
}): Attachment {
  const base64 =
    typeof params.data === 'string'
      ? params.data
      : params.data
        ? params.data.toString('base64')
        : undefined;

  return {
    kind: 'video',
    mimeType: params.mimeType,
    name: params.name,
    url: params.url,
    data: base64
  };
}

// Basic guard for empty payloads
export function assertNonEmptyAttachment(att: Attachment): void {
  if (!att.url && !att.data) {
    throw new Error('Attachment must have either url or data');
  }
}

