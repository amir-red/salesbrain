'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import Link from 'next/link';
import { PROSPECT_STAGES } from '@/lib/prospecting';
import { relativeTime } from '@/lib/time';

interface Prospect {
  id: string;
  stage: string;
  icp_score: number | null;
  fit_label: string | null;
  reply_status: string | null;
  next_action_at: string | null;
  last_contacted_at: string | null;
  created_at: string;
  company_name: string | null;
  full_name: string | null;
  email: string | null;
  title: string | null;
  owner_name: string | null;
  converted_deal_id: string | null;
}

const STAGE_COLORS: Record<string, string> = {
  P0_IMPORTED: 'var(--text-muted)',
  P1_ENRICHED: '#8b5cf6',
  P2_ICP_CHECKED: '#3b82f6',
  P3_RESEARCH_READY: '#0ea5e9',
  P4_OUTREACH_DRAFTED: '#eab308',
  P5_SENT: 'var(--accent)',
  P6_REPLIED: '#f97316',
  P7_QUALIFIED: 'var(--green)',
  P8_DISQUALIFIED: 'var(--red)',
  P9_ARCHIVED: 'var(--text-muted)',
};

function FitBadge({ score, label }: { score: number | null; label: string | null }) {
  if (score === null) return <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = score >= 75 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : score >= 40 ? 'var(--orange)' : 'var(--red)';
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${color}20`, color }}>
      {score} · {label?.replace(/_/g, ' ') || '—'}
    </span>
  );
}

export default function ProspectingPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const [newCompany, setNewCompany] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newSource, setNewSource] = useState('manual');

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stageFilter) params.set('stage', stageFilter);
      if (mineOnly) params.set('mine', 'true');
      const res = await fetch(`/api/prospects?${params.toString()}`);
      if (res.ok) setProspects(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [stageFilter, mineOnly]);

  useEffect(() => { fetchProspects(); }, [fetchProspects]);

  const createProspect = async () => {
    if (!newCompany.trim() || !newFullName.trim()) return;
    const res = await fetch('/api/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: newCompany.trim(),
        domain: newDomain.trim() || undefined,
        full_name: newFullName.trim(),
        email: newEmail.trim() || undefined,
        title: newTitle.trim() || undefined,
        source_type: newSource || 'manual',
      }),
    });
    if (res.ok) {
      setShowNew(false);
      setNewCompany(''); setNewDomain(''); setNewFullName(''); setNewEmail(''); setNewTitle('');
      fetchProspects();
    }
  };

  const stageCounts: Record<string, number> = {};
  for (const s of PROSPECT_STAGES) stageCounts[s.stage] = 0;
  for (const p of prospects) stageCounts[p.stage] = (stageCounts[p.stage] || 0) + 1;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Prospecting</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{prospects.length} prospects</p>
          </div>
          <button
            onClick={() => setShowNew(!showNew)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            + New Prospect
          </button>
        </div>

        {/* New prospect form */}
        {showNew && (
          <div className="p-4 border-b space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <div className="grid grid-cols-3 gap-2">
              <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Company name *" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="Domain (optional)" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="Source (referral, linkedin, etc.)" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input value={newFullName} onChange={(e) => setNewFullName(e.target.value)} placeholder="Contact full name *" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional)" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <div className="flex gap-2">
              <button onClick={createProspect} disabled={!newCompany.trim() || !newFullName.trim()} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--green)', color: '#fff' }}>Create</button>
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="p-4 flex flex-wrap gap-2 items-center border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => setStageFilter(null)}
            className="px-2.5 py-1 rounded text-xs"
            style={{ background: stageFilter === null ? 'var(--accent)' : 'var(--bg-input)', color: stageFilter === null ? '#fff' : 'var(--text-muted)' }}
          >
            All ({prospects.length})
          </button>
          {PROSPECT_STAGES.map((s) => (
            <button
              key={s.stage}
              onClick={() => setStageFilter(s.stage === stageFilter ? null : s.stage)}
              className="px-2.5 py-1 rounded text-xs"
              style={{
                background: s.stage === stageFilter ? STAGE_COLORS[s.stage] : 'var(--bg-input)',
                color: s.stage === stageFilter ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${s.stage === stageFilter ? STAGE_COLORS[s.stage] : 'var(--border)'}`,
              }}
              title={s.description}
            >
              {s.stage.replace('_', '·').slice(0, 12)} ({stageCounts[s.stage] || 0})
            </button>
          ))}
          <label className="text-xs flex items-center gap-1 ml-2" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Mine only
          </label>
        </div>

        {/* Table */}
        <div className="p-4">
          {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>}
          {!loading && prospects.length === 0 && (
            <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
              <p>No prospects yet</p>
              <p className="text-xs mt-1">Create one above or import from the chat.</p>
            </div>
          )}
          {!loading && prospects.length > 0 && (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
                    <th className="text-left p-2 font-medium text-xs">Prospect</th>
                    <th className="text-left p-2 font-medium text-xs">Company</th>
                    <th className="text-left p-2 font-medium text-xs">Stage</th>
                    <th className="text-left p-2 font-medium text-xs">ICP Fit</th>
                    <th className="text-left p-2 font-medium text-xs">Owner</th>
                    <th className="text-left p-2 font-medium text-xs">Last contacted</th>
                    <th className="text-left p-2 font-medium text-xs">Next</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((p) => (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="p-2">
                        <Link href={`/prospects/${p.id}`} className="hover:underline">
                          <div className="font-medium">{p.full_name || '—'}</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.title || '—'}</div>
                        </Link>
                      </td>
                      <td className="p-2">
                        <div>{p.company_name || '—'}</div>
                      </td>
                      <td className="p-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${STAGE_COLORS[p.stage]}20`, color: STAGE_COLORS[p.stage] }}>
                          {p.stage}
                        </span>
                        {p.converted_deal_id && (
                          <Link href={`/deals/${p.converted_deal_id}`} className="ml-1 text-[10px] underline" style={{ color: 'var(--accent)' }}>
                            deal→
                          </Link>
                        )}
                      </td>
                      <td className="p-2"><FitBadge score={p.icp_score} label={p.fit_label} /></td>
                      <td className="p-2 text-xs" style={{ color: 'var(--text-muted)' }}>{p.owner_name || '—'}</td>
                      <td className="p-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {p.last_contacted_at ? relativeTime(p.last_contacted_at) : '—'}
                      </td>
                      <td className="p-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {p.next_action_at ? new Date(p.next_action_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
