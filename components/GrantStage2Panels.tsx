'use client';

/**
 * Grant Stage-2 panels — rendered on /deals/[id] for grant deals only.
 *
 * Four logical panels in one file (they share deal_id + refresh handler
 * + one API layer):
 *   * HandoverPanel      — signature status + record-signature form
 *   * GrantResourcesPanel — money/credits/in-kind CRUD table
 *   * GrantReportsPanel   — report queue CRUD table
 *   * EvidencePanel      — one-glance view of every attached URL
 *
 * All writes go through `/api/grants/*` and `/api/deals/[id]/sign` which
 * proxy to the kernel — the browser never talks to the DB directly.
 * On any write we call `onUpdate?.()` so the parent (DealViewPage) can
 * refetch the deal (contract_signed_at changed, etc.).
 */

import { useCallback, useEffect, useState } from 'react';

// ─── shared types ────────────────────────────────────────────────────

interface Deal {
  id: string;
  name: string;
  company: string;
  lead_id: string | null;
  lead_name: string | null;
  deal_type: 'sales' | 'grant';
  fields: Record<string, unknown>;
  status?: string;
  gate: number;
}

// The migration adds these — server hydrates from the same query as before,
// so we just read them off the deal prop when present.
type Signable = Deal & { contract_signed_at?: string | null };

interface User { id: string; name: string; email: string }

interface Resource {
  id: string;
  deal_id: string;
  resource_type: string;
  activation_method: string | null;
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

interface Report {
  id: string;
  deal_id: string;
  report_type: string;
  title: string;
  due_at: string;
  status: string;
  submitted_at: string | null;
  accepted_at: string | null;
  evidence_url: string | null;
  notes: string | null;
}

const RESOURCE_TYPES = ['cash', 'reimbursement', 'credits', 'in_kind',
                        'direct_vendor', 'financing', 'other'] as const;
const RESOURCE_STATUSES = ['not_started', 'requested', 'partly_available',
                           'fully_available', 'fully_utilized', 'reconciled',
                           'returned', 'cancelled', 'expired'] as const;
const REPORT_TYPES = ['financial', 'narrative', 'impact', 'logframe', 'audit', 'other'] as const;
const REPORT_STATUSES = ['not_started', 'drafting', 'internal_review',
                         'submitted', 'accepted', 'overdue'] as const;
const RESOURCE_TERMINAL = new Set(
  ['fully_utilized', 'reconciled', 'returned', 'cancelled', 'expired'],
);

// ─── small style helpers ─────────────────────────────────────────────

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

function statusColor(status: string): string {
  if (['accepted', 'fully_utilized', 'reconciled'].includes(status)) return 'var(--green)';
  if (['overdue'].includes(status)) return 'var(--red)';
  if (['submitted', 'fully_available', 'internal_review'].includes(status)) return 'var(--blue, #3b82f6)';
  if (['drafting', 'partly_available', 'requested'].includes(status)) return 'var(--yellow)';
  return 'var(--text-muted)';
}

function pill(text: string, color: string) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

function fmtMoney(n: number | null | undefined, currency: string) {
  if (n === null || n === undefined) return '—';
  return `${currency} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// ─── HandoverPanel ────────────────────────────────────────────────────

function HandoverPanel({ deal, users, onUpdate }: {
  deal: Signable; users: User[]; onUpdate: () => void;
}) {
  const [signing, setSigning] = useState(false);
  // Default to today so the native date picker shows a real date instead
  // of the empty dd/mm/yyyy placeholder (which reads as a text field on
  // first glance). Users can still backdate via the picker or keyboard.
  const [signedAt, setSignedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newLeadId, setNewLeadId] = useState<string>(deal.lead_id ?? '');
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = {};
      if (signedAt) body.signed_at = new Date(signedAt).toISOString();
      if (newLeadId && newLeadId !== deal.lead_id) body.new_lead_id = newLeadId;
      if (reason.trim()) body.reason = reason.trim();
      const res = await fetch(`/api/deals/${deal.id}/sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setSigning(false); onUpdate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (deal.contract_signed_at) {
    return (
      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>📝 Grant Agreement</strong>
          {pill('SIGNED', 'var(--green)')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Signed <strong style={{ color: 'var(--text)' }}>{deal.contract_signed_at.slice(0, 10)}</strong>
          {' · '}Lead: <strong style={{ color: 'var(--text)' }}>{deal.lead_name || 'Unassigned'}</strong>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Grant is in Stage 2 — track resources + reports below.
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>📝 Grant Agreement</strong>
        {pill('NOT SIGNED', 'var(--yellow)')}
      </div>
      {!signing ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Once the agreement is countersigned, record it here to move to Stage 2 (Disbursement, Delivery &amp; Reporting).
            You can also hand the deal off to a new lead in the same step.
          </div>
          <button onClick={() => setSigning(true)} style={{
            background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
          }}>Record signature</button>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Signed on
            <input type="date" value={signedAt}
              onChange={(e) => setSignedAt(e.target.value)}
              style={{ ...inputStyle(), marginTop: 4, width: '100%' }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Assigned Person (optional handover)
            <select value={newLeadId} onChange={(e) => setNewLeadId(e.target.value)}
              style={{ ...inputStyle(), marginTop: 4, width: '100%' }}>
              <option value="">— unchanged —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Handover reason (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Hannes → Liliane for delivery"
              style={{ ...inputStyle(), marginTop: 4, width: '100%' }} />
          </label>
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={submit} style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}>{busy ? 'Recording…' : 'Confirm & sign'}</button>
            <button onClick={() => { setSigning(false); setErr(null); }} style={{
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 14px', fontSize: 13, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GrantResourcesPanel ─────────────────────────────────────────────

function ResourceRow({ r, onChange, onDelete }: {
  r: Resource; onChange: () => void; onDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Resource>>({});

  async function save() {
    setBusy(true);
    await fetch(`/api/grants/resources/${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setEditing(false); setForm({}); setBusy(false); onChange();
  }
  async function del() {
    if (!confirm('Delete this resource row?')) return;
    setBusy(true);
    await fetch(`/api/grants/resources/${r.id}`, { method: 'DELETE' });
    setBusy(false); onDelete();
  }

  const du = daysUntil(r.expected_at);
  const de = daysUntil(r.expires_at);
  const remaining = (r.received_amount || 0) - (r.utilized_amount || 0);
  const alert = (du !== null && du < 0 && !RESOURCE_TERMINAL.has(r.status)) ? 'overdue receipt'
              : (de !== null && de < 30 && remaining > 0) ? 'expiring soon' : null;

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: 8, fontSize: 12 }}>{r.resource_type}</td>
      <td style={{ padding: 8, fontSize: 12, whiteSpace: 'nowrap' }}>
        {editing ? (
          <select value={form.status ?? r.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inputStyle()}>
            {RESOURCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : pill(r.status, statusColor(r.status))}
      </td>
      <td style={{ padding: 8, fontSize: 12, textAlign: 'right' }}>
        {editing ? <input type="number" defaultValue={r.committed_amount ?? undefined}
          onChange={(e) => setForm({ ...form, committed_amount: Number(e.target.value) })}
          style={{ ...inputStyle(), width: 90, textAlign: 'right' }} /> : fmtMoney(r.committed_amount, r.currency)}
      </td>
      <td style={{ padding: 8, fontSize: 12, textAlign: 'right' }}>
        {editing ? <input type="number" defaultValue={r.received_amount}
          onChange={(e) => setForm({ ...form, received_amount: Number(e.target.value) })}
          style={{ ...inputStyle(), width: 90, textAlign: 'right' }} /> : fmtMoney(r.received_amount, r.currency)}
      </td>
      <td style={{ padding: 8, fontSize: 12, textAlign: 'right' }}>
        {editing ? <input type="number" defaultValue={r.utilized_amount}
          onChange={(e) => setForm({ ...form, utilized_amount: Number(e.target.value) })}
          style={{ ...inputStyle(), width: 90, textAlign: 'right' }} /> : fmtMoney(r.utilized_amount, r.currency)}
      </td>
      <td style={{ padding: 8, fontSize: 12, textAlign: 'right', color: remaining > 0 ? 'var(--yellow)' : 'var(--text-muted)' }}>
        {fmtMoney(remaining, r.currency)}
      </td>
      <td style={{ padding: 8, fontSize: 12, whiteSpace: 'nowrap' }}>
        {editing ? <input type="date" defaultValue={r.expected_at ?? ''}
          onChange={(e) => setForm({ ...form, expected_at: e.target.value })} style={inputStyle()} />
          : r.expected_at || '—'}
      </td>
      <td style={{ padding: 8, fontSize: 12, whiteSpace: 'nowrap' }}>
        {editing ? <input type="date" defaultValue={r.expires_at ?? ''}
          onChange={(e) => setForm({ ...form, expires_at: e.target.value })} style={inputStyle()} />
          : r.expires_at || '—'}
      </td>
      <td style={{ padding: 8, fontSize: 11 }}>
        {alert && pill(alert, 'var(--red)')}
      </td>
      <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {editing ? (
          <>
            <button onClick={save} disabled={busy}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4 }}>Save</button>
            <button onClick={() => { setEditing(false); setForm({}); }}
              style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)}
              style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4 }}>Edit</button>
            <button onClick={del} disabled={busy}
              style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>×</button>
          </>
        )}
      </td>
    </tr>
  );
}

function GrantResourcesPanel({ dealId }: { dealId: string }) {
  const [rows, setRows] = useState<Resource[]>([]);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<string>('cash');
  const [committed, setCommitted] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [expected, setExpected] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/grants/resources?deal_id=${dealId}`);
    if (!res.ok) return;
    const j = await res.json();
    setRows(j.resources || []);
  }, [dealId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function add() {
    setErr(null);
    const body: Record<string, unknown> = { deal_id: dealId, resource_type: type, currency };
    if (committed) body.committed_amount = Number(committed);
    if (expected) body.expected_at = expected;
    const res = await fetch(`/api/grants/resources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || `HTTP ${res.status}`); return;
    }
    setAdding(false); setCommitted(''); setExpected(''); refresh();
  }

  const totals = rows.reduce((acc, r) => ({
    committed: acc.committed + (Number(r.committed_amount) || 0),
    received: acc.received + (Number(r.received_amount) || 0),
    utilized: acc.utilized + (Number(r.utilized_amount) || 0),
  }), { committed: 0, received: 0, utilized: 0 });
  const primaryCurrency = rows[0]?.currency || 'USD';

  return (
    <div style={panelStyle()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>💰 Resources</strong>
        <button onClick={() => setAdding(!adding)} style={{
          background: 'transparent', color: 'var(--accent)',
          border: '1px solid var(--accent)', borderRadius: 6,
          padding: '4px 10px', fontSize: 12, cursor: 'pointer',
        }}>{adding ? 'Close' : '+ Add resource'}</button>
      </div>
      {adding && (
        <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg-input)', borderRadius: 6 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Type
              <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle(), marginTop: 2, display: 'block' }}>
                {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Committed
              <input type="number" value={committed} onChange={(e) => setCommitted(e.target.value)}
                placeholder="0" style={{ ...inputStyle(), width: 110, marginTop: 2, display: 'block' }} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Currency
              <input value={currency} onChange={(e) => setCurrency(e.target.value)}
                style={{ ...inputStyle(), width: 70, marginTop: 2, display: 'block' }} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Expected
              <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)}
                style={{ ...inputStyle(), marginTop: 2, display: 'block' }} />
            </label>
            <button onClick={add} style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}>Add</button>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{err}</div>}
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
          No resources tracked yet. Add cash tranches, credit lines, reimbursement claims, or in-kind support.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Committed</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Received</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Utilized</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Remaining</th>
                <th style={{ padding: 8 }}>Expected</th>
                <th style={{ padding: 8 }}>Expires</th>
                <th style={{ padding: 8 }}>Alert</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <ResourceRow key={r.id} r={r} onChange={refresh} onDelete={refresh} />)}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 500 }}>
                <td colSpan={2} style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>Totals</td>
                <td style={{ padding: 8, fontSize: 12, textAlign: 'right' }}>{fmtMoney(totals.committed, primaryCurrency)}</td>
                <td style={{ padding: 8, fontSize: 12, textAlign: 'right' }}>{fmtMoney(totals.received, primaryCurrency)}</td>
                <td style={{ padding: 8, fontSize: 12, textAlign: 'right' }}>{fmtMoney(totals.utilized, primaryCurrency)}</td>
                <td style={{ padding: 8, fontSize: 12, textAlign: 'right' }}>{fmtMoney(totals.committed - totals.utilized, primaryCurrency)}</td>
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── GrantReportsPanel ───────────────────────────────────────────────

function ReportRow({ r, onChange }: { r: Report; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function set(status: string) {
    setBusy(true);
    await fetch(`/api/grants/reports/${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBusy(false); onChange();
  }
  async function del() {
    if (!confirm('Delete this report?')) return;
    setBusy(true);
    await fetch(`/api/grants/reports/${r.id}`, { method: 'DELETE' });
    setBusy(false); onChange();
  }
  const du = daysUntil(r.due_at);
  const isOverdue = du !== null && du < 0 && r.status !== 'accepted';
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: 8, fontSize: 12 }}>{r.report_type}</td>
      <td style={{ padding: 8, fontSize: 12, fontWeight: 500 }}>{r.title}</td>
      <td style={{ padding: 8, fontSize: 12, whiteSpace: 'nowrap',
                   color: isOverdue ? 'var(--red)' : 'var(--text)' }}>
        {r.due_at}
        {du !== null && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
            ({du > 0 ? `in ${du}d` : du === 0 ? 'today' : `${-du}d overdue`})
          </span>
        )}
      </td>
      <td style={{ padding: 8, fontSize: 12 }}>{pill(r.status, statusColor(r.status))}</td>
      <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {r.status !== 'submitted' && r.status !== 'accepted' && (
          <button onClick={() => set('submitted')} disabled={busy}
            style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4 }}>Submitted</button>
        )}
        {r.status !== 'accepted' && (
          <button onClick={() => set('accepted')} disabled={busy}
            style={{ background: 'transparent', color: 'var(--green)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4 }}>Accepted</button>
        )}
        <button onClick={del} disabled={busy}
          style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>×</button>
      </td>
    </tr>
  );
}

function GrantReportsPanel({ dealId }: { dealId: string }) {
  const [rows, setRows] = useState<Report[]>([]);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<string>('financial');
  const [title, setTitle] = useState<string>('');
  const [due, setDue] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/grants/reports?deal_id=${dealId}`);
    if (!res.ok) return;
    const j = await res.json();
    setRows(j.reports || []);
  }, [dealId]);
  useEffect(() => { refresh(); }, [refresh]);

  async function add() {
    setErr(null);
    if (!title.trim() || !due) { setErr('Title and due date are required'); return; }
    const res = await fetch(`/api/grants/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: dealId, report_type: type, title: title.trim(), due_at: due }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || `HTTP ${res.status}`); return;
    }
    setAdding(false); setTitle(''); setDue(''); refresh();
  }

  return (
    <div style={panelStyle()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>📊 Reports</strong>
        <button onClick={() => setAdding(!adding)} style={{
          background: 'transparent', color: 'var(--accent)',
          border: '1px solid var(--accent)', borderRadius: 6,
          padding: '4px 10px', fontSize: 12, cursor: 'pointer',
        }}>{adding ? 'Close' : '+ Add report'}</button>
      </div>
      {adding && (
        <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg-input)', borderRadius: 6 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Type
              <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle(), marginTop: 2, display: 'block' }}>
                {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q1 Financial Report"
                style={{ ...inputStyle(), width: '100%', marginTop: 2, display: 'block' }} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Due
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
                style={{ ...inputStyle(), marginTop: 2, display: 'block' }} />
            </label>
            <button onClick={add} style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}>Add</button>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{err}</div>}
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
          No reports scheduled. Add financial, narrative, impact, logframe or audit reports with their due dates — you&apos;ll get Telegram reminders 14d / 7d / 1d / when overdue.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Title</th>
                <th style={{ padding: 8 }}>Due</th>
                <th style={{ padding: 8 }}>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <ReportRow key={r.id} r={r} onChange={refresh} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── EvidencePanel ───────────────────────────────────────────────────

function EvidencePanel({ dealId, evidenceRepo }: { dealId: string; evidenceRepo?: string }) {
  const [items, setItems] = useState<{ label: string; url: string; kind: string }[]>([]);
  useEffect(() => {
    (async () => {
      const [rres, rrep] = await Promise.all([
        fetch(`/api/grants/resources?deal_id=${dealId}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/grants/reports?deal_id=${dealId}`).then((r) => r.json()).catch(() => ({})),
      ]);
      const out: { label: string; url: string; kind: string }[] = [];
      for (const r of rres.resources || []) if (r.proof_url) out.push({
        label: `${r.resource_type} proof`, url: r.proof_url, kind: 'resource',
      });
      for (const r of rrep.reports || []) if (r.evidence_url) out.push({
        label: r.title, url: r.evidence_url, kind: 'report',
      });
      setItems(out);
    })();
  }, [dealId]);
  return (
    <div style={panelStyle()}>
      <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>📎 Evidence</strong>
      {evidenceRepo && (
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Canonical repository:</span>{' '}
          <a href={evidenceRepo} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{evidenceRepo}</a>
        </div>
      )}
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          No proof URLs attached yet. Add proof_url on resources and evidence_url on reports.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
          {items.map((it, i) => (
            <li key={i} style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>[{it.kind}]</span>
              <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{it.label}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── wrapper ─────────────────────────────────────────────────────────

export default function GrantStage2Panels({
  deal, users, onUpdate,
}: { deal: Signable; users: User[]; onUpdate: () => void }) {
  if (deal.deal_type !== 'grant') return null;
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      <HandoverPanel deal={deal} users={users} onUpdate={onUpdate} />
      {deal.contract_signed_at && (
        <>
          <GrantResourcesPanel dealId={deal.id} />
          <GrantReportsPanel dealId={deal.id} />
          <EvidencePanel dealId={deal.id}
            evidenceRepo={typeof deal.fields?.evidence_repository === 'string'
              ? (deal.fields.evidence_repository as string) : undefined} />
        </>
      )}
    </div>
  );
}
