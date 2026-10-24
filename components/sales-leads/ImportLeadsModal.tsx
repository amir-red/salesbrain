'use client';

import { useEffect, useMemo, useState } from 'react';
import { IMPORT_FIELDS, mapRows, type ImportField, type ImportSummary } from '@/lib/lead-import';
import type { TeamUser } from '@/lib/sales-leads';
import ExportButton from '@/components/ExportButton';

/**
 * Import a list of leads from a CSV or Excel file, or rows pasted from a sheet: 1 choose → 2 match the columns and set
 * the defaults → 3 preview (new / duplicate / error per row, nothing written) → import. POST /api/sales-leads/import;
 * the kernel dedupes, fills the roles and gives every created lead its prospect. Opened from a prospect list (/icp/[id])
 * with `list`, the new prospects land on that list, scored against it, and its owner is the default back office.
 */
type Step = 'upload' | 'map' | 'preview' | 'done';
const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'var(--green)' }, created: { label: 'Imported', color: 'var(--green)' },
  duplicate: { label: 'Already a lead', color: 'var(--orange)' }, error: { label: 'Cannot import', color: 'var(--red)' },
};

export default function ImportLeadsModal({ users: given, list, onClose, onImported }: {
  users?: TeamUser[]; list?: { id: string; name: string; ownerName?: string };
  onClose: () => void; onImported: (n: number, listName: string) => void;
}) {
  const [step, setStep] = useState<Step>('upload');
  const [source, setSource] = useState<'file' | 'paste'>('file');
  const [pasted, setPasted] = useState('');
  const [fetched, setFetched] = useState<TeamUser[]>([]);
  const users = given ?? fetched;
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(ImportField | '')[]>([]);
  const [defaults, setDefaults] = useState({ list_name: '', met_at: '', priority: '', responsible: '', front: '' });
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (given) return;
    fetch('/api/sales-leads/import').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.users) setFetched(d.users); }).catch(() => {});
  }, [given]);

  const mapped = useMemo(() => mapRows(rows, mapping), [rows, mapping]);
  const hasName = mapping.includes('full_name') || mapping.includes('first_name') || mapping.includes('last_name');

  async function read(input: File | string) {
    const isFile = typeof input !== 'string';
    setBusy(true); setError(null); setFileName(isFile ? input.name : 'Pasted rows');
    try {
      const fd = new FormData();
      if (isFile) fd.append('file', input); else fd.append('text', input);
      const res = await fetch('/api/sales-leads/import', { method: 'POST', body: fd });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'Could not read the rows.');
      setHeaders(out.headers); setRows(out.rows); setMapping(out.mapping);
      if (isFile && !list) setDefaults((d) => ({ ...d, list_name: d.list_name || input.name.replace(/\.(csv|xlsx?|txt|tsv)$/i, '') }));
      setStep('map');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not read the rows.'); }
    finally { setBusy(false); }
  }

  async function run(dry: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/sales-leads/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: mapped, ...defaults, priority: defaults.priority || undefined, icp_id: list?.id, dry_run: dry }),
      });
      const out = await res.json();
      // `error` in a summary is the COUNT of rows that cannot be imported; only a string is a failure of the call.
      if (!res.ok || typeof out.error === 'string') throw new Error(typeof out.error === 'string' ? out.error : 'The import failed.');
      setSummary(out); setStep(dry ? 'preview' : 'done');
      if (!dry) onImported(out.created, list?.name || defaults.list_name);
    } catch (err) { setError(err instanceof Error ? err.message : 'The import failed.'); }
    finally { setBusy(false); }
  }

  const select = (k: keyof typeof defaults, label: string, opts: { value: string; label: string }[], empty: string) => (
    <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
      {label}
      <select id={`imp-${k}`} value={defaults[k]} onChange={(e) => setDefaults((d) => ({ ...d, [k]: e.target.value }))} className="z-input text-sm">
        <option value="">{empty}</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const people = users.map((u) => ({ value: u.email, label: u.name }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: 'color-mix(in srgb, var(--text) 35%, transparent)' }}
      role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="z-card w-full max-w-4xl p-6 grid gap-5" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="z-eyebrow mb-1">{list ? 'Prospect list · add people' : 'Sales leads · import'}</div>
            <h2 id="import-title" className="text-lg font-semibold">{list ? `Add people to “${list.name}”` : 'Import a list'}</h2>
            <ol className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" aria-label="Steps">
              {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
                <li key={s} style={{ color: step === s ? 'var(--text)' : 'var(--text-muted)', fontWeight: step === s ? 600 : 400 }}>
                  {i + 1}. {s === 'upload' ? 'Choose a file or paste' : s === 'map' ? 'Match columns' : s === 'preview' ? 'Check' : 'Done'}
                </li>
              ))}
            </ol>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-sm px-2" aria-label="Close" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {step === 'upload' && (
          <div className="flex gap-1 text-sm" role="tablist" aria-label="Where the rows come from">
            {(['file', 'paste'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={source === k} onClick={() => { setSource(k); setError(null); }}
                className="px-3 py-1.5 rounded-full" style={source === k ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                {k === 'file' ? 'Upload a file' : 'Paste rows'}
              </button>
            ))}
          </div>
        )}
        {step === 'upload' && source === 'paste' && (
          <div className="grid gap-2">
            <label htmlFor="imp-paste" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Copy the rows from Excel or Google Sheets, header row included, and paste them here. Comma- or semicolon-separated text works too.
            </label>
            <textarea id="imp-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={10} disabled={busy}
              className="z-input font-mono text-xs resize-y" spellCheck={false}
              placeholder={'Name, Company, Title, Email\nAnna Berg, Berg Plastics GmbH, Geschäftsführerin, anna@berg-plastics.de'} />
            <div className="flex justify-end">
              <button type="button" onClick={() => read(pasted)} disabled={busy || !pasted.trim()} className="z-btn text-sm">{busy ? 'Reading…' : 'Read the rows'}</button>
            </div>
          </div>
        )}
        {step === 'upload' && source === 'file' && (
          <label className="grid place-items-center gap-2 rounded-xl p-10 text-center cursor-pointer" style={{ border: '2px dashed var(--border)', background: 'var(--bg-input)' }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) read(f); }}>
            <span className="text-sm font-medium">{busy ? `Reading ${fileName}…` : 'Drop a CSV or Excel file here, or click to choose'}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>One person per row, with a header row. Up to 2,000 rows. A LinkedIn connections export works as it is.</span>
            <input id="imp-file" type="file" accept=".csv,.xlsx,.xls,.txt" className="sr-only" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
          </label>
        )}
        {step === 'upload' && (
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>No file yet? Start from the template; its columns are matched without any changes.</span>
            <ExportButton href="/api/sales-leads/import/template?format=xlsx" label="Template (Excel)" title="Download the lead-import template with an example row and a sheet that explains each column" />
            <ExportButton href="/api/sales-leads/import/template?format=csv" label="Template (CSV)" title="The same template as a CSV file" />
          </div>
        )}

        {step === 'map' && (
          <>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}><b style={{ color: 'var(--text)' }}>{fileName}</b> · {rows.length} row{rows.length === 1 ? '' : 's'}. Check what each column holds; columns set to “Skip” are not imported.</p>
            <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-sm">
                <thead><tr style={{ background: 'var(--bg-input)' }}>
                  <th className="text-left px-3 py-2 font-medium">Column in the file</th><th className="text-left px-3 py-2 font-medium">Goes into</th><th className="text-left px-3 py-2 font-medium">Example</th>
                </tr></thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-2">{h}</td>
                      <td className="px-3 py-2">
                        <select id={`imp-map-${i}`} value={mapping[i]} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value as ImportField | '' : x)))} className="z-input text-sm py-1">
                          <option value="">Skip</option>
                          {IMPORT_FIELDS.map((fd) => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[18rem]" style={{ color: 'var(--text-muted)' }}>{rows.find((r) => (r[i] || '').trim())?.[i] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list && (
              <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'var(--bg-input)' }}>
                New people go onto <b>{list.name}</b> and are scored against it; they also get a card on Sales leads.
                Someone who is already a prospect stays on the list they are on.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {!list && (
                <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  List name
                  <input id="imp-list" value={defaults.list_name} onChange={(e) => setDefaults((d) => ({ ...d, list_name: e.target.value }))} className="z-input text-sm" placeholder="Hannover Messe 2027" />
                </label>
              )}
              <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Where we met (for rows without one)
                <input id="imp-met" value={defaults.met_at} onChange={(e) => setDefaults((d) => ({ ...d, met_at: e.target.value }))} className="z-input text-sm" placeholder="Hannover Messe 2027" />
              </label>
              {select('priority', 'Priority (for rows without one)', Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `P${i + 1}` })), 'Not set')}
              {select('responsible', 'Back office', people, list ? (list.ownerName ? `${list.ownerName} (list owner)` : 'The list owner') : 'Me')}
              {select('front', 'Front office', people, 'Same as back office')}
            </div>
            {!hasName && <p className="text-sm" role="alert" style={{ color: 'var(--red)' }}>Pick the column with the person’s name (Full name, or First and Last name).</p>}
          </>
        )}

        {(step === 'preview' || step === 'done') && summary && (
          <>
            <div className="flex flex-wrap gap-6">
              {(step === 'preview' ? ['new', 'duplicate', 'error'] : ['created', 'duplicate', 'error']).map((k) => (
                <div key={k}><div className="text-2xl font-semibold tabular-nums" style={{ color: STATUS_STYLE[k].color }}>{summary[k as 'new']}</div>
                  <div className="z-eyebrow">{k === 'new' ? 'will be added' : k === 'created' ? 'added' : k === 'duplicate' ? 'already leads, skipped' : 'cannot be imported'}</div></div>
              ))}
              {step === 'done' && (list
                ? <div><div className="text-2xl font-semibold tabular-nums">{summary.added_to_list ?? 0}</div><div className="z-eyebrow">put on this list</div></div>
                : <div><div className="text-2xl font-semibold tabular-nums">{summary.prospects_linked}</div><div className="z-eyebrow">linked to the prospect pipeline</div></div>)}
            </div>
            <div className="overflow-x-auto max-h-80 rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ background: 'var(--bg-input)' }}><tr>
                  <th className="text-left px-3 py-2 font-medium w-14">Row</th><th className="text-left px-3 py-2 font-medium">Person</th><th className="text-left px-3 py-2 font-medium">Result</th>
                </tr></thead>
                <tbody>
                  {summary.results.slice(0, 500).map((r) => (
                    <tr key={r.row} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>{r.row}</td>
                      <td className="px-3 py-1.5">{r.name || '—'}{r.company ? <span style={{ color: 'var(--text-muted)' }}> · {r.company}</span> : null}</td>
                      <td className="px-3 py-1.5"><span style={{ color: STATUS_STYLE[r.status].color }}>{STATUS_STYLE[r.status].label}</span>{r.reason ? <span style={{ color: 'var(--text-muted)' }}> · {r.reason}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {step === 'done' && list && summary.created > (summary.added_to_list ?? 0) && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{summary.created - (summary.added_to_list ?? 0)} of them were already prospects on another list and stayed there.</p>
            )}
            {step === 'done' && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>The new leads are on Sales leads as New. The agents now look up their LinkedIn profiles and enrich them; each lead shows its next step.</p>}
          </>
        )}

        {error && <p className="text-sm rounded-lg px-3 py-2" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          {step === 'map' && <button type="button" onClick={() => setStep('upload')} disabled={busy} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>{source === 'paste' ? 'Edit the pasted rows' : 'Choose another file'}</button>}
          {step === 'preview' && <button type="button" onClick={() => setStep('map')} disabled={busy} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Back to columns</button>}
          {step === 'map' && <button type="button" onClick={() => run(true)} disabled={busy || !hasName || !mapped.length} className="z-btn text-sm">{busy ? 'Checking…' : `Check ${mapped.length} rows`}</button>}
          {step === 'preview' && summary && (
            <button type="button" onClick={() => run(false)} disabled={busy || !summary.new} className="z-btn text-sm">
              {busy ? 'Importing…' : summary.new ? `Import ${summary.new} new lead${summary.new === 1 ? '' : 's'}` : 'Nothing new to import'}
            </button>
          )}
          {(step === 'done' || step === 'upload') && <button type="button" onClick={onClose} disabled={busy} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>{step === 'done' ? 'Close' : 'Cancel'}</button>}
        </div>
      </div>
    </div>
  );
}
