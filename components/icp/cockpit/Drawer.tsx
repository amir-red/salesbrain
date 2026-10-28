'use client';

import { useEffect, type ReactNode } from 'react';

/** A panel that slides over the right of the page: the list page keeps its leads table in view and opens details here. */
export default function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default"
        style={{ background: 'color-mix(in srgb, var(--text) 25%, transparent)' }} />
      <div className="relative h-full w-full max-w-[760px] overflow-y-auto shadow-xl" style={{ background: 'var(--bg)', borderLeft: '1px solid var(--border)' }}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Close</button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}
