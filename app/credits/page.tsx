'use client';

/**
 * /credits — AI/cloud credit dashboard.
 *
 * Two tabs:
 *   Active (default) — applications in flight (deal_type=ai_credit,
 *     gate=C1..C4). Metric cards: pipeline count + apps needing action.
 *     Grouped table by owner. Rows link to /deals/[id].
 *   Awarded — the credit register (deal_type=ai_credit, gate>=C4).
 *     Metric cards: total received (per currency), expiring in 30d,
 *     total unused. Table columns: provider, program, applicant,
 *     received / utilized bar, expires + days-until badge, lead.
 *
 * "Add existing credit" button top-right opens the backfill modal —
 * a one-shot form that creates the deal (at C5 Active) + its
 * grant_resources row in a single transaction (POST /api/credits/backfill).
 *
 * Tab state via ?tab=active|awarded so links are shareable and refresh-
 * stable. Data fetches lazily per tab.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { AI_CREDIT_GATES } from '@/lib/gates';

interface ActiveCreditDeal {
  id: string;
  name: string;
  company: string;
  gate: number;
  applicant_entity: 'chipchip' | 'zeami' | 'both' | null;
  currency: string;
  value: string | null;
  lead_id: string | null;
  lead_name: string | null;
  days_in_gate: number;
  fields: Record<string, unknown>;
}

interface AwardedCredit {
  deal_id: string;
  name: string;
  company: string;
  provider: string | null;
  credit_program_name: string | null;
  applicant_entity: 'chipchip' | 'zeami' | 'both' | null;
  gate: number;
  currency: string;
  total_committed: number;
  total_received: number;
  total_utilized: number;
  earliest_expiry: string | null;
  lead_id: string | null;
  lead_name: string | null;
  resource_count: number;
}

const APPLICANT_LABEL: Record<string, string> = {
  chipchip: 'ChipChip', zeami: 'Zeami', both: 'Both',
};

function fmtMoney(n: number | null | undefined, ccy: string) {
  if (n === null || n === undefined) return '—';
  return `${ccy} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pill(text: string, color: string) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 500,
    }}>{text}</span>
  );
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

// ─── page wrapper ─────────────────────────────────────────────────────

type Tab = 'active' | 'awarded';

export default function CreditsDashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    }>
      <CreditsDashboardInner />
    </Suspense>
  );
}

function CreditsDashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get('tab') === 'active' ? 'active' : 'awarded';
  const [awarded, setAwarded] = useState<AwardedCredit[] | null>(null);
  const [activeDeals, setActiveDeals] = useState<ActiveCreditDeal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showBackfill, setShowBackfill] = useState(false);

  useEffect(() => {
    // Awarded loads on mount (default tab). Active loads on first switch.
    fetch('/api/credits/awarded?limit=200')
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setAwarded(j.credits || []);
      })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'active' || activeDeals !== null) return;
    // Active-tab data comes from the generic /api/deals feed filtered
    // client-side — the kernel already exposes deal_type=ai_credit +
    // gate < 4 without needing a dedicated command.
    fetch('/api/deals?limit=200')
      .then((r) => r.json())
      .then((deals: unknown[]) => {
        const rows: ActiveCreditDeal[] = (deals as ActiveCreditDeal[])
          .filter((d) => (d as unknown as { deal_type: string }).deal_type === 'ai_credit'
                         && d.gate <= 3)
          .map((d) => ({
            ...d,
            fields: d.fields || {},
            days_in_gate: 0,   // deals feed doesn't include this today; UI degrades gracefully
          }));
        setActiveDeals(rows);
      })
      .catch((e) => setErr(e.message || String(e)));
  }, [tab, activeDeals]);

  function selectTab(t: Tab) {
    const q = new URLSearchParams(params.toString());
    if (t === 'active') q.set('tab', 'active'); else q.delete('tab');
    router.replace(`/credits${q.toString() ? `?${q}` : ''}`);
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto p-6">
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>AI Credits</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {tab === 'awarded'
                ? 'The credit register — cloud + AI credits currently active with balance, expiration, and utilization.'
                : 'Applications in flight — discovered, qualified, submitted, awaiting decision.'}
            </p>
          </div>
          <button onClick={() => setShowBackfill(true)} style={{
            background: '#D97706', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
          }}>+ Add existing credit</button>
        </div>

        <TabStrip tab={tab} onSelect={selectTab} />

        {err && (
          <div style={{ padding: 12, background: 'var(--red)22', color: 'var(--red)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            Error: {err}
          </div>
        )}

        {tab === 'awarded'
          ? <AwardedView loading={loading} credits={awarded} />
          : <ActiveView loading={activeDeals === null} deals={activeDeals} />}

        {showBackfill && <BackfillModal onClose={() => setShowBackfill(false)}
                                        onSuccess={() => {
                                          setShowBackfill(false);
                                          // Force awarded reload
                                          setLoading(true); setAwarded(null);
                                          fetch('/api/credits/awarded?limit=200')
                                            .then((r) => r.json())
                                            .then((j) => setAwarded(j.credits || []))
                                            .finally(() => setLoading(false));
                                        }} />}
      </div>
    </div>
  );
}

function TabStrip({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  const tabStyle = (active: boolean) => ({
    padding: '8px 16px', fontSize: 13, fontWeight: 500,
    color: active ? 'var(--text)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid #D97706' : '2px solid transparent',
    cursor: 'pointer', background: 'transparent', border: 'none',
    borderRadius: 0,
  } as const);
  return (
    <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 20, display: 'flex' }}>
      <button style={tabStyle(tab === 'awarded')} onClick={() => onSelect('awarded')}>Awarded (Active credits)</button>
      <button style={tabStyle(tab === 'active')} onClick={() => onSelect('active')}>Applications in flight</button>
    </div>
  );
}

// ─── Awarded view ─────────────────────────────────────────────────────

function AwardedView({ loading, credits }: { loading: boolean; credits: AwardedCredit[] | null }) {
  const stats = useMemo(() => {
    if (!credits) return { count: 0, totalByCcy: new Map<string, number>(), expiringSoon: 0, unused: new Map<string, number>() };
    const byCcy = new Map<string, number>();
    const unused = new Map<string, number>();
    let expiringSoon = 0;
    for (const c of credits) {
      byCcy.set(c.currency, (byCcy.get(c.currency) || 0) + Number(c.total_received || 0));
      unused.set(c.currency, (unused.get(c.currency) || 0) + (Number(c.total_received || 0) - Number(c.total_utilized || 0)));
      const du = daysUntil(c.earliest_expiry);
      if (du !== null && du >= 0 && du <= 30) expiringSoon++;
    }
    return { count: credits.length, totalByCcy: byCcy, expiringSoon, unused };
  }, [credits]);

  if (loading || credits === null) return <div style={{ color: 'var(--text-muted)' }}>Loading credit register…</div>;

  const receivedSummary = stats.totalByCcy.size === 0
    ? '—'
    : [...stats.totalByCcy.entries()]
        .map(([c, v]) => `${c} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(' · ');
  const unusedSummary = stats.unused.size === 0
    ? '—'
    : [...stats.unused.entries()]
        .map(([c, v]) => `${c} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(' · ');

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <MetricCard label="Active credits" value={String(stats.count)} tone="var(--green)" />
        <MetricCard label="Total received" value={receivedSummary} tone="var(--text)" />
        <MetricCard label="Unused balance" value={unusedSummary} tone="var(--text)"
                    sub={stats.expiringSoon > 0 ? `${stats.expiringSoon} expiring in 30d` : undefined}
                    subTone={stats.expiringSoon > 0 ? 'var(--red)' : undefined} />
      </div>

      <Section title="Credit Register">
        {credits.length === 0 ? (
          <Empty text="No AI credits tracked yet. Click 'Add existing credit' to backfill the ones you already have (Google, AWS, Anthropic, ElevenLabs, DigitalOcean…)." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                  <th style={{ padding: 6 }}>Provider</th>
                  <th style={{ padding: 6 }}>Program / Deal</th>
                  <th style={{ padding: 6 }}>Applicant</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Received</th>
                  <th style={{ padding: 6 }}>Utilization</th>
                  <th style={{ padding: 6 }}>Expires</th>
                  <th style={{ padding: 6 }}>Lead</th>
                </tr>
              </thead>
              <tbody>
                {credits.map((c) => {
                  const received = Number(c.total_received || 0);
                  const utilized = Number(c.total_utilized || 0);
                  const ratio = received > 0 ? Math.min(1, utilized / received) : 0;
                  const du = daysUntil(c.earliest_expiry);
                  const expiryColor = du === null ? 'var(--text-muted)'
                                    : du < 0 ? 'var(--red)'
                                    : du <= 30 ? 'var(--orange)'
                                    : du <= 90 ? 'var(--yellow)' : 'var(--text)';
                  return (
                    <tr key={c.deal_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6, fontWeight: 500 }}>{c.provider || '—'}</td>
                      <td style={{ padding: 6 }}>
                        <Link href={`/deals/${c.deal_id}`} style={{ color: 'var(--accent)' }}>{c.credit_program_name || c.name}</Link>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{c.company}</div>
                      </td>
                      <td style={{ padding: 6 }}>{c.applicant_entity ? pill(APPLICANT_LABEL[c.applicant_entity], 'var(--accent)') : '—'}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(received, c.currency)}</td>
                      <td style={{ padding: 6, minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${ratio * 100}%`, height: '100%', background: 'var(--green)' }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {Math.round(ratio * 100)}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: 6, color: expiryColor, whiteSpace: 'nowrap' }}>
                        {c.earliest_expiry || '—'}
                        {du !== null && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {du < 0 ? `${-du}d ago` : du === 0 ? 'today' : `in ${du}d`}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 6, color: 'var(--text-muted)' }}>{c.lead_name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

// ─── Active view ──────────────────────────────────────────────────────

function ActiveView({ loading, deals }: { loading: boolean; deals: ActiveCreditDeal[] | null }) {
  if (loading || deals === null) return <div style={{ color: 'var(--text-muted)' }}>Loading applications…</div>;

  const byOwner = groupBy(deals, (d) => d.lead_name || 'Unassigned');
  const stageName = (n: number) => AI_CREDIT_GATES.find((g) => g.number === n)?.name || `C${n}`;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <MetricCard label="Applications" value={String(deals.length)} tone={deals.length > 0 ? 'var(--accent)' : 'var(--text-muted)'} />
        <MetricCard label="Awaiting decision" value={String(deals.filter((d) => d.gate === 3).length)} tone="var(--yellow)" />
        <MetricCard label="Not yet applied" value={String(deals.filter((d) => d.gate <= 2).length)} tone="var(--text-muted)" />
      </div>

      <Section title="Applications">
        {deals.length === 0 ? (
          <Empty text="No credit applications in flight. Create one on the Pipeline board (deal type: AI Credit)." />
        ) : (
          [...byOwner.entries()].map(([owner, rows]) => (
            <div key={owner} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {owner} · {rows.length}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                      <th style={{ padding: 6 }}>Deal</th>
                      <th style={{ padding: 6 }}>Provider</th>
                      <th style={{ padding: 6 }}>Applicant</th>
                      <th style={{ padding: 6 }}>Stage</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Est. value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 6 }}>
                          <Link href={`/deals/${d.id}`} style={{ color: 'var(--accent)' }}>{d.name}</Link>
                          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{d.company}</div>
                        </td>
                        <td style={{ padding: 6 }}>{(d.fields.provider as string) || '—'}</td>
                        <td style={{ padding: 6 }}>{d.applicant_entity ? APPLICANT_LABEL[d.applicant_entity] : '—'}</td>
                        <td style={{ padding: 6 }}>{pill(`C${d.gate}: ${stageName(d.gate)}`, d.gate === 3 ? 'var(--yellow)' : 'var(--accent)')}</td>
                        <td style={{ padding: 6, textAlign: 'right' }}>{d.value ? fmtMoney(Number(d.value), d.currency) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </Section>
    </>
  );
}

// ─── Backfill modal ───────────────────────────────────────────────────

function BackfillModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: '', company: 'ChipChip', provider: '', credit_program_name: '',
    applicant_entity: 'zeami' as 'chipchip' | 'zeami' | 'both',
    award_amount: '', currency: 'USD',
    credits_activated_at: new Date().toISOString().slice(0, 10),
    expires_at: '', units_label: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      company: form.company.trim(),
      provider: form.provider.trim(),
      credit_program_name: form.credit_program_name.trim(),
      applicant_entity: form.applicant_entity,
      award_amount: Number(form.award_amount),
      currency: form.currency.trim() || 'USD',
    };
    if (form.credits_activated_at) body.credits_activated_at = form.credits_activated_at;
    if (form.expires_at) body.expires_at = form.expires_at;
    if (form.units_label.trim()) body.units_label = form.units_label.trim();
    if (form.notes.trim()) body.notes = form.notes.trim();
    const res = await fetch('/api/credits/backfill', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || `HTTP ${res.status}`);
      setBusy(false);
      return;
    }
    setBusy(false);
    onSuccess();
  }

  const input = (label: string, key: keyof typeof form, opts: { placeholder?: string; type?: string; wide?: boolean } = {}) => (
    <label style={{ fontSize: 12, color: 'var(--text-muted)', gridColumn: opts.wide ? '1 / -1' : undefined }}>
      {label}
      <input
        type={opts.type || 'text'} value={form[key]}
        placeholder={opts.placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        style={{
          marginTop: 4, width: '100%',
          background: 'var(--bg-input)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 13,
        }} />
    </label>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
        padding: 20, width: 640, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Add existing AI credit</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          One-shot backfill for a credit already received. Creates the deal at C5 (Active) with a matching balance row so monitoring starts immediately.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {input('Deal name (e.g. "Google for Startups Cloud (Zeami)")', 'name', { wide: true, placeholder: 'Google for Startups Cloud (Zeami)' })}
          {input('Company (applicant legal entity)', 'company', { placeholder: 'ChipChip' })}
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Applicant entity
            <select value={form.applicant_entity} onChange={(e) => setForm({ ...form, applicant_entity: e.target.value as 'chipchip' | 'zeami' | 'both' })}
              style={{ marginTop: 4, width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 13 }}>
              <option value="chipchip">ChipChip</option>
              <option value="zeami">Zeami</option>
              <option value="both">Both</option>
            </select>
          </label>
          {input('Provider (Google Cloud / AWS / Anthropic / ElevenLabs)', 'provider', { placeholder: 'Google Cloud' })}
          {input('Program (e.g. Google for Startups Cloud, AWS Activate)', 'credit_program_name', { placeholder: 'Google for Startups Cloud' })}
          {input('Award amount', 'award_amount', { type: 'number', placeholder: '100000' })}
          {input('Currency', 'currency', { placeholder: 'USD' })}
          {input('Received on', 'credits_activated_at', { type: 'date' })}
          {input('Expires on', 'expires_at', { type: 'date' })}
          {input('Units label (for non-money credits, e.g. "credits" for ElevenLabs 33M)', 'units_label', { wide: true, placeholder: 'credits' })}
          {input('Notes (optional)', 'notes', { wide: true })}
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
          }}>Cancel</button>
          <button disabled={busy || !form.name || !form.provider || !form.credit_program_name || !form.award_amount}
                  onClick={submit} style={{
            background: '#D97706', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}>{busy ? 'Adding…' : 'Add credit'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── shared bits ──────────────────────────────────────────────────────

function MetricCard({ label, value, tone, sub, subTone }: { label: string; value: string; tone: string; sub?: string; subTone?: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: tone }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subTone || 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>{text}</div>;
}
