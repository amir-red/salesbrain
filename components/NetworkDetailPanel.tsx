'use client';

import { useState } from 'react';
import type { GraphNode } from '@/lib/network-graph';

interface Props {
  node: GraphNode | null;
  onClose: () => void;
  onUpdate?: () => void;        // re-fetch graph after a change
}

function relativeDays(iso: string | null): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const days = Math.floor((Date.now() - t) / 86400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function NetworkDetailPanel({ node, onClose, onUpdate }: Props) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (!node) return null;

  const meta = node.metadata as Record<string, unknown>;

  async function markContacted() {
    if (!node || node.type !== 'contact') return;
    const contactId = meta.contact_id as string;
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_contacted: true }),
      });
      if (res.ok) {
        setToast('Marked as contacted');
        onUpdate?.();
      } else setToast('Failed to update');
    } catch { setToast('Network error'); }
    finally { setBusy(false); setTimeout(() => setToast(null), 2500); }
  }

  async function scheduleFollowup() {
    if (!node || node.type !== 'contact') return;
    const dealId = meta.deal_id as string | null;
    if (!dealId) {
      setToast('Need a linked deal to schedule a followup');
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const days = parseInt(prompt('Follow up in how many days?', '3') || '0', 10);
    if (!days || days < 1) return;
    const due_at = new Date(Date.now() + days * 86400_000).toISOString();
    const subject = `Follow up: ${meta.full_name ?? ''}`;
    const body = `Quick follow up with ${meta.full_name ?? 'contact'} at ${meta.company ?? 'their company'}.`;
    setBusy(true);
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: dealId,
          type: 'reminder',
          subject,
          body,
          to_email: meta.email ?? undefined,
          due_at,
        }),
      });
      if (res.ok) setToast(`Followup scheduled in ${days}d`);
      else setToast('Failed to schedule');
    } catch { setToast('Network error'); }
    finally { setBusy(false); setTimeout(() => setToast(null), 2500); }
  }

  return (
    <aside
      className="absolute top-0 right-0 h-full w-[340px] flex flex-col border-l overflow-y-auto"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <header className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {node.type}
        </div>
        <button
          onClick={onClose}
          className="text-xl leading-none"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close"
        >×</button>
      </header>

      <div className="p-4 space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>{node.label}</h2>

        {node.type === 'contact' && (
          <ContactDetails meta={meta} />
        )}
        {node.type === 'account' && (
          <AccountDetails meta={meta} />
        )}
        {(node.type === 'industry' || node.type === 'location') && (
          <ClusterDetails type={node.type} label={node.label} />
        )}

        {node.type === 'contact' && (
          <div className="space-y-2 pt-3 mt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</p>
            <ActionRow>
              <ActionLink
                href={
                  meta.deal_id
                    ? `/?deal=${meta.deal_id}`
                    : meta.prospect_id
                    ? `/prospects/${meta.prospect_id}`
                    : null
                }
                label="Open chat"
              />
              <ActionLink
                href={meta.account_id ? `/accounts/${meta.account_id}` : null}
                label="View account"
              />
            </ActionRow>
            <ActionRow>
              <ActionButton onClick={markContacted} disabled={busy} label="Mark contacted" />
              <ActionButton onClick={scheduleFollowup} disabled={busy} label="Schedule followup" />
            </ActionRow>
            <ActionRow>
              <ActionLink
                href={
                  meta.deal_id
                    ? `/?deal=${meta.deal_id}&prefill=${encodeURIComponent(`Draft a first-touch cold email for ${meta.full_name ?? 'this contact'}`)}`
                    : null
                }
                label="Generate outreach"
              />
              {meta.linkedin_url ? (
                <ActionLink href={meta.linkedin_url as string} label="LinkedIn" external />
              ) : (
                <ActionButton onClick={() => {}} disabled label="LinkedIn" />
              )}
            </ActionRow>
          </div>
        )}

        {toast && (
          <div className="mt-3 p-2 rounded text-xs" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
            {toast}
          </div>
        )}
      </div>
    </aside>
  );
}

function ContactDetails({ meta }: { meta: Record<string, unknown> }) {
  return (
    <dl className="space-y-2 text-sm">
      <Field label="Title" value={meta.title as string | null} />
      <Field label="Company" value={meta.company as string | null} />
      <Field label="Industry" value={meta.industry as string | null} />
      <Field label="Location" value={meta.location as string | null} />
      <Field label="Email" value={meta.email as string | null} />
      <Field label="Phone" value={meta.phone as string | null} />
      <Field label="Last contact" value={relativeDays((meta.last_contacted_at as string | null) ?? null)} />
      <Field label="Messages" value={String(meta.msg_count ?? 0)} />
      {meta.prospect_stage ? <Field label="Prospect stage" value={meta.prospect_stage as string} /> : null}
      {meta.deal_gate ? <Field label="Deal gate" value={`G${meta.deal_gate}`} /> : null}
      {meta.notes ? <Field label="Notes" value={meta.notes as string} multiline /> : null}
    </dl>
  );
}

function AccountDetails({ meta }: { meta: Record<string, unknown> }) {
  return (
    <dl className="space-y-2 text-sm">
      <Field label="Industry" value={meta.industry as string | null} />
      <Field label="Location" value={meta.location as string | null} />
      <Field label="Domain" value={meta.domain as string | null} />
      <Field label="Size" value={meta.company_size as string | null} />
      <Field label="Contacts" value={String(meta.contact_count ?? 0)} />
    </dl>
  );
}

function ClusterDetails({ type, label }: { type: string; label: string }) {
  return (
    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
      Cluster node — represents the {type} <strong style={{ color: 'var(--text)' }}>{label}</strong>. Connected accounts and contacts orbit around it.
    </p>
  );
}

function Field({ label, value, multiline }: { label: string; value: string | null; multiline?: boolean }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <dt className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd
        className={multiline ? 'whitespace-pre-wrap' : 'truncate'}
        style={{ color: 'var(--text)' }}
        title={value ?? undefined}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}
function ActionLink({ href, label, external }: { href: string | null; label: string; external?: boolean }) {
  if (!href) return <ActionButton onClick={() => {}} disabled label={label} />;
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="flex-1 text-center px-2 py-1.5 rounded border text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
    >
      {label}
    </a>
  );
}
function ActionButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 px-2 py-1.5 rounded border text-xs disabled:opacity-40"
      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
    >
      {label}
    </button>
  );
}
