'use client';

import { useCallback, useEffect, useState } from 'react';
import { relativeTime } from '@/lib/time';
import { CONFLICT_LABEL, DOC_LABEL, FORMALITY, LIMIT_KEYS, SOURCE_LABEL, STEPS, TONES, type BrandPayload, type RuleKind, type VoiceRule } from '@/lib/voice';
import { HowYouWrite, Priorities, TrustLadder } from '@/components/voice/SenderLearning';
import { api, ChipInput, Help, Section } from './ui';

interface Stats {
  by_kind: { kind: string; sent: number; unchanged: number; skipped: number; avg_rating: string | null; rated: number; avg_edit: string | null }[];
  weekly: { week: string; avg_rating: string | null; sent: number; unchanged: number }[];
  rules: { active?: number; learned_recently?: number };
}

/** How we sound — the team's voice for this brand, and the viewer's OWN voice that learns from their corrections. */
export default function VoiceTab({ data, reload }: { data: BrandPayload; reload: () => void }) {
  const b = data.brand;
  const [rules, setRules] = useState<{ sender: VoiceRule[]; team: VoiceRule[] } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showOld, setShowOld] = useState(false);

  const loadRules = useCallback(async () => {
    const [r, s] = await Promise.all([
      api<{ sender: VoiceRule[]; team: VoiceRule[] }>(`/api/voice/rules?brand=${b.key}${showOld ? '&all=1' : ''}`),
      api<Stats>('/api/voice/stats?days=60'),
    ]);
    if (!r.error) setRules(r);
    if (!s.error) setStats(s);
  }, [b.key, showOld]);
  useEffect(() => { loadRules(); }, [loadRules]);

  const patch = async (fields: Record<string, unknown>) => {
    const out = await api(`/api/brand/${b.key}`, { method: 'PATCH', body: { fields } });
    if (!out.error) reload();
    return out.error ?? null;
  };

  return (
    <div className="space-y-4">
      <HowYouWrite />
      <MyVoice rules={rules?.sender ?? null} stats={stats} brandKey={b.key} reload={loadRules} showOld={showOld} setShowOld={setShowOld} />
      <TrustLadder />

      <Section title={`How ${b.name} sounds`} help="The team's voice: every message for this brand, from every sender. A sender's own rules win where they differ.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 block">
            <span className="text-xs font-medium">Tone</span>
            <select value={b.tone} onChange={(e) => patch({ tone: e.target.value })} className="z-input">
              {TONES.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.hint}</option>)}
            </select>
            <Help>A style guide for every draft.</Help>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs font-medium">Formal or informal address</span>
            <select value={b.formality} onChange={(e) => patch({ formality: e.target.value })} className="z-input">
              {FORMALITY.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <Help>In German this is checked in code: a draft with the wrong form is flagged before anyone sees it.</Help>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs font-medium">Default language</span>
            <input defaultValue={b.language ?? ''} onBlur={(e) => { if (e.target.value.trim() !== (b.language ?? '')) patch({ language: e.target.value.trim() }); }}
              className="z-input" placeholder="en, de, …" />
            <Help>A hint — a list can set its own language, and a German conversation is answered in German.</Help>
          </label>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium">Never write</span>
          <ChipInput values={b.never_write ?? []} onChange={(v) => patch({ never_write: v })}
            placeholder="e.g. just wanted to circle back — press Enter" />
          <Help>Checked in code on every draft: one of these phrases is flagged on the card, and an automatic draft containing one is redrafted or dropped. There is no “always include” list on purpose — forced phrases make every message sound the same.</Help>
        </div>
        <details>
          <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>Word limits per message</summary>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 pt-2">
            {LIMIT_KEYS.map((l) => (
              <label key={l.key} className="flex items-center justify-between gap-2 text-xs">
                <span>{l.label}</span>
                <input type="number" min={5} max={1000} defaultValue={b.limits?.[l.key] ?? l.fallback}
                  onBlur={(e) => { const n = Number(e.target.value); if (n && n !== (b.limits?.[l.key] ?? l.fallback)) patch({ limits: { ...(b.limits ?? {}), [l.key]: n } }); }}
                  className="z-input !w-20 !py-1 tabular-nums" aria-label={`${l.label} word limit`} />
              </label>
            ))}
          </div>
        </details>
      </Section>

      <TeamRules rules={rules?.team ?? null} brandKey={b.key} brandName={b.name} reload={loadRules} />
    </div>
  );
}

function RuleRow({ r, actions }: { r: VoiceRule; actions?: React.ReactNode }) {
  const ev = r.evidence ?? {};
  const scope = [r.channels?.join('/'), r.steps?.map((s) => STEPS.find((x) => x.key === s)?.label ?? s).join(', ')].filter(Boolean).join(' · ');
  return (
    <li className="rounded-xl p-3 space-y-1" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', opacity: r.status === 'active' ? 1 : 0.6 }}>
      <div className="flex items-start gap-2">
        <span className="flex-1 text-sm">{r.kind === 'never_write' ? <>Never write “{r.content}”</> : r.kind === 'judgment' ? <><span className="text-[10px] px-1 py-0.5 rounded mr-1" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>when / what</span>{r.content}</> : r.content}</span>
        {actions}
      </div>
      <div className="text-[11px] flex flex-wrap gap-x-2" style={{ color: 'var(--text-muted)' }}>
        <span>{ev.doc ? `from ${DOC_LABEL[ev.doc] ?? ev.doc}` : (SOURCE_LABEL[r.source] ?? r.source)} · {relativeTime(r.created_at)}</span>
        {ev.resolved && <span>· you settled “{CONFLICT_LABEL[ev.resolved.key] ?? ev.resolved.key}” with this one</span>}
        {r.confirmations > 1 && <span>· confirmed {r.confirmations}×</span>}
        {scope && <span>· only for {scope}</span>}
        {ev.rating ? <span>· you rated it {ev.rating}/10{ev.reason ? ` — ${ev.reason}` : ''}</span> : null}
        {r.status !== 'active' && <span>· {r.status}</span>}
      </div>
      {(ev.before || ev.after) && (
        <details className="text-[12px]">
          <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>What it learned from</summary>
          <div className="grid gap-2 md:grid-cols-2 pt-1">
            {ev.before && <div><div className="text-xs font-medium">Draft</div><p className="whitespace-pre-wrap">{ev.before}</p></div>}
            {ev.after && <div><div className="text-xs font-medium">What was sent</div><p className="whitespace-pre-wrap">{ev.after}</p></div>}
          </div>
        </details>
      )}
    </li>
  );
}

function MyVoice({ rules, stats, brandKey, reload, showOld, setShowOld }: {
  rules: VoiceRule[] | null; stats: Stats | null; brandKey: string; reload: () => void; showOld: boolean; setShowOld: (v: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: 'forget' | 'share') => {
    setBusy(id);
    await api(`/api/voice/rules/${id}`, { method: 'POST', body: { action, brand: brandKey } });
    setBusy(null); reload();
  };
  const sent = stats?.by_kind.reduce((n, k) => n + Number(k.sent), 0) ?? 0;
  const unchanged = stats?.by_kind.reduce((n, k) => n + Number(k.unchanged), 0) ?? 0;
  const rated = stats?.by_kind.filter((k) => k.avg_rating).map((k) => ({ n: Number(k.rated), r: Number(k.avg_rating) })) ?? [];
  const avg = rated.reduce((s, x) => s + x.n, 0) ? (rated.reduce((s, x) => s + x.n * x.r, 0) / rated.reduce((s, x) => s + x.n, 0)).toFixed(1) : '—';

  return (
    <Section title="Your voice"
      help={<>Learned from you: a draft you send as written counts as a 10 by itself; every edit and every chip you tap (what was wrong) becomes a rule here at once — in your voice only. Decide drafts on the Telegram card or on <a href="/agents" className="underline">Agents</a>.</>}
      aside={<label className="text-[11px] flex items-center gap-1 shrink-0" style={{ color: 'var(--text-muted)' }}>
        <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> show forgotten</label>}>
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Sent unchanged', sent ? `${Math.round((unchanged / sent) * 100)}%` : '—', 'of drafts you sent in 60 days — this should rise'],
            ['Average rating', avg, `${rated.reduce((s, x) => s + x.n, 0)} drafts rated`],
            ['Rules learned', String(stats.rules.learned_recently ?? 0), `${stats.rules.active ?? 0} active in your voice`],
          ].map(([k, v, h]) => (
            <div key={k} className="rounded-xl p-3" style={{ background: 'var(--bg-input)' }}>
              <div className="text-xs font-medium">{k}</div>
              <div className="text-xl font-semibold tabular-nums">{v}</div>
              <Help>{h}</Help>
            </div>
          ))}
        </div>
      )}
      <AddRule brandKey={brandKey} scope="sender" onAdded={reload} />
      {rules && <Contested rules={rules.filter((r) => r.status === 'active')} reload={reload} />}
      {rules && rules.filter((r) => r.status === 'active').length >= 2 && <Priorities rules={rules.filter((r) => r.status === 'active' && !isHeldBack(r))} reload={reload} />}
      {rules === null ? <Help>Loading…</Help> : rules.length === 0 ? (
        <Help>No rules yet. Correct a draft, tap a chip on one, or add a rule above — e.g. “Sign as Matthias, no surname”.</Help>
      ) : (
        <ul className="space-y-2">
          {rules.filter((r) => !(r.status === 'active' && isContested(r))).map((r) => (
            <RuleRow key={r.id} r={r} actions={r.status === 'active' ? (
              <span className="flex gap-2 shrink-0 text-xs">
                <button onClick={() => act(r.id, 'share')} disabled={busy === r.id} className="underline" style={{ color: 'var(--text-muted)' }} title="Copy to the team's voice — live for everyone at once">Share with team</button>
                <button onClick={() => act(r.id, 'forget')} disabled={busy === r.id} className="underline" style={{ color: 'var(--text-muted)' }}>Forget</button>
              </span>) : null} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function isContested(r: VoiceRule): boolean {
  return Boolean(r.evidence?.conflict?.key);
}
/** The contested side the drafter does not read (its twin is the default). It keeps no priority position. */
function isHeldBack(r: VoiceRule): boolean {
  return isContested(r) && !r.evidence?.conflict?.default;
}

/** A loaded playbook can carry two rules that contradict each other (the 22 Oct playbook vs the "Mateo Method" guide).
 * Both are stored; the drafter follows the DEFAULT side (the one the sender's own messages support) until the person
 * keeps one. Keeping a side archives the other. */
function Contested({ rules, reload }: { rules: VoiceRule[]; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const groups = new Map<string, VoiceRule[]>();
  for (const r of rules) { const k = r.evidence?.conflict?.key; if (k) groups.set(k, [...(groups.get(k) ?? []), r]); }
  if (groups.size === 0) return null;
  const keep = async (id: string) => {
    setBusy(id);
    await api(`/api/voice/rules/${id}`, { method: 'POST', body: { action: 'resolve' } });
    setBusy(null); reload();
  };
  return (
    <div className="rounded-xl p-3 space-y-3" style={{ background: 'color-mix(in srgb, var(--yellow) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--yellow) 40%, transparent)' }}>
      <div>
        <div className="text-sm font-medium">Contested: pick the one that is you</div>
        <Help>Your playbooks disagree on these. The drafter follows the side marked “drafting with this one” until you keep one; keeping a side forgets the other.</Help>
      </div>
      <ul className="space-y-3">
        {[...groups.entries()].map(([key, pair]) => (
          <li key={key} className="space-y-1">
            <div className="text-xs font-medium">{CONFLICT_LABEL[key] ?? key}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {pair.sort((a, b) => Number(Boolean(b.evidence?.conflict?.default)) - Number(Boolean(a.evidence?.conflict?.default))).map((r) => {
                const isDefault = Boolean(r.evidence?.conflict?.default);
                return (
                  <div key={r.id} className="rounded-lg p-2 space-y-1" style={{ background: 'var(--bg-card)', border: `1px solid ${isDefault ? 'var(--accent)' : 'var(--border)'}` }}>
                    <p className="text-sm">{r.content}</p>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {r.evidence?.doc ? `from ${DOC_LABEL[r.evidence.doc] ?? r.evidence.doc}` : SOURCE_LABEL[r.source]}
                      {isDefault ? ' · drafting with this one' : ' · held back'}
                      {r.evidence?.conflict?.note ? ` · ${r.evidence.conflict.note}` : ''}
                    </div>
                    <button onClick={() => keep(r.id)} disabled={busy === r.id} className="px-2 py-1 rounded-md text-xs font-medium disabled:opacity-40"
                      style={{ background: isDefault ? 'var(--accent)' : 'var(--bg-input)', color: isDefault ? 'var(--accent-fg)' : 'var(--text)', border: '1px solid var(--border)' }}>
                      Keep this
                    </button>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamRules({ rules, brandKey, brandName, reload }: { rules: VoiceRule[] | null; brandKey: string; brandName: string; reload: () => void }) {
  const forget = async (id: string) => { await api(`/api/voice/rules/${id}`, { method: 'POST', body: { action: 'forget' } }); reload(); };
  return (
    <Section title={`Team rules for ${brandName}`} help="Rules for everyone writing for this brand — added here or shared from someone's own voice. Live at once.">
      <AddRule brandKey={brandKey} scope="team" onAdded={reload} />
      {rules && rules.length === 0 && <Help>No team rules yet.</Help>}
      <ul className="space-y-2">
        {(rules ?? []).map((r) => (
          <RuleRow key={r.id} r={r} actions={r.status === 'active'
            ? <button onClick={() => forget(r.id)} className="text-xs underline shrink-0" style={{ color: 'var(--text-muted)' }}>Remove</button> : null} />
        ))}
      </ul>
    </Section>
  );
}

function AddRule({ brandKey, scope, onAdded }: { brandKey: string; scope: 'sender' | 'team'; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<RuleKind>('rule');
  const [step, setStep] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const add = async () => {
    if (!text.trim()) return;
    const out = await api<{ rule?: VoiceRule; reinforced?: boolean }>('/api/voice/rules', {
      method: 'POST', body: { content: text, kind, scope, brand: brandKey, ...(step ? { steps: [step] } : {}) },
    });
    if (out.error) { setMsg(out.error); return; }
    setMsg(out.reinforced ? 'Already there — confirmed it again.' : null);
    setText(''); onAdded();
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as RuleKind)} className="z-input !w-auto !py-1.5 text-xs" aria-label="Kind of rule">
          <option value="rule">Wording</option>
          <option value="judgment">When / what</option>
          <option value="never_write">Never write</option>
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder={kind === 'rule' ? (scope === 'team' ? 'e.g. No demo asks in a first message' : 'e.g. Keep LinkedIn first messages to three sentences') : kind === 'judgment' ? 'e.g. Never ask for a call before they have answered once' : 'The exact phrase'}
          className="z-input flex-1 min-w-[12rem] !py-1.5" aria-label="New rule" />
        <select value={step} onChange={(e) => setStep(e.target.value)} className="z-input !w-auto !py-1.5 text-xs" aria-label="Applies to">
          <option value="">every message</option>
          {STEPS.map((s) => <option key={s.key} value={s.key}>{s.label} only</option>)}
        </select>
        <button onClick={add} disabled={!text.trim()} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Add</button>
      </div>
      {msg && <Help>{msg}</Help>}
    </div>
  );
}
