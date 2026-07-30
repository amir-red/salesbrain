'use client';

import { useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface Lead {
  company_name: string;
  website?: string;
  full_name: string;
  email?: string;
  title?: string;
}

interface ImportResultItem {
  input: Lead;
  prospect_id?: string;
  account_id?: string;
  created?: boolean;
  error?: string;
}

export default function DiscoveryPage() {
  const [csvText, setCsvText] = useState('');
  const [importStats, setImportStats] = useState<{ created: number; existing: number; errors: number; results: ImportResultItem[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [researching, setResearching] = useState<string | null>(null);
  const [researchLog, setResearchLog] = useState<string[]>([]);

  const parseCsv = (text: string): Lead[] => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('company') || firstLine.includes('name');
    const rows = hasHeader ? lines.slice(1) : lines;

    const leads: Lead[] = [];
    for (const line of rows) {
      const cols = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
      // Accept either: company,website,fullname,email,title  OR  company,fullname,email
      if (cols.length < 2) continue;
      let company: string, website: string | undefined, fullName: string, email: string | undefined, title: string | undefined;

      if (cols.length >= 5) {
        [company, website, fullName, email, title] = cols;
      } else if (cols.length === 4) {
        [company, website, fullName, email] = cols;
        title = undefined;
      } else if (cols.length === 3) {
        [company, fullName, email] = cols;
        website = undefined;
      } else {
        [company, fullName] = cols;
      }

      if (!company || !fullName) continue;
      leads.push({
        company_name: company,
        website: website || undefined,
        full_name: fullName,
        email: email || undefined,
        title: title || undefined,
      });
    }
    return leads;
  };

  const bulkImport = async () => {
    const leads = parseCsv(csvText);
    if (leads.length === 0) {
      setImportStats({ created: 0, existing: 0, errors: 0, results: [] });
      return;
    }
    setImporting(true);
    try {
      const res = await fetch('/api/discovery/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type: 'discovery_paste', leads }),
      });
      const data = await res.json();
      setImportStats(data);
    } finally { setImporting(false); }
  };

  const researchAll = async () => {
    if (!importStats) return;
    const candidates = importStats.results.filter((r) => r.prospect_id && r.input.website);
    for (const r of candidates) {
      setResearching(r.prospect_id!);
      setResearchLog((l) => [...l, `Researching ${r.input.company_name}...`]);
      try {
        const res = await fetch(`/api/accounts/${r.account_id}/research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ website: r.input.website, prospect_id: r.prospect_id }),
        });
        const data = await res.json();
        setResearchLog((l) => [...l, data.error ? `  ✗ ${r.input.company_name}: ${data.error}` : `  ✓ ${r.input.company_name} researched`]);
      } catch (err) {
        setResearchLog((l) => [...l, `  ✗ ${r.input.company_name}: ${err}`]);
      }
    }
    setResearching(null);
  };

  const leads = parseCsv(csvText);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Discovery</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Paste a list of leads, import them as prospects, and let AI research each company from their website.
            Then go to the chat on each prospect or ask the agent to &quot;draft cold emails for all new prospects&quot;.
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-medium mb-2">1. Paste your list (CSV)</h2>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Format: <code>company_name, website, full_name, email, title</code> — one lead per line. Header row optional.
            </p>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={`Acme Corp, acme.com, Jane Doe, jane@acme.com, VP Operations
Beta Industries, beta.io, Tom Lee, tom@beta.io, CTO
Gamma Logistics, gamma.com, Sara Kim, , Director of Fleet`}
              rows={10}
              className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none font-mono"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {leads.length} lead{leads.length !== 1 ? 's' : ''} detected
              </span>
              <button
                onClick={bulkImport}
                disabled={importing || leads.length === 0}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--accent)', color: '#fff', opacity: importing ? 0.6 : 1 }}
              >
                {importing ? 'Importing...' : `Import ${leads.length} lead${leads.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          {importStats && (
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-medium mb-2">2. Import result</h2>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="rounded-lg p-3 text-center" style={{ background: 'var(--bg-input)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{importStats.created}</p>
                  <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>New prospects</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: 'var(--bg-input)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'var(--yellow)' }}>{importStats.existing}</p>
                  <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Already existed</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: 'var(--bg-input)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'var(--red)' }}>{importStats.errors}</p>
                  <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Errors</p>
                </div>
              </div>
              <button
                onClick={researchAll}
                disabled={!!researching}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--green)', color: '#fff' }}
              >
                {researching ? 'Researching...' : `Research all ${importStats.results.filter((r) => r.prospect_id && r.input.website).length} websites with AI`}
              </button>
              {researchLog.length > 0 && (
                <pre className="mt-3 text-xs p-2 rounded max-h-48 overflow-y-auto" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>{researchLog.join('\n')}</pre>
              )}
              <div className="mt-3 space-y-1 max-h-80 overflow-y-auto">
                {importStats.results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 rounded" style={{ background: r.error ? 'rgba(239,68,68,0.1)' : 'var(--bg-input)' }}>
                    <div>
                      <span className="font-medium">{r.input.company_name}</span>
                      <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{r.input.full_name}</span>
                    </div>
                    {r.prospect_id ? (
                      <Link href={`/prospects/${r.prospect_id}`} className="underline" style={{ color: 'var(--accent)' }}>
                        view →
                      </Link>
                    ) : r.error ? (
                      <span style={{ color: 'var(--red)' }}>{String(r.error).slice(0, 50)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-medium mb-2">3. Next steps</h2>
            <ol className="text-xs space-y-1 list-decimal list-inside" style={{ color: 'var(--text-muted)' }}>
              <li>Imported prospects are scored against your active ICP. Review them in <Link href="/prospecting" style={{ color: 'var(--accent)' }}>Prospects</Link>, best fit first.</li>
              <li>Ask the assistant (Telegram or chat) to <b>qualify</b> a prospect — it researches the company and sharpens the score.</li>
              <li>Ask it to <b>engage</b> one. That promotes them into the relationship graph with their research attached, then drafts follow the value-first path.</li>
              <li>Nothing sends without you approving the exact text. Replies arrive in your own inbox, and the assistant triages them for you.</li>
            </ol>
            <p className="text-[10px] mt-3" style={{ color: 'var(--text-muted)' }}>
              Deliverability guardrails active: daily send cap of {process.env.NEXT_PUBLIC_OUTREACH_DAILY_LIMIT || 50}/user, 3-min throttle per recipient domain,
              unsubscribe footer auto-added, suppression list enforced.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
