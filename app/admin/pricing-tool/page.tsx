'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';

interface ToolRow {
  id: string;
  version: number;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  is_active: boolean;
  notes: string | null;
  uploaded_by_name: string | null;
}

export default function PricingToolAdmin() {
  const [rows, setRows] = useState<ToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/pricing/tools');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setRows(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (notes.trim()) fd.append('notes', notes.trim());
      const res = await fetch('/api/pricing/tools', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      flash(`Uploaded v${json.version}${json.is_active ? ' (auto-activated as first version)' : ''}`);
      setFile(null);
      setNotes('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    if (!confirm('Make this the active pricing tool? New quotes will use this version. Past quotes keep their snapshot values.')) return;
    try {
      const res = await fetch(`/api/pricing/tools/${id}/activate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      flash('Activated');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <header className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Pricing Tool</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Upload a new .xlsx whenever you tweak pricing. The active version is used by all new quotes. Older quotes keep their saved snapshots — they don't change retroactively. Anyone on the team can upload and activate versions; each version records who shipped it.
          </p>
        </header>

        <div className="p-6 max-w-3xl mx-auto space-y-6">
          {/* Upload */}
          <section className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Upload a new version</h2>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="w-full text-sm"
              style={{ color: 'var(--text)' }}
            />
            {file && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
            <label className="block mt-3">
              <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
                Changelog notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Adjusted LLM cost from $2.5/day to $1.10/day"
                className="w-full px-2 py-1.5 rounded border text-sm"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </label>
            <button
              onClick={upload}
              disabled={!file || busy}
              className="mt-3 px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#0b1220' }}
            >
              {busy ? 'Uploading…' : 'Upload'}
            </button>
            {error && <p className="mt-2 text-sm" style={{ color: '#fb7185' }}>{error}</p>}
          </section>

          {/* Version list */}
          <section>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Versions</h2>
            {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
            {!loading && rows.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No pricing tool uploaded yet. Upload your Excel above to get started.
              </p>
            )}
            <div className="space-y-2">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg p-3 flex items-center justify-between"
                  style={{
                    background: 'var(--bg-card)',
                    border: `1px solid ${r.is_active ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>v{r.version}</span>
                      {r.is_active && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>Active</span>
                      )}
                      <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{r.filename}</span>
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      Uploaded by {r.uploaded_by_name ?? 'unknown'} · {new Date(r.uploaded_at).toLocaleString()} · {(r.size_bytes / 1024).toFixed(1)} KB
                    </p>
                    {r.notes && <p className="text-xs mt-1" style={{ color: 'var(--text)' }}>“{r.notes}”</p>}
                  </div>
                  {!r.is_active && (
                    <button
                      onClick={() => activate(r.id)}
                      className="ml-3 px-2 py-1 rounded text-xs border flex-shrink-0"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                      Activate
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        {toast && (
          <div className="fixed bottom-4 right-4 px-3 py-2 rounded text-sm shadow-lg"
               style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
