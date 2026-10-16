'use client';

import { useState } from 'react';

/**
 * Downloads an .xlsx from /api/export/… with the page's current filters. A plain fetch (not a link) so a failure
 * (expired session, ICP not visible) shows a message instead of replacing the page with JSON.
 */
export default function ExportButton({ href, label = 'Export Excel', title, className = '' }: {
  href: string; label?: string; title?: string; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Export failed (${res.status})`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'salesbrain-export.xlsx';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
      setTimeout(() => setErr(null), 6000);
    } finally { setBusy(false); }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={go} disabled={busy} title={title}
        className={`text-xs px-3 py-1.5 rounded-full disabled:opacity-50 ${className}`}
        style={{ border: '1px solid var(--border)', color: 'var(--text)', background: 'transparent' }}>
        {busy ? 'Preparing…' : label}
      </button>
      {err && <span className="text-xs" style={{ color: 'var(--red)' }}>{err}</span>}
    </span>
  );
}
