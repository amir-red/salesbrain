'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { ActivityList } from '@/components/icp/IcpLeads';
import { RUN_STATUS_COLOR } from '@/lib/icp';
import type { AgentRun } from '@/lib/icp';
import { relativeTime } from '@/lib/time';

interface AgentDef {
  name: string; label: string; description: string | null; kind: 'timer' | 'routine'; schedule: string | null;
  policy_key: string; script: string | null; routine: string | null; skill: string | null;
  enabled: boolean; config: Record<string, unknown>;
  last_run: (AgentRun & { icp_name?: string | null }) | null;
  last_24h: { runs: number; errors: number; skipped: number; analyzed: number; matched: number; created: number; researched: number };
}
interface PausedAccount {
  unipile_account_id: string; display_name: string | null; owner_name: string; owner_user_id: string;
  agent_paused_at: string; agent_pause_reason: string | null; agent_consecutive_errors: number;
}
interface Payload { is_admin: boolean; kill_switch: boolean; agents: AgentDef[]; paused_accounts: PausedAccount[] }
interface Approval {
  id: string; status: string; channel: string; subject: string | null; message: string; rationale: string | null;
  created_at: string; expires_at: string; person_name: string | null; title: string | null; company: string | null;
  icp_score: number | null; icp_name: string | null; owner_name: string | null;
}

/**
 * /agents — the registry of background agents (agent_definitions + policy_rules),
 * what each did in the last 24h, paused LinkedIn accounts, and the switches.
 */
export default function AgentsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [decideNote, setDecideNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([fetch('/api/agents'), fetch(`/api/agents/runs?limit=60${filter ? `&agent=${filter}` : ''}`), fetch('/api/agents/approvals')]);
    if (a.ok) setData(await a.json());
    if (b.ok) setRuns(await b.json());
    if (c.ok) setApprovals(await c.json());
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setErr(null);
    try {
      const res = await fetch('/api/agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok || out.error) setErr(out.error || 'Failed');
      await load();
    } finally { setBusy(null); }
  };
  const decide = async (id: string, decision: 'approve' | 'reject') => {
    if (decision === 'approve' && !confirm('Send this message now? It goes through the policy gate (quiet hours, caps) and is delivered as you.')) return;
    setBusy(id); setDecideNote(null);
    try {
      const res = await fetch('/api/agents/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval_id: id, decision }) });
      const out = await res.json();
      if (!res.ok || out.error) setDecideNote(out.error || 'Failed');
      else if (decision === 'reject') setDecideNote('Skipped — nothing sent.');
      else setDecideNote(out.sent ? `Sent (${out.status}).` : `Not sent: ${out.note || 'policy denied'}`);
      await load();
    } finally { setBusy(null); }
  };

  const resume = async (id: string) => {
    setBusy(id); setErr(null);
    try {
      const res = await fetch('/api/agents/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unipile_account_id: id }) });
      const out = await res.json();
      if (!res.ok || out.error) setErr(out.error || 'Failed');
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Agents</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Background workers that act as you, bounded by policy. Nothing here sends a message without you.</p>
          </div>
          {data && (
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: data.kill_switch ? 'var(--green)' : 'var(--red)' }}>
                ● {data.kill_switch ? 'agents live' : 'KILL SWITCH — all agents stopped'}
              </span>
              {data.is_admin && (
                <button onClick={() => { if (data.kill_switch ? confirm('Stop every background agent on its next tick?') : true) patch({ kill_switch: !data.kill_switch }, 'ks'); }}
                        disabled={busy === 'ks'} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
                        style={{ background: data.kill_switch ? 'var(--red)' : 'var(--green)', color: '#fff' }}>
                  {data.kill_switch ? 'Stop all agents' : 'Resume all agents'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          {err && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}>{err}</div>}
          {!data && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data?.agents.map((a) => {
              const lr = a.last_run;
              const color = lr ? RUN_STATUS_COLOR[lr.status] : 'var(--text-muted)';
              return (
                <div key={a.name} className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', opacity: a.enabled ? 1 : 0.7 }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {a.label}
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: a.enabled ? 'rgba(34,197,94,0.15)' : 'var(--bg-input)', color: a.enabled ? 'var(--green)' : 'var(--text-muted)' }}>
                          {a.enabled ? 'enabled' : 'off'}
                        </span>
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{a.kind === 'timer' ? 'systemd timer' : 'Hermes routine'} · {a.schedule}</div>
                    </div>
                    {data.is_admin && (
                      <button onClick={() => patch({ agent: a.name, enabled: !a.enabled }, a.name)} disabled={busy === a.name}
                              className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>
                        {a.enabled ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </div>
                  {a.description && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.description}</p>}
                  <div className="text-xs">
                    <span className="inline-flex items-center gap-1.5" style={{ color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                      {lr ? `${lr.status} · ${relativeTime(lr.started_at)}${lr.icp_name ? ` · ${lr.icp_name}` : ''}` : 'never ran'}
                    </span>
                    {lr?.error && <div className="text-[11px] mt-1" style={{ color: 'var(--red)' }}>{lr.error}</div>}
                    {lr?.status === 'skipped' && <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{lr.detail?.reason}</div>}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[['runs', a.last_24h.runs], ['analyzed', a.last_24h.analyzed], ['matched', a.last_24h.matched], ['new', a.last_24h.created]].map(([k, v]) => (
                      <div key={String(k)} className="rounded-lg p-2" style={{ background: 'var(--bg-input)' }}>
                        <div className="text-base font-semibold">{v as number}</div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{k} · 24h</div>
                      </div>
                    ))}
                  </div>
                  <details className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    <summary className="cursor-pointer">caps ({a.policy_key})</summary>
                    <div className="mt-1 grid grid-cols-2 gap-x-3">
                      {Object.entries(a.config).filter(([k]) => k !== 'enabled').map(([k, v]) => <div key={k}>{k}: <span style={{ color: 'var(--text)' }}>{Array.isArray(v) ? v.join('/') : String(v)}</span></div>)}
                    </div>
                    <div className="mt-1">assets: {[a.script, a.routine, a.skill].filter(Boolean).join(' · ')}</div>
                  </details>
                </div>
              );
            })}
          </div>

          {data && data.paused_accounts.length > 0 && (
            <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid var(--red)' }}>
              <div className="text-sm font-semibold" style={{ color: 'var(--red)' }}>Paused LinkedIn accounts</div>
              {data.paused_accounts.map((p) => (
                <div key={p.unipile_account_id} className="flex items-center gap-3 text-xs">
                  <div className="flex-1">
                    <b>{p.display_name || p.owner_name}</b> ({p.owner_name}) — paused {relativeTime(p.agent_paused_at)}: {p.agent_pause_reason}
                  </div>
                  <button onClick={() => resume(p.unipile_account_id)} disabled={busy === p.unipile_account_id} className="px-3 py-1 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Resume</button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Pending approvals</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: approvals.length ? 'rgba(234,179,8,0.15)' : 'var(--bg-input)', color: approvals.length ? 'var(--yellow)' : 'var(--text-muted)' }}>{approvals.length}</span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Drafts the Outreach agent filed for you — same 👍/👎 as the Telegram card.</span>
            </div>
            {decideNote && <div className="text-xs" style={{ color: decideNote.startsWith('Not sent') || decideNote === 'Failed' ? 'var(--red)' : 'var(--text-muted)' }}>{decideNote}</div>}
            {approvals.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing waiting.</p>}
            {approvals.map((ap) => (
              <div key={ap.id} className="rounded-xl p-4 space-y-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{ap.person_name || '—'} <span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}>{[ap.title, ap.company].filter(Boolean).join(' · ')}</span></div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>via {ap.channel}{ap.icp_score !== null ? ` · fit ${ap.icp_score}` : ''}{ap.icp_name ? ` · ${ap.icp_name}` : ''}{ap.owner_name ? ` · for ${ap.owner_name}` : ''} · expires {relativeTime(ap.expires_at)}</div>
                    {ap.rationale && <div className="text-[11px] mt-1 italic" style={{ color: 'var(--text-muted)' }}>{ap.rationale}</div>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => decide(ap.id, 'reject')} disabled={busy === ap.id} className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>👎 Skip</button>
                    <button onClick={() => decide(ap.id, 'approve')} disabled={busy === ap.id} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--green)', color: '#fff' }}>{busy === ap.id ? 'Working…' : '👍 Send'}</button>
                  </div>
                </div>
                {ap.subject && <div className="text-xs"><b>Subject:</b> {ap.subject}</div>}
                <pre className="text-xs whitespace-pre-wrap rounded-lg p-3" style={{ background: 'var(--bg-input)', color: 'var(--text)', fontFamily: 'inherit' }}>{ap.message}</pre>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <h2 className="text-sm font-semibold">Activity</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              <option value="">all agents</option>
              {data?.agents.map((a) => <option key={a.name} value={a.name}>{a.label}</option>)}
            </select>
            <Link href="/icp" className="ml-auto text-xs underline" style={{ color: 'var(--text-muted)' }}>ICP lists →</Link>
          </div>
          <ActivityList runs={runs} showIcp />
        </div>
      </div>
    </div>
  );
}
