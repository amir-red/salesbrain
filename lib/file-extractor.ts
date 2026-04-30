import mammoth from 'mammoth';

/**
 * File-handling rules for chat attachments.
 *
 * - Text-like (txt, md, csv): read as UTF-8.
 * - DOCX: extract via mammoth.
 * - PDF: do NOT extract here; we let Claude read it natively as a `document`
 *   content block (much higher fidelity than text extraction, especially for
 *   pitch decks with tables/diagrams).
 * - Images (PNG, JPEG, WebP, GIF): pass through to Claude as `image` blocks.
 * - Anything else: rejected at the upload endpoint.
 */

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per file

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export type AttachmentKind = 'text' | 'pdf' | 'image';

export function classify(mime: string): AttachmentKind | null {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime.startsWith('text/') ||
    mime === 'application/json'
  ) {
    return 'text';
  }
  return null;
}

/**
 * Extracts plain text from a file buffer when possible. Returns null for
 * binary types (PDF, image) which are sent to Claude as native blobs.
 */
export async function extractText(buffer: Buffer, mime: string, filename: string): Promise<string | null> {
  // DOCX → mammoth
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch (err) {
      console.error(`[file-extractor] DOCX extraction failed for ${filename}:`, err);
      return '';
    }
  }

  // text/plain, text/markdown, text/csv, application/json
  if (mime.startsWith('text/') || mime === 'application/json') {
    try {
      return buffer.toString('utf8');
    } catch (err) {
      console.error(`[file-extractor] UTF-8 decode failed for ${filename}:`, err);
      return '';
    }
  }

  // PDF, image, etc. → no extraction
  return null;
}

/**
 * Build an Anthropic content block for an attachment.
 * Returns one of: text block (with extracted content), document block (PDF),
 * or image block. The shape matches @anthropic-ai/sdk types.
 */
export function buildContentBlock(
  attachment: {
    filename: string;
    mime_type: string;
    extracted_text: string | null;
  },
  fileBuffer?: Buffer
): { type: 'text'; text: string } | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | null {
  const kind = classify(attachment.mime_type);

  if (kind === 'text') {
    const text = attachment.extracted_text || '';
    return {
      type: 'text',
      text: `## Attached file: ${attachment.filename}\n\n${text}`,
    };
  }

  if (kind === 'pdf' && fileBuffer) {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: fileBuffer.toString('base64'),
      },
    };
  }

  if (kind === 'image' && fileBuffer) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mime_type,
        data: fileBuffer.toString('base64'),
      },
    };
  }

  return null;
}
