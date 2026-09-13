'use client';

import Link from 'next/link';
import type { PanelPayload } from '@/lib/icp-panel';
import { relativeTime } from '@/lib/time';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import ApprovalsPanel from '@/components/prospect/ApprovalsPanel';
import { RunPill } from '@/components/icp/IcpLeads';

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--accent)', approved: 'var(--green)', sent: 'var(--green)', rejected: 'var(--text-muted)', failed: 'var(--red)', expired: 'var(--text-muted)',
};
const INTRO_COLOR: Record<string, string> = {
  drafted: 'var(--text-muted)', pending_approval: 'var(--accent)', sent: 'var(--yellow)', awaiting_reply: 'var(--yellow)',
  replied: 'var(--green)', forwarded: 'var(--green)', declined: 'var(--red)', silent: 'var(--text-muted)', abandoned: 'var(--text-muted)',
};

/** Steps 6–7: drafts waiting for a human, what already went out, and intro asks in flight. */
export default function OutreachSection({ data, onChanged }: { data: PanelPayload; onChanged: () => Promise<void> }) {
  const { outreach, is_owner, policy } = data;
  const statuses = Object.entries(outreach.by_status).sort((a, b) => b[1] - a[1]);
  const states = Object.entries(outreach.intros.by_state).sort((a, b) => b[1] - a[1]);
  return (
    <SectionCard title="6 · Outreach & intros" subtitle={`outreach routine ${policy.enabled.outreach ? 'enabled' : 'disabled'} · approve = send now through the same policy gate a human uses`}>
      <div className="flex flex-wrap items-center gap-3">
        <RunPill run={outreach.last_run} queued={0} state={null} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile label="awaiting approval" value={outreach.pending.length} color={outreach.pending.length ? 'var(--accent)' : undefined} />
        <StatTile label="sent" value={outreach.by_status.sent ?? 0} color="var(--green)" />
        <StatTile label="skipped / expired" value={(outreach.by_status.rejected ?? 0) + (outreach.by_status.expired ?? 0)} />
        <StatTile label="intro asks open" value={outreach.intros.open.length} color={outreach.intros.open.length ? 'var(--yellow)' : undefined} />
      </div>
      {statuses.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[10px]">
          {statuses.map(([s, n]) => <span key={s} className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: STATUS_COLOR[s] ?? 'var(--text-muted)' }}>{s} {n}</span>)}
          {states.map(([s, n]) => <span key={`i-${s}`} className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: INTRO_COLOR[s] ?? 'var(--text-muted)' }}>🤝 {s.replace(/_/g, ' ')} {n}</span>)}
        </div>
      )}
      {outreach.pending.length > 0 && (
        is_owner
          ? <ApprovalsPanel approvals={outreach.pending} onChanged={() => { void onChanged(); }} />
          : (
            <div className="space-y-1 text-[11px]" title="Only the owner can send as themselves">
              {outreach.pending.map((a) => (
                <div key={a.id} className="rounded-lg p-2" style={{ background: 'var(--bg-input)' }}>
                  <span style={{ color: 'var(--accent)' }}>{a.kind === 'intro_request' ? `🤝 intro ask → ${a.person_name || 'connector'} for ${a.intro_lead_name || 'lead'}` : `✉️ cold message → ${a.person_name || '—'}`}</span>
                  <span style={{ color: 'var(--text-muted)' }}> · via {a.channel} · expires {relativeTime(a.expires_at)} · owner decides</span>
                </div>
              ))}
            </div>
          )
      )}
      {outreach.intros.open.length > 0 && (
        <div className="text-[11px] space-y-0.5">
          <div style={{ color: 'var(--text-muted)' }}>Intro asks in flight</div>
          {outreach.intros.open.map((ir) => (
            <div key={ir.id} className="flex items-center gap-2">
              <span className="px-1.5 rounded text-[10px]" style={{ background: 'var(--bg-input)', color: INTRO_COLOR[ir.state] }}>{ir.state.replace(/_/g, ' ')}</span>
              <span>ask <b>{ir.connector_name || '?'}</b> for <Link href={`/prospects/${ir.prospect_id}`} className="hover:underline">{ir.lead_name || 'lead'}</Link></span>
              <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{ir.sent_at ? `sent ${relativeTime(ir.sent_at)}` : `drafted ${relativeTime(ir.created_at)}`}{ir.next_followup_at ? ` · follow up ${relativeTime(ir.next_followup_at)}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {outreach.pending.length === 0 && outreach.intros.open.length === 0 && statuses.length === 0 && (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Nothing drafted for this list yet. The outreach routine drafts for researched leads scoring ≥ its minimum, or open a lead to ask for an intro.</p>
      )}
    </SectionCard>
  );
}
