'use client';

/**
 * New list / edit list as a short wizard (2026-10-27, Amir: "a bunch of forms to fill; no one knows what to fill").
 * One question per step, defaults filled in, a live "who fits" panel on the side. Only WHO belongs on the list is asked
 * here; what the list pitches, the first message and the scoring weights live on the list page (ListSettings) and pass
 * through a save unchanged. Saves through the same routes the old one-page builder used.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import {
  COMPANY_SIZES, DEFAULT_WEIGHTS, EXCLUDE_TITLE_PRESETS, INDUSTRIES, LOCATION_GROUPS, ROLE_GROUPS, SENIORITY_BANDS,
  emptyCriteria, normalizeWeights,
  INVESTOR_CURRENCIES, INVESTOR_EXCLUDES, INVESTOR_EXCLUDE_SECTORS, INVESTOR_INDUSTRIES, INVESTOR_REGIONS,
  INVESTOR_SECTORS, INVESTOR_STAGES, INVESTOR_TITLES, isInvestorList,
} from '@/lib/icp';
import type { FirmBrief } from '@/lib/firms';
import type { IcpCandidate, IcpCriteria, IcpProfile, SeniorityBand } from '@/lib/icp';
import {
  ArrowLeft, ArrowRight, Ban, Briefcase, Building, Check, Coins, Info, MapPin, Pencil, Sparkle, Target, Users,
} from '@/components/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface PreviewMatch {
  contact_id: string; full_name: string; title: string | null; company: string | null;
  icp_score: number; fit_label: string; reasons: string[];
}
interface PreviewResult { considered: number; distribution: Record<string, number>; matches: PreviewMatch[] }

interface Props {
  initial: IcpProfile | null;
  onSaved: (profile: IcpProfile) => void;
  onCancel: () => void;
}

type ListKind = 'customers' | 'investors';
type StepKey = 'kind' | 'who' | 'fund' | 'where' | 'skip' | 'review';

/** The investor brief as the form edits it: numbers as text, so a half-typed value is not lost. */
interface BriefForm {
  stages: string[]; sectors: string[]; exclude_sectors: string[]; geographies: string[];
  round_size: string; currency: string; entity_country: string; min_fund_year: string; pitch: string;
}
function briefForm(b: FirmBrief | null | undefined): BriefForm {
  return {
    stages: b?.stages ?? [], sectors: b?.sectors ?? [], exclude_sectors: b?.exclude_sectors ?? [], geographies: b?.geographies ?? [],
    round_size: b?.round_size ? String(b.round_size) : '', currency: b?.currency || 'EUR', entity_country: b?.entity_country ?? '',
    min_fund_year: b?.min_fund_year ? String(b.min_fund_year) : '', pitch: b?.pitch ?? '',
  };
}
function briefBody(f: BriefForm): FirmBrief {
  const num = (v: string) => { const n = Number(v.replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined; };
  return {
    stages: f.stages, sectors: f.sectors, exclude_sectors: f.exclude_sectors, geographies: f.geographies,
    round_size: num(f.round_size), currency: f.currency || undefined, entity_country: f.entity_country.trim() || undefined,
    min_fund_year: num(f.min_fund_year), pitch: f.pitch.trim() || undefined,
  };
}

const sizeLabel = (k: string) => COMPANY_SIZES.find((s) => s.key === k)?.label ?? k;
const bandLabel = (k: string) => SENIORITY_BANDS.find((b) => b.key === k)?.label ?? k;
const fitColor = (score: number) => (score >= 75 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : score >= 40 ? 'var(--orange)' : 'var(--red)');
const muted = { color: 'var(--text-muted)' } as const;

// What is shown as one-tap chips; everything else in the vocabulary is found by typing.
const POPULAR_ROLES = ['Chief Executive Officer', 'Chief Operating Officer', 'Chief Financial Officer', 'Chief Technology Officer',
  'Managing Director', 'Founder', 'Owner', 'Head of Operations', 'Operations Manager', 'Head of IT', 'Head of Finance', 'Head of Sales'];
const POPULAR_INDUSTRIES = ['Manufacturing', 'Software Development', 'Logistics and Supply Chain', 'Automotive', 'Financial Services',
  'Retail', 'Business Consulting and Services', 'Healthcare'];
const POPULAR_LOCATIONS = ['DACH', 'Germany', 'Austria', 'Switzerland', 'Europe', 'United Kingdom', 'North America', 'United States'];
const ALL_ROLES = ROLE_GROUPS.flatMap((g) => g.titles);
const ALL_LOCATIONS = LOCATION_GROUPS.flatMap((g) => g.items);
const CUSTOMER_SKIP_DEFAULTS = ['student', 'intern', 'recruiter'];

const DIST: { key: string; label: string; color: string }[] = [
  { key: 'strong_fit', label: 'Strong', color: 'var(--green)' },
  { key: 'proceed_with_caution', label: 'Good', color: 'var(--yellow)' },
  { key: 'weak_fit', label: 'Weak', color: 'var(--orange)' },
  { key: 'do_not_pursue', label: 'No', color: 'var(--red)' },
];

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const short = (xs: string[], n = 3, label: (s: string) => string = (s) => s) =>
  xs.length ? xs.slice(0, n).map(label).join(', ') + (xs.length > n ? ` +${xs.length - n}` : '') : '';

/** An ⓘ that shows a longer explanation on hover or tap, so the step itself stays one line. */
function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" aria-label="More about this" title={text} onClick={() => setOpen((o) => !o)}
        className="w-6 h-6 inline-flex items-center justify-center rounded-full" style={muted}>
        <Info width={15} height={15} />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-0 top-7 z-20 w-64 rounded-xl p-3 text-xs leading-relaxed shadow-lg"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {text}
        </span>
      )}
    </span>
  );
}

/** One group of choices: common ones as chips, anything else found by typing (or added as typed). */
function Picker({ label, icon: I, popular, all = [], selected, onChange, labelOf, tone = 'include', allowCustom = true, placeholder, tip }: {
  label: string; icon?: Icon; popular: string[]; all?: string[]; selected: string[]; onChange: (v: string[]) => void;
  labelOf?: (v: string) => string; tone?: 'include' | 'exclude'; allowCustom?: boolean; placeholder?: string; tip?: string;
}) {
  const [draft, setDraft] = useState('');
  const has = (v: string) => selected.some((s) => eq(s, v));
  const toggle = (v: string) => onChange(has(v) ? selected.filter((s) => !eq(s, v)) : [...selected, v]);
  const add = (v: string) => { const t = v.trim(); if (t && !has(t)) onChange([...selected, t]); setDraft(''); };
  const accent = tone === 'exclude' ? 'var(--red)' : 'var(--accent)';
  const extra = selected.filter((s) => !popular.some((p) => eq(p, s)));
  const q = draft.trim().toLowerCase();
  const matches = q ? all.filter((v) => v.toLowerCase().includes(q) && !has(v)).slice(0, 6) : [];

  const chip = (v: string) => {
    const on = has(v);
    return (
      <button key={v} type="button" onClick={() => toggle(v)} aria-pressed={on}
        className="min-h-9 px-3 rounded-full text-sm inline-flex items-center gap-1.5 border transition-colors duration-150"
        style={{
          background: on ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'var(--bg-card)',
          borderColor: on ? accent : 'var(--border)', color: on ? accent : 'var(--text)',
        }}>
        {on && (tone === 'exclude' ? <Ban width={13} height={13} /> : <Check width={13} height={13} />)}
        {labelOf ? labelOf(v) : v}
      </button>
    );
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        {I && <I width={16} height={16} style={muted} />}
        {label}
        {tip && <Tip text={tip} />}
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="ml-auto text-xs font-normal underline" style={muted}>clear</button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {popular.map(chip)}
        {extra.map(chip)}
      </div>
      {allowCustom && (
        <div className="relative max-w-md">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder ?? '+ add another'}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(matches[0] && matches[0].toLowerCase() === q ? matches[0] : draft); } }}
            className="z-input text-sm" aria-label={`Add to ${label}`} />
          {matches.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl overflow-hidden shadow-lg"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              {matches.map((m) => (
                <button key={m} type="button" onClick={() => add(m)} className="block w-full text-left px-3 py-2 text-sm hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)' }}>{labelOf ? labelOf(m) : m}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function IcpWizard({ initial, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [criteria, setCriteria] = useState<IcpCriteria>(() => {
    if (initial?.criteria) return initial.criteria;
    return { ...emptyCriteria(), exclude_titles: CUSTOMER_SKIP_DEFAULTS };
  });
  const startBrief = useMemo(() => briefForm(initial?.firm_brief as FirmBrief | undefined), [initial]);
  const [kind, setKind] = useState<ListKind>(isInvestorList(initial) ? 'investors' : 'customers');
  const [brief, setBrief] = useState<BriefForm>(startBrief);
  const investors = kind === 'investors';
  const setB = <K extends keyof BriefForm>(k: K, v: BriefForm[K]) => setBrief((b) => ({ ...b, [k]: v }));
  const set = <K extends keyof IcpCriteria>(k: K, v: IcpCriteria[K]) => setCriteria((c) => ({ ...c, [k]: v }));

  const steps: { key: StepKey; label: string; icon: Icon }[] = [
    { key: 'kind', label: 'Purpose', icon: Target },
    { key: 'who', label: 'Who', icon: Users },
    ...(investors ? [{ key: 'fund' as StepKey, label: 'Fund focus', icon: Coins }] : []),
    { key: 'where', label: investors ? 'Funds' : 'Companies', icon: investors ? Briefcase : Building },
    { key: 'skip', label: 'Skip', icon: Ban },
    { key: 'review', label: 'Save', icon: Check },
  ];
  const [step, setStep] = useState<StepKey>(initial ? 'review' : 'kind');
  const [visited, setVisited] = useState<Set<StepKey>>(() => new Set(initial ? steps.map((s) => s.key) : ['kind']));
  const idx = Math.max(0, steps.findIndex((s) => s.key === step));
  const go = (k: StepKey) => { setStep(k); setVisited((v) => new Set(v).add(k)); };
  const next = () => go(steps[Math.min(idx + 1, steps.length - 1)].key);
  const back = () => go(steps[Math.max(idx - 1, 0)].key);
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [step]);

  // Switching to Investors fills the empty parts with the usual VC answer; nothing chosen is overwritten.
  const chooseKind = (k: ListKind) => {
    setKind(k);
    setCriteria((c) => {
      if (k === 'investors') {
        const skip = c.exclude_titles.length && !c.exclude_titles.every((t) => CUSTOMER_SKIP_DEFAULTS.includes(t)) ? c.exclude_titles : INVESTOR_EXCLUDES;
        return { ...c, titles: c.titles.length ? c.titles : INVESTOR_TITLES, industries: c.industries.length ? c.industries : INVESTOR_INDUSTRIES, exclude_titles: skip };
      }
      return c;
    });
  };

  // Picking a company size gives it weight the first time; clearing sizes takes it back. The total stays 100.
  const setSizes = (sizes: string[]) => setCriteria((c) => {
    const w = { ...c.weights };
    if (sizes.length && w.size === 0) w.size = 10;
    if (!sizes.length) w.size = 0;
    return { ...c, company_sizes: sizes, weights: normalizeWeights(w) };
  });

  // ── Website draft (customers): the optimizer's recommended pick fills every later step. ──
  const [website, setWebsite] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [aiDrafted, setAiDrafted] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftFromWebsite = async () => {
    if (!website.trim()) return;
    setDrafting(true); setDraftError(null);
    try {
      const res = await fetch('/api/icp/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website, product: initial?.product ?? 'zeami', description: initial?.description ?? '', criteria: {
          titles: criteria.titles, seniority: criteria.seniority, industries: criteria.industries,
          locations: criteria.locations, company_sizes: criteria.company_sizes,
        } }),
      });
      const data = await res.json();
      if (!res.ok) { setDraftError(data.error || 'Could not draft from that website.'); return; }
      const list: IcpCandidate[] = data.candidates || [];
      const cand = list[typeof data.recommended_index === 'number' ? data.recommended_index : 0] ?? list[0];
      if (!cand) { setDraftError('No suggestion came back. Fill the steps by hand.'); return; }
      const s = cand.suggestion;
      if (!name.trim() && s.name) setName(s.name);
      setCriteria({
        titles: s.criteria.titles ?? [], seniority: (s.criteria.seniority ?? []) as SeniorityBand[],
        industries: s.criteria.industries ?? [], locations: s.criteria.locations ?? [], company_sizes: s.criteria.company_sizes ?? [],
        exclude_titles: s.criteria.exclude_titles?.length ? s.criteria.exclude_titles : CUSTOMER_SKIP_DEFAULTS,
        exclude_companies: s.criteria.exclude_companies ?? [],
        weights: normalizeWeights({ ...DEFAULT_WEIGHTS, ...(s.criteria.weights ?? {}) }),
      });
      setAiDrafted(true);
      go('who');
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Could not draft from that website.');
    } finally { setDrafting(false); }
  };

  // ── Live preview: re-scores your contacts a moment after the choices change. Creates nothing. ──
  const hasCriteria = criteria.titles.length > 0 || criteria.seniority.length > 0 || criteria.industries.length > 0;
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const critKey = JSON.stringify(criteria);
  useEffect(() => {
    if (!hasCriteria) { setPreview(null); return; }
    let off = false;
    const t = setTimeout(async () => {
      setPreviewing(true); setPreviewError(false);
      try {
        const res = await fetch('/api/icp/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criteria, limit: 5 }) });
        const data = await res.json();
        if (!off) { if (res.ok) setPreview(data); else setPreviewError(true); }
      } catch { if (!off) setPreviewError(true); } finally { if (!off) setPreviewing(false); }
    }, 1200);
    return () => { off = true; clearTimeout(t); };
  }, [critKey, hasCriteria]); // eslint-disable-line react-hooks/exhaustive-deps
  const fits = preview ? (preview.distribution.strong_fit || 0) + (preview.distribution.proceed_with_caution || 0) : 0;

  // ── Save ──
  const suggestedName = useMemo(() => {
    if (investors) return ['Investors', brief.stages[0], brief.geographies[0]].filter(Boolean).join(' · ');
    const who = criteria.titles[0] ?? (criteria.seniority[0] ? bandLabel(criteria.seniority[0]) : '');
    return [who, criteria.industries[0], criteria.locations[0]].filter(Boolean).join(' · ');
  }, [investors, brief, criteria]);
  const finalName = name.trim() || suggestedName;
  // A hand-made list is never searched and an investor list is driven by its funds, so neither needs roles to save.
  const fb = briefBody(brief);
  const needsNoCriteria = initial?.objective === 'list' || (investors && !!(fb.stages?.length || fb.sectors?.length || fb.geographies?.length));
  const canSave = finalName.length > 0 && (hasCriteria || needsNoCriteria);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true); setError(null);
    try {
      // Outreach settings are edited on the list page; a save carries them through unchanged.
      const body = {
        name: finalName, product: initial?.product ?? 'zeami', description: initial?.description ?? null,
        objective: initial?.objective ?? null, criteria,
        first_message_template: (initial as { first_message_template?: string | null } | null)?.first_message_template ?? null,
      };
      const res = await fetch(initial ? `/api/icp/${initial.id}` : '/api/icp', {
        method: initial ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const issue = (data.issues as { path?: (string | number)[]; message?: string }[] | undefined)?.[0];
        setError(issue ? `${data.error}: ${(issue.path ?? []).join('.') || 'body'} — ${issue.message}` : (data.error || 'Not saved. Try again.'));
        return;
      }
      const listId = (data as { id?: string }).id ?? (data as { profile?: { id?: string } }).profile?.id ?? initial?.id;
      // An investor list keeps its brief; switching a list back to Customers leaves an existing brief alone.
      if (listId && investors && JSON.stringify(brief) !== JSON.stringify(startBrief)) {
        const r = await fetch(`/api/icp/${listId}/firms/brief`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: briefBody(brief) }) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok || out.error) { setError(`List saved, but the fund focus was not: ${out.error || r.status}`); return; }
      }
      onSaved(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Not saved. Try again.');
    } finally { setSaving(false); }
  };

  const roleOptions = investors ? [...INVESTOR_TITLES, 'Venture Partner', 'Business Angel'] : POPULAR_ROLES;
  const stepMeta: Record<StepKey, { q: string; sub: string; tip?: string }> = {
    kind: { q: 'What is this list for?', sub: 'Pick one. You can change it later.' },
    who: { q: investors ? 'Who at the fund?' : 'Who should we reach?', sub: 'Pick a few roles, or a seniority.',
      tip: 'Titles match on whole words, so “VP Engineering” also finds “VP of Engineering”. Similar titles are not guessed: add the variants you care about. Seniority catches people whose exact title is not listed.' },
    fund: { q: 'What should the fund invest in?', sub: 'Each fund is judged against this.',
      tip: 'Every researched fund gets Go, Check (needs a look) or Out, with the reason. A minimum cheque above our round is Out; a last fund older than the year you set is Check. Empty means “any”.' },
    where: { q: investors ? 'Which funds, and where?' : 'Which companies, and where?', sub: 'All optional. Empty means any.',
      tip: 'Location is the person’s own location, not the company’s HQ. Regions and countries both work.' },
    skip: { q: 'Anyone to skip?', sub: 'Optional. A match here is never contacted.',
      tip: 'Hard rules: anyone whose title contains one of these words, or who works at one of these companies, scores 0 whatever else fits.' },
    review: { q: initial ? 'Check and save' : 'Check and create', sub: 'Tap a line to change it.' },
  };
  const meta = stepMeta[step];
  const StepIcon = steps[idx].icon;

  const summary: { key: StepKey; icon: Icon; label: string; text: string }[] = [
    { key: 'kind', icon: investors ? Coins : Building, label: 'For', text: investors ? 'Investors' : 'Customers' },
    { key: 'who', icon: Users, label: 'People', text: [short(criteria.titles), short(criteria.seniority, 3, bandLabel)].filter(Boolean).join(' · ') || 'Anyone' },
    ...(investors ? [{ key: 'fund' as StepKey, icon: Coins, label: 'Invests in', text: [short(brief.stages), short(brief.sectors), short(brief.geographies)].filter(Boolean).join(' · ') || 'Not set yet' }] : []),
    { key: 'where', icon: MapPin, label: 'Where', text: [short(criteria.industries, 2), short(criteria.locations), short(criteria.company_sizes, 3, sizeLabel)].filter(Boolean).join(' · ') || 'Anywhere' },
    { key: 'skip', icon: Ban, label: 'Skip', text: [short(criteria.exclude_titles), short(criteria.exclude_companies)].filter(Boolean).join(' · ') || 'Nobody' },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 p-4 md:p-6 max-w-6xl" ref={topRef}>
      <div className="min-w-0 space-y-5">
        {/* Step strip */}
        <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Steps">
          {steps.map((s, i) => {
            const S = s.icon;
            const current = s.key === step;
            const done = visited.has(s.key) && !current && i < idx;
            const reachable = visited.has(s.key) || i <= idx;
            return (
              <li key={s.key} className="shrink-0">
                <button type="button" disabled={!reachable} onClick={() => go(s.key)} aria-current={current ? 'step' : undefined}
                  className="h-9 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-colors duration-150 disabled:opacity-40"
                  style={current
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: done ? 'var(--accent-soft)' : 'transparent', color: done ? 'var(--accent)' : 'var(--text-muted)', border: done ? '1px solid transparent' : '1px solid var(--border)' }}>
                  {done ? <Check width={14} height={14} /> : <S width={14} height={14} />}
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>

        <section className="z-card p-5 md:p-7 space-y-6">
          <header className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <StepIcon width={20} height={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold leading-tight flex items-center gap-1">{meta.q}{meta.tip && <Tip text={meta.tip} />}</h2>
              <p className="text-sm mt-0.5" style={muted}>{meta.sub}</p>
            </div>
          </header>

          {aiDrafted && step !== 'kind' && step !== 'review' && (
            <div className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Sparkle width={13} height={13} /> Drafted from your website — check it
            </div>
          )}

          {step === 'kind' && (
            <div className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-3" role="radiogroup">
                {([['customers', 'Customers', 'People at companies who could buy', Building], ['investors', 'Investors', 'People at funds for a raise', Coins]] as const).map(([k, label, sub, I]) => {
                  const on = kind === k;
                  return (
                    <button key={k} type="button" role="radio" aria-checked={on} onClick={() => chooseKind(k)}
                      className="text-left rounded-2xl p-4 flex items-start gap-3 transition-colors duration-150"
                      style={{ border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'color-mix(in srgb, var(--accent) 6%, var(--bg-card))' : 'var(--bg-card)' }}>
                      <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: on ? 'var(--accent)' : 'var(--accent-soft)', color: on ? 'var(--accent-fg)' : 'var(--accent)' }}>
                        <I width={22} height={22} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{label}</span>
                        <span className="block text-sm" style={muted}>{sub}</span>
                      </span>
                      {on && <Check width={18} height={18} className="ml-auto shrink-0" style={{ color: 'var(--accent)' }} />}
                    </button>
                  );
                })}
              </div>
              {!investors && (
                <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-input)' }}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkle width={16} height={16} style={{ color: 'var(--accent)' }} /> Let AI draft it
                    <span className="font-normal" style={muted}>· optional</span>
                    <Tip text="Reads the website and fills every step with a suggested profile. You check each step before anything is saved." />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourcompany.com" className="z-input text-sm flex-1"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !drafting) void draftFromWebsite(); }} aria-label="Website" />
                    <button type="button" onClick={draftFromWebsite} disabled={drafting || !website.trim()} className="z-btn">
                      <Sparkle width={15} height={15} />{drafting ? 'Drafting…' : 'Draft it'}
                    </button>
                  </div>
                  {drafting && <p className="text-xs" style={muted}>Reading the site, about 15 seconds.</p>}
                  {draftError && <p className="text-xs" role="alert" style={{ color: 'var(--red)' }}>{draftError}</p>}
                </div>
              )}
            </div>
          )}

          {step === 'who' && (
            <div className="space-y-6">
              <Picker label="Roles" icon={Briefcase} popular={roleOptions} all={ALL_ROLES} selected={criteria.titles}
                onChange={(v) => set('titles', v)} placeholder="+ another role, e.g. Plant Manager" />
              <Picker label="Seniority" icon={Users} popular={SENIORITY_BANDS.map((b) => b.key)} selected={criteria.seniority}
                onChange={(v) => set('seniority', v as SeniorityBand[])} labelOf={bandLabel} allowCustom={false} />
            </div>
          )}

          {step === 'fund' && (
            <div className="space-y-6">
              <Picker label="Rounds" icon={Coins} popular={INVESTOR_STAGES} selected={brief.stages} onChange={(v) => setB('stages', v)} placeholder="+ another round" />
              <Picker label="Focus" icon={Target} popular={INVESTOR_SECTORS} selected={brief.sectors} onChange={(v) => setB('sectors', v)} placeholder="+ another focus, e.g. vertical SaaS" />
              <Picker label="Out if they only do" icon={Ban} tone="exclude" popular={INVESTOR_EXCLUDE_SECTORS} selected={brief.exclude_sectors}
                onChange={(v) => setB('exclude_sectors', v)} placeholder="+ another sector" />
              <Picker label="Regions" icon={MapPin} popular={INVESTOR_REGIONS} selected={brief.geographies} onChange={(v) => setB('geographies', v)}
                placeholder="+ a region or country" tip="The fund must invest in at least one of these. Global funds always count." />
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_96px_1fr_1fr] gap-3">
                <label className="grid gap-1 text-xs font-medium">Round size
                  <input value={brief.round_size} onChange={(e) => setB('round_size', e.target.value)} inputMode="numeric" placeholder="1500000" className="z-input text-sm tabular-nums" /></label>
                <label className="grid gap-1 text-xs font-medium">Currency
                  <select value={brief.currency} onChange={(e) => setB('currency', e.target.value)} className="z-input text-sm">
                    {INVESTOR_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></label>
                <label className="grid gap-1 text-xs font-medium">We are based in
                  <input value={brief.entity_country} onChange={(e) => setB('entity_country', e.target.value)} placeholder="Germany" className="z-input text-sm" /></label>
                <label className="grid gap-1 text-xs font-medium">Last fund from
                  <input value={brief.min_fund_year} onChange={(e) => setB('min_fund_year', e.target.value)} inputMode="numeric" placeholder={String(new Date().getFullYear() - 4)} className="z-input text-sm tabular-nums" /></label>
              </div>
              <label className="grid gap-1 text-xs font-medium">What we raise for, in one sentence
                <textarea value={brief.pitch} onChange={(e) => setB('pitch', e.target.value)} rows={2} maxLength={600}
                  placeholder="Zeami: AI software that maps how teams work and automates the repeatable parts." className="z-input text-sm resize-y" /></label>
            </div>
          )}

          {step === 'where' && (
            <div className="space-y-6">
              <Picker label="Industries" icon={Building} popular={investors ? [...INVESTOR_INDUSTRIES, 'Financial Services'] : POPULAR_INDUSTRIES}
                all={INDUSTRIES} selected={criteria.industries} onChange={(v) => set('industries', v)} placeholder="+ another industry" />
              <Picker label="Locations" icon={MapPin} popular={POPULAR_LOCATIONS} all={ALL_LOCATIONS} selected={criteria.locations}
                onChange={(v) => set('locations', v)} placeholder="+ a country or city" />
              {!investors && (
                <Picker label="Company size" icon={Users} popular={COMPANY_SIZES.map((s) => s.key)} selected={criteria.company_sizes}
                  onChange={setSizes} labelOf={sizeLabel} allowCustom={false} />
              )}
            </div>
          )}

          {step === 'skip' && (
            <div className="space-y-6">
              <Picker label="Titles containing" icon={Ban} tone="exclude" popular={investors ? INVESTOR_EXCLUDES : EXCLUDE_TITLE_PRESETS}
                selected={criteria.exclude_titles} onChange={(v) => set('exclude_titles', v.map((s) => s.toLowerCase()))} placeholder="+ a word, e.g. advisor" />
              <Picker label={investors ? 'Funds to avoid' : 'Companies to avoid'} icon={Building} tone="exclude" popular={[]}
                selected={criteria.exclude_companies} onChange={(v) => set('exclude_companies', v)}
                placeholder={investors ? '+ a fund, e.g. one that already passed' : '+ a company, e.g. a competitor'} />
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-5">
              <label className="grid gap-1.5 text-sm font-medium">List name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || 'e.g. Ops leaders · DACH'}
                  onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} className="z-input text-base" />
                {!name.trim() && suggestedName && <span className="text-xs font-normal" style={muted}>Empty uses “{suggestedName}”.</span>}
              </label>
              <ul className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                {summary.map((s, i) => {
                  const I = s.icon;
                  return (
                    <li key={s.key} style={i ? { borderTop: '1px solid var(--border)' } : undefined}>
                      <button type="button" onClick={() => go(s.key)} className="w-full text-left px-4 py-3 flex items-center gap-3 min-h-11 hover:opacity-90">
                        <I width={18} height={18} style={{ color: 'var(--accent)' }} className="shrink-0" />
                        <span className="w-20 shrink-0 text-xs" style={muted}>{s.label}</span>
                        <span className="text-sm flex-1 min-w-0 truncate">{s.text}</span>
                        <Pencil width={15} height={15} style={muted} className="shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {investors && !fb.stages?.length && !fb.sectors?.length && !fb.geographies?.length && (
                <p className="text-xs" style={{ color: 'var(--orange)' }}>Add rounds, focus or regions: funds are only researched once the list says what it looks for.</p>
              )}
              <p className="text-xs flex items-center gap-1.5" style={muted}>
                <Info width={14} height={14} /> What you pitch, the first message and scoring are on the list page.
              </p>
            </div>
          )}

          {error && (
            <div className="text-sm px-3 py-2 rounded-xl" role="alert" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>{error}</div>
          )}

          <footer className="flex items-center gap-2 pt-1">
            {idx > 0
              ? <button type="button" onClick={back} className="min-h-11 px-3 rounded-full text-sm inline-flex items-center gap-1.5" style={muted}><ArrowLeft width={16} height={16} />Back</button>
              : <button type="button" onClick={onCancel} className="min-h-11 px-3 rounded-full text-sm" style={muted}>Cancel</button>}
            <div className="flex-1" />
            {step === 'skip' && <button type="button" onClick={next} className="min-h-11 px-3 text-sm underline" style={muted}>Skip</button>}
            {step === 'review'
              ? <button type="button" onClick={save} disabled={!canSave || saving} className="z-btn">
                  <Check width={16} height={16} />{saving ? 'Saving…' : initial ? 'Save changes' : 'Create list'}
                </button>
              : <button type="button" onClick={next} className="z-btn">Next<ArrowRight width={16} height={16} /></button>}
          </footer>
          {step === 'review' && !canSave && <p className="text-xs -mt-3 text-right" style={muted}>Pick at least one role, seniority or industry.</p>}
        </section>
      </div>

      {/* Who fits so far */}
      <aside className="xl:sticky xl:top-4 self-start">
        <div className="z-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Target width={16} height={16} style={{ color: 'var(--accent)' }} />Who fits</div>
          {!hasCriteria && <p className="text-sm" style={muted}>Pick a role or an industry to see who fits.</p>}
          {hasCriteria && previewing && !preview && (
            <div className="space-y-2 animate-pulse motion-reduce:animate-none">
              <div className="h-9 w-20 rounded-lg" style={{ background: 'var(--bg-input)' }} />
              <div className="h-2 rounded-full" style={{ background: 'var(--bg-input)' }} />
              <div className="h-10 rounded-lg" style={{ background: 'var(--bg-input)' }} />
            </div>
          )}
          {hasCriteria && previewError && !preview && <p className="text-sm" style={muted}>Could not score right now. It retries when you change a choice.</p>}
          {hasCriteria && preview && (
            <div className={`space-y-3 transition-opacity duration-150 ${previewing ? 'opacity-60' : ''}`}>
              <div>
                <div className="text-3xl font-semibold tabular-nums leading-none">{fits}</div>
                <div className="text-xs mt-1" style={muted}>strong or good fits, of {preview.considered} contacts</div>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                {DIST.map((d) => {
                  const n = preview.distribution[d.key] || 0;
                  return n > 0 ? <div key={d.key} style={{ width: `${(n / Math.max(preview.considered, 1)) * 100}%`, background: d.color }} title={`${d.label}: ${n}`} /> : null;
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                {DIST.slice(0, 3).map((d) => (
                  <span key={d.key} className="inline-flex items-center gap-1" style={muted}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.color }} />{d.label} {preview.distribution[d.key] || 0}
                  </span>
                ))}
              </div>
              {fits === 0 && preview.matches.length > 0 && <div className="text-xs font-medium" style={muted}>Closest so far</div>}
              {preview.matches.length === 0
                ? <p className="text-xs" style={muted}>Nobody yet. Try fewer roles or an empty location.</p>
                : (
                  <ul className="space-y-2">
                    {preview.matches.slice(0, 3).map((m) => (
                      <li key={m.contact_id} className="flex items-center gap-2 text-sm" title={m.reasons.join(' · ')}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.full_name}</span>
                          <span className="block truncate text-xs" style={muted}>{[m.title, m.company].filter(Boolean).join(' · ') || '—'}</span>
                        </span>
                        <span className="shrink-0 px-1.5 py-0.5 rounded-md text-xs font-semibold tabular-nums"
                          style={{ background: `color-mix(in srgb, ${fitColor(m.icp_score)} 14%, transparent)`, color: fitColor(m.icp_score) }}>{m.icp_score}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
          <p className="text-[11px] flex items-center gap-1" style={muted}>From the contacts you already have. Nothing is created.</p>
        </div>
      </aside>
    </div>
  );
}
