/** Lead import: the fields a file column can map to, and the header guesses. Pure, client-safe. */

export const IMPORT_FIELDS = [
  { key: 'full_name', label: 'Full name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title / role' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedin_url', label: 'LinkedIn URL' },
  { key: 'website', label: 'Website' },
  { key: 'met_at', label: 'Where we met' },
  { key: 'priority', label: 'Priority (1–10)' },
  { key: 'must_talk', label: 'Must talk (yes/no)' },
  { key: 'notes', label: 'Notes' },
] as const;
export type ImportField = typeof IMPORT_FIELDS[number]['key'];

/** The downloadable template: one column per field, named the way guessField reads them, plus an example row. */
export const TEMPLATE_COLUMNS: { header: string; field: ImportField; example: string; help: string }[] = [
  { header: 'Full name', field: 'full_name', example: 'Anna Berg', help: 'Required (or fill First name + Last name instead).' },
  { header: 'First name', field: 'first_name', example: '', help: 'Use with Last name when the file splits names.' },
  { header: 'Last name', field: 'last_name', example: '', help: '' },
  { header: 'Company', field: 'company', example: 'Berg Plastics GmbH', help: 'Used to spot duplicates (same name at the same company).' },
  { header: 'Title', field: 'title', example: 'Geschäftsführerin', help: '' },
  { header: 'Email', field: 'email', example: 'anna@berg-plastics.de', help: 'One address. Used to spot duplicates.' },
  { header: 'Phone', field: 'phone', example: '+49 151 2345678', help: '' },
  { header: 'LinkedIn URL', field: 'linkedin_url', example: 'https://www.linkedin.com/in/anna-berg', help: 'The profile link (linkedin.com/in/…). Saves the lookup.' },
  { header: 'Website', field: 'website', example: 'berg-plastics.de', help: '' },
  { header: 'Where we met', field: 'met_at', example: 'Fakuma 2026', help: 'Empty = the default you set in the import.' },
  { header: 'Priority', field: 'priority', example: '2', help: '1 (top) … 10. Empty = the default you set.' },
  { header: 'Must talk', field: 'must_talk', example: 'yes', help: 'yes / no: stars the lead.' },
  { header: 'Notes', field: 'notes', example: 'Met at the stand, interested in quoting automation.', help: 'Free text, lands on the lead card.' },
];

// Lower-cased header words → field. English and German, the way LinkedIn exports, CRMs and fair lists name them.
const GUESSES: [RegExp, ImportField][] = [
  [/^(full ?name|name|contact( name)?|person|ansprechpartner|kontakt)$/, 'full_name'],
  [/^(first ?name|given name|vorname)$/, 'first_name'],
  [/^(last ?name|surname|family name|nachname)$/, 'last_name'],
  [/^(company|organi[sz]ation|firm|firma|unternehmen|account|employer|company name)$/, 'company'],
  [/^(title|job ?title|position|role|funktion|titel|headline)$/, 'title'],
  [/^(e-?mail|email address|e-?mail-?adresse|mail)$/, 'email'],
  [/^(phone|mobile|telephone|tel\.?|telefon|handy|mobil|phone number)$/, 'phone'],
  [/^(linkedin|linkedin ?url|linkedin profile|profile ?url|url linkedin)$/, 'linkedin_url'],
  [/^(website|web|url|homepage|webseite|domain)$/, 'website'],
  [/^(met( at)?|where (we )?met|event|messe|source|quelle)$/, 'met_at'],
  [/^(priority|prio|priorität)$/, 'priority'],
  [/^(must ?talk|star|starred|wichtig)$/, 'must_talk'],
  [/^(notes?|comments?|notiz(en)?|bemerkung(en)?|kommentar)$/, 'notes'],
];

export function guessField(header: string): ImportField | '' {
  const h = header.trim().toLowerCase().replace(/[_*:]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, f] of GUESSES) if (re.test(h)) return f;
  return '';
}

export type ImportRow = Partial<Record<ImportField, string>>;

/** Apply a column → field mapping to raw rows (arrays of cell strings). Empty rows are dropped. */
export function mapRows(rows: string[][], mapping: (ImportField | '')[]): ImportRow[] {
  const out: ImportRow[] = [];
  for (const r of rows) {
    const o: ImportRow = {};
    mapping.forEach((f, i) => {
      const v = (r[i] ?? '').toString().trim();
      if (!f || !v) return;
      o[f] = o[f] ? `${o[f]} ${v}` : v;
    });
    if (Object.keys(o).length) out.push(o);
  }
  return out;
}

export interface ImportResult {
  row: number; status: 'new' | 'created' | 'duplicate' | 'error'; name?: string | null; company?: string | null;
  reason?: string; lead_id?: string; duplicate_of?: string;
}
export interface ImportSummary {
  dry_run: boolean; rows: number; new: number; created: number; duplicate: number; error: number;
  prospects_linked: number; source: string; results: ImportResult[];
  /** Only for an import into one prospect list (icp_id). */
  list_name?: string; added_to_list?: number;
}
