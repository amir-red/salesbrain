/**
 * Parsers for imported messages from various sources.
 */

export interface ParsedMessage {
  direction: 'sent' | 'received' | 'unknown';
  sent_at: Date | null;
  body: string;
  from_name?: string;
  subject?: string;
}

/**
 * Parse a WhatsApp chat export (.txt).
 * Format varies slightly by platform but is usually:
 *   [DD/MM/YY, HH:MM:SS] Name: message body
 * or:
 *   [MM/DD/YY, HH:MM:SS AM/PM] Name: message body
 * or:
 *   DD/MM/YYYY, HH:MM - Name: message body
 *
 * Messages from `myName` are marked 'sent'; others are 'received'.
 */
export function parseWhatsAppExport(text: string, myName?: string): ParsedMessage[] {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const messages: ParsedMessage[] = [];

  // Common patterns:
  //   [12/04/25, 10:23:45] Amir: Hello
  //   12/04/25, 10:23 - Amir: Hello
  //   [12/4/25, 10:23:45 AM] Amir: Hello
  const bracketPattern = /^\[(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?\]\s+([^:]+):\s*(.*)$/;
  const dashPattern = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:-|–)\s*([^:]+):\s*(.*)$/;

  let current: ParsedMessage | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let match = line.match(bracketPattern);
    let groups: RegExpMatchArray | null = match;
    let hasAmPm = true;

    if (!groups) {
      match = line.match(dashPattern);
      groups = match;
      hasAmPm = false;
    }

    if (groups) {
      // Save previous message
      if (current) messages.push(current);

      const day = parseInt(groups[1], 10);
      const month = parseInt(groups[2], 10);
      let year = parseInt(groups[3], 10);
      if (year < 100) year += 2000;
      let hour = parseInt(groups[4], 10);
      const minute = parseInt(groups[5], 10);
      const second = groups[6] ? parseInt(groups[6], 10) : 0;
      const ampm = hasAmPm ? groups[7] : null;
      if (ampm && ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
      if (ampm && ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

      const name = hasAmPm ? groups[8]?.trim() : groups[7]?.trim();
      const body = hasAmPm ? groups[9] : groups[8];

      const sentAt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      const direction: ParsedMessage['direction'] = myName && name && name.toLowerCase().includes(myName.toLowerCase())
        ? 'sent'
        : 'received';

      current = {
        direction,
        sent_at: sentAt,
        body: body || '',
        from_name: name,
      };
    } else if (current) {
      // Continuation of previous message
      current.body += '\n' + line;
    }
  }
  if (current) messages.push(current);

  // Filter out system/media messages
  return messages.filter((m) => {
    const b = m.body.trim().toLowerCase();
    if (!b) return false;
    if (b === '<media omitted>') return false;
    if (b === 'null' || b === 'this message was deleted') return false;
    return true;
  });
}

/**
 * Parse a LinkedIn connections CSV export.
 * Expected header: First Name,Last Name,URL,Email Address,Company,Position,Connected On
 */
export interface LinkedInContact {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  linkedin_url: string | null;
  company: string | null;
  title: string | null;
  connected_on: string | null;
}

export function parseLinkedInContactsCsv(text: string): LinkedInContact[] {
  // LinkedIn export has a preamble of "Notes:" lines above the header — skip to the actual header row
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('first name') && l.includes('last name')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const header = parseCsvLine(lines[headerIdx]).map((h) => h.trim().toLowerCase());
  const idxFirst = header.indexOf('first name');
  const idxLast = header.indexOf('last name');
  const idxUrl = header.indexOf('url');
  const idxEmail = header.indexOf('email address');
  const idxCompany = header.indexOf('company');
  const idxPosition = header.indexOf('position');
  const idxConn = header.indexOf('connected on');

  const result: LinkedInContact[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const firstName = (cols[idxFirst] || '').trim();
    const lastName = (cols[idxLast] || '').trim();
    if (!firstName && !lastName) continue;

    result.push({
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim(),
      email: (cols[idxEmail] || '').trim() || null,
      linkedin_url: (cols[idxUrl] || '').trim() || null,
      company: (cols[idxCompany] || '').trim() || null,
      title: (cols[idxPosition] || '').trim() || null,
      connected_on: (cols[idxConn] || '').trim() || null,
    });
  }
  return result;
}

/**
 * Parse one CSV line with naive quote handling.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

/**
 * Dump arbitrary text as a single "unknown direction" message.
 * Useful when user pastes an email body or message with no structured format.
 */
export function parseGenericText(text: string, direction: ParsedMessage['direction'] = 'unknown'): ParsedMessage[] {
  if (!text.trim()) return [];
  return [{
    direction,
    sent_at: null,
    body: text.trim(),
  }];
}
