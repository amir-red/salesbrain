'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface PersonRow {
  id: string;
  full_name: string;
  organization: string | null;
  stage: Stage;
  preferred_channel: string | null;
  cadence_days: number | null;
  last_interaction_at: string | null;
  handles: { channel: string; handle: string }[];
  open_commitments: number;
  facts: number;
  value_events: number;
  objectives: number;
  deals: number;
}

interface Dossier {
  person: PersonRow;
  handles: { channel: string; handle: string }[];
  facts: { fact: string; source: string | null; learned_at: string; superseded_at: string | null }[];
  commitments: {
    direction: 'ours' | 'theirs';
    description: string;
    due_at: string | null;
    status: string;
    resolved_at: string | null;
  }[];
  value_events: { tier: string; description: string; occurred_at: string }[];
  objectives: { description: string; target_tier: string | null; status: string }[];
  interactions: { occurred_at: string; channel: string; direction: string; summary: string }[];
  deals: { id: string; name: string; gate: number; status: string; deal_type: string }[];
}

type Stage = 'stranger' | 'acquaintance' | 'engaged' | 'trusted' | 'advocate';

const STAGE_COLOR: Record<Stage, string> = {
  stranger: 'var(--text-muted)',
  acquaintance: '#60a5fa',
  engaged: '#a78bfa',
  trusted: '#34d399',
  advocate: '#fbbf24',
};

const TIER_COLOR: Record<string, string> = {
  personal: '#fbbf24',
  career: '#34d399',
  company: '#60a5fa',
  commercial: '#a78bfa',
};

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default function RelationshipsPage() {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<'all' | Stage>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);

  useEffect(() => {
    fetch('/api/relationships')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Failed');
        setPeople(j.people);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) { setDossier(null); return; }
    setDossierLoading(true);
    fetch(`/api/relationships/${selected}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Failed');
        setDossier(j);
      })
      .catch(() => setDossier(null))
      .finally(() => setDossierLoading(false));
  }, [selected]);

  const q = search.trim().toLowerCase();
  const filtered = people.filter(
    (p) =>
      (stage === 'all' || p.stage === stage) &&
      (!q ||
        p.full_name.toLowerCase().includes(q) ||
        (p.organization || '').toLowerCase().includes(q) ||
        p.handles.some((h) => h.handle.toLowerCase().includes(q))),
  );

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Relationships</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            The relationship graph — what the agent knows, remembers, and owes. Written only by the
            agent runtime (conversations, distilled facts, policy-gated outreach); read-only here.
          </p>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* ── List pane ─────────────────────────────────────────────── */}
          <div className="w-full md:w-[380px] flex-shrink-0 flex flex-col border-r overflow-hidden"
               style={{ borderColor: 'var(--border)' }}>
            <div className="p-3 space-y-2 border-b" style={{ borderColor: 'var(--border)' }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, org, handle…"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <div className="flex gap-1.5 flex-wrap">
                {(['all', 'stranger', 'acquaintance', 'engaged', 'trusted', 'advocate'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStage(s)}
                    className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                    style={{
                      background: stage === s ? 'var(--accent)' : 'var(--bg-input)',
                      color: stage === s ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${stage === s ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {loading ? (
                <p className="text-sm p-2" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : error ? (
                <p className="text-sm p-2" style={{ color: 'var(--red)' }}>{error}</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm p-2" style={{ color: 'var(--text-muted)' }}>No people match.</p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p.id === selected ? null : p.id)}
                    className="w-full text-left rounded-lg p-3 transition-colors"
                    style={{
                      background: selected === p.id ? 'var(--accent-glow)' : 'var(--bg-card)',
                      border: `1px solid ${selected === p.id ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate">{p.full_name}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ color: STAGE_COLOR[p.stage], border: `1px solid ${STAGE_COLOR[p.stage]}` }}>
                        {p.stage}
                      </span>
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {p.organization || '—'}
                    </div>
                    <div className="flex gap-3 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      <span>last touch: {ago(p.last_interaction_at)}</span>
                      {p.open_commitments > 0 && (
                        <span style={{ color: 'var(--red)' }}>{p.open_commitments} open commitment{p.open_commitments > 1 ? 's' : ''}</span>
                      )}
                      {p.deals > 0 && <span>{p.deals} deal{p.deals > 1 ? 's' : ''}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ── Dossier pane ──────────────────────────────────────────── */}
          <div className="hidden md:block flex-1 overflow-y-auto p-4">
            {!selected ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Select a person to see their dossier — exactly what the agent sees.
                </p>
              </div>
            ) : dossierLoading || !dossier ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {dossierLoading ? 'Loading dossier…' : 'Failed to load dossier.'}
              </p>
            ) : (
              <div className="max-w-3xl space-y-4">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-xl font-bold">{dossier.person.full_name}</h2>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ color: STAGE_COLOR[dossier.person.stage], border: `1px solid ${STAGE_COLOR[dossier.person.stage]}` }}>
                      {dossier.person.stage}
                    </span>
                  </div>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {dossier.person.organization || 'No organization'} · preferred channel:{' '}
                    {dossier.person.preferred_channel || 'unknown'} · last interaction:{' '}
                    {ago(dossier.person.last_interaction_at)}
                  </p>
                  {dossier.handles.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {dossier.handles.map((h, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded-md"
                              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                          {h.channel}: {h.handle}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <Section title={`Facts (${dossier.facts.filter((f) => !f.superseded_at).length})`}
                         empty="Nothing learned yet — facts appear as the agent distills real conversations."
                         isEmpty={dossier.facts.length === 0}>
                  {dossier.facts.map((f, i) => (
                    <div key={i} className="text-sm py-1.5 flex items-baseline justify-between gap-3"
                         style={{ opacity: f.superseded_at ? 0.45 : 1 }}>
                      <span style={{ textDecoration: f.superseded_at ? 'line-through' : 'none' }}>{f.fact}</span>
                      {/* Provenance is a first-class citizen: every fact shows where it came from */}
                      <span className="text-[11px] flex-shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>
                        {f.source || 'unknown'} · {String(f.learned_at).slice(0, 10)}
                      </span>
                    </div>
                  ))}
                </Section>

                <Section title={`Commitments (${dossier.commitments.filter((c) => c.status === 'open').length} open)`}
                         empty="No promises tracked in either direction."
                         isEmpty={dossier.commitments.length === 0}>
                  {dossier.commitments.map((c, i) => {
                    const overdue = c.status === 'open' && c.due_at && new Date(c.due_at) < new Date();
                    return (
                      <div key={i} className="text-sm py-1.5 flex items-baseline gap-2"
                           style={{ opacity: c.status === 'open' ? 1 : 0.5 }}>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: 'var(--bg-input)', color: c.direction === 'ours' ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {c.direction === 'ours' ? 'WE OWE' : 'THEY OWE'}
                        </span>
                        <span className="flex-1">{c.description}</span>
                        <span className="text-[11px] flex-shrink-0" style={{ color: overdue ? 'var(--red)' : 'var(--text-muted)' }}>
                          {c.status === 'open'
                            ? c.due_at ? `due ${String(c.due_at).slice(0, 10)}${overdue ? ' — OVERDUE' : ''}` : 'undated'
                            : c.status}
                        </span>
                      </div>
                    );
                  })}
                </Section>

                <Section title={`Value delivered (${dossier.value_events.length})`}
                         empty="No value delivered yet — the ledger fills before we ever ask for anything."
                         isEmpty={dossier.value_events.length === 0}>
                  {dossier.value_events.map((v, i) => (
                    <div key={i} className="text-sm py-1.5 flex items-baseline gap-2">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: 'var(--bg-input)', color: TIER_COLOR[v.tier] || 'var(--text-muted)' }}>
                        {v.tier}
                      </span>
                      <span className="flex-1">{v.description}</span>
                      <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {String(v.occurred_at).slice(0, 10)}
                      </span>
                    </div>
                  ))}
                </Section>

                {dossier.objectives.length > 0 && (
                  <Section title="Objectives" empty="" isEmpty={false}>
                    {dossier.objectives.map((o, i) => (
                      <div key={i} className="text-sm py-1.5" style={{ opacity: o.status === 'active' ? 1 : 0.5 }}>
                        {o.description}
                        <span className="text-[11px] ml-2" style={{ color: 'var(--text-muted)' }}>
                          → {o.target_tier || '?'} · {o.status}
                        </span>
                      </div>
                    ))}
                  </Section>
                )}

                {dossier.deals.length > 0 && (
                  <Section title="Linked deals" empty="" isEmpty={false}>
                    {dossier.deals.map((d) => (
                      <Link key={d.id} href={`/?deal=${d.id}`}
                            className="block text-sm py-1.5 hover:underline" style={{ color: 'var(--accent)' }}>
                        {d.name} <span style={{ color: 'var(--text-muted)' }}>· {d.deal_type} · G{d.gate} · {d.status}</span>
                      </Link>
                    ))}
                  </Section>
                )}

                <Section title={`Interactions (${dossier.interactions.length})`}
                         empty="No interactions recorded — the timeline fills as real conversations flow through the agent."
                         isEmpty={dossier.interactions.length === 0}>
                  {dossier.interactions.map((x, i) => (
                    <div key={i} className="text-sm py-1.5 flex items-baseline gap-2">
                      <span className="text-[11px] flex-shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>
                        {String(x.occurred_at).slice(0, 10)}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                        {x.channel} {x.direction}
                      </span>
                      <span className="flex-1 truncate" title={x.summary}>{x.summary}</span>
                    </div>
                  ))}
                </Section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, empty, isEmpty, children }: {
  title: string; empty: string; isEmpty: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <h3 className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h3>
      {isEmpty ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{empty}</p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>{children}</div>
      )}
    </div>
  );
}
