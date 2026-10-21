'use client';

import { useMemo, useState } from 'react';
import { FIRM_IMPORT_FIELDS, mapFirmRows, type FirmImportField, type FirmImportSummary } from '@/lib/firms';

/**
 * Put firms on this list from a CSV or Excel file: choose → match columns → check (nothing written) → import.
 * One firm per row; the same firm twice keeps the better-ranked row. POST /api/icp/[id]/firms.
 */
type Step = 'upload' | 'map' | 'preview' | 'done';
const STATUS: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'var(--green)' }, created: { label: 'Added', color: 'var(--green)' },
  duplicate: { label: 'Already on the list', color: 'var(--orange)' }, error: { label: 'Cannot import', color: 'var(--red)' },
};

export default function ImportFirmsModal({ icpId, onClose, onImported }: {
  icpId: string; onClose: () => void; onImported: (n: number) => void;
}) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(FirmImportField | '')[]>([]);
  const [summary, setSummary] = useState<FirmImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapped = useMemo(() => mapFirmRows(rows, mapping), [rows, mapping]);
  const hasFirm = mapping.includes('firm');

  async function upload(file: File) {
    setBusy(true); setError(null); setFileName(file.name);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/icp/${icpId}/firms`, { method: 'POST', body: fd });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'Could not read the file.');
      setHeaders(out.headers); setRows(out.rows); setMapping(out.mapping); setStep('map');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not read the file.'); }
    finally { setBusy(false); }
  }

  async function run(dry: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/icp/${icpId}/firms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: mapped, dry_run: dry }),
      });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'The import failed.');
      setSummary(out); setStep(dry ? 'preview' : 'done');
      if (!dry) onImported(out.created);
    } catch (err) { setError(err instanceof Error ? err.message : 'The import failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: 'color-mix(in srgb, var(--text) 35%, transparent)' }}
      role="dialog" aria-modal="true" aria-labelledby="firm-import-title" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="z-card w-full max-w-4xl p-6 grid gap-5" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="z-eyebrow mb-1">Firms · import</div>
            <h2 id="firm-import-title" className="text-lg font-semibold">Put firms on this list</h2>
            <ol className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" aria-label="Steps">
              {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
                <li key={s} style={{ color: step === s ? 'var(--text)' : 'var(--text-muted)', fontWeight: step === s ? 600 : 400 }}>
                  {i + 1}. {s === 'upload' ? 'Choose a file' : s === 'map' ? 'Match columns' : s === 'preview' ? 'Check' : 'Done'}
                </li>
              ))}
            </ol>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-sm px-2" aria-label="Close" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {step === 'upload' && (
          <label className="grid place-items-center gap-2 rounded-xl p-10 text-center cursor-pointer" style={{ border: '2px dashed var(--border)', background: 'var(--bg-input)' }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
            <span className="text-sm font-medium">{busy ? `Reading ${fileName}…` : 'Drop a CSV or Excel file here, or click to choose'}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>One firm per row with a header row: firm name, and ideally website, rank and priority. Up to 2,000 rows.</span>
            <input id="firm-imp-file" type="file" accept=".csv,.xlsx,.xls,.txt" className="sr-only" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          </label>
        )}

        {step === 'map' && (
          <>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}><b style={{ color: 'var(--text)' }}>{fileName}</b> · {rows.length} rows → {mapped.length} with a firm name. Columns set to “Skip” are kept out.</p>
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
                        <select id={`firm-imp-map-${i}`} value={mapping[i]} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value as FirmImportField | '' : x)))} className="z-input text-sm py-1">
                          <option value="">Skip</option>
                          {FIRM_IMPORT_FIELDS.map((fd) => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[18rem]" style={{ color: 'var(--text-muted)' }}>{rows.find((r) => (r[i] || '').trim())?.[i] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasFirm && <p className="text-sm" role="alert" style={{ color: 'var(--red)' }}>Pick the column with the firm’s name.</p>}
          </>
        )}

        {(step === 'preview' || step === 'done') && summary && (
          <>
            <div className="flex flex-wrap gap-6">
              {(step === 'preview' ? ['new', 'duplicate', 'error'] : ['created', 'duplicate', 'error']).map((k) => (
                <div key={k}><div className="text-2xl font-semibold tabular-nums" style={{ color: STATUS[k].color }}>{summary[k as 'new']}</div>
                  <div className="z-eyebrow">{k === 'new' ? 'will be added' : k === 'created' ? 'added' : k === 'duplicate' ? 'skipped as duplicates' : 'cannot be imported'}</div></div>
              ))}
            </div>
            <div className="overflow-x-auto max-h-80 rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ background: 'var(--bg-input)' }}><tr>
                  <th className="text-left px-3 py-2 font-medium w-14">Row</th><th className="text-left px-3 py-2 font-medium">Firm</th><th className="text-left px-3 py-2 font-medium">Result</th>
                </tr></thead>
                <tbody>
                  {summary.results.slice(0, 800).map((r) => (
                    <tr key={r.row} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>{r.row}</td>
                      <td className="px-3 py-1.5">{r.firm || '—'}</td>
                      <td className="px-3 py-1.5"><span style={{ color: STATUS[r.status].color }}>{STATUS[r.status].label}</span>{r.reason ? <span style={{ color: 'var(--text-muted)' }}> · {r.reason}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {step === 'done' && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>The firms are on the list as New. Use “Research next 25” to learn what they invest in; nothing is researched or sent until you ask.</p>}
          </>
        )}

        {error && <p className="text-sm rounded-lg px-3 py-2" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          {step === 'map' && <button type="button" onClick={() => setStep('upload')} disabled={busy} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Choose another file</button>}
          {step === 'preview' && <button type="button" onClick={() => setStep('map')} disabled={busy} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>Back to columns</button>}
          {step === 'map' && <button type="button" onClick={() => run(true)} disabled={busy || !hasFirm || !mapped.length} className="z-btn text-sm">{busy ? 'Checking…' : `Check ${mapped.length} firms`}</button>}
          {step === 'preview' && summary && (
            <button type="button" onClick={() => run(false)} disabled={busy || !summary.new} className="z-btn text-sm">
              {busy ? 'Importing…' : summary.new ? `Add ${summary.new} firm${summary.new === 1 ? '' : 's'}` : 'Nothing new to add'}
            </button>
          )}
          {(step === 'done' || step === 'upload') && <button type="button" onClick={onClose} disabled={busy} className="text-sm px-4 py-2 rounded-full" style={{ border: '1px solid var(--border)' }}>{step === 'done' ? 'Close' : 'Cancel'}</button>}
        </div>
      </div>
    </div>
  );
}
