'use client';

/**
 * Outreach settings for one list (2026-10-27): what we sell, what the list pitches, the first message after an
 * accepted request, and the scoring weights. They used to sit in the create form; the wizard now asks only who belongs
 * on the list. Collapsed by default; read-only for anyone but the owner or an admin (the routes enforce it too).
 */
import { useEffect, useState } from 'react';
import ListVoiceFields, { type ListVoice } from './ListVoiceFields';
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, normalizeCriteria, normalizeWeights, weightsTotal } from '@/lib/icp';
import type { IcpCriteria, WeightKey } from '@/lib/icp';
import { Chat, Chevron, Info, Note, Send, Sliders } from '@/components/icons';

interface Full {
  id: string; name: string; product: string | null; description: string | null; objective: string | null;
  criteria: IcpCriteria; first_message_template?: string | null;
  product_id?: string | null; writing_context?: string | null; language?: string | null; can_edit?: boolean;
}

const muted = { color: 'var(--text-muted)' } as const;

function Head({ icon: I, title, tip }: { icon: typeof Chat; title: string; tip?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <I width={16} height={16} style={{ color: 'var(--accent)' }} />{title}
      {tip && <span title={tip} className="inline-flex" style={muted}><Info width={14} height={14} /></span>}
    </div>
  );
}

export default function ListSettings({ icpId, onSaved }: { icpId: string; onSaved?: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [icp, setIcp] = useState<Full | null>(null);
  const [description, setDescription] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [weights, setWeights] = useState<Record<WeightKey, number>>(DEFAULT_WEIGHTS);
  const [voice, setVoice] = useState<ListVoice>({ product_id: '', writing_context: '', language: '' });
  const [startVoice, setStartVoice] = useState<ListVoice>(voice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    setLoadError(false);
    const r = await fetch(`/api/icp/${icpId}`).catch(() => null);
    if (!r || !r.ok) { setLoadError(true); return; }
    const d = await r.json() as Full;
    const crit = normalizeCriteria(d.criteria);
    setIcp({ ...d, criteria: crit });
    setDescription(d.description ?? '');
    setFirstMessage(d.first_message_template ?? '');
    setWeights(crit.weights);
    const v = { product_id: d.product_id ?? '', writing_context: d.writing_context ?? '', language: d.language ?? '' };
    setVoice(v); setStartVoice(v);
  };
  useEffect(() => { if (open && !icp) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const editable = !!icp?.can_edit;
  const total = weightsTotal(weights);
  const sizesOff = (icp?.criteria.company_sizes.length ?? 0) === 0;
  const dirty = !!icp && (
    description !== (icp.description ?? '') || firstMessage !== (icp.first_message_template ?? '')
    || JSON.stringify(weights) !== JSON.stringify(icp.criteria.weights) || JSON.stringify(voice) !== JSON.stringify(startVoice));

  const save = async () => {
    if (!icp || saving) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const listChanged = description !== (icp.description ?? '') || firstMessage !== (icp.first_message_template ?? '')
        || JSON.stringify(weights) !== JSON.stringify(icp.criteria.weights);
      if (listChanged) {
        const body = {
          name: icp.name, product: icp.product, description: description.trim() || null, objective: icp.objective,
          criteria: { ...icp.criteria, weights: normalizeWeights(weights) }, first_message_template: firstMessage.trim() || null,
        };
        const r = await fetch(`/api/icp/${icpId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          const issue = (d.issues as { path?: (string | number)[]; message?: string }[] | undefined)?.[0];
          setError(issue ? `${(issue.path ?? []).join('.')}: ${issue.message}` : (d.error || 'Not saved. Try again.'));
          return;
        }
      }
      if (JSON.stringify(voice) !== JSON.stringify(startVoice)) {
        const v = await fetch(`/api/icp/${icpId}/voice`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(voice) });
        if (!v.ok) { const e = await v.json().catch(() => ({})); setError(`The pitch was not saved: ${e.error || v.status}`); return; }
      }
      await load();
      setSaved(true);
      onSaved?.('Outreach settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Not saved. Try again.');
    } finally { setSaving(false); }
  };

  return (
    <section className="z-panel">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 min-h-12 text-left">
        <Sliders width={16} height={16} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-semibold">Outreach settings</span>
        <span className="text-xs" style={muted}>pitch · first message · scoring</span>
        <Chevron width={16} height={16} className="ml-auto transition-transform duration-150" style={{ ...muted, transform: open ? 'rotate(90deg)' : undefined }} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5 border-t" style={{ borderColor: 'var(--border)' }}>
          {!icp && loadError && (
            <p className="pt-4 text-sm" style={muted}>Could not load the settings. <button type="button" className="underline" onClick={() => void load()}>Try again</button></p>
          )}
          {!icp && !loadError && <div className="pt-4 space-y-2 animate-pulse motion-reduce:animate-none">
            <div className="h-4 w-40 rounded" style={{ background: 'var(--bg-input)' }} /><div className="h-16 rounded-xl" style={{ background: 'var(--bg-input)' }} />
          </div>}
          {icp && (
            <fieldset disabled={!editable} className="space-y-6 pt-4 max-w-2xl">
              <div className="space-y-2">
                <Head icon={Note} title="What we sell, and to whom" tip="Every draft for this list reads it." />
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000}
                  placeholder="e.g. Zeami maps how operations teams work and automates the repeatable parts." className="z-input text-sm resize-y" />
              </div>

              <div className="space-y-2">
                <Head icon={Chat} title="What this list pitches" tip="The product brings its pain, proof, free resources and objection answers into every draft; the hook is the angle for these people." />
                <ListVoiceFields brandKey="zeami" value={voice} onChange={setVoice} inputStyle={{}} />
              </div>

              <div className="space-y-2">
                <Head icon={Send} title="First message after they accept"
                  tip="Each accepted connection request becomes one approval card with this text. Nothing is sent by itself. Empty: you are only told who accepted." />
                <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} rows={3} maxLength={1900}
                  placeholder="Hi {first_name}, thanks for connecting…" className="z-input text-sm resize-y" />
                <p className="text-[11px]" style={muted}>{'{first_name} {full_name} {company}'}</p>
              </div>

              <div className="space-y-2">
                <Head icon={Sliders} title="Scoring" tip="How a person's fit score (0–100) is made up. The list's tuning panel can propose these from what got answers." />
                <div className="space-y-2">
                  {WEIGHT_LABELS.map(({ key, label }) => {
                    const off = key === 'size' && sizesOff;
                    return (
                      <div key={key} className="grid grid-cols-[110px_1fr_48px] items-center gap-3" style={{ opacity: off ? 0.45 : 1 }}
                        title={off ? 'Pick company sizes in the list to use this' : undefined}>
                        <span className="text-xs">{label}</span>
                        <input type="range" min={0} max={100} value={weights[key]} disabled={off} aria-label={label} style={{ accentColor: 'var(--accent)' }}
                          onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })} />
                        <span className="text-xs text-right tabular-nums">{weights[key]}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 text-xs">
                    <span className="tabular-nums" style={{ color: total === 100 ? 'var(--green)' : 'var(--orange)' }}>{total}/100{total !== 100 && ' · rescaled on save'}</span>
                    <button type="button" className="underline ml-auto" style={muted}
                      onClick={() => setWeights({ ...DEFAULT_WEIGHTS, size: sizesOff ? 0 : 10 })}>Reset</button>
                  </div>
                </div>
              </div>
            </fieldset>
          )}
          {icp && !editable && <p className="text-xs" style={muted}>Only the list’s owner or an admin can change these.</p>}
          {error && <div className="text-sm px-3 py-2 rounded-xl" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>}
          {icp && editable && (
            <div className="flex items-center gap-3 justify-end">
              {saved && !dirty && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved</span>}
              <button type="button" onClick={save} disabled={!dirty || saving} className="z-btn">{saving ? 'Saving…' : 'Save settings'}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
