'use client';

import { useEffect, useState } from 'react';

/**
 * The relationship graph, as a status strip plus a browsable list of the
 * strongest first-hop connections.
 *
 * The list is the point: edge strength is a formula with tunable constants, and
 * the only way to know whether it is calibrated is to look at the top of it and
 * recognise the people there.
 */

interface GraphEdge {
  source: string;
  strength: number;
  direction: string;
  last_signal_at: string | null;
  evidence: Record<string, unknown> | null;
  person_id: string;
  full_name: string;
  organization: string | null;
  primary_email: string | null;
}

interface GraphPayload {
  totals: { edges: number; people: number };
  by_source: { source: string; edges: number; people: number; avg_strength: number; newest: string | null }[];
  contacts: { contacts: number; bridged: number; dated: number };
  sync: {
    phase: string; relations_pages_done: number; relations_seen: number;
    mirror_completed_at: string | null; last_run_at: string | null; last_error: string | null;
  } | null;
  edges: GraphEdge[];
}

const SOURCE_LABELS: Record<string, string> = {
  linkedin_csv: 'Imported connections',
  linkedin_relation: 'LinkedIn 1st degree',
  linkedin_thread: 'LinkedIn conversations',
  email_thread: 'Email',
  intro_confirmed: 'Confirmed intros',
  manual: 'Added by hand',
};

function ago(iso: string | null): string {
  if (!iso) return 'no date';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function evidenceText(e: GraphEdge): string {
  const ev = e.evidence || {};
  const theirs = Number(ev.their_messages ?? 0);
  const total = Number(ev.messages ?? 0);
  if (total) {
    return theirs
      ? `${total} messages, ${theirs} from them`
      : `${total} messages, none back yet`;
  }
  if (ev.connected_on) return `connected ${String(ev.connected_on)}`;
  return SOURCE_LABELS[e.source] || e.source;
}

export default function GraphPanel() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/graph?edges=100${source ? `&source=${source}` : ''}`);
      if (res.ok) setData(await res.json());
    } catch { /* the strip is decoration; a failed load must not break /network */ }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source]);

  async function sync() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/graph/sync', { method: 'POST' });
      const json = await res.json();
      setNote(res.ok ? (json.note || 'Queued — the agent picks it up on its next tick.')
                     : (json.error || 'Could not queue a sync'));
      await load();
    } catch {
      setNote('Could not queue a sync');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  const { totals, by_source, contacts, sync: state } = data;
  const mirror = state?.phase === 'mirror_complete'
    ? 'LinkedIn mirror complete'
    : state?.relations_seen
      ? `LinkedIn mirror ${state.relations_seen} connections over ${state.relations_pages_done} page(s)`
      : 'LinkedIn mirror not started';

  return (
    <div className="border-b" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs">
        <button
          onClick={() => setOpen((v) => !v)}
          className="font-medium"
          style={{ color: 'var(--text)' }}
        >
          {open ? '▾' : '▸'} Relationship graph
        </button>
        <span style={{ color: 'var(--text-muted)' }}>
          {totals.people.toLocaleString()} people · {totals.edges.toLocaleString()} connections
          {by_source.length > 0 && ` · ${by_source.length} sources`}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>{mirror}</span>
        {contacts.contacts > 0 && (
          <span style={{ color: 'var(--text-muted)' }}>
            {contacts.bridged.toLocaleString()}/{contacts.contacts.toLocaleString()} contacts bridged
          </span>
        )}
        <button
          onClick={sync}
          disabled={busy}
          className="ml-auto rounded px-2 py-1"
          style={{ background: 'var(--bg-input)', color: 'var(--text)', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Queueing…' : 'Rebuild'}
        </button>
      </div>

      {note && (
        <div className="px-4 pb-2 text-xs" style={{ color: 'var(--text-muted)' }}>{note}</div>
      )}

      {open && (
        <div className="px-4 pb-3">
          <div className="mb-2 flex flex-wrap gap-1">
            <button
              onClick={() => setSource(null)}
              className="rounded px-2 py-0.5 text-xs"
              style={{
                background: source === null ? 'var(--accent)' : 'var(--bg-input)',
                color: source === null ? '#fff' : 'var(--text-muted)',
              }}
            >
              All
            </button>
            {by_source.map((s) => (
              <button
                key={s.source}
                onClick={() => setSource(s.source)}
                className="rounded px-2 py-0.5 text-xs"
                style={{
                  background: source === s.source ? 'var(--accent)' : 'var(--bg-input)',
                  color: source === s.source ? '#fff' : 'var(--text-muted)',
                }}
              >
                {SOURCE_LABELS[s.source] || s.source} ({s.edges.toLocaleString()})
              </button>
            ))}
          </div>

          {data.edges.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              No connections yet. Upload your LinkedIn Connections.csv on the Imports tab, connect
              Google, or connect LinkedIn — then hit Rebuild.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded" style={{ background: 'var(--bg-card)' }}>
              <table className="w-full text-xs">
                <tbody>
                  {data.edges.map((e) => (
                    <tr key={`${e.person_id}-${e.source}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="w-12 px-3 py-1.5 font-mono" style={{ color: 'var(--accent)' }}>
                        {e.strength.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: 'var(--text)' }}>
                        {e.full_name}
                        {e.organization && (
                          <span style={{ color: 'var(--text-muted)' }}> · {e.organization}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                        {evidenceText(e)}
                      </td>
                      <td className="w-20 px-3 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>
                        {ago(e.last_signal_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
