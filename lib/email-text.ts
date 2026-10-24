/**
 * Email text helpers, pure (no imports) so a script can test them: flatten an HTML part, and cut the quoted history
 * off a reply so the Inbox shows only what the person wrote this time.
 */

export function unescapeHtml(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function htmlToText(html: string): string {
  return unescapeHtml(html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<blockquote[\s\S]*$/i, '')       // Gmail's quoted history in the HTML part
    .replace(/<[^>]+>/g, '')).replace(/&nbsp;/g, ' ');
}

/**
 * The new part of a message: everything before the quoted history ("On … wrote:", "Am … schrieb …:", Outlook's
 * "From: … Sent:" block, "-----Original Message-----", or a run of "> " lines). Exported for the tests.
 */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const two = `${l} ${(lines[i + 1] || '').trim()}`;
    if (/^-{2,}\s*(original message|ursprüngliche nachricht)/i.test(l)) break;
    // "On … wrote:" / "Am … schrieb Name <addr>:" — the verb can sit before the name (German) or at the end
    if (/^(on|am|le|el)\s.{4,240}\b(wrote|schrieb|a écrit|escribió)\b.{0,120}:$/i.test(l)) break;
    if (/^(on|am)\s.{4,240}\b(wrote|schrieb)\b.{0,120}:$/i.test(two) && !/\b(wrote|schrieb)\b/i.test(l)) break;
    if (/^(from|von):\s.+/i.test(l) && lines.slice(i + 1, i + 4).some((x) => /^(sent|gesendet|date|datum):/i.test(x.trim()))) break;
    if (l.startsWith('>') && lines.slice(i, i + 2).every((x) => x.trim().startsWith('>') || !x.trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
