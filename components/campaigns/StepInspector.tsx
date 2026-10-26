'use client';

import FillableText from '@/components/campaigns/FillableText';
import {
  BRANCH_FIELDS, BRANCH_OPS, END_REASONS, EVENTS, HANDOFF_TO, LABELS, MODES, NOTE_MODES, PLACEHOLDERS, VARIANT_IDS, nodeLabel,
  sampleKey, toTemplate, variantsOf, type GraphNode, type Sample, type Variant,
} from '@/lib/campaigns';

/**
 * The right-hand panel of the canvas: everything one step can be told. Changes go straight back to the graph
 * (autosaved by the page). The kernel re-validates on every save and the step shows what is still missing.
 */
interface Rule { field: string; op: string; value?: string | number }

interface Props {
  node: GraphNode; editable: boolean; blockers: string[]; warnings: string[]; sample?: Sample; onTestRun?: () => void;
  /** samples by key (`<node>` or `<node>:<variant>`), for the variants' own sample lines */
  samples?: Record<string, Sample>;
  onChange: (config: Record<string, unknown>) => void; onRemove: () => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  );
}

export default function StepInspector({ node, editable, blockers, warnings, sample, samples, onTestRun, onChange, onRemove }: Props) {
  const c = node.config || {};
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });
  const variants = variantsOf(c);
  const setVariants = (vs: Variant[]) => {
    const next: Record<string, unknown> = { ...c, variants: vs };
    if (!vs.length) { delete next.variants; delete next.winner; }
    else if (typeof next.winner === 'string' && !vs.some((v) => v.id === next.winner)) delete next.winner;
    onChange(next);
  };
  const setVariant = (id: string, p: Partial<Variant>) => setVariants(variants.map((v) => (v.id === id ? { ...v, ...p } : v)));
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
  const num = (k: string, d = 0) => (c[k] == null || c[k] === '' ? d : Number(c[k]));
  const t = node.type;
  const isAction = t === 'linkedin_connect' || t === 'linkedin_message' || t === 'email';
  const modeKey = t === 'linkedin_connect' ? 'note_mode' : 'mode';
  const mode = str(modeKey) || (t === 'linkedin_connect' ? 'none' : 'auto');
  const modes = t === 'linkedin_connect' ? NOTE_MODES : MODES;
  const rules = (Array.isArray(c.rules) ? c.rules : []) as Rule[];
  const setRule = (i: number, patch: Partial<Rule>) => set({ rules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const dis = !editable;

  return (
    <div className="grid gap-4 content-start">
      <div>
        <div className="text-xs font-medium">{LABELS[t]}</div>
        <div className="font-semibold">{nodeLabel(node)}</div>
      </div>
      {blockers.length > 0 && (
        <ul className="text-xs grid gap-1 rounded-lg px-3 py-2" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>
          {blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="text-xs grid gap-1 rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--orange) 10%, transparent)', color: 'var(--orange)' }}>
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {t === 'start' && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Everyone on the campaign’s lists starts here when the campaign goes live (and anyone added to those lists
          later). Connect its exit to the first step.
        </p>
      )}

      {t !== 'start' && (
        <Field label="Name on the canvas" hint="Optional — e.g. “Follow-up 1”.">
          <input className="z-input" disabled={dis} value={str('title')} onChange={(e) => set({ title: e.target.value })} placeholder={nodeLabel({ type: t, config: { ...c, title: '' } })} />
        </Field>
      )}

      {isAction && (
        <>
          <Field label={t === 'linkedin_connect' ? 'Note' : 'How it is written'}>
            <div className="grid gap-1.5">
              {modes.map((m) => (
                <button key={m.key} type="button" disabled={dis} onClick={() => set({ [modeKey]: m.key })}
                  className="text-left rounded-lg px-3 py-2 grid"
                  style={{ border: `1px solid ${mode === m.key ? 'var(--accent)' : 'var(--border)'}`, background: mode === m.key ? 'var(--accent-soft)' : 'transparent' }}>
                  <span className="text-[13px] font-medium">{m.label}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{m.hint}</span>
                </button>
              ))}
            </div>
          </Field>
          {mode === 'guided' && (
            <Field label="Instructions" hint="What to say or avoid at this step. The writer still follows your voice rules.">
              <textarea className="z-input" rows={4} disabled={dis} value={str('instructions')} onChange={(e) => set({ instructions: e.target.value })}
                placeholder="e.g. Mention we met at Fakuma; ask for 20 minutes next week." />
            </Field>
          )}
          {mode === 'fixed' && (
            <>
              {t === 'email' && (
                <Field label="Subject" hint="Needed on the first email; a later email replies in the same thread.">
                  <input className="z-input" disabled={dis} value={str('subject')} onChange={(e) => set({ subject: e.target.value })} />
                </Field>
              )}
              <Field label={t === 'linkedin_connect' ? 'Note text' : 'Text'}
                hint={`Placeholders: ${PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}. A person with no value for one waits at this step instead of getting a gap.`}>
                <textarea className="z-input" rows={t === 'linkedin_connect' ? 4 : 7} disabled={dis} value={str('text')} onChange={(e) => set({ text: e.target.value })} />
                {t === 'linkedin_connect' && (
                  <span className="text-[11px] tabular-nums" style={{ color: str('text').length > 300 ? 'var(--red)' : 'var(--text-muted)' }}>
                    {str('text').length}/300 characters (200 on a free LinkedIn account)
                  </span>
                )}
              </Field>
            </>
          )}
          {mode !== 'fixed' && mode !== 'none' && (
            sample ? (
              <div className="grid gap-1.5 rounded-lg p-2.5" style={{ background: 'var(--bg-input)' }}>
                <span className="text-xs font-medium">Sample message</span>
                {sample.subject && <span className="text-xs"><span style={{ color: 'var(--text-muted)' }}>Subject:</span> <FillableText text={toTemplate(sample.subject, sample.person)} /></span>}
                <p className="text-sm whitespace-pre-wrap"><FillableText text={toTemplate(sample.text, sample.person)} /></p>
                {editable && (
                  <button type="button" className="text-xs underline justify-self-start"
                    onClick={() => onChange({ ...c, [modeKey]: 'fixed', text: toTemplate(sample.text, sample.person),
                      ...(t === 'email' && sample.subject ? { subject: toTemplate(sample.subject, sample.person) } : {}) })}>
                    Edit it and use it as this step’s text
                  </button>
                )}
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Written for {sample.person?.full_name ?? 'the test person'}; the highlighted fields are filled in for each person. With “Write it for me” each person still gets their own draft.</span>
              </div>
            ) : onTestRun ? (
              <button type="button" className="text-xs underline justify-self-start" onClick={onTestRun}>See a draft of this message (Test run)</button>
            ) : null
          )}
          {/* A/B (084): 2–3 variants of this message, split evenly; the Results tab shows each one's reply rate. */}
          <div className="grid gap-2 rounded-lg p-2.5" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">A/B test{variants.length ? ` · ${variants.length} variants` : ''}</span>
              {editable && variants.length < VARIANT_IDS.length && (
                <button type="button" className="text-xs underline" onClick={() => {
                  const used = new Set(variants.map((v) => v.id));
                  const free = VARIANT_IDS.filter((v) => !used.has(v));
                  const add: Variant[] = variants.length ? [{ id: free[0] }] : [{ id: 'a' }, { id: 'b' }];
                  setVariants([...variants, ...add]);
                }}>{variants.length ? '+ another variant' : 'Split into A/B'}</button>
              )}
            </div>
            {variants.length === 0 ? (
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Try two wordings: each person gets one at random, and you see which gets more replies.</span>
            ) : variants.map((v) => {
              const vmode = String(v.mode ?? v.note_mode ?? mode);
              const vsample = samples?.[sampleKey(node.id, v.id)];
              const isWinner = c.winner === v.id;
              return (
                <div key={v.id} className="grid gap-1.5 rounded-lg p-2" style={{ background: isWinner ? 'var(--accent-soft)' : 'var(--bg-input)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold rounded px-1.5" style={{ background: 'var(--bg-card)' }}>{v.id.toUpperCase()}</span>
                    <input className="z-input text-xs flex-1" disabled={dis} value={v.label ?? ''} placeholder="label (optional)"
                      onChange={(e) => setVariant(v.id, { label: e.target.value })} />
                    {isWinner && <span className="text-[10px]" style={{ color: 'var(--accent)' }}>winner</span>}
                    {editable && <button type="button" className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}
                      onClick={() => setVariants(variants.filter((x) => x.id !== v.id))}>remove</button>}
                  </div>
                  <select className="z-input text-xs" disabled={dis} value={vmode}
                    onChange={(e) => setVariant(v.id, { [modeKey]: e.target.value })}>
                    {modes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                  {vmode === 'guided' && (
                    <textarea className="z-input text-xs" rows={2} disabled={dis} value={v.instructions ?? ''} placeholder={`Instructions for ${v.id.toUpperCase()} (else the step's)`}
                      onChange={(e) => setVariant(v.id, { instructions: e.target.value })} />
                  )}
                  {vmode === 'fixed' && (
                    <>
                      {t === 'email' && <input className="z-input text-xs" disabled={dis} value={v.subject ?? ''} placeholder={`Subject for ${v.id.toUpperCase()} (else the step's)`}
                        onChange={(e) => setVariant(v.id, { subject: e.target.value })} />}
                      <textarea className="z-input text-xs" rows={4} disabled={dis} value={v.text ?? ''} placeholder={`Text for ${v.id.toUpperCase()} (else the step's)`}
                        onChange={(e) => setVariant(v.id, { text: e.target.value })} />
                    </>
                  )}
                  {vmode !== 'fixed' && vsample?.text && (
                    <p className="text-[11px] whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}><FillableText text={toTemplate(vsample.text, vsample.person)} /></p>
                  )}
                </div>
              );
            })}
            {variants.length > 0 && (
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {typeof c.winner === 'string' ? `Only ${String(c.winner).toUpperCase()} is sent now. ` : 'Split evenly, the same person always gets the same one. '}
                Pick the winner on the Results tab once the numbers say something.
              </span>
            )}
          </div>
          <p className="text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            {t === 'linkedin_connect' && 'Skipped for anyone already connected or with a request already pending. '}
            {t === 'linkedin_message' && 'A first message once connected; a follow-up when a conversation exists. '}
            {t === 'email' && 'From the sender’s Gmail, inside their daily cap. A later email follows up in the same thread. '}
            Every draft waits on the sender’s card for approval.
          </p>
        </>
      )}

      {t === 'wait' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Days"><input type="number" min={0} max={90} className="z-input" disabled={dis} value={num('days')} onChange={(e) => set({ days: Number(e.target.value) })} /></Field>
          <Field label="Hours"><input type="number" min={0} max={23} className="z-input" disabled={dis} value={num('hours')} onChange={(e) => set({ hours: Number(e.target.value) })} /></Field>
        </div>
      )}

      {t === 'wait_for' && (
        <>
          <Field label="Wait until">
            <select className="z-input" disabled={dis} value={str('event') || 'replied'} onChange={(e) => set({ event: e.target.value })}>
              {Object.entries(EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Give up after (days)" hint="“yes” is followed when it happens; “no / timed out” after this many days.">
            <input type="number" min={1} max={90} className="z-input" disabled={dis} value={num('timeout_days', 7)} onChange={(e) => set({ timeout_days: Number(e.target.value) })} />
          </Field>
        </>
      )}

      {t === 'branch' && (
        <>
          <Field label="Go to “yes” when">
            <select className="z-input" disabled={dis} value={str('match') || 'all'} onChange={(e) => set({ match: e.target.value })}>
              <option value="all">all of these are true</option>
              <option value="any">any of these is true</option>
            </select>
          </Field>
          <div className="grid gap-2">
            {rules.map((r, i) => {
              const f = BRANCH_FIELDS[r.field] ?? BRANCH_FIELDS.has_email;
              const ops = BRANCH_OPS[f.kind];
              return (
                <div key={i} className="grid gap-1.5 rounded-lg p-2" style={{ border: '1px solid var(--border)' }}>
                  <select className="z-input text-sm" disabled={dis} value={r.field} aria-label="Field"
                    onChange={(e) => { const k = BRANCH_FIELDS[e.target.value].kind; setRule(i, { field: e.target.value, op: BRANCH_OPS[k][0].key, value: undefined }); }}>
                    {Object.entries(BRANCH_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <div className="flex gap-1.5">
                    <select className="z-input text-sm flex-1" disabled={dis} value={r.op} aria-label="Condition" onChange={(e) => setRule(i, { op: e.target.value })}>
                      {ops.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    {f.kind !== 'bool' && (
                      <input className="z-input text-sm flex-1" disabled={dis} aria-label="Value" type={f.kind === 'number' ? 'number' : 'text'}
                        value={r.value ?? ''} onChange={(e) => setRule(i, { value: f.kind === 'number' ? Number(e.target.value) : e.target.value })} />
                    )}
                  </div>
                  {editable && rules.length > 1 && (
                    <button type="button" className="text-[11px] underline justify-self-end" style={{ color: 'var(--text-muted)' }}
                      onClick={() => set({ rules: rules.filter((_, j) => j !== i) })}>remove</button>
                  )}
                </div>
              );
            })}
            {editable && (
              <button type="button" className="text-xs underline justify-self-start" onClick={() => set({ rules: [...rules, { field: 'fit_score', op: 'gte', value: 70 }] })}>
                + another condition
              </button>
            )}
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Something we do not know about the person is never a “yes”.</p>
          </div>
        </>
      )}

      {t === 'handoff' && (
        <>
          <Field label="Hand to">
            <select className="z-input" disabled={dis} value={str('to') || 'back_office'} onChange={(e) => set({ to: e.target.value })}>
              {HANDOFF_TO.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
          </Field>
          <Field label="What they should do" hint="Becomes the lead’s next step and the message they get.">
            <textarea className="z-input" rows={3} disabled={dis} value={str('note')} onChange={(e) => set({ note: e.target.value })} placeholder="They replied — take over the conversation." />
          </Field>
        </>
      )}

      {t === 'end' && (
        <Field label="Why it ends">
          <select className="z-input" disabled={dis} value={str('reason') || 'completed'} onChange={(e) => set({ reason: e.target.value })}>
            {END_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </Field>
      )}

      {t !== 'start' && t !== 'handoff' && t !== 'end' && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          A reply at any step stops the campaign for that person and hands them to their back office — unless this is
          a “Wait for a reply” step, which follows its own “yes”.
        </p>
      )}

      {editable && t !== 'start' && (
        <button type="button" onClick={onRemove} className="text-sm justify-self-start underline" style={{ color: 'var(--red)' }}>Remove this step</button>
      )}
    </div>
  );
}
