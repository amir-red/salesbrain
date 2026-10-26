'use client';

/**
 * "Import a WhatsApp chat" on /warm: the closest relationships live on WhatsApp (Mateo, 2026-10-26), which no API
 * reaches. Export a one-to-one chat on the phone (Export chat → Without media) and drop the file here; its messages
 * count towards warmth like LinkedIn and email conversations. Importing the same chat again adds nothing.
 */
import { useState } from 'react';

interface Candidate { person_id: string; name: string; company: string | null }

export default function WhatsAppImport({ onDone }: { onDone: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [contact, setContact] = useState('');
  const [myName, setMyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const pickFile = (f: File | null) => {
    setFile(f); setError(null); setCandidates([]);
    const m = f?.name.replace(/\.(txt|zip)$/i, '').match(/chat\s+(?:with|mit|avec|con)\s+(.+)$/i);
    if (m && !contact) setContact(m[1].trim());
  };

  const send = async (personId?: string) => {
    if (!file) return;
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append('file', file);
    if (contact.trim()) fd.append('contact', contact.trim());
    if (myName.trim()) fd.append('my_name', myName.trim());
    if (personId) fd.append('person_id', personId);
    fd.append('tz_offset_minutes', String(-new Date().getTimezoneOffset()));
    try {
      const res = await fetch('/api/warm/whatsapp', { method: 'POST', body: fd });
      const out = await res.json();
      if (!res.ok || out.error) {
        setError(out.error || `Not imported (${res.status})`);
        setCandidates(Array.isArray(out.candidates) ? out.candidates : []);
        return;
      }
      setOpen(false); setFile(null); setContact(''); setCandidates([]);
      onDone(out.imported
        ? `WhatsApp with ${out.person.name}: ${out.imported} messages imported (${out.inbound} from them, ${out.outbound} from you)${out.already_there ? `, ${out.already_there} were already there` : ''}.`
        : `WhatsApp with ${out.person.name}: nothing new (${out.already_there} messages were already there).`);
    } catch { setError('Could not reach the server'); } finally { setBusy(false); }
  };

  const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
        title="Export a one-to-one WhatsApp chat on your phone (Export chat → Without media) and import it here">
        Import a WhatsApp chat
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, black 40%, transparent)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
      <div className="w-full max-w-md rounded-xl p-5 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <h2 className="text-sm font-semibold">Import a WhatsApp chat</h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          On your phone: open the chat → ⋮ / contact name → Export chat → Without media. Send the file to yourself and
          choose it here (.txt, or the .zip an iPhone makes). One-to-one chats only. The messages count towards warmth.
        </p>
        <input type="file" accept=".txt,.zip" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="text-xs w-full" />
        <label className="block text-xs space-y-1">
          <span style={{ color: 'var(--text-muted)' }}>Who is the chat with?</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Their name"
            className="w-full px-2 py-1.5 rounded-lg outline-none" style={inputStyle} />
        </label>
        <label className="block text-xs space-y-1">
          <span style={{ color: 'var(--text-muted)' }}>Your name in the chat (only if it differs from your SalesBrain name)</span>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} className="w-full px-2 py-1.5 rounded-lg outline-none" style={inputStyle} />
        </label>
        {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
        {candidates.length > 0 && (
          <div className="space-y-1">
            {candidates.map((c) => (
              <button key={c.person_id} onClick={() => send(c.person_id)} disabled={busy}
                className="block w-full text-left text-xs px-2 py-1.5 rounded-lg" style={{ background: 'var(--bg-input)' }}>
                {c.name}{c.company ? ` · ${c.company}` : ''}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setOpen(false)} disabled={busy} className="text-xs px-3 py-1.5">Cancel</button>
          <button onClick={() => send()} disabled={!file || busy} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{busy ? 'Importing…' : 'Import'}</button>
        </div>
      </div>
    </div>
  );
}
