/**
 * Whom an email reply goes to (core 108). Client-safe and pure; the TypeScript twin of salesbrain-core
 * policy/email_people.py (parse_addresses, default_recipients): change both.
 */

export interface Recipients { to: string[]; cc: string[]; bcc: string[] }
export const NO_RECIPIENTS: Recipients = { to: [], cc: [], bcc: [] };

const ADDR = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/;
export const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** [{name, email}] from a To / Cc / From line; a comma inside a quoted name does not split. */
export function parseAddresses(header: string | null | undefined): { name: string | null; email: string }[] {
  const out: { name: string | null; email: string }[] = [];
  for (const raw of (header || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const part = raw.trim();
    const m = part.match(ADDR);
    if (!m) continue;
    const email = m[0].toLowerCase();
    let name: string | null = part.includes('<') ? part.split('<')[0].trim().replace(/^["']|["']$/g, '').trim() || null : null;
    if (name && name.toLowerCase() === email) name = null;
    out.push({ name, email });
  }
  return out;
}

export function cleanRecipients(r: Partial<Recipients> | null | undefined, ours: string[] = []): Recipients {
  const mine = new Set(ours.map((a) => a.toLowerCase()));
  const seen = new Set<string>();
  const out: Recipients = { to: [], cc: [], bcc: [] };
  for (const k of ['to', 'cc', 'bcc'] as const) {
    for (const v of r?.[k] || []) {
      const e = String(v || '').trim().replace(/^<|>$/g, '').toLowerCase();
      if (!EMAIL_RE.test(e) || seen.has(e) || mine.has(e)) continue;
      seen.add(e);
      out[k].push(e);
    }
  }
  return out;
}

/** Reply-all as a mail program does it: To = whoever wrote last, the rest of that message in Cc, never us. When we
 *  wrote last (a follow-up): the same people as our last message. Messages oldest first. */
export function replyAll(messages: { from_me: boolean | null; from?: string | null; to?: string | null; cc?: string | null }[], ours: string[]): Recipients {
  const mine = new Set(ours.map((a) => a.toLowerCase()));
  const msgs = messages.filter((m) => m.from || m.to);
  let theirs = -1; let ourLast = -1;
  msgs.forEach((m, i) => { if (m.from_me) ourLast = i; else theirs = i; });
  if (ourLast > theirs && ourLast >= 0) {
    const m = msgs[ourLast];
    return cleanRecipients({ to: parseAddresses(m.to).map((a) => a.email), cc: parseAddresses(m.cc).map((a) => a.email) }, ours);
  }
  if (theirs < 0) return { ...NO_RECIPIENTS };
  const m = msgs[theirs];
  const sender = parseAddresses(m.from).map((a) => a.email).filter((e) => !mine.has(e)).slice(0, 1);
  const others = [...parseAddresses(m.to), ...parseAddresses(m.cc)].map((a) => a.email).filter((e) => !mine.has(e) && !sender.includes(e));
  return cleanRecipients({ to: sender, cc: others }, ours);
}

/** Names seen for each address across the messages ("Michael Nguyen" for michael.nguyen@greenlyte.tech). */
export function namesOf(messages: { from?: string | null; to?: string | null; cc?: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of messages) {
    for (const a of [...parseAddresses(m.from), ...parseAddresses(m.to), ...parseAddresses(m.cc)]) {
      if (a.name && !out[a.email]) out[a.email] = a.name;
    }
  }
  return out;
}
