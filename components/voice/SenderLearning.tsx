'use client';

import { useCallback, useEffect, useState } from 'react';
import { relativeTime } from '@/lib/time';
import { STEPS, TRUST_LABEL, type DraftEval, type SenderProfile, type SenderProfilePayload, type SenderTrustPayload, type SenderTrustRow, type VoiceRule } from '@/lib/voice';
import { api, Help, Section } from '@/components/brand/ui';

/**
 * The AI learns the sender (core 098) — the three cards on /brand → Voice: how you write (measured), the trust
 * ladder (which kinds of message send without your tap), and your priorities (the order the drafter reads your
 * rules in). Nothing here sends anything; a trusted slice still goes through the send gate.
 */

const CHANNEL_LABEL: Record<string, string> = { linkedin: 'LinkedIn', email: 'Email', whatsapp: 'WhatsApp', imessage: 'iMessage' };
const LANG_LABEL: Record<string, string> = { any: 'all languages', de: 'German', en: 'English' };

export function HowYouWrite({ owner }: { owner?: string | null }) {
  const [data, setData] = useState<SenderProfilePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const out = await api<SenderProfilePayload>(`/api/voice/profile${owner ? `?owner=${owner}` : ''}`);
    if (!out.error) setData(out);
  }, [owner]);
  useEffect(() => { load(); }, [load]);

  const act = async (action: 'refresh' | 'rebuild') => {
    setBusy(action); setNote(null);
    const out = await api<{ error?: string; new?: number; stored?: number; built?: unknown[]; thin?: { channel: string; n: number }[]; min_messages?: number }>(
      '/api/voice/profile', { method: 'POST', body: { action, ...(owner ? { owner } : {}) } });
    setBusy(null);
    if (out.error) { setNote(out.error); return; }
    if (action === 'refresh') setNote(`Gathered ${out.stored ?? 0} of your messages (${out.new ?? 0} new).`);
    else setNote(out.built?.length ? `Measured ${out.built.length} profile(s).` : `Nothing new to measure${out.thin?.length ? ` — ${out.thin.map((t) => `${CHANNEL_LABEL[t.channel] ?? t.channel} has ${t.n} of ${out.min_messages ?? 15} messages`).join(', ')}` : ''}.`);
    load();
  };

  const live = (data?.profiles ?? []).filter((p) => p.active);
  const corpus = data?.corpus ?? {};
  const total = Object.values(corpus).reduce((n, c) => n + c.n, 0);

  return (
    <Section title="How you write"
      help="Measured from your own messages — LinkedIn chats, emails, WhatsApp — not from a model's impression. The drafter reads this block before every draft, with your real messages as examples."
      aside={<div className="flex gap-2 shrink-0 text-xs">
        <button onClick={() => act('refresh')} disabled={!!busy} className="underline disabled:opacity-40" style={{ color: 'var(--text-muted)' }} title="Re-gather your messages from the LinkedIn / email mirrors">{busy === 'refresh' ? 'Gathering…' : 'Gather messages'}</button>
        <button onClick={() => act('rebuild')} disabled={!!busy} className="underline disabled:opacity-40" style={{ color: 'var(--text-muted)' }} title="Measure a new version now (the nightly job does this by itself)">{busy === 'rebuild' ? 'Measuring…' : 'Measure now'}</button>
      </div>}>
      {note && <Help>{note}</Help>}
      <div className="flex flex-wrap gap-2">
        {Object.entries(corpus).map(([ch, c]) => (
          <div key={ch} className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--bg-input)' }}>
            <div className="font-medium">{CHANNEL_LABEL[ch] ?? ch}</div>
            <div className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{c.n} messages · {c.reply_known ? `${Math.round((100 * c.replied) / c.reply_known)}% answered` : 'replies unknown'}{c.newest ? ` · newest ${relativeTime(c.newest)}` : ''}</div>
          </div>
        ))}
        {total === 0 && <Help>No messages gathered yet. Connect LinkedIn or Google on your profile, then “Gather messages” — or wait for tonight.</Help>}
      </div>
      {live.length === 0 && total > 0 && <Help>Not enough on any channel yet for a profile (the drafter needs about {data?.profiles?.length === 0 ? 15 : 15} messages per channel). It still uses your messages as examples.</Help>}
      <ul className="space-y-2">
        {live.map((p: SenderProfile) => (
          <li key={p.id} className="rounded-xl p-3 space-y-1" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">{CHANNEL_LABEL[p.channel] ?? p.channel} · {LANG_LABEL[p.language] ?? p.language}</span>
              <span style={{ color: 'var(--text-muted)' }}>v{p.version} · {p.n_messages} messages · {p.eval_score != null ? `scores ${p.eval_score.toFixed(2)}` : 'not scored yet'} · {relativeTime(p.built_at)}</span>
              <button onClick={() => setOpen(open === p.id ? null : p.id)} className="underline ml-auto" style={{ color: 'var(--text-muted)' }}>{open === p.id ? 'hide' : 'what the drafter reads'}</button>
            </div>
            {open === p.id && <pre className="text-xs whitespace-pre-wrap rounded-lg p-2" style={{ background: 'var(--bg-card)', fontFamily: 'inherit' }}>{p.block}</pre>}
            {open !== p.id && p.measured?.words && (
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {p.measured.words.p25}–{p.measured.words.p75} words · opens “{p.measured.greetings?.[0]?.[0] ?? '—'}” · signs “{p.measured.signoffs?.[0]?.[0] ?? '—'}” · asks a question in {p.measured.question_pct ?? 0}%
                {p.measured.du_pct != null ? ` · du ${p.measured.du_pct}% / Sie ${p.measured.sie_pct ?? 0}%` : ''}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function TrustLadder({ owner }: { owner?: string | null }) {
  const [data, setData] = useState<(SenderTrustPayload & { evals?: DraftEval[] }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const out = await api<SenderTrustPayload & { evals?: DraftEval[] }>(`/api/voice/trust?evals=1${owner ? `&owner=${owner}` : ''}`);
    if (!out.error) setData(out); else setErr(out.error);
  }, [owner]);
  useEffect(() => { load(); }, [load]);

  const set = async (row: { situation: string; channel: string }, body: Record<string, unknown>) => {
    const key = `${row.situation}:${row.channel}`;
    setBusy(key); setErr(null);
    const out = await api('/api/voice/trust', { method: 'POST', body: { situation: row.situation, channel: row.channel, ...body, ...(owner ? { owner } : {}) } });
    setBusy(null);
    if (out.error) setErr(out.error);
    load();
  };

  const rows: SenderTrustRow[] = data?.slices ?? [];
  const all: { situation: string; channel: string }[] = [];
  for (const ch of ['linkedin', 'email']) for (const s of ['first', 'followup', 'reply']) all.push({ situation: s, channel: ch });
  const byKey = new Map(rows.map((r) => [`${r.situation}:${r.channel}`, r]));
  const evals = data?.evals ?? [];

  return (
    <Section title="When the AI sends without you"
      help={<>A kind of message (say, LinkedIn follow-ups) sends by itself once you opted in, {data?.trust_after ?? 5} in a row went out unchanged, and the nightly check scores at least {data?.eval_min ?? 0.75}. One edit or skip takes it back. Connection requests and intro asks always wait for your tap.{data && !data.auto_send_enabled ? ' Auto-send is switched off for everyone right now.' : ''}</>}>
      {err && <div className="text-[11px]" style={{ color: 'var(--red)' }}>{err}</div>}
      <ul className="space-y-1.5">
        {all.map((k) => {
          const r = byKey.get(`${k.situation}:${k.channel}`);
          const key = `${k.situation}:${k.channel}`;
          const level = r?.level ?? 'draft';
          const trusted = level === 'trusted' || level === 'autonomous';
          return (
            <li key={key} className="rounded-xl px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ background: 'var(--bg-input)', border: `1px solid ${trusted ? 'var(--green)' : 'var(--border)'}` }}>
              <span className="font-medium min-w-[11rem]">{CHANNEL_LABEL[k.channel]} · {STEPS.find((s) => s.key === k.situation)?.label ?? k.situation}</span>
              <span style={{ color: trusted ? 'var(--green)' : 'var(--text-muted)' }}>{trusted ? '🤖 ' : ''}{TRUST_LABEL[level]}</span>
              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{r?.unchanged_streak ?? 0} of {data?.trust_after ?? 5} unchanged{r?.eval_score != null ? ` · scores ${r.eval_score.toFixed(2)}` : ''}</span>
              {r?.needs?.length ? <span style={{ color: 'var(--text-muted)' }}>· needs: {r.needs.join(', ')}</span> : null}
              {r?.reset_reason && !trusted && r.last_reset_at ? <span style={{ color: 'var(--text-muted)' }}>· {r.reset_reason} {relativeTime(r.last_reset_at)}</span> : null}
              <span className="ml-auto flex gap-2">
                {trusted
                  ? <button onClick={() => set(k, { level: 'draft' })} disabled={busy === key} className="px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>⏸ Pause</button>
                  : r?.opted_in
                    ? <button onClick={() => set(k, { opted_in: false })} disabled={busy === key} className="underline disabled:opacity-40" style={{ color: 'var(--text-muted)' }}>opted in · opt out</button>
                    : <button onClick={() => set(k, { opted_in: true })} disabled={busy === key} className="px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }} title="Once the ladder is complete, these send without your tap">Send these without me once they're good</button>}
              </span>
            </li>
          );
        })}
      </ul>
      {evals.length > 0 && (
        <details>
          <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>Nightly checks ({evals.length})</summary>
          <ul className="text-[11px] pt-1 space-y-0.5" style={{ color: 'var(--text-muted)' }}>
            {evals.slice(0, 12).map((e) => (
              <li key={e.id}>{relativeTime(e.run_at)} · {CHANNEL_LABEL[e.channel] ?? e.channel} · {e.n} messages redrafted blind · similarity {e.mean_similarity != null ? e.mean_similarity.toFixed(2) : '—'} · judge {e.judge_mean != null ? `${e.judge_mean.toFixed(1)}/5` : '—'} · score <b>{e.score != null ? e.score.toFixed(2) : '—'}</b>{e.profile_version ? ` · profile v${e.profile_version}${e.kept === false ? ' (not activated)' : ''}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

/** Rank the viewer's own rules by drag-free up/down — the drafter reads them in this order. */
export function Priorities({ rules, reload }: { rules: VoiceRule[]; reload: () => void }) {
  const [order, setOrder] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setOrder(rules.map((r) => r.id)); setDirty(false); }, [rules]);
  const move = (id: string, dir: -1 | 1) => {
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };
  const save = async () => {
    await api('/api/voice/rules', { method: 'POST', body: { action: 'reorder', rule_ids: order } });
    setDirty(false); reload();
  };
  if (rules.length < 2) return null;
  const byId = new Map(rules.map((r) => [r.id, r]));
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Your priorities</span>
        <Help>The order the drafter reads your rules in — first one first. Move what matters most to the top.</Help>
        {dirty && <button onClick={save} className="ml-auto px-3 py-1 rounded-lg text-xs font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Save order</button>}
      </div>
      <ol className="space-y-1">
        {order.map((id, i) => {
          const r = byId.get(id);
          if (!r) return null;
          return (
            <li key={id} className="flex items-center gap-2 text-xs rounded-lg px-2 py-1" style={{ background: 'var(--bg-input)' }}>
              <span className="tabular-nums w-5" style={{ color: 'var(--text-muted)' }}>{i + 1}.</span>
              <span className="flex-1">{r.kind === 'never_write' ? `Never write “${r.content}”` : r.kind === 'judgment' ? `When / what: ${r.content}` : r.content}</span>
              <button onClick={() => move(id, -1)} disabled={i === 0} className="disabled:opacity-30" aria-label="Move up">▲</button>
              <button onClick={() => move(id, 1)} disabled={i === order.length - 1} className="disabled:opacity-30" aria-label="Move down">▼</button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
