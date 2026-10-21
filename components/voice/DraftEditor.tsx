'use client';

import { useState } from 'react';
import type { VoiceFlag } from '@/lib/voice';

/**
 * Edit a pending draft in place (Brand & Voice, core 079). The model's version is kept on the server, so the change
 * can be rated and learned from; the Telegram card is updated with the new text. Nothing is sent.
 */
export default function DraftEditor({ approvalId, text, onSaved, onCancel }: {
  approvalId: string; text: string; onSaved: (text: string, flags: VoiceFlag[]) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/drafts/${approvalId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit', text: value }) });
      const out = await r.json();
      if (!r.ok || out.error) { setErr(out.error || 'Could not save'); return; }
      onSaved(value.trim(), Array.isArray(out.check_flags) ? out.check_flags : []);
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(14, Math.max(4, value.split('\n').length + 1))}
        aria-label="Edit the draft" className="w-full text-xs rounded-lg p-2"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)', color: 'var(--text)', fontFamily: 'inherit' }} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || !value.trim() || value.trim() === text.trim()}
          className="px-3 py-1 rounded-md text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
          {busy ? 'Saving…' : 'Save text'}
        </button>
        <button onClick={onCancel} className="px-3 py-1 rounded-md text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Cancel</button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Your edit teaches your voice. Nothing is sent until you approve.</span>
      </div>
      {err && <div className="text-[11px]" style={{ color: 'var(--red)' }}>{err}</div>}
    </div>
  );
}
