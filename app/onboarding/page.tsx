'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { STAGES } from '@/lib/onboarding';

interface OnboardingCard {
  id: string;
  deal_id: string;
  pm_user_id: string | null;
  pm_name: string | null;
  stage: number;
  status: 'in_progress' | 'completed' | 'paused';
  company_name: string;
  deal_company: string | null;
  updated_at: string;
  created_at: string;
  // For "days in stage"
  stage1_completed_at: string | null;
  stage2_completed_at: string | null;
  stage3_completed_at: string | null;
  stage4_completed_at: string | null;
  stage5_completed_at: string | null;
  stage6_completed_at: string | null;
  stage7_completed_at: string | null;
  stage8_completed_at: string | null;
}

interface WonDeal {
  id: string;
  name: string;
  company: string;
}

export default function OnboardingPage() {
  const [rows, setRows] = useState<OnboardingCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/onboardings');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setRows(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Client Onboarding</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {rows.length} client{rows.length === 1 ? '' : 's'} — won deals (G9) flow here automatically
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#0b1220' }}
          >
            Start onboarding
          </button>
        </header>

        {loading && <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {error && <p className="p-4 text-sm" style={{ color: '#fb7185' }}>{error}</p>}

        {!loading && rows.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <p style={{ color: 'var(--text)' }}>No clients onboarding yet.</p>
              <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                When a sales deal reaches G9, an onboarding will appear here automatically.<br />
                You can also start one manually for any won deal.
              </p>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="p-4 overflow-x-auto flex-1">
            <div className="flex gap-3 h-full" style={{ minWidth: STAGES.length * 280 }}>
              {STAGES.map((stage) => {
                const stageRows = rows.filter((r) => r.stage === stage.number);
                return (
                  <div
                    key={stage.number}
                    className="flex-1 flex flex-col rounded-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 260 }}
                  >
                    <div
                      className="px-3 py-2 rounded-t-lg flex items-center justify-between"
                      style={{ background: stage.color, color: '#fff' }}
                    >
                      <div>
                        <p className="text-[10px] uppercase tracking-wider opacity-80">Stage {stage.number}</p>
                        <p className="text-sm font-semibold">{stage.name}</p>
                      </div>
                      <span className="text-xs font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(0,0,0,0.2)' }}>
                        {stageRows.length}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {stageRows.map((r) => <OnboardingCardView key={r.id} row={r} />)}
                      {stageRows.length === 0 && (
                        <p className="text-xs text-center pt-3" style={{ color: 'var(--text-muted)' }}>—</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      </div>
    </div>
  );
}

function OnboardingCardView({ row }: { row: OnboardingCard }) {
  // Compute days-in-stage from the previous stage's completion timestamp.
  const stageEnteredAt =
    row.stage > 1
      ? (row[`stage${(row.stage - 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7}_completed_at`] as string | null) ?? row.created_at
      : row.created_at;
  const days = stageEnteredAt
    ? Math.floor((Date.now() - Date.parse(stageEnteredAt)) / 86400_000)
    : 0;
  const isCompleted = row.status === 'completed';

  return (
    <Link
      href={`/onboarding/${row.id}`}
      className="block rounded p-2 hover:bg-white/5 transition-colors"
      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
    >
      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }} title={row.company_name}>
        {row.company_name}
      </p>
      <div className="flex items-center justify-between mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span className="truncate" title={row.pm_name ?? ''}>
          PM: {row.pm_name || 'Unassigned'}
        </span>
        <span style={{ color: days > 7 ? '#fb7185' : 'var(--text-muted)' }}>
          {isCompleted ? '✓ Done' : `${days}d`}
        </span>
      </div>
    </Link>
  );
}

// ─── Create modal: pick a won (G9) sales deal ───────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [deals, setDeals] = useState<WonDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Reuse /api/deals; filter to won sales deals on the client.
        const res = await fetch('/api/deals');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed');
        const filtered = (json as Array<{ id: string; name: string; company: string; gate: number; deal_type?: string }>)
          .filter((d) => d.gate === 9 && (d.deal_type ?? 'sales') === 'sales');
        setDeals(filtered);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function create(deal_id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/onboardings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center z-30" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg p-4 w-[480px] max-h-[80vh] flex flex-col" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Start onboarding</h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Pick a won (G9) sales deal. The onboarding row will auto-prefill from the deal's company info.
        </p>
        {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading deals…</p>}
        {error && <p className="text-sm" style={{ color: '#fb7185' }}>{error}</p>}
        {!loading && deals.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No won sales deals available — onboardings can only start once a deal reaches G9.
          </p>
        )}
        <div className="flex-1 overflow-y-auto space-y-1">
          {deals.map((d) => (
            <button
              key={d.id}
              onClick={() => create(d.id)}
              disabled={busy}
              className="w-full text-left p-2 rounded border hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <p className="text-sm font-medium">{d.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.company}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
