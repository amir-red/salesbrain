/**
 * The plain-text email we send from a person's own Gmail, as RFC 2822 (pure: no IO, so a script can test it).
 * With files (core 104) it is multipart/mixed: the text first, then one base64 part per file.
 */

/** RFC 2047 for a header with non-ASCII text (umlauts in a subject or a name). */
export function encodeHeader(v: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

export function cleanHeader(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').trim();
}

export interface MimeFile { name: string; mime: string; content: Buffer }

function b64lines(buf: Buffer): string {
  return buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

/** A file name in a MIME header: plain when ASCII, RFC 2047 otherwise, plus the RFC 2231 form mail programs prefer. */
function fileParams(name: string): string {
  const clean = cleanHeader(name).replace(/"/g, "'");
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return `filename="${clean}"`;
  return `filename="${encodeHeader(clean)}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

export function buildMime(o: { from: string; fromName?: string | null; to: string; subject: string; body: string; inReplyTo?: string | null; files?: MimeFile[] }): string {
  const from = o.fromName ? `${encodeHeader(cleanHeader(o.fromName))} <${cleanHeader(o.from)}>` : cleanHeader(o.from);
  const lines = [
    `From: ${from}`,
    `To: ${cleanHeader(o.to)}`,
    `Subject: ${encodeHeader(cleanHeader(o.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (o.inReplyTo) lines.push(`In-Reply-To: ${cleanHeader(o.inReplyTo)}`, `References: ${cleanHeader(o.inReplyTo)}`);
  const body = b64lines(Buffer.from(o.body.replace(/\r?\n/g, '\r\n'), 'utf8'));
  if (!o.files?.length) return `${lines.join('\r\n')}\r\n\r\n${body}`;
  // With files (core 104): multipart/mixed — the text first, then one base64 part per file.
  const boundary = `sb_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const head = lines.filter((l) => !l.startsWith('Content-Type:') && !l.startsWith('Content-Transfer-Encoding:'));
  head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`,
    ...o.files.map((f) => `--${boundary}\r\nContent-Type: ${cleanHeader(f.mime || 'application/octet-stream')}\r\n`
      + `Content-Disposition: attachment; ${fileParams(f.name)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(f.content)}`),
  ];
  return `${head.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--\r\n`;
}
