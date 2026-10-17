'use client';

import { useEffect, useState } from 'react';
import { ACTOR_STYLE, LIFECYCLE_BLOCKERS, LIFECYCLE_LABELS, type Lead, type LifecycleStage } from '@/lib/sales-leads';
import type { ProfileLookup } from '@/lib/connect';

/**
 * "Where this lead is and what happens next", at the top of the opened card. A six-step path (profile → connect →
 * connected → messaged → replied → call), the one-line verdict from the Lead Conductor, why it is blocked when it
 * is, and only the controls that make sense for the stage: pick a profile, search again, paste the URL, connect now.
 * Every control reuses an existing, audited route; nothing here sends a message.
 */
const PATH: { label: string; stages: LifecycleStage[] }[] = [
  { label: 'Find profile', stages: ['landed', 'finding_profile', 'needs_pick', 'no_linkedin'] },
  { label: 'Connect', stages: ['ready_to_connect', 'request_filed', 'request_pending', 'stalled', 'email_path'] },
  { label: 'Connected', stages: ['connected', 'first_message_waiting'] },
  { label: 'Messaged', stages: ['messaged', 'followup_due', 'followup_waiting'] },
  { label: 'Replied', stages: ['replied', 'in_conversation'] },
  { label: 'Call', stages: ['call_set'] },
];

function slugOf(input: string): string {
  const v = input.trim().split('?')[0].replace(/\/+$/, '');
  return (v.includes('/in/') ? v.split('/in/')[1] : v).split('/')[0].toLowerCase();
}

export default function LifecyclePanel({ lead, onRefresh, onConnect, connecting, canConnect, busy }: {
  lead: Lead; onRefresh: () => void; onConnect: () => void; connecting: boolean; canConnect: boolean; busy: boolean;
}) {
  const stage = lead.lifecycle_stage;
  const [lookup, setLookup] = useState<ProfileLookup | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    setLookup(null); setMsg(null);
    if (!lead.prospect_id || (stage !== 'needs_pick' && stage !== 'no_linkedin' && stage !== 'finding_profile')) return;
    let live = true;
    fetch(`/api/sales-leads/${lead.id}/lookup`).then((r) => r.json()).then((d) => { if (live) setLookup(d.profile_lookup ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [lead.id, lead.prospect_id, stage]);

  if (!stage) {
    return (
      <div className="mb-4 rounded-xl p-3 text-xs" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
        The Lead Conductor has not looked at this lead yet. It checks every lead each hour.
      </div>
    );
  }
  const actor = lead.lifecycle_actor ?? 'none';
  const style = ACTOR_STYLE[actor];
  const here = PATH.findIndex((p) => p.stages.includes(stage));
  const blocker = lead.lifecycle_blocker ? LIFECYCLE_BLOCKERS[lead.lifecycle_blocker] ?? lead.lifecycle_blocker : null;
  const when = lead.lifecycle_next_at ? new Date(lead.lifecycle_next_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;
  const ghost = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '9999px' } as const;
  const solid = { background: 'var(--accent)', color: 'var(--accent-fg)' } as const;

  async function post(path: string, body: unknown, ok: string): Promise<boolean> {
    setWorking(true); setMsg(null);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'Something went wrong');
      setMsg({ ok: true, text: out.note || ok }); onRefresh(); return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) }); return false;
    } finally { setWorking(false); }
  }
  const pick = (slug: string, member?: string | null) =>
    post(`/api/prospects/${lead.prospect_id}/find-linkedin`, { public_identifier: slug, ...(member ? { member_id: member } : {}) }, 'Profile attached.');
  const search = () => post(`/api/prospects/${lead.prospect_id}/find-linkedin`, {}, 'Searched.');
  const setPaused = (paused: boolean) => post(`/api/sales-leads/${lead.id}/automation`, { paused }, paused ? 'Automation paused.' : 'Automation resumed.');

  const candidates = lookup?.candidates ?? [];
  const strong = new Set(lookup?.strong ?? []);
  const needsProfile = !!lead.prospect_id && (stage === 'needs_pick' || stage === 'no_linkedin' || stage === 'finding_profile');

  return (
    <div className="mb-4 rounded-xl p-3 space-y-2.5" style={{ background: 'var(--bg-input)' }}>
      <ol className="flex items-center gap-1" aria-label="Lead path">
        {PATH.map((p, i) => (
          <li key={p.label} className="flex-1 min-w-0">
            <div className="h-1.5 rounded-full" style={{ background: i < here || (i === here && stage === 'call_set') ? 'var(--accent)' : i === here ? style.color : 'var(--border)' }} />
            <div className="mt-1 text-[11px] leading-tight truncate" style={{ color: i <= here ? 'var(--text)' : 'var(--text-muted)', fontWeight: i === here ? 600 : 400 }}>{p.label}</div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${style.color} 14%, transparent)`, color: style.color }}>
          {style.label ? `${style.label} · ` : ''}{LIFECYCLE_LABELS[stage]}
        </span>
        <span className="text-xs font-medium">{lead.lifecycle_step}</span>
        {when && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>expected around {when}</span>}
      </div>
      {lead.sender_name && !['in_conversation', 'paused', 'call_set', 'replied'].includes(stage) && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Sends from <b style={{ color: 'var(--text)' }}>{lead.sender_name}</b>&apos;s LinkedIn and cards go to their Telegram.</div>
      )}

      {blocker && (
        <p className="text-xs rounded-lg px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)', color: 'var(--text)' }}>
          <b style={{ color: 'var(--orange)' }}>Blocked:</b> {blocker}
        </p>
      )}

      {needsProfile && candidates.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Which LinkedIn profile is {lead.full_name}{lead.company && lead.company !== 'Unknown' ? ` at ${lead.company}` : ''}? A wrong pick cannot be undone once a request goes out.
          </div>
          {candidates.slice(0, 6).map((c) => (
            <div key={c.public_identifier ?? c.name ?? ''} className="rounded-lg px-2.5 py-1.5 flex items-start gap-2"
              style={{ background: 'var(--bg-card)', border: `1px solid ${c.public_identifier && strong.has(c.public_identifier) ? 'var(--green)' : 'var(--border)'}` }}>
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium truncate">{c.name || c.public_identifier}{c.public_identifier && strong.has(c.public_identifier) ? ' · likely' : ''}</div>
                <div className="truncate" style={{ color: 'var(--text-muted)' }}>{[c.headline, c.location].filter(Boolean).join(' · ') || '—'}</div>
                {c.public_identifier && <a href={`https://www.linkedin.com/in/${c.public_identifier}`} target="_blank" rel="noopener noreferrer" className="underline text-[11px]" style={{ color: 'var(--accent)' }}>open on LinkedIn</a>}
              </div>
              {c.public_identifier && (
                <button type="button" disabled={working || busy} onClick={() => pick(c.public_identifier!, c.provider_id)}
                  className="text-[11px] px-2.5 py-1 rounded-full font-medium disabled:opacity-50 flex-shrink-0" style={solid}>Use this</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {needsProfile && (
          <button type="button" disabled={working || busy} onClick={search} className="text-[11px] px-3 py-1 disabled:opacity-50" style={ghost}
            title="One search on the sending account: the web first, then LinkedIn">{working ? 'Searching…' : 'Search again now'}</button>
        )}
        {needsProfile && (
          <span className="inline-flex items-center gap-1">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the LinkedIn URL" aria-label="LinkedIn profile URL"
              onKeyDown={(e) => { if (e.key === 'Enter' && slugOf(url)) pick(slugOf(url)).then((ok) => ok && setUrl('')); }}
              className="text-[11px] px-2.5 py-1 w-52" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '9999px' }} />
            <button type="button" disabled={working || busy || !slugOf(url)} onClick={() => pick(slugOf(url)).then((ok) => ok && setUrl(''))}
              className="text-[11px] px-2.5 py-1 font-medium disabled:opacity-40" style={solid} >Use URL</button>
          </span>
        )}
        {canConnect && (
          <button type="button" disabled={connecting || busy} onClick={onConnect} className="text-[11px] px-3 py-1 rounded-full font-medium disabled:opacity-50" style={solid}
            title="Files this request for approval now instead of waiting for the next daily batch">{connecting ? 'Filing…' : 'Connect now'}</button>
        )}
        <span className="flex-1" />
        <button type="button" disabled={working || busy} onClick={() => setPaused(!lead.lifecycle_paused)} className="text-[11px] px-2.5 py-1 disabled:opacity-50" style={{ ...ghost, color: 'var(--text-muted)' }}
          title={lead.lifecycle_paused ? 'Hand this lead back to the Lead Conductor' : 'Stop the system doing anything with this lead; you keep it on the list'}>
          {lead.lifecycle_paused ? 'Resume automation' : 'Pause automation'}
        </button>
      </div>
      {msg && <p className="text-xs" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</p>}
    </div>
  );
}
