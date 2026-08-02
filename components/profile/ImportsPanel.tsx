'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface Contact { id: string; full_name: string; email: string | null; company_name?: string | null }

export default function ImportsPanel() {
  return (
    <Suspense fallback={<div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</div>}>
      <IntegrationsPageInner />
    </Suspense>
  );
}

function IntegrationsPageInner() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');
  const urlConnected = searchParams.get('connected');

  const [connected, setConnected] = useState<{ google?: { account_email: string | null } }>({});
  const [syncing, setSyncing] = useState(false);
  const [syncStats, setSyncStats] = useState<Record<string, unknown> | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<string>('');
  const [importText, setImportText] = useState('');
  const [importSource, setImportSource] = useState<'whatsapp' | 'email_paste' | 'linkedin_paste' | 'generic'>('whatsapp');
  const [myName, setMyName] = useState('');
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Check actual connection state from the DB so it persists across refreshes.
      const statusRes = await fetch('/api/integrations/status');
      if (statusRes.ok) {
        const { providers } = await statusRes.json();
        setConnected(providers || {});
      } else if (urlConnected === 'google') {
        // Fallback: we just came back from OAuth callback but status call failed;
        // show as connected optimistically.
        setConnected((c) => ({ ...c, google: { account_email: null } }));
      }

      const res = await fetch('/api/contacts');
      if (res.ok) {
        const data = await res.json();
        setContacts(data.slice(0, 100));
      }
    } catch { /* ignore */ }
  }, [urlConnected]);

  useEffect(() => { refresh(); }, [refresh]);

  const runSync = async (mode: 'contacts' | 'messages' | 'both') => {
    setSyncing(true);
    setSyncStats(null);
    try {
      const res = await fetch('/api/integrations/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      setSyncStats(data);
      refresh();
    } finally { setSyncing(false); }
  };

  const disconnectGoogle = async () => {
    await fetch('/api/integrations/google/disconnect', { method: 'POST' });
    setConnected({});
  };

  const importMessages = async () => {
    if (!selectedContact || !importText.trim()) return;
    const res = await fetch('/api/imports/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: selectedContact, source: importSource, text: importText, my_name: myName || undefined }),
    });
    const data = await res.json();
    setImportResult(data);
    if (res.ok) setImportText('');
  };

  const importCsv = async () => {
    if (!csvFile) return;
    setCsvUploading(true);
    setCsvResult(null);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      fd.append('source', 'linkedin_csv');
      const res = await fetch('/api/imports/contacts', { method: 'POST', body: fd });
      const data = await res.json();
      setCsvResult(data);
      if (res.ok) { setCsvFile(null); refresh(); }
    } finally {
      setCsvUploading(false);
    }
  };

  const analyzeStyle = async () => {
    if (!selectedContact) return;
    const res = await fetch(`/api/contacts/${selectedContact}/analyze-style`, { method: 'POST' });
    const data = await res.json();
    setImportResult(data);
  };

  return (
    <div>
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Integrations & Imports</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Connect your email, import contacts & messages, and train your communication style</p>
        </div>

        {urlError && (
          <div className="m-4 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)' }}>
            OAuth error: {urlError}
          </div>
        )}

        <div className="p-4 grid grid-cols-2 gap-4">
          {/* Google */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Google (Gmail + Contacts)</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Import contacts from Google + sync recent emails</p>
              </div>
              {connected.google && (
                <span className="text-[10px] px-2 py-1 rounded" style={{ background: `var(--green)20`, color: 'var(--green)' }}>
                  Connected{connected.google.account_email ? ` · ${connected.google.account_email}` : ''}
                </span>
              )}
            </div>
            {!connected.google ? (
              <a href="/api/integrations/google/connect" className="block px-3 py-2 rounded-lg text-sm text-center font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
                Connect Google
              </a>
            ) : (
              <>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => runSync('contacts')} disabled={syncing} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                    Sync contacts
                  </button>
                  <button onClick={() => runSync('messages')} disabled={syncing} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                    Sync recent emails
                  </button>
                  <button onClick={() => runSync('both')} disabled={syncing} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
                    {syncing ? 'Syncing...' : 'Full sync'}
                  </button>
                  <button onClick={disconnectGoogle} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--red)', border: '1px solid var(--border)' }}>
                    Disconnect
                  </button>
                </div>
                {syncStats && (
                  <pre className="text-xs p-2 rounded mt-2" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{JSON.stringify(syncStats, null, 2)}</pre>
                )}
              </>
            )}
            <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
              Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI set in server env. Set up in Google Cloud Console.
            </p>
          </div>

          {/* LinkedIn CSV upload */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div>
              <h2 className="text-sm font-semibold">LinkedIn Contacts (CSV)</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                LinkedIn → Settings → Data Privacy → Get a copy of your data → request <strong>Connections only</strong>. Extract the ZIP and upload <code>Connections.csv</code>.
              </p>
            </div>

            <label
              htmlFor="linkedin-csv-input"
              className="block w-full text-center px-3 py-6 rounded-lg cursor-pointer text-sm transition-colors"
              style={{
                background: csvFile ? 'var(--accent-glow)' : 'var(--bg-input)',
                border: `1px dashed ${csvFile ? 'var(--accent)' : 'var(--border)'}`,
                color: csvFile ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {csvFile ? (
                <>
                  <span className="font-medium">📄 {csvFile.name}</span>
                  <span className="block text-[10px] mt-1">{(csvFile.size / 1024).toFixed(1)} KB · click to change</span>
                </>
              ) : (
                <>Click to choose a .csv file</>
              )}
            </label>
            <input
              id="linkedin-csv-input"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setCsvFile(f || null);
                setCsvResult(null);
                e.target.value = ''; // allow re-selecting same file
              }}
            />

            <div className="flex gap-2">
              <button
                onClick={importCsv}
                disabled={!csvFile || csvUploading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: csvFile ? 'var(--accent)' : 'var(--border)', color: csvFile ? '#fff' : 'var(--text-muted)', opacity: csvUploading ? 0.6 : 1 }}
              >
                {csvUploading ? 'Uploading...' : 'Import LinkedIn Connections'}
              </button>
              {csvFile && !csvUploading && (
                <button
                  onClick={() => { setCsvFile(null); setCsvResult(null); }}
                  className="px-3 py-1.5 rounded-lg text-xs"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                >
                  Clear
                </button>
              )}
            </div>

            {csvResult && (
              <pre className="text-xs p-2 rounded overflow-x-auto" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{JSON.stringify(csvResult, null, 2)}</pre>
            )}
          </div>

          {/* WhatsApp / text paste per contact */}
          <div className="rounded-xl p-4 space-y-3 col-span-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div>
              <h2 className="text-sm font-semibold">Import Messages for a Contact</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Paste a WhatsApp export (.txt), email thread, or any conversation. AI will learn your communication style with this specific person.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={selectedContact} onChange={(e) => setSelectedContact(e.target.value)} className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <option value="">Select contact...</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name} {c.email ? `(${c.email})` : ''}</option>
                ))}
              </select>
              <select value={importSource} onChange={(e) => setImportSource(e.target.value as 'whatsapp' | 'email_paste' | 'linkedin_paste' | 'generic')} className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <option value="whatsapp">WhatsApp export (.txt)</option>
                <option value="email_paste">Email (pasted)</option>
                <option value="linkedin_paste">LinkedIn message</option>
                <option value="generic">Generic text</option>
              </select>
              <input
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                placeholder="Your name in WhatsApp (for direction)"
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste the message export or email thread here..."
              rows={8}
              className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none font-mono"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <div className="flex gap-2">
              <button
                onClick={importMessages}
                disabled={!selectedContact || !importText.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Import Messages
              </button>
              <button
                onClick={analyzeStyle}
                disabled={!selectedContact}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--green)', color: '#fff' }}
                title="Analyze all imported messages for this contact and build a communication profile"
              >
                Analyze Communication Style →
              </button>
            </div>
            {importResult && (
              <pre className="text-xs p-2 rounded overflow-x-auto" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{JSON.stringify(importResult, null, 2)}</pre>
            )}
          </div>
        </div>
      </div>
  );
}
