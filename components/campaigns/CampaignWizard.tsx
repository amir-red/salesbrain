'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/panel/Button';
import {
  CHANNEL_OPTIONS, DEFAULT_SPEC, HANDOFF_TO, MODES, NOTE_MODES, PLACEHOLDERS, describeSpec, specProblems,
  type MessageSpec, type WizardSpec, type WriteMode,
} from '@/lib/campaigns';

/**
 * New campaign, as five questions (the ICP builder's shape: numbered sections, the plan in a sticky right column).
 * Nothing is drawn by hand here: "Create campaign" sends the answers to the kernel, which draws the sequence
 * (policy/campaigns.py::graph_from_spec) and opens it on the canvas, where any step can still be changed.
 */
interface ListOpt { id: string; name: string; owner_user_id: string; owner_name: string | null; leads: number; with_email: number; with_linkedin: number }
interface SourceOpt { source: string; leads: number; with_email: number; with_linkedin: number }
interface Owner { id: string; name: string; has_gmail: boolean; has_linkedin: boolean }
interface Options { icps: ListOpt[]; sources: SourceOpt[]; products: { id: string; name: string }[]; owners: Owner[] }

const muted = { color: 'var(--text-muted)' };

function Section({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{n}</span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {sub && <p className="text-xs" style={muted}>{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="text-xs font-medium">{children}</span>
      {hint && <span className="text-[11px]" style={muted}>{hint}</span>}
    </span>
  );
}

/** A row of choice tiles (the selected one gets the accent border). */
function Choice<K extends string>({ options, value, onChange }: {
  options: { key: K; label: string; hint?: string }[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${options.length > 3 ? 150 : 190}px, 1fr))` }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={on}
            className="text-left rounded-lg px-3 py-2.5 grid gap-0.5"
            style={{ border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-soft)' : 'transparent' }}>
            <span className="text-sm font-medium">{o.label}</span>
            {o.hint && <span className="text-[11px] leading-snug" style={muted}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function MessageEditor({ value, onChange, subject, placeholder }: {
  value: MessageSpec; onChange: (m: MessageSpec) => void; subject: boolean; placeholder: string;
}) {
  return (
    <div className="grid gap-2">
      <Choice options={MODES.map((m) => ({ key: m.key as WriteMode, label: m.label, hint: m.hint }))} value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })} />
      {value.mode === 'guided' && (
        <textarea className="z-input text-sm" rows={3} value={value.instructions} placeholder={placeholder}
          aria-label="Instructions" onChange={(e) => onChange({ ...value, instructions: e.target.value })} />
      )}
      {value.mode === 'fixed' && (
        <>
          {subject && <input className="z-input text-sm" value={value.subject ?? ''} placeholder="Subject"
            aria-label="Subject" onChange={(e) => onChange({ ...value, subject: e.target.value })} />}
          <textarea className="z-input text-sm" rows={5} value={value.text} aria-label="Text"
            placeholder={'Hi {first_name},\n\n…'} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          <span className="text-[11px]" style={muted}>
            You can use {PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}. Someone with no value for one waits instead of getting a gap.
          </span>
        </>
      )}
    </div>
  );
}

export default function CampaignWizard() {
  const router = useRouter();
  const [opts, setOpts] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'blank' | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [hook, setHook] = useState('');
  const [language, setLanguage] = useState('');
  const [productId, setProductId] = useState('');
  const [icps, setIcps] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [spec, setSpec] = useState<WizardSpec>(DEFAULT_SPEC);
  const [dailyMax, setDailyMax] = useState(10);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/campaigns/options');
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) { setError(out.error || 'Could not load your lists.'); return; }
      setOpts(out);
    })();
  }, []);

  const set = (patch: Partial<WizardSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const toggle = (arr: string[], fn: (v: string[]) => void, v: string) => fn(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const reach = useMemo(() => {
    const picked = [...(opts?.icps ?? []).filter((i) => icps.includes(i.id)), ...(opts?.sources ?? []).filter((s) => sources.includes(s.source))];
    return {
      people: picked.reduce((a, r) => a + r.leads, 0),
      email: picked.reduce((a, r) => a + r.with_email, 0),
      linkedin: picked.reduce((a, r) => a + r.with_linkedin, 0),
    };
  }, [opts, icps, sources]);

  const senders = useMemo(() => {
    const ids = new Set((opts?.icps ?? []).filter((i) => icps.includes(i.id)).map((i) => i.owner_user_id));
    return (opts?.owners ?? []).filter((o) => ids.has(o.id));
  }, [opts, icps]);

  const usesEmail = spec.channel !== 'linkedin';
  const usesLinkedIn = spec.channel !== 'email';
  const problems = [
    ...(!name.trim() ? ['Give the campaign a name.'] : []),
    ...(!icps.length && !sources.length ? ['Choose at least one list.'] : []),
    ...specProblems(spec),
  ];
  const plan = describeSpec(spec);

  const create = async (blank: boolean) => {
    setBusy(blank ? 'blank' : 'create'); setError(null);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, goal, writing_context: hook, language, product_id: productId || null, daily_max_per_step: dailyMax,
          lists: [...icps.map((id) => ({ icp_id: id })), ...sources.map((s) => ({ source: s }))],
          ...(blank ? { start_from: 'blank' } : { spec: { ...spec, reply_days: spec.reply_days.slice(0, spec.messages) } }),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) throw new Error(out.error || 'Could not create the campaign.');
      router.push(`/campaigns/${out.id}?created=${blank ? 'blank' : 'drawn'}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the campaign.'); setBusy(null); }
  };

  const msgLabel = spec.channel === 'email' ? 'email' : 'message';
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 p-4">
      <div className="space-y-4 min-w-0">
        <Section n={1} title="What is this campaign for?" sub="Every draft reads this before it is written.">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="grid gap-1"><Label>Name</Label>
              <input className="z-input text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zeami raise · VC email" autoFocus /></label>
            <label className="grid gap-1"><Label>Goal</Label>
              <input className="z-input text-sm" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. A 30-minute intro call" /></label>
          </div>
          <label className="grid gap-1"><Label hint="Who they are and why we are writing: the angle every message starts from.">Who we target and the hook</Label>
            <textarea className="z-input text-sm" rows={3} value={hook} onChange={(e) => setHook(e.target.value)}
              placeholder="e.g. Seed funds investing in AI and enterprise software in Europe. Zeami shows where a company's time goes and what to automate first." /></label>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="grid gap-1"><Label>Language</Label>
              <select className="z-input text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">Decide per person</option><option value="en">English</option><option value="de">German</option>
              </select></label>
            {opts && opts.products.length > 0 && (
              <label className="grid gap-1"><Label>Product it pitches</Label>
                <select className="z-input text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">The brand in general</option>
                  {opts.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
            )}
          </div>
        </Section>

        <Section n={2} title="Who should it reach?" sub="A person is in one campaign at a time; anyone who already replied or is in another campaign is left out.">
          {!opts && !error && <p className="text-xs" style={muted}>Loading your lists…</p>}
          {opts && (
            <div className="grid gap-3">
              {opts.icps.length > 0 && (
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  <div className="grid grid-cols-[1fr_auto] px-3 py-1.5 text-[11px] font-medium" style={{ ...muted, background: 'var(--bg-input)' }}>
                    <span>List</span><span>people · with email · on LinkedIn</span>
                  </div>
                  {opts.icps.map((i) => (
                    <label key={i.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 text-sm border-t cursor-pointer" style={{ borderColor: 'var(--border)' }}>
                      <input type="checkbox" checked={icps.includes(i.id)} onChange={() => toggle(icps, setIcps, i.id)} />
                      <span className="truncate">{i.name} <span className="text-xs" style={muted}>· {i.owner_name}</span></span>
                      <span className="text-xs tabular-nums" style={muted}>{i.leads} · {i.with_email} · {i.with_linkedin}</span>
                    </label>
                  ))}
                </div>
              )}
              {opts.sources.length > 0 && (
                <details className="rounded-lg" style={{ border: '1px solid var(--border)' }}>
                  <summary className="px-3 py-2 text-xs cursor-pointer" style={muted}>Sales-lead sources ({opts.sources.length})</summary>
                  {opts.sources.map((s) => (
                    <label key={s.source} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 text-sm border-t cursor-pointer" style={{ borderColor: 'var(--border)' }}>
                      <input type="checkbox" checked={sources.includes(s.source)} onChange={() => toggle(sources, setSources, s.source)} />
                      <span className="truncate">{s.source}</span>
                      <span className="text-xs tabular-nums" style={muted}>{s.leads} · {s.with_email} · {s.with_linkedin}</span>
                    </label>
                  ))}
                </details>
              )}
            </div>
          )}
        </Section>

        <Section n={3} title="How do we reach them?">
          <Choice options={CHANNEL_OPTIONS.map((c) => ({ key: c.key, label: c.label, hint: c.hint }))} value={spec.channel}
            onChange={(channel) => set({ channel })} />
          {reach.people > 0 && (
            <p className="text-xs" style={muted}>
              Of the {reach.people} people chosen, {reach.email} have an email and {reach.linkedin} a LinkedIn profile.
              {spec.channel === 'email' && reach.people > reach.email && ` The other ${reach.people - reach.email} wait at the first email until an address is found.`}
              {spec.channel === 'linkedin' && reach.people > reach.linkedin && ` The other ${reach.people - reach.linkedin} wait until their profile is found.`}
            </p>
          )}
        </Section>

        <Section n={4} title="What do we send?" sub="Each message is drafted per person in the sender’s voice and waits for their approval. Nothing goes out by itself.">
          {usesLinkedIn && (
            <div className="grid gap-3 rounded-lg p-3" style={{ background: 'var(--bg-input)' }}>
              <Label hint="A plain request is accepted most often.">Connection request</Label>
              <Choice options={NOTE_MODES.map((m) => ({ key: m.key as WizardSpec['connect_note'], label: m.label }))} value={spec.connect_note}
                onChange={(connect_note) => set({ connect_note })} />
              {spec.connect_note === 'guided' && (
                <textarea className="z-input text-sm" rows={2} value={spec.connect_instructions} aria-label="Instructions for the note"
                  placeholder="e.g. Mention we met at Fakuma." onChange={(e) => set({ connect_instructions: e.target.value })} />
              )}
              {spec.connect_note === 'fixed' && (
                <>
                  <textarea className="z-input text-sm" rows={3} value={spec.connect_text} aria-label="Connection note"
                    onChange={(e) => set({ connect_text: e.target.value })} />
                  <span className="text-[11px] tabular-nums" style={{ color: spec.connect_text.length > 300 ? 'var(--red)' : 'var(--text-muted)' }}>
                    {spec.connect_text.length}/300 characters (200 on a free LinkedIn account)</span>
                </>
              )}
              <label className="flex items-center gap-2 text-sm">Wait up to
                <input type="number" min={1} max={60} className="z-input text-sm" style={{ width: 72 }} value={spec.accept_days}
                  onChange={(e) => set({ accept_days: Number(e.target.value) || 21 })} /> days for them to accept</label>
            </div>
          )}

          <div className="grid gap-2">
            <Label hint={`The first ${msgLabel}, then follow-ups to anyone who has not replied.`}>How many {msgLabel}s</Label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" onClick={() => set({ messages: n })} aria-pressed={spec.messages === n}
                  className="px-3 py-1.5 rounded-lg text-sm tabular-nums"
                  style={{ border: `1px solid ${spec.messages === n ? 'var(--accent)' : 'var(--border)'}`, background: spec.messages === n ? 'var(--accent-soft)' : 'transparent' }}>
                  {n === 1 ? '1 · no follow-up' : `${n} · ${n - 1} follow-up${n > 2 ? 's' : ''}`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label hint="A reply at any point stops the sequence for that person.">Wait for a reply</Label>
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: spec.messages }, (_, i) => (
                <label key={i} className="flex items-center gap-2 text-sm">
                  <span style={muted}>after {i === 0 ? `the first ${msgLabel}` : `follow-up ${i}`}</span>
                  <input type="number" min={1} max={60} className="z-input text-sm" style={{ width: 64 }} value={spec.reply_days[i] ?? 7}
                    onChange={(e) => { const d = [...spec.reply_days]; d[i] = Number(e.target.value) || 7; set({ reply_days: d }); }} />
                  <span style={muted}>days</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>The first {msgLabel}</Label>
            <MessageEditor value={spec.first} onChange={(first) => set({ first })} subject={usesEmail}
              placeholder="e.g. Short and direct. One line on why them, one on what Zeami does with one number. Ask for 30 minutes. No links." />
          </div>
          {spec.messages > 1 && (
            <div className="grid gap-2">
              <Label hint="Every follow-up is written the same way; each one knows what was already said.">The follow-ups</Label>
              <MessageEditor value={spec.followups} onChange={(followups) => set({ followups })} subject={false}
                placeholder="e.g. Shorter than the last; one new fact; one easy question." />
            </div>
          )}
        </Section>

        <Section n={5} title="When someone replies" sub="The sequence stops for them at once, and a person takes over.">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="grid gap-1"><Label>Hand them to</Label>
              <select className="z-input text-sm" value={spec.reply_to} onChange={(e) => set({ reply_to: e.target.value as WizardSpec['reply_to'] })}>
                {HANDOFF_TO.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
              </select></label>
            <label className="grid gap-1"><Label>What they should do</Label>
              <input className="z-input text-sm" value={spec.reply_note} onChange={(e) => set({ reply_note: e.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm flex-wrap">At most
            <input type="number" min={1} max={100} className="z-input text-sm" style={{ width: 72 }} value={dailyMax}
              onChange={(e) => setDailyMax(Math.max(1, Number(e.target.value) || 10))} />
            drafts per step per day on the approval card
            <span className="text-[11px] w-full" style={muted}>Start small: read the first card carefully, then raise it in Settings.</span>
          </label>
        </Section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 self-start">
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold">Your sequence</h3>
          <ol className="grid gap-1.5">
            {plan.map((l, i) => (
              <li key={i} className={`flex gap-2 text-xs ${l.indent ? 'pl-4' : ''}`}>
                <span className="w-4 shrink-0 text-center" aria-hidden
                  style={{ color: l.kind === 'send' ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {l.kind === 'send' ? '●' : l.kind === 'wait' ? '⋮' : l.kind === 'branch' ? '↳' : '■'}
                </span>
                <span>
                  <span className={l.kind === 'send' ? 'font-medium' : ''} style={l.kind === 'send' ? undefined : muted}>{l.text}</span>
                  {l.detail && <span style={muted}> · {l.detail}</span>}
                </span>
              </li>
            ))}
            <li className="flex gap-2 text-xs"><span className="w-4 text-center" style={{ color: 'var(--green)' }} aria-hidden>↩</span>
              <span style={muted}>Any reply: hand to {HANDOFF_TO.find((h) => h.key === spec.reply_to)?.label.split(' (')[0].toLowerCase()}</span></li>
          </ol>
          <p className="text-[11px]" style={muted}>You can change any step on the canvas after it is drawn.</p>
        </div>

        {senders.length > 0 && (
          <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-semibold">Sent from</h3>
            <p className="text-[11px]" style={muted}>Each list’s owner sends and approves its messages.</p>
            {senders.map((o) => {
              const missing = [usesEmail && !o.has_gmail ? 'Gmail' : null, usesLinkedIn && !o.has_linkedin ? 'LinkedIn' : null].filter(Boolean);
              return (
                <div key={o.id} className="text-xs flex justify-between gap-2">
                  <span>{o.name}</span>
                  <span style={{ color: missing.length ? 'var(--orange)' : 'var(--green)' }}>
                    {missing.length ? `${missing.join(' and ')} not connected` : 'ready'}</span>
                </div>
              );
            })}
            {senders.some((o) => (usesEmail && !o.has_gmail) || (usesLinkedIn && !o.has_linkedin)) && (
              <p className="text-[11px]" style={muted}>They connect it on Profile → Google or Profile → LinkedIn. You can create the campaign now;
                until it is connected, their people wait at those steps (and a campaign nobody can send cannot launch).</p>
            )}
          </div>
        )}

        {error && <div className="text-xs px-3 py-2 rounded-lg" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: 'var(--red)' }}>{error}</div>}
        {problems.length > 0 && (
          <ul className="text-[11px] grid gap-0.5" style={muted}>{problems.map((p) => <li key={p}>· {p}</li>)}</ul>
        )}
        <div className="flex gap-2">
          <Button variant="success" className="flex-1 justify-center" disabled={problems.length > 0 || busy !== null} onClick={() => create(false)}>
            {busy === 'create' ? 'Drawing…' : 'Create campaign'}
          </Button>
          <Button href="/campaigns">Cancel</Button>
        </div>
        <p className="text-[11px]" style={muted}>
          It is created as a draft: nothing is sent until you launch it.{' '}
          <button type="button" className="underline" disabled={!name.trim() || (!icps.length && !sources.length) || busy !== null}
            onClick={() => create(true)}>{busy === 'blank' ? 'Opening…' : 'Or draw it yourself on an empty canvas'}</button>.
        </p>
      </aside>
    </div>
  );
}
