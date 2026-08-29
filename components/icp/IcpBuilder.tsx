'use client';

import { useMemo, useState } from 'react';
import ChipSelect from './ChipSelect';
import {
  COMPANY_SIZES, DEFAULT_WEIGHTS, EXCLUDE_TITLE_PRESETS, INDUSTRIES, LOCATION_GROUPS, PRODUCTS,
  ROLE_GROUPS, SENIORITY_BANDS, WEIGHT_LABELS, buildSalesNavFilters, emptyCriteria,
  normalizeWeights, weightsTotal,
} from '@/lib/icp';
import type { IcpCriteria, IcpProfile, IcpSuggestion, SeniorityBand, WeightKey } from '@/lib/icp';

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
              style={{ background: 'var(--accent)', color: '#fff' }}>{n}</span>
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
  const [criteria, setCriteria] = useState<IcpCriteria>(initial?.criteria ?? emptyCriteria());

  const [website, setWebsite] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [aiTouched, setAiTouched] = useState(false);

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

  const analyze = async () => {
    setSuggesting(true); setError(null); setSuggestNote(null);
    try {
      const res = await fetch('/api/icp/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website, product, description }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Analysis failed'); return; }
      const s: IcpSuggestion = data.suggestion;
      if (!name.trim() && s.company_name) setName(`${s.company_name} buyers`);
      if (!description.trim() && s.description) setDescription(s.description);
      setCriteria((c) => {
        const sizes = s.company_sizes.length ? s.company_sizes : c.company_sizes;
        const w = { ...c.weights };
        if (sizes.length && w.size === 0) w.size = 10;
        return {
          titles: s.titles.length ? s.titles : c.titles,
          seniority: s.seniority.length ? s.seniority : c.seniority,
          industries: s.industries.length ? s.industries : c.industries,
          locations: s.locations.length ? s.locations : c.locations,
          company_sizes: sizes,
          exclude_titles: s.exclude_titles.length ? s.exclude_titles : c.exclude_titles,
          exclude_companies: s.exclude_companies.length ? s.exclude_companies : c.exclude_companies,
          weights: normalizeWeights(w),
        };
      });
      setAiTouched(true);
      const via = data.source === 'bundle' ? 'Read from the site\u2019s app bundle (JS-only page). '
        : data.source === 'description' ? 'The site returned no text \u2014 drafted from your description instead. ' : '';
      setSuggestNote(via + [s.rationale, s.keywords.length ? `Topics buyers talk about: ${s.keywords.join(', ')}` : null].filter(Boolean).join(' \u2014 '));
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally { setSuggesting(false); }
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
      const body = { name: name.trim(), product: product || null, description: description.trim() || null, criteria };
      const res = await fetch(initial ? `/api/icp/${initial.id}` : '/api/icp', {
        method: initial ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Save failed'); return; }
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

        <Section n={1} title="About the product" sub="Name this profile and, optionally, let AI draft it from a website.">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Profile name, e.g. PE-backed mid-market ops leaders *"
                   className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
            <select value={product} onChange={(e) => setProduct(e.target.value)} className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}>
              {PRODUCTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                    placeholder="What we sell and to whom (used by the agent when drafting outreach)"
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y" style={inputStyle} />
          <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-input)', border: '1px dashed var(--border)' }}>
            <div className="text-xs font-medium">Draft from a website</div>
            <div className="flex gap-2">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://zeami.io"
                     onKeyDown={(e) => { if (e.key === 'Enter' && website.trim() && !suggesting) analyze(); }}
                     className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none" style={{ ...inputStyle, background: 'var(--bg)' }} />
              <button type="button" onClick={analyze} disabled={!website.trim() || suggesting}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
                {suggesting ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Reads the homepage and /about, then proposes roles, industries, markets, sizes and exclusions. Nothing is saved until you click Save.
            </p>
            {suggestNote && <p className="text-[11px]" style={{ color: 'var(--text)' }}>{suggestNote}</p>}
          </div>
        </Section>

        <Section n={2} title="Who's your ideal customer?" sub="Titles are matched on whole words, so “VP Engineering” also catches “VP of Engineering”. Similar titles are not inferred — add the variants you care about.">
          <ChipSelect label="Job roles" options={roleGroups} selected={criteria.titles} onChange={(v) => set('titles', v)} placeholder="Add a title, e.g. Head of Automation" />
          <ChipSelect label="Seniority" hint="Scores the band even when the exact title isn't listed." options={SENIORITY_BANDS.map((b) => b.key)}
                      selected={criteria.seniority} onChange={(v) => set('seniority', v as SeniorityBand[])} allowCustom={false} labelOf={bandLabel} />
        </Section>

        <Section n={3} title="What kind of companies are you targeting?" sub="Leave a group empty to mean “any”.">
          <ChipSelect label="Industries" options={INDUSTRIES} selected={criteria.industries} onChange={(v) => set('industries', v)} allLabel="All industries" placeholder="Add an industry…" />
          <ChipSelect label="Locations" hint="Person's own location, not company HQ. Regions and countries both work." options={LOCATION_GROUPS}
                      selected={criteria.locations} onChange={(v) => set('locations', v)} allLabel="All locations" placeholder="Add a country or city…" />
          <ChipSelect label="Company size" options={COMPANY_SIZES.map((s) => s.key)} selected={criteria.company_sizes} onChange={setSizes}
                      allowCustom={false} labelOf={sizeLabel} allLabel="All sizes" />
        </Section>

        <Section n={4} title="Who should we exclude?" sub="Hard disqualifications — a match scores 0 no matter what else fits.">
          <ChipSelect label="Exclude these profiles" tone="exclude" options={EXCLUDE_TITLE_PRESETS} selected={criteria.exclude_titles}
                      onChange={(v) => set('exclude_titles', v.map((s) => s.toLowerCase()))} placeholder="Add a title fragment, e.g. advisor" />
          <ChipSelect label="Companies to avoid" tone="exclude" hint="Competitors, your own company, partners you don't want to cold-message."
                      options={[]} selected={criteria.exclude_companies} onChange={(v) => set('exclude_companies', v)} placeholder="e.g. UiPath, Workato" />
        </Section>

        <Section n={5} title="How should we score a match?" sub="Points out of 100. Tuning is data, not a deploy — change it any time.">
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
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: `${fitColor(m.icp_score)}22`, color: fitColor(m.icp_score) }}>{m.icp_score}</span>
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

        {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}>{error}</div>}

        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={!canSave || saving}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40" style={{ background: 'var(--green)', color: '#fff' }}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Save ICP'}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
        </div>
        {!canSave && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Give it a name and at least one role, seniority band or industry.</p>}
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
