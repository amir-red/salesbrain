'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RUN_STATUS_COLOR } from '@/lib/icp';
import type { FleetPayload, OwnerQuota } from '@/lib/icp-panel';
import { relativeTime } from '@/lib/time';
import ProgressBar from '@/components/panel/ProgressBar';

/**
 * The machinery at a glance, above the ICP rows: kill switch, one chip per
 * agent (what it did in the last 24 h, when it last ran), the viewer's spend
 * against today's ceilings, and any LinkedIn account the agents paused.
 * Switches reuse /agents' endpoints; admin-only ones stay hidden otherwise.
 */
export default function FleetStrip({ fleet, quota, onChanged }: {
  fleet: FleetPayload | null; quota: OwnerQuota | null; onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setErr(null);
    try {
      const res = await fetch('/api/agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) setErr(out.error || 'Failed');
      await onChanged();
    } finally { setBusy(null); }
  };
  const resume = async (acct: string) => {
    setBusy(acct); setErr(null);
    try {
      const res = await fetch('/api/agents/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unipile_account_id: acct }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) setErr(out.error || 'Failed');
      await onChanged();
    } finally { setBusy(null); }
  };

  if (!fleet) return <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Loading agents…</div>;
  const live = fleet.kill_switch;

  return (
    <div className="rounded-xl p-3 space-y-3" style={{ background: 'var(--bg-card)', border: `1px solid ${live ? 'var(--border)' : 'var(--red)'}` }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium inline-flex items-center gap-1.5" style={{ color: live ? 'var(--green)' : 'var(--red)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: live ? 'var(--green)' : 'var(--red)' }} />
          {live ? 'agents live' : 'KILL SWITCH — all agents stopped'}
        </span>
        {fleet.is_admin && (
          <button onClick={() => { if (live && !confirm('Stop every agent now? Nothing will source, enrich, sync or draft until you resume.')) return; patch({ kill_switch: !live }, 'ks'); }}
                  disabled={busy === 'ks'} className="px-2 py-0.5 rounded text-[11px] disabled:opacity-40"
                  style={{ border: `1px solid ${live ? 'var(--red)' : 'var(--green)'}`, color: live ? 'var(--red)' : 'var(--green)' }}>
            {live ? 'Stop all' : 'Resume all'}
          </button>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <Link href="/agents" className="underline" style={{ color: 'var(--text-muted)' }}>Agents →</Link>
          {fleet.is_admin && <Link href="/admin/linkedin" className="underline" style={{ color: 'var(--text-muted)' }}>LinkedIn health →</Link>}
        </div>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {fleet.agents.map((a) => {
          const lr = a.last_run;
          const color = lr ? RUN_STATUS_COLOR[lr.status] : 'var(--text-muted)';
          return (
            <div key={a.name} className="rounded-lg px-3 py-2 space-y-1" style={{ background: 'var(--bg-input)', opacity: a.enabled ? 1 : 0.7 }}>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium truncate">{a.label}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: a.enabled ? 'rgba(34,197,94,0.15)' : 'var(--bg-card)', color: a.enabled ? 'var(--green)' : 'var(--text-muted)' }}>{a.enabled ? 'on' : 'off'}</span>
                {fleet.is_admin && (
                  <button onClick={() => patch({ agent: a.name, enabled: !a.enabled }, a.name)} disabled={busy === a.name}
                          className="ml-auto text-[10px] underline disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>
                    {a.enabled ? 'disable' : 'enable'}
                  </button>
                )}
              </div>
              <div className="text-[10px] inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }} title={lr?.source || a.schedule || ''}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                {lr ? `${lr.status} · ${relativeTime(lr.started_at)}${lr.icp_name ? ` · ${lr.icp_name}` : ''}` : 'never ran'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                24h: <b style={{ color: 'var(--text)' }}>{a.last_24h.runs}</b> runs
                {a.last_24h.errors > 0 && <span style={{ color: 'var(--red)' }}> · {a.last_24h.errors} errors</span>}
                {a.last_24h.skipped > 0 && <span> · {a.last_24h.skipped} skipped</span>}
                {a.name === 'leads_finder' && <span> · {a.last_24h.matched} matched · {a.last_24h.created} new</span>}
                {a.name === 'enricher' && <span> · {a.last_24h.created} employers · {a.last_24h.researched} researched · {a.last_24h.matched} emails</span>}
                {a.name === 'graph_sync' && <span> · {a.last_24h.matched} edges</span>}
              </div>
            </div>
          );
        })}
      </div>

      {quota && (
        <div className="grid gap-3 items-end" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div className="text-[10px] self-center" style={{ color: 'var(--text-muted)' }}>
            Your LinkedIn{quota.connected ? <> · <span style={{ color: quota.tier === 'sales_navigator' ? 'var(--accent)' : 'var(--text)' }}>{quota.tier === 'sales_navigator' ? 'Sales Navigator' : 'Free'}</span>{quota.display_name ? ` · ${quota.display_name}` : ''}</> : <span style={{ color: 'var(--yellow)' }}> · not connected</span>}
            {quota.paused_at && <span style={{ color: 'var(--red)' }}> · paused</span>}
          </div>
          <ProgressBar label="searches" used={quota.search.used} cap={quota.search.cap} title="Leads Finder searches today (manual, chat and timer all count)" />
          <ProgressBar label="profile fetches" used={quota.profile.used} cap={quota.profile.cap} title="Enricher employer look-ups today" />
          <ProgressBar label="email credits" used={quota.email_credits.used} cap={quota.email_credits.cap} title="Email-provider credits spent today" />
          {quota.linkedin.message && <ProgressBar label="messages" used={quota.linkedin.message.used} cap={quota.linkedin.message.cap} title="LinkedIn messages sent today" />}
          {quota.linkedin.relations && <ProgressBar label="connections read" used={quota.linkedin.relations.used} cap={quota.linkedin.relations.cap} title="Relations pages read today (graph sync + hourly poll)" />}
        </div>
      )}

      {fleet.paused_accounts.length > 0 && (
        <div className="rounded-lg p-2 text-[11px] space-y-1" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid var(--red)' }}>
          {fleet.paused_accounts.map((p) => (
            <div key={p.unipile_account_id} className="flex items-center gap-2">
              <span style={{ color: 'var(--red)' }}>⏸</span>
              <span><b>{p.display_name || p.unipile_account_id}</b> ({p.owner_name}) paused {relativeTime(p.agent_paused_at)} — {p.agent_pause_reason || `${p.agent_consecutive_errors} provider errors`}</span>
              <button onClick={() => resume(p.unipile_account_id)} disabled={busy === p.unipile_account_id} className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium text-white disabled:opacity-40" style={{ background: 'var(--green)' }}>Resume</button>
            </div>
          ))}
        </div>
      )}
      {err && <div className="text-[11px]" style={{ color: 'var(--red)' }}>{err}</div>}
    </div>
  );
}
