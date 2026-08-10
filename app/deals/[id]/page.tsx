'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import Timeline from '@/components/Timeline';
import DealPricingPanel from '@/components/DealPricingPanel';
import MarkAsLostModal from '@/components/MarkAsLostModal';
import GrantStage2Panels from '@/components/GrantStage2Panels';
import { getPipeline, SALES_GATES } from '@/lib/gates';

interface Deal {
  id: string;
  name: string;
  company: string;
  gate: number;
  score: number | null;
  risk: string | null;
  verdict: string | null;
  value: string | null;
  currency: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  linked_contact_name?: string | null;
  linked_contact_org?: string | null;
  owner: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  missing: string[];
  flags: string[];
  fields: Record<string, unknown>;
  gate_entered_at: string;
  user_id: string;
  deal_type: 'sales' | 'grant';
  status?: 'active' | 'won' | 'lost' | 'cancelled';
  contract_signed_at?: string | null;
  won_at?: string | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
  deleted_at?: string | null;
  deleted_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface UserRow { id: string; name: string; email: string }

const GRANT_MONEY_FIELDS = [
  'grant_amount_min',
  'grant_amount_max',
  'our_contribution',
  'our_contribution_type',
  'cofunding_split',
];

interface CurrentUser {
  userId: string;
  email: string;
  name: string;
  role: string;
}

function ScoreRing({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="w-28 h-28 rounded-full border-4 flex items-center justify-center" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>N/A</span>
      </div>
    );
  }
  const circumference = 2 * Math.PI * 48;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div className="relative w-28 h-28">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 108 108">
        <circle cx="54" cy="54" r="48" fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle cx="54" cy="54" r="48" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
      {label}
    </span>
  );
}

export default function DealViewPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.id as string;
  const [deal, setDeal] = useState<Deal | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [markLostOpen, setMarkLostOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchDeal = () =>
    fetch(`/api/deals/${dealId}?include_deleted=1`).then((r) => (r.ok ? r.json() : null));

  const reload = () => { fetchDeal().then(setDeal); };

  useEffect(() => {
    Promise.all([
      fetchDeal(),
      fetch('/api/auth/me').then((r) => r.ok ? r.json() : null),
      fetch('/api/users').then((r) => r.ok ? r.json() : []),
    ]).then(([dealData, userData, userList]) => {
      setDeal(dealData);
      setCurrentUser(userData);
      setUsers(Array.isArray(userList) ? userList : []);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function handleDelete() {
    if (!deal) return;
    const ok = window.confirm(
      `Delete "${deal.name}"?\n\nThe deal will be hidden everywhere. An admin can restore it later.`,
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/deals/${dealId}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.push('/pipeline');
    else alert('Delete failed: ' + (await res.text()));
  }

  async function handleRestore() {
    if (!deal) return;
    setBusy(true);
    const res = await fetch(`/api/deals/${dealId}/restore`, { method: 'POST' });
    setBusy(false);
    if (res.ok) reload();
    else alert('Restore failed: ' + (await res.text()));
  }

  if (loading) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Deal not found</div>
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';
  const isOwner = currentUser?.userId === deal.user_id || isAdmin;
  // Wider than `isOwner` — the lead can also mark lost / chat. Matches the
  // POST /api/deals/:id/mark-lost permission rule.
  const canMutate =
    isAdmin ||
    currentUser?.userId === deal.user_id ||
    currentUser?.userId === deal.lead_id;
  const isLost = deal.status === 'lost';
  const isDeleted = !!deal.deleted_at;
  // Pipeline-aware gate lookup — was hardcoded to SALES_GATES via the GATES
  // alias, silently mislabelling grant deals with sales gate names.
  const pipeline = getPipeline(deal.deal_type);
  const gate = pipeline[deal.gate - 1];
  const fields = deal.fields || {};

  // Money-fields enforcement for grants — show banner if any are missing.
  const isGrant = deal.deal_type === 'grant';
  const missingMoney = isGrant
    ? GRANT_MONEY_FIELDS.filter((f) => {
        const v = fields[f];
        return v === undefined || v === null || v === '';
      })
    : [];
  const fieldKeys = Object.keys(fields);
  // G2 field-completion probe. Sales G2 has 7 required fields; grant G2 has 6
  // (different set entirely). The old code used SALES_GATES[1] for both.
  const g2 = pipeline[1];
  const totalRequired = g2?.requiredFields?.length || 7;
  const filledRequired = g2?.requiredFields?.filter((f) => fields[f] !== undefined && fields[f] !== null && fields[f] !== '')?.length || 0;

  const riskColors: Record<string, string> = { low: 'var(--green)', medium: 'var(--yellow)', high: 'var(--orange)', critical: 'var(--red)' };
  const verdictColors: Record<string, string> = { STRONG: 'var(--green)', PROCEED_WITH_CAUTION: 'var(--yellow)', WEAK: 'var(--orange)', WALK_AWAY: 'var(--red)' };

  const leadInitials = deal.lead_name
    ? deal.lead_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : null;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-4">
            <Link
              href="/pipeline"
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              ← Pipeline
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{deal.name}</h1>
                {isLost && (
                  <span
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                    title="This deal was marked lost — see /lessons for the captured lesson"
                  >
                    Lost
                  </span>
                )}
                {isDeleted && (
                  <span
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold"
                    style={{ background: 'rgba(148,163,184,0.2)', color: 'var(--text-muted)' }}
                    title={`Deleted${deal.deleted_by_name ? ` by ${deal.deleted_by_name}` : ''} on ${new Date(deal.deleted_at as string).toLocaleDateString()}`}
                  >
                    Deleted
                  </span>
                )}
              </div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{deal.company}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Mark as Lost: only shown on active deals to anyone with mutate rights.
                Sits next to Open Chat so it\'s discoverable but visually de-emphasized
                (outlined red, not solid) to avoid accidental clicks. */}
            {!isLost && !isDeleted && canMutate && (
              <button
                onClick={() => setMarkLostOpen(true)}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: 'transparent',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.4)',
                }}
                title="Mark this deal lost and capture a lesson"
              >
                Mark as Lost
              </button>
            )}
            {!isDeleted && canMutate && (
              <button
                onClick={handleDelete}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
                title="Soft-delete this deal — an admin can restore it later"
              >
                Delete
              </button>
            )}
            {isDeleted && isAdmin && (
              <button
                onClick={handleRestore}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Restore
              </button>
            )}
            {isOwner && (
              <Link
                href={`/?deal=${deal.id}`}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Open Chat →
              </Link>
            )}
          </div>
        </div>

        {/* Money-fields-missing banner for grants */}
        {isGrant && missingMoney.length > 0 && (
          <div
            className="mx-6 mt-4 p-4 rounded-xl flex items-start gap-3"
            style={{
              background: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.4)',
              color: 'var(--text)',
            }}
          >
            <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--yellow)' }}>
                Money fields missing — gate advancement is BLOCKED
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                The system refuses to advance this grant to the next gate until these are filled:
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {missingMoney.map((f) => (
                  <span
                    key={f}
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{ background: 'rgba(234, 179, 8, 0.2)', color: 'var(--yellow)' }}
                  >
                    {f}
                  </span>
                ))}
              </div>
              <Link
                href={`/?deal=${deal.id}`}
                className="inline-block mt-3 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Open chat to fill →
              </Link>
            </div>
          </div>
        )}

        <div className="p-6 space-y-8">
          {/* Top row: Score + Meta */}
          <div className="grid grid-cols-4 gap-6">
            {/* Score */}
            <div className="flex flex-col items-center gap-2 rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <ScoreRing score={deal.score} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Deal Score</span>
            </div>

            {/* Risk + Verdict */}
            <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Risk</p>
                {deal.risk ? <Badge label={deal.risk.toUpperCase()} color={riskColors[deal.risk] || 'var(--text-muted)'} /> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Not assessed</span>}
              </div>
              <div>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Verdict</p>
                {deal.verdict ? <Badge label={deal.verdict.replace(/_/g, ' ')} color={verdictColors[deal.verdict] || 'var(--text-muted)'} /> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Not assessed</span>}
              </div>
            </div>

            {/* Value + Gate */}
            <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Value</p>
                <p className="text-lg font-bold">
                  {deal.value ? `${deal.currency} ${Number(deal.value).toLocaleString()}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Current Gate</p>
                <p className="text-sm font-medium">G{deal.gate}: {gate?.name || 'Unknown'}</p>
              </div>
            </div>

            {/* Lead + Contact */}
            <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Project Lead</p>
                {deal.lead_name ? (
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>
                      {leadInitials}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{deal.lead_name}</p>
                      {deal.lead_email && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{deal.lead_email}</p>}
                    </div>
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Unassigned</span>
                )}
              </div>
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Contact</p>
                <p className="text-sm">{deal.contact_name || deal.linked_contact_name || 'Unknown'}</p>
                {deal.contact_email && <p className="text-[10px]" style={{ color: 'var(--accent)' }}>{deal.contact_email}</p>}
                {deal.contact_phone && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{deal.contact_phone}</p>}
                {!deal.contact_name && deal.linked_contact_name && (
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {deal.linked_contact_org ? `${deal.linked_contact_org} · ` : ''}from relationship graph
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Gate strip — uses pipeline for correct sales-vs-grant gate names */}
          <div>
            <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              <span>G{deal.gate}: {gate?.name}</span>
              <span>G{pipeline.length}: {pipeline[pipeline.length - 1]?.name}</span>
            </div>
            <div className="flex gap-1.5">
              {pipeline.map((g) => (
                <div
                  key={g.number}
                  className="flex-1 h-3 rounded-full"
                  style={{
                    background: g.number < deal.gate ? 'var(--green)' : g.number === deal.gate ? 'var(--accent)' : 'var(--border)',
                  }}
                  title={`G${g.number}: ${g.name}`}
                />
              ))}
            </div>
          </div>

          {/* Field completion */}
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between text-xs mb-2">
              <span style={{ color: 'var(--text-muted)' }}>G2 Field Completion</span>
              <span>{filledRequired}/{totalRequired}</span>
            </div>
            <div className="w-full h-2.5 rounded-full" style={{ background: 'var(--border)' }}>
              <div
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: `${(filledRequired / totalRequired) * 100}%`,
                  background: filledRequired === totalRequired ? 'var(--green)' : 'var(--accent)',
                }}
              />
            </div>
            {deal.missing.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {deal.missing.map((f) => (
                  <span key={f} className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--red)', color: '#fff', opacity: 0.8 }}>
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Flags */}
          {deal.flags.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Flags & Signals
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {deal.flags.map((f, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded text-xs"
                    style={{
                      background: f.startsWith('sla_') || f.startsWith('decay_') ? 'var(--red)' : 'var(--bg-input)',
                      color: f.startsWith('sla_') || f.startsWith('decay_') ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${f.startsWith('sla_') || f.startsWith('decay_') ? 'var(--red)' : 'var(--border)'}`,
                    }}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pricing & Quotes panel (sales deals only) */}
          {deal.deal_type === 'sales' && (
            <div className="mb-6">
              <DealPricingPanel
                deal={{
                  id: deal.id,
                  company: deal.company,
                  contact_email: deal.contact_email,
                  fields: deal.fields,
                  currency: deal.currency,
                }}
              />
            </div>
          )}

          {/* Grant Stage 2 — signature handover, resources, reports, evidence.
              Panels appear only for grant deals; the resource/report/evidence
              trio unlocks once contract_signed_at is set. */}
          {deal.deal_type === 'grant' && (
            <div className="mb-6">
              <GrantStage2Panels deal={deal} users={users} onUpdate={reload} />
            </div>
          )}

          {/* Two-column: Timeline + Fields */}
          <div className="grid grid-cols-2 gap-6">
            {/* Activity Timeline */}
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Activity
              </h3>
              <Timeline dealId={deal.id} />
            </div>

            {/* Deal Fields */}
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Deal Fields
              </h3>
              {fieldKeys.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No fields captured yet</p>
              ) : (
                <div className="space-y-2">
                  {fieldKeys.map((key) => (
                    <div key={key} className="flex justify-between text-xs">
                      <span style={{ color: 'var(--text-muted)' }}>{key.replace(/_/g, ' ')}</span>
                      <span className="text-right ml-3 max-w-[60%] truncate">{String(fields[key])}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mount the Mark-as-Lost modal once at the page root so it can overlay
          everything. Hidden until `markLostOpen=true`. */}
      <MarkAsLostModal
        dealId={deal.id}
        dealName={deal.name}
        dealType={deal.deal_type}
        isOpen={markLostOpen}
        onClose={() => setMarkLostOpen(false)}
        onMarked={() => { reload(); }}
      />
    </div>
  );
}
