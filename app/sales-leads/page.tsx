'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface SalesLead {
  id: string;
  full_name: string;
  company: string;
  email: string;
  description: string | null;
  source: string;
  status: 'new' | 'contacted' | 'converted' | 'archived';
  created_at: string;
  converted_at: string | null;
  converted_deal_id: string | null;
  converted_deal_name: string | null;
  converted_deal_gate: number | null;
  website: string | null;                   // From Calendly's "Website" custom question
  // Preferred demo time captured from zeami.io's "Request Demo" form.
  // All three optional — old leads + non-demo submissions have these null.
  preferred_demo_date: string | null;       // YYYY-MM-DD (pg DATE → string)
  preferred_demo_time: string | null;       // HH:MM:SS  (pg TIME → string)
  preferred_demo_timezone: string | null;   // IANA, e.g. 'Africa/Nairobi'

  // Calendly booking columns — populated by /api/public/calendly-webhook
  // once the prospect actually books a slot. On Calendly Free (webhooks
  // gated) these stay NULL — the row still shows the preferred_demo_*
  // fallback line.
  calendly_event_uuid: string | null;
  meet_link: string | null;
  reschedule_url: string | null;
  cancel_url: string | null;
  booked_at: string | null;                 // ISO 8601 UTC of the confirmed slot
  booking_status: 'scheduled' | 'canceled' | 'no_show' | null;
}

/**
 * Format an absolute UTC timestamp as a slot label in the prospect's
 * preferred timezone. Used to render `booked_at` in a human-friendly way
 * that respects where the prospect actually is.
 */
function formatBookedTime(lead: SalesLead): string | null {
  if (!lead.booked_at) return null;
  const d = new Date(lead.booked_at);
  if (isNaN(d.getTime())) return null;
  const tz = lead.preferred_demo_timezone || 'UTC';
  try {
    const dateFmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: tz,
    });
    const timeFmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: tz,
    });
    return `${dateFmt.format(d)} · ${timeFmt.format(d)} · ${tz}`;
  } catch {
    return lead.booked_at;
  }
}

/**
 * Render the preferred demo line — preserves the prospect's local time.
 * Example: "Thu, Jun 18 2026 · 9:00 AM · Africa/Nairobi"
 *
 * The trick: we have date + time as wall-clock values in the prospect's tz.
 * We compose them as a "fake UTC" Date, then ask Intl.DateTimeFormat to
 * render IN that tz. Since Intl treats the Date as UTC and shifts to the
 * target tz, we have to pre-shift by inserting "Z" — i.e. treat the
 * composed wall-clock string as if it were already UTC. That way the
 * formatter doesn't re-apply the rep's local offset.
 */
function formatDemoTime(lead: SalesLead): string | null {
  if (!lead.preferred_demo_date) return null;
  const timeRaw = lead.preferred_demo_time || '00:00:00';
  const time = timeRaw.length === 5 ? `${timeRaw}:00` : timeRaw;
  const tz = lead.preferred_demo_timezone || 'UTC';
  try {
    // Treat the composed wall-clock string as UTC. Intl will then render
    // it AT `tz` — and since both sides use the same wall-clock numbers,
    // the rendered output equals the prospect's intended local time.
    const date = new Date(`${lead.preferred_demo_date}T${time}Z`);
    if (isNaN(date.getTime())) return null;
    const dateFmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      timeZone: 'UTC',
    });
    const timeFmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit',
      timeZone: 'UTC',
    });
    return `${dateFmt.format(date)} · ${timeFmt.format(date)} · ${tz}`;
  } catch {
    return `${lead.preferred_demo_date} · ${lead.preferred_demo_time || '?'} · ${tz}`;
  }
}

type StatusFilter = 'new' | 'contacted' | 'converted' | 'archived' | 'all';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'converted', label: 'Converted' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

const statusColor: Record<SalesLead['status'], string> = {
  new: 'var(--accent)',
  contacted: '#eab308',
  converted: 'var(--green)',
  archived: 'var(--text-muted)',
};

export default function SalesLeadsPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('new');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales-leads?status=${filter}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: 'contacted' | 'archived' | 'new') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sales-leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Update failed');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function convert(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/sales-leads/${id}/convert`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Convert failed');
      // Hop straight into the new deal — they'll want to triage in chat.
      window.location.href = `/deals/${data.deal_id}`;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Convert failed');
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Sales Leads</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Demo-request submissions from zeami.io and other intake forms. Convert promising ones to a sales deal at G1.
          </p>
        </div>

        <div className="p-4">
          {/* Filter chips */}
          <div className="flex gap-2 mb-4">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: filter === f.key ? 'var(--accent)' : 'var(--bg-input)',
                  color: filter === f.key ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : leads.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {filter === 'new'
                  ? 'No new leads. Submissions to zeami.io\'s demo form will show up here.'
                  : `No ${filter} leads.`}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {leads.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg p-4"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `3px solid ${statusColor[l.status]}` }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold truncate">{l.full_name}</h3>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>·</span>
                        <span className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{l.company}</span>
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: `${statusColor[l.status]}20`, color: statusColor[l.status] }}
                        >
                          {l.status}
                        </span>
                        {/* Booking status pill — separate from lead status.
                            Only appears when Calendly webhook has fired
                            (scheduled or canceled). No pill = not booked. */}
                        {l.booking_status === 'scheduled' && (
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                          >
                            Scheduled
                          </span>
                        )}
                        {l.booking_status === 'canceled' && (
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                          >
                            Canceled
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        <a href={`mailto:${l.email}`} className="hover:underline">{l.email}</a>
                        {l.website && (
                          <>
                            {' · '}
                            <a
                              href={l.website.startsWith('http') ? l.website : `https://${l.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                              style={{ color: 'var(--accent)' }}
                            >
                              {l.website.replace(/^https?:\/\//, '')}
                            </a>
                          </>
                        )}
                        <span> · {l.source} · {new Date(l.created_at).toLocaleString()}</span>
                      </p>
                      {/* Booking card — takes priority over the preferred-time
                          fallback when a real slot has been booked. */}
                      {l.booking_status === 'scheduled' && (() => {
                        const bookedLine = formatBookedTime(l);
                        return (
                          <div
                            className="mt-2 rounded p-2 text-xs"
                            style={{
                              background: 'rgba(34,197,94,0.08)',
                              border: '1px solid rgba(34,197,94,0.3)',
                              color: 'var(--text)',
                            }}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <span>✅</span>
                              <strong style={{ color: '#22c55e' }}>Booked demo:</strong>
                              <span>{bookedLine || 'time TBD'}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {l.meet_link && (
                                <a
                                  href={l.meet_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2 py-1 rounded text-[11px] font-medium text-white"
                                  style={{ background: '#22c55e' }}
                                >
                                  Join meeting →
                                </a>
                              )}
                              {l.reschedule_url && (
                                <a
                                  href={l.reschedule_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2 py-1 rounded text-[11px] font-medium"
                                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                                >
                                  Prospect reschedule link
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      {/* Preferred-time fallback — shown when Calendly hasn't
                          confirmed a slot yet. Once Standard is enabled and
                          the webhook fires, this line is replaced by the
                          booking card above. */}
                      {l.booking_status !== 'scheduled' && (() => {
                        const demoLine = formatDemoTime(l);
                        return demoLine ? (
                          <p
                            className="text-xs mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded"
                            style={{ background: 'rgba(34,211,238,0.1)', color: 'var(--text)', border: '1px solid rgba(34,211,238,0.25)' }}
                          >
                            <span style={{ color: '#22d3ee' }}>📅</span>
                            <span><strong>Preferred demo:</strong> {demoLine}</span>
                          </p>
                        ) : null;
                      })()}
                      {l.description && (
                        <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
                          {l.description}
                        </p>
                      )}
                      {l.converted_deal_id && (
                        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                          → Converted to{' '}
                          <Link href={`/deals/${l.converted_deal_id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                            {l.converted_deal_name || 'deal'} (G{l.converted_deal_gate ?? '?'})
                          </Link>
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {l.status !== 'converted' && (
                        <button
                          onClick={() => convert(l.id)}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
                          style={{ background: 'var(--accent)' }}
                        >
                          {busyId === l.id ? '…' : 'Convert to deal'}
                        </button>
                      )}
                      {l.status === 'new' && (
                        <button
                          onClick={() => setStatus(l.id, 'contacted')}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        >
                          Mark contacted
                        </button>
                      )}
                      {l.status !== 'archived' && l.status !== 'converted' && (
                        <button
                          onClick={() => setStatus(l.id, 'archived')}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                        >
                          Archive
                        </button>
                      )}
                      {l.status === 'archived' && (
                        <button
                          onClick={() => setStatus(l.id, 'new')}
                          disabled={busyId === l.id}
                          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
