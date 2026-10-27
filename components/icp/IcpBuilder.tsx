'use client';

import { useMemo, useState } from 'react';
import ChipSelect from './ChipSelect';
import ListVoiceFields, { type ListVoice } from './ListVoiceFields';
import {
  COMPANY_SIZES, DEFAULT_WEIGHTS, EXCLUDE_TITLE_PRESETS, INDUSTRIES, LOCATION_GROUPS, PRODUCTS,
  ROLE_GROUPS, SENIORITY_BANDS, WEIGHT_LABELS, buildSalesNavFilters, emptyCriteria,
  normalizeWeights, weightsTotal, OBJECTIVES,
  INVESTOR_CURRENCIES, INVESTOR_EXCLUDES, INVESTOR_EXCLUDE_SECTORS, INVESTOR_INDUSTRIES, INVESTOR_REGIONS,
  INVESTOR_SECTORS, INVESTOR_STAGES, INVESTOR_TITLES, isInvestorList,
} from '@/lib/icp';
import type { FirmBrief } from '@/lib/firms';
import type { IcpCandidate, IcpCriteria, IcpProfile, ObjectiveKey, SeniorityBand, WeightKey } from '@/lib/icp';

interface PreviewMatch {
  contact_id: string; full_name: string; title: string | null; company: string | null;
  location: string | null; industry: string | null; linkedin_url: string | null;
  icp_score: number; fit_label: string; reasons: string[];
}
interface PreviewResult {
  considered: number;
  distribution: Record<string, number>;
  matches: PreviewMatch[];
  note?: string;
}

interface Props {
  initial: IcpProfile | null;
  onSaved: (profile: IcpProfile) => void;
  onCancel: () => void;
}

const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' } as const;

type ListKind = 'customers' | 'investors';
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
const briefHasContent = (f: BriefForm) => Object.values(briefBody(f)).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== 'EUR'));
const sizeLabel = (k: string) => COMPANY_SIZES.find((s) => s.key === k)?.label ?? k;
const bandLabel = (k: string) => SENIORITY_BANDS.find((b) => b.key === k)?.label ?? k;

function fitColor(score: number) {
  return score >= 75 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : score >= 40 ? 'var(--orange)' : 'var(--red)';
}

function Section({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{n}</span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {sub && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * The ICP builder — Gojiberry's four onboarding cards folded into one form:
 * who (roles/seniority) → which companies (industry/location/size) → who to
 * exclude → how to score, with a live "Sales Navigator ask" and a dry-run
 * preview against existing contacts before anything is saved.
 */
export default function IcpBuilder({ initial, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [product, setProduct] = useState<string>(initial?.product ?? 'zeami');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [firstMessage, setFirstMessage] = useState<string>(((initial as { first_message_template?: string | null } | undefined)?.first_message_template) ?? '');
  // Brand & Voice (079): what this list pitches. Saved after the list itself (it needs the list's id).
  const initVoice = initial as { product_id?: string | null; writing_context?: string | null; language?: string | null } | undefined;
  const startVoice: ListVoice = { product_id: initVoice?.product_id ?? '', writing_context: initVoice?.writing_context ?? '', language: initVoice?.language ?? '' };
  const [listVoice, setListVoice] = useState<ListVoice>(startVoice);
  const [criteria, setCriteria] = useState<IcpCriteria>(initial?.criteria ?? emptyCriteria());
  // Investor list (075): what every fund on it is judged against. Saved after the list (it needs the list's id).
  const startBrief = briefForm(initial?.firm_brief as FirmBrief | undefined);
  const [kind, setKind] = useState<ListKind>(isInvestorList(initial) ? 'investors' : 'customers');
  const [brief, setBrief] = useState<BriefForm>(startBrief);
  const investors = kind === 'investors';
  const setB = <K extends keyof BriefForm>(k: K, v: BriefForm[K]) => setBrief((b) => ({ ...b, [k]: v }));

  // Switching to Investors fills the empty parts with the usual VC answer; nothing typed is overwritten.
  const chooseKind = (k: ListKind) => {
    setKind(k);
    if (k !== 'investors') return;
    setCriteria((c) => ({
      ...c,
      titles: c.titles.length ? c.titles : INVESTOR_TITLES,
      industries: c.industries.length ? c.industries : INVESTOR_INDUSTRIES,
      exclude_titles: c.exclude_titles.length ? c.exclude_titles : INVESTOR_EXCLUDES,
    }));
    setCandidates([]);
  };

  const [website, setWebsite] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [aiTouched, setAiTouched] = useState(false);
  const [objective, setObjective] = useState<ObjectiveKey | ''>((initial?.objective as ObjectiveKey) ?? '');
  const [candidates, setCandidates] = useState<IcpCandidate[]>([]);
  const [recommendedIdx, setRecommendedIdx] = useState(0);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [openReasons, setOpenReasons] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof IcpCriteria>(k: K, v: IcpCriteria[K]) => setCriteria((c) => ({ ...c, [k]: v }));

  // Picking a company size for the first time gives it weight; clearing sizes
  // takes it back. Either way the total stays 100.
  const setSizes = (sizes: string[]) => setCriteria((c) => {
    const w = { ...c.weights };
    if (sizes.length && w.size === 0) w.size = 10;
    if (!sizes.length) w.size = 0;
    return { ...c, company_sizes: sizes, weights: normalizeWeights(w) };
  });
  const setWeight = (k: WeightKey, v: number) => set('weights', { ...criteria.weights, [k]: Math.max(0, Math.min(100, Math.round(v))) });

  const total = weightsTotal(criteria.weights);
  const salesNav = useMemo(() => buildSalesNavFilters(criteria), [criteria]);
  const canSave = name.trim().length > 0 && (criteria.titles.length > 0 || criteria.seniority.length > 0 || criteria.industries.length > 0);
  // Section numbers move by one when the investor brief is shown.
  const sec = (n: number) => (investors && n >= 3 ? n + 1 : n);

  // Suggest scored ICP candidates from whatever the user has (website /
  // description / current chips) tuned to the chosen objective. Nothing saves.
  const suggest = async () => {
    setSuggesting(true); setError(null); setSuggestNote(null);
    try {
      const partial = {
        titles: criteria.titles, seniority: criteria.seniority, industries: criteria.industries,
        locations: criteria.locations, company_sizes: criteria.company_sizes,
      };
      const res = await fetch('/api/icp/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website, product, description, objective: objective || undefined, criteria: partial }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Suggestion failed'); return; }
      setCandidates(data.candidates || []);
      setRecommendedIdx(typeof data.recommended_index === 'number' ? data.recommended_index : 0);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suggestion failed');
    } finally { setSuggesting(false); }
  };

  // Apply a chosen candidate into the form (like the old website merge, but a
  // full replace since the candidate is a complete profile).
  const useCandidate = (cand: IcpCandidate) => {
    const s2 = cand.suggestion;
    if (!name.trim() && s2.name) setName(s2.name);
    if (s2.product) setProduct(s2.product);
    setCriteria({
      titles: s2.criteria.titles ?? [],
      seniority: (s2.criteria.seniority ?? []) as SeniorityBand[],
      industries: s2.criteria.industries ?? [],
      locations: s2.criteria.locations ?? [],
      company_sizes: s2.criteria.company_sizes ?? [],
      exclude_titles: s2.criteria.exclude_titles ?? [],
      exclude_companies: s2.criteria.exclude_companies ?? [],
      weights: normalizeWeights({ ...DEFAULT_WEIGHTS, ...(s2.criteria.weights ?? {}) }),
    });
    setAiTouched(true);
    setCandidates([]);
    setSuggestNote(cand.rationale || null);
  };

  const runPreview = async () => {
    setPreviewing(true); setError(null);
    try {
      const res = await fetch('/api/icp/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria, limit: 10 }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Preview failed'); setPreview(null); return; }
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally { setPreviewing(false); }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body = { name: name.trim(), product: product || null, description: description.trim() || null, objective: objective || null, criteria, first_message_template: firstMessage.trim() || null };
      const res = await fetch(initial ? `/api/icp/${initial.id}` : '/api/icp', {
        method: initial ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const issue = (data.issues as { path?: (string | number)[]; message?: string }[] | undefined)?.[0];
        setError(issue ? `${data.error}: ${(issue.path ?? []).join('.') || 'body'} — ${issue.message}` : (data.error || 'Save failed'));
        return;
      }
      const listId = (data as { id?: string; profile?: { id?: string } }).id ?? (data as { profile?: { id?: string } }).profile?.id ?? initial?.id;
      if (listId && JSON.stringify(listVoice) !== JSON.stringify(startVoice)) {
        const v = await fetch(`/api/icp/${listId}/voice`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(listVoice) });
        if (!v.ok) { const e = await v.json().catch(() => ({})); setError(`List saved, but what it pitches was not: ${e.error || v.status}`); return; }
      }
      // An investor list keeps its brief; switching a list back to Customers leaves an existing brief alone.
      if (listId && investors && JSON.stringify(brief) !== JSON.stringify(startBrief)) {
        const r = await fetch(`/api/icp/${listId}/firms/brief`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: briefBody(brief) }) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok || out.error) { setError(`List saved, but what funds are judged against was not: ${out.error || r.status}`); return; }
      }
      onSaved(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const roleGroups = ROLE_GROUPS.map((g) => ({ group: g.group, items: g.titles }));
  const dist = preview?.distribution ?? {};
  const distOrder: { key: string; label: string; color: string }[] = [
    { key: 'strong_fit', label: 'Strong', color: 'var(--green)' },
    { key: 'proceed_with_caution', label: 'Proceed', color: 'var(--yellow)' },
    { key: 'weak_fit', label: 'Weak', color: 'var(--orange)' },
    { key: 'do_not_pursue', label: 'No', color: 'var(--red)' },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 p-4">
      <div className="space-y-4">
        {aiTouched && (
          <div className="text-[11px] px-3 py-1.5 rounded-full inline-flex items-center gap-2"
               style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
            ✦ AI-generated from your website — adjust or add anything below before saving.
          </div>
        )}

        <Section n={1} title={investors ? 'About the raise' : 'About the product'}
                 sub={investors ? 'Name the list and say what we raise for.' : 'Name this profile and, optionally, let AI draft it from a website.'}>
          <div>
            <div className="text-xs font-medium mb-1">This list is for</div>
            <div className="inline-flex rounded-full p-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }} role="radiogroup">
              {([['customers', 'Customers'], ['investors', 'Investors']] as const).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => chooseKind(k)}
                        className="text-xs px-3 py-1 rounded-full"
                        style={kind === k ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--text-muted)' }}>
                  {label}
                </button>
              ))}
            </div>
            {investors && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                People at funds (partners first), and every fund on the list judged Go, Check or Out against the rounds, focus and regions below.
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={investors ? 'List name, e.g. Seed VCs Europe — B2B AI *' : 'Profile name, e.g. PE-backed mid-market ops leaders *'}
                   className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
            <select value={product} onChange={(e) => setProduct(e.target.value)} className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}>
              {PRODUCTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000}
                    placeholder={investors ? 'Who we are and what we raise (used by the agent when drafting outreach)' : 'What we sell and to whom (used by the agent when drafting outreach)'}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y" style={inputStyle} />
          <ListVoiceFields brandKey="zeami" value={listVoice} onChange={setListVoice} inputStyle={inputStyle} />
          <div>
            <div className="text-xs font-medium mb-1">First message after they accept <span style={{ color: 'var(--text-muted)' }}>(optional)</span></div>
            <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} rows={4}
                      placeholder={'When someone on this list accepts a connection request, a card with this text is filed for your 👍. Placeholders: {first_name} {full_name} {company}'}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y" style={inputStyle} />
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Nothing is sent by itself: each acceptance becomes one approval card on Telegram and on the list page. Leave empty to only be told who accepted.
            </div>
          </div>
          {!investors && <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--bg-input)', border: '1px dashed var(--border)' }}>
            <div>
              <div className="text-xs font-medium mb-1">Optimize for <span style={{ color: 'var(--text-muted)' }}>(optional)</span></div>
              <div className="flex flex-wrap gap-1.5">
                {OBJECTIVES.map((o) => (
                  <button key={o.key} type="button" title={o.hint}
                          onClick={() => setObjective(objective === o.key ? '' : o.key)}
                          className="text-[11px] px-2 py-1 rounded-full border"
                          style={objective === o.key
                            ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }
                            : { background: 'var(--bg)', color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (optional), e.g. zeami.io"
                     onKeyDown={(e) => { if (e.key === 'Enter' && !suggesting) suggest(); }}
                     className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none" style={{ ...inputStyle, background: 'var(--bg)' }} />
              <button type="button" onClick={suggest} disabled={suggesting}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 whitespace-nowrap" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                {suggesting ? 'Thinking…' : 'Suggest ICPs'}
              </button>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Uses the website, your description and any chips you’ve set to propose a few candidate ICPs — each scored on speed, volume, margin, logo and test-cases. Nothing is saved until you pick one and click Save.
            </p>
            {suggestNote && <p className="text-[11px]" style={{ color: 'var(--text)' }}>{suggestNote}</p>}

            {candidates.length > 0 && (
              <div className="space-y-2 pt-1">
                {candidates.map((cand, i) => (
                  <div key={i} className="rounded-lg p-3"
                       style={{ background: 'var(--bg)', border: i === recommendedIdx ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold flex items-center gap-2 flex-wrap">
                        {cand.suggestion.name}
                        {i === recommendedIdx && <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>Recommended</span>}
                        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{cand.confidence} confidence</span>
                      </div>
                      <button type="button" onClick={() => useCandidate(cand)}
                              className="text-[11px] px-2 py-1 rounded whitespace-nowrap" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Use this</button>
                    </div>
                    <div className="grid gap-1 mt-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                      {OBJECTIVES.map((o) => {
                        const v = cand.objective_scores[o.key] ?? 0;
                        return (
                          <div key={o.key} title={`${o.label}: ${v}/5`} className="text-center">
                            <div className="flex items-end justify-center gap-0.5 h-6">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <span key={n} className="w-1 rounded-sm" style={{ height: `${n * 18}%`, background: n <= v ? 'var(--accent)' : 'var(--border)' }} />
                              ))}
                            </div>
                            <div className="text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{o.label.split(' ')[0]}</div>
                          </div>
                        );
                      })}
                    </div>
                    {cand.rationale && <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>{cand.rationale}</p>}
                    {cand.assumptions.length > 0 && (
                      <ul className="text-[10px] mt-1 list-disc pl-4 space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                        {cand.assumptions.slice(0, 3).map((a, j) => <li key={j}>{a}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>}
        </Section>

        <Section n={2} title={investors ? 'Who at the fund?' : "Who's your ideal customer?"} sub="Titles are matched on whole words, so “VP Engineering” also catches “VP of Engineering”. Similar titles are not inferred — add the variants you care about.">
          <ChipSelect label="Job roles" options={roleGroups} selected={criteria.titles} onChange={(v) => set('titles', v)} placeholder="Add a title, e.g. Head of Automation" />
          <ChipSelect label="Seniority" hint="Scores the band even when the exact title isn't listed." options={SENIORITY_BANDS.map((b) => b.key)}
                      selected={criteria.seniority} onChange={(v) => set('seniority', v as SeniorityBand[])} allowCustom={false} labelOf={bandLabel} />
        </Section>

        {investors && (
          <Section n={3} title="What should the fund invest in?" sub="Every researched fund is judged against this: Go, Check (needs a look) or Out, with the reason. Leave a group empty to mean “any”.">
            <ChipSelect label="Rounds they invest in" hint="Our round. A fund that only writes later cheques is Out." options={INVESTOR_STAGES}
                        selected={brief.stages} onChange={(v) => setB('stages', v)} placeholder="Add a round…" />
            <ChipSelect label="Investment focus" hint="Their thesis should name at least one, e.g. B2B SaaS rather than consumer." options={INVESTOR_SECTORS}
                        selected={brief.sectors} onChange={(v) => setB('sectors', v)} placeholder="Add a focus, e.g. vertical SaaS" />
            <ChipSelect label="Out if they invest only in" tone="exclude" options={INVESTOR_EXCLUDE_SECTORS}
                        selected={brief.exclude_sectors} onChange={(v) => setB('exclude_sectors', v)} placeholder="Add a sector…" />
            <ChipSelect label="Regions the fund must cover" hint="Global funds always count." options={INVESTOR_REGIONS}
                        selected={brief.geographies} onChange={(v) => setB('geographies', v)} placeholder="Add a region or country…" />
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_1fr_1fr] gap-2">
              <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>Round size
                <input value={brief.round_size} onChange={(e) => setB('round_size', e.target.value)} inputMode="numeric" placeholder="1500000"
                       className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
              </label>
              <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>Currency
                <select value={brief.currency} onChange={(e) => setB('currency', e.target.value)} className="px-2 py-2 rounded-lg text-sm outline-none" style={inputStyle}>
                  {INVESTOR_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>Our company is in
                <input value={brief.entity_country} onChange={(e) => setB('entity_country', e.target.value)} placeholder="Germany"
                       className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
              </label>
              <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>Latest fund at least from
                <input value={brief.min_fund_year} onChange={(e) => setB('min_fund_year', e.target.value)} inputMode="numeric" placeholder={String(new Date().getFullYear() - 4)}
                       className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
              </label>
            </div>
            <p className="text-[11px] -mt-2" style={{ color: 'var(--text-muted)' }}>A minimum cheque above the round is Out; an older last fund is Check (may no longer be investing).</p>
            <label className="grid gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>What we raise for (one sentence; research uses it to write each fund’s opening line)
              <textarea value={brief.pitch} onChange={(e) => setB('pitch', e.target.value)} rows={2} maxLength={600}
                        placeholder="Zeami: AI workflow software that maps how business teams work and automates the repeatable parts."
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y" style={inputStyle} />
            </label>
          </Section>
        )}

        <Section n={sec(3)} title={investors ? 'Which funds and where are their people?' : 'What kind of companies are you targeting?'} sub="Leave a group empty to mean “any”.">
          <ChipSelect label="Industries" options={INDUSTRIES} selected={criteria.industries} onChange={(v) => set('industries', v)} allLabel="All industries" placeholder="Add an industry…" />
          <ChipSelect label="Locations" hint="Person's own location, not company HQ. Regions and countries both work." options={LOCATION_GROUPS}
                      selected={criteria.locations} onChange={(v) => set('locations', v)} allLabel="All locations" placeholder="Add a country or city…" />
          <ChipSelect label="Company size" options={COMPANY_SIZES.map((s) => s.key)} selected={criteria.company_sizes} onChange={setSizes}
                      allowCustom={false} labelOf={sizeLabel} allLabel="All sizes" />
        </Section>

        <Section n={sec(4)} title="Who should we exclude?" sub="Hard disqualifications — a match scores 0 no matter what else fits.">
          <ChipSelect label="Exclude these profiles" tone="exclude" options={investors ? INVESTOR_EXCLUDES : EXCLUDE_TITLE_PRESETS} selected={criteria.exclude_titles}
                      onChange={(v) => set('exclude_titles', v.map((s) => s.toLowerCase()))} placeholder="Add a title fragment, e.g. advisor" />
          <ChipSelect label={investors ? 'Funds to avoid' : 'Companies to avoid'} tone="exclude" hint={investors ? 'Funds already in the cap table, ones that passed, or competitors’ investors.' : "Competitors, your own company, partners you don't want to cold-message."}
                      options={[]} selected={criteria.exclude_companies} onChange={(v) => set('exclude_companies', v)} placeholder="e.g. UiPath, Workato" />
        </Section>

        <Section n={sec(5)} title="How should we score a match?" sub="Points out of 100. Tuning is data, not a deploy — change it any time.">
          <div className="space-y-2">
            {WEIGHT_LABELS.map(({ key, label, hint }) => {
              const disabled = key === 'size' && criteria.company_sizes.length === 0;
              return (
                <div key={key} className="grid grid-cols-[130px_1fr_52px] items-center gap-3" style={{ opacity: disabled ? 0.45 : 1 }}>
                  <div>
                    <div className="text-xs font-medium">{label}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{disabled ? 'Pick company sizes to use' : hint}</div>
                  </div>
                  <input type="range" min={0} max={100} value={criteria.weights[key]} disabled={disabled}
                         onChange={(e) => setWeight(key, Number(e.target.value))} className="w-full" />
                  <input type="number" min={0} max={100} value={criteria.weights[key]} disabled={disabled}
                         onChange={(e) => setWeight(key, Number(e.target.value))}
                         className="px-2 py-1 rounded text-xs text-right outline-none" style={inputStyle} />
                </div>
              );
            })}
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs" style={{ color: total === 100 ? 'var(--green)' : 'var(--orange)' }}>
                Total {total}/100{total !== 100 && ' — will be rescaled on save'}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => set('weights', normalizeWeights(criteria.weights))} className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>Rescale to 100</button>
                <button type="button" onClick={() => set('weights', { ...DEFAULT_WEIGHTS, size: criteria.company_sizes.length ? 10 : 0 })} className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>Reset</button>
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* Right rail: what this ICP asks for + dry-run preview + save */}
      <aside className="space-y-4 xl:sticky xl:top-4 self-start">
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold">Sales Navigator ask</h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Derived from your choices; resolved to LinkedIn filter ids when a search runs.</p>
          <dl className="text-xs space-y-1">
            {salesNav.search_keywords && <Row k="Keywords" v={salesNav.search_keywords} />}
            {Object.entries(salesNav.filters).map(([k, v]) => (
              <Row key={k} k={k.replace(/_/g, ' ')} v={Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : String(v)} />
            ))}
            {!salesNav.search_keywords && Object.keys(salesNav.filters).length === 0 && (
              <div style={{ color: 'var(--text-muted)' }}>Nothing yet — pick roles or companies.</div>
            )}
          </dl>
        </div>

        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Preview matches</h3>
            <button type="button" onClick={runPreview} disabled={previewing || !canSave}
                    className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>
              {previewing ? 'Scoring…' : preview ? 'Re-run' : 'Run'}
            </button>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Scores your existing contacts against this profile. Creates nothing, spends no LinkedIn quota.</p>
          {preview && (
            <>
              <div className="flex h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                {distOrder.map((d) => {
                  const n = dist[d.key] || 0;
                  return n > 0 ? <div key={d.key} style={{ width: `${(n / Math.max(preview.considered, 1)) * 100}%`, background: d.color }} title={`${d.label}: ${n}`} /> : null;
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {distOrder.map((d) => (
                  <span key={d.key} style={{ color: d.color }}>{d.label} {dist[d.key] || 0}</span>
                ))}
                <span style={{ color: 'var(--text-muted)' }}>of {preview.considered}</span>
              </div>
              <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
                {preview.matches.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No contact scored above 0. Loosen the roles or industries.</p>}
                {preview.matches.map((m) => (
                  <div key={m.contact_id} className="rounded-lg p-2 text-xs" style={{ background: 'var(--bg-input)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{m.full_name}</div>
                        <div className="truncate" style={{ color: 'var(--text-muted)' }}>{[m.title, m.company].filter(Boolean).join(' · ') || '—'}</div>
                        <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>{[m.industry, m.location].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${fitColor(m.icp_score)} 14%, transparent)`, color: fitColor(m.icp_score) }}>{m.icp_score}</span>
                    </div>
                    <button type="button" onClick={() => setOpenReasons(openReasons === m.contact_id ? null : m.contact_id)} className="mt-1 text-[10px] underline" style={{ color: 'var(--text-muted)' }}>
                      {openReasons === m.contact_id ? 'hide why' : 'why?'}
                    </button>
                    {openReasons === m.contact_id && (
                      <ul className="mt-1 space-y-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {m.reasons.map((r, i) => <li key={i}>· {r}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: 'var(--red)' }}>{error}</div>}

        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={!canSave || saving}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40" style={{ background: 'var(--green)', color: 'var(--accent-fg)' }}>
            {saving ? 'Saving…' : initial ? 'Save changes' : investors ? 'Save list' : 'Save ICP'}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
        </div>
        {!canSave && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Give it a name and at least one role, seniority band or industry.</p>}
        {investors && canSave && !briefHasContent(brief) && (
          <p className="text-[11px]" style={{ color: 'var(--orange)' }}>Add the rounds, focus or regions: funds are researched and judged only once the list says what it looks for.</p>
        )}
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-2">
      <dt className="capitalize" style={{ color: 'var(--text-muted)' }}>{k}</dt>
      <dd className="break-words">{v}</dd>
    </div>
  );
}
