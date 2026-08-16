'use client';

/**
 * AI-credit Stage-2 panel — rendered on /deals/[id] for ai_credit deals.
 *
 * Simpler than GrantStage2Panels: credits don't have signing ceremony,
 * multi-report calendars, or handover flow. What matters is:
 *   * Which provider + program + applicant entity (chipchip / zeami / both)
 *   * The single credit balance (committed / received / utilized / remaining)
 *   * Expiration date + days-until (color coded)
 *   * Application URL + notes
 *
 * The underlying grant_resources row is fetched via the same /api/grants/
 * resources?deal_id endpoint the grant panel uses (relaxed guard admits
 * ai_credit deals since kernel migration 031).
 */

import { useCallback, useEffect, useState } from 'react';

interface Deal {
  id: string;
  name: string;
  company: string;
  deal_type: 'sales' | 'grant' | 'ai_credit';
  applicant_entity?: 'chipchip' | 'zeami' | 'both' | null;
  fields: Record<string, unknown>;
}

interface Resource {
  id: string;
  deal_id: string;
  resource_type: string;
  provider: string | null;
  committed_amount: number | null;
  received_amount: number;
  utilized_amount: number;
  units_label: string | null;
  currency: string;
  expected_at: string | null;
  expires_at: string | null;
  status: string;
  proof_url: string | null;
  notes: string | null;
}

function panelStyle() {
  return {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 16,
  } as const;
}

function inputStyle() {
  return {
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 8px',
    color: 'var(--text)',
    fontSize: 13,
  } as const;
}

function pill(text: string, color: string) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 500,
    }}>{text}</span>
  );
}

function fmtMoney(n: number | null | undefined, currency: string, units?: string | null) {
  if (n === null || n === undefined) return '—';
  const value = Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return units ? `${value} ${units}` : `${currency} ${value}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

const APPLICANT_LABEL: Record<string, string> = {
  chipchip: 'ChipChip', zeami: 'Zeami', both: 'ChipChip + Zeami',
};

export default function AiCreditPanel({ deal }: { deal: Deal }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/grants/resources?deal_id=${deal.id}`);
    if (!res.ok) { setLoading(false); return; }
    const j = await res.json();
    setResources(j.resources || []);
    setLoading(false);
  }, [deal.id]);
  useEffect(() => { refresh(); }, [refresh]);

  // A credit deal usually has exactly one resource row (the credit balance).
  // If the operator adds multiples we sum them for the header + let the
  // per-row table show details.
  const primary = resources[0];
  const totals = resources.reduce(
    (a, r) => ({
      committed: a.committed + (Number(r.committed_amount) || 0),
      received: a.received + (Number(r.received_amount) || 0),
      utilized: a.utilized + (Number(r.utilized_amount) || 0),
    }),
    { committed: 0, received: 0, utilized: 0 },
  );
  const remaining = totals.received - totals.utilized;
  const currency = primary?.currency || 'USD';
  const units = primary?.units_label ?? null;
  const provider = primary?.provider || (deal.fields?.provider as string) || 'Unknown';
  const program = (deal.fields?.credit_program_name as string) || deal.name;
  const applicant = deal.applicant_entity ? APPLICANT_LABEL[deal.applicant_entity] : '—';
  const expiresAt = resources.reduce<string | null>((min, r) => {
    if (!r.expires_at) return min;
    return !min || r.expires_at < min ? r.expires_at : min;
  }, null);
  const du = daysUntil(expiresAt);
  const expiryColor = du === null ? 'var(--text-muted)'
                    : du < 0 ? 'var(--red)'
                    : du <= 30 ? 'var(--orange)'
                    : du <= 90 ? 'var(--yellow)' : 'var(--green)';
  const utilizedRatio = totals.received > 0 ? Math.min(1, totals.utilized / totals.received) : 0;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Header — provider + program + applicant */}
      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              ⚡ AI Credit
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{provider}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{program}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {pill(`Applied as: ${applicant}`, 'var(--accent)')}
          </div>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading credit balance…</div>
        ) : resources.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No credit balance attached yet. Add one via the resources table below when the credit is activated.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
              <Stat label="Received" value={fmtMoney(totals.received, currency, units)} />
              <Stat label="Utilized" value={fmtMoney(totals.utilized, currency, units)} />
              <Stat label="Remaining" value={fmtMoney(remaining, currency, units)}
                    color={remaining <= 0 ? 'var(--text-muted)' : 'var(--green)'} />
              <Stat label="Expires" value={expiresAt || '—'}
                    sub={du === null ? undefined
                        : du < 0 ? `${-du}d ago`
                        : du === 0 ? 'today'
                        : `in ${du}d`}
                    color={expiryColor} />
            </div>
            {/* Utilization bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${utilizedRatio * 100}%`, height: '100%',
                              background: utilizedRatio >= 0.9 ? 'var(--green)' : 'var(--accent)' }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {Math.round(utilizedRatio * 100)}% used
              </span>
            </div>
          </>
        )}
      </div>

      {/* Compact resource table — reuse the same shape as grants, but simpler */}
      <ResourceTable dealId={deal.id} rows={resources} onChange={refresh} />
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function ResourceTable({ dealId, rows, onChange }: {
  dealId: string; rows: Resource[]; onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [committed, setCommitted] = useState('');
  const [received, setReceived] = useState('');
  const [expires, setExpires] = useState('');
  const [provider, setProvider] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function addResource() {
    setErr(null);
    const body: Record<string, unknown> = {
      deal_id: dealId,
      resource_type: 'credits',
      status: 'fully_available',
    };
    if (committed) body.committed_amount = Number(committed);
    if (received) body.received_amount = Number(received);
    if (expires) body.expires_at = expires;
    if (provider) body.provider = provider;
    const res = await fetch('/api/grants/resources', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || `HTTP ${res.status}`); return;
    }
    setAdding(false); setCommitted(''); setReceived(''); setExpires(''); setProvider('');
    onChange();
  }

  async function updateUtilized(id: string, utilized: number) {
    await fetch(`/api/grants/resources/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utilized_amount: utilized }),
    });
    onChange();
  }

  return (
    <div style={panelStyle()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>💰 Balance details</strong>
        <button onClick={() => setAdding(!adding)} style={{
          background: 'transparent', color: 'var(--accent)',
          border: '1px solid var(--accent)', borderRadius: 6,
          padding: '4px 10px', fontSize: 12, cursor: 'pointer',
        }}>{adding ? 'Close' : '+ Add balance line'}</button>
      </div>
      {adding && (
        <div style={{ padding: 10, background: 'var(--bg-input)', borderRadius: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Provider
              <input value={provider} onChange={(e) => setProvider(e.target.value)}
                placeholder="Google Cloud" style={{ ...inputStyle(), marginTop: 2, display: 'block', width: 130 }} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Committed
              <input type="number" value={committed} onChange={(e) => setCommitted(e.target.value)}
                style={{ ...inputStyle(), width: 100, marginTop: 2, display: 'block' }} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Received
              <input type="number" value={received} onChange={(e) => setReceived(e.target.value)}
                style={{ ...inputStyle(), width: 100, marginTop: 2, display: 'block' }} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Expires
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)}
                style={{ ...inputStyle(), marginTop: 2, display: 'block' }} />
            </label>
            <button onClick={addResource} style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}>Add</button>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{err}</div>}
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          No balance lines yet. For a straight backfill (e.g. Google $100K received), one line captures the full picture.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                <th style={{ padding: 6 }}>Provider</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Committed</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Received</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Utilized (editable)</th>
                <th style={{ padding: 6 }}>Expires</th>
                <th style={{ padding: 6 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>{r.provider || '—'}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(r.committed_amount, r.currency, r.units_label)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(r.received_amount, r.currency, r.units_label)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <input type="number" defaultValue={r.utilized_amount}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== r.utilized_amount) updateUtilized(r.id, v);
                      }}
                      style={{ ...inputStyle(), width: 100, textAlign: 'right' }} />
                  </td>
                  <td style={{ padding: 6 }}>{r.expires_at || '—'}</td>
                  <td style={{ padding: 6 }}>{pill(r.status, 'var(--text-muted)')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
