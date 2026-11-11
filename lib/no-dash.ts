/**
 * No dashes as punctuation in anything we write (Amir, 2026-11-11: "DO NOT EVER USE em dash (—), never ever").
 * The TypeScript twin of salesbrain-core policy/writing.py: change both. Pure.
 */

export const NO_DASH_RULE = 'Never use the em dash character (—) or a spaced en dash ( – ) anywhere: write a comma, a full stop, a colon or brackets instead.';


export function stripDashes(text: string): string {
  if (!text || !/[—―–]/.test(text)) return text;
  return text.split('\n').map((line) => {
    if (!/[—―–]/.test(line)) return line;   // a line without a dash is left exactly as it is
    const lead = line.match(/^[ \t]*/)?.[0] ?? '';
    let l = line.slice(lead.length).replace(/^[—―–]\s*/, '- ');
    l = l.replace(/\s*[—―]\s*$/, ',').replace(/\s+–\s*$/, ',');
    l = l.replace(/\s*[—―]\s*/g, ', ').replace(/\s+–\s+/g, ', ');
    l = l.replace(/–/g, '-');
    l = l.replace(/,\s*([,.;:!?])/g, '$1').replace(/\(\s*,\s*/g, '(').replace(/,\s*\)/g, ')').replace(/(?<=\S)[ \t]{2,}/g, ' ');
    return lead + l.replace(/\s+$/, '');
  }).join('\n');
}

export function stripDashesDeep<T>(value: T): T {
  if (typeof value === 'string') return stripDashes(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripDashesDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripDashesDeep(v)])) as T;
  }
  return value;
}
