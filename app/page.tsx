'use client';

import { useState, useEffect, useCallback } from 'react';
import Chat from '@/components/Chat';
import DealPanel from '@/components/DealPanel';
import Sidebar from '@/components/Sidebar';
import { GATES } from '@/lib/gates';

interface Deal {
  id: string;
  name: string;
  company: string;
  gate: number;
  score: number | null;
  risk: string | null;
  verdict: string | null;
  value: number | null;
  currency: string;
  contact_name: string | null;
  contact_email: string | null;
  owner: string | null;
  missing: string[];
  flags: string[];
  fields: Record<string, unknown>;
  gate_entered_at: string;
  created_at: string;
}

export default function Home() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [newDealName, setNewDealName] = useState('');
  const [newDealCompany, setNewDealCompany] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch('/api/deals');
      if (res.ok) {
        const data = await res.json();
        setDeals(data);
      }
    } catch {
      // DB not connected yet — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDeal = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/deals/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedDeal(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  useEffect(() => {
    if (selectedDealId) {
      fetchDeal(selectedDealId);
    }
  }, [selectedDealId, fetchDeal]);

  const createDeal = async () => {
    if (!newDealName.trim() || !newDealCompany.trim()) return;
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDealName.trim(), company: newDealCompany.trim() }),
      });
      if (res.ok) {
        const deal = await res.json();
        setDeals((prev) => [deal, ...prev]);
        setSelectedDealId(deal.id);
        setShowNewDeal(false);
        setNewDealName('');
        setNewDealCompany('');
      }
    } catch {
      // ignore
    }
  };

  const handleDealUpdate = () => {
    if (selectedDealId) fetchDeal(selectedDealId);
    fetchDeals();
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      {/* Deal List */}
      <div
        className="w-64 flex-shrink-0 border-r flex flex-col"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold">SalesBrain</h1>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Agentic B2B CRM</p>
            </div>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
              className="px-2 py-1 rounded text-xs transition-colors"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              title="Sign out"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="p-3">
          <button
            onClick={() => setShowNewDeal(!showNewDeal)}
            className="w-full py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            + New Deal
          </button>
        </div>

        {showNewDeal && (
          <div className="px-3 pb-3 space-y-2">
            <input
              value={newDealName}
              onChange={(e) => setNewDealName(e.target.value)}
              placeholder="Deal name"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <input
              value={newDealCompany}
              onChange={(e) => setNewDealCompany(e.target.value)}
              placeholder="Company"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button
              onClick={createDeal}
              disabled={!newDealName.trim() || !newDealCompany.trim()}
              className="w-full py-2 rounded-lg text-sm"
              style={{ background: 'var(--green)', color: '#fff' }}
            >
              Create
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>
          )}
          {!loading && deals.length === 0 && (
            <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              No deals yet. Create one to get started.
            </p>
          )}
          {deals.map((deal) => (
            <button
              key={deal.id}
              onClick={() => setSelectedDealId(deal.id)}
              className="w-full text-left px-4 py-3 border-b transition-colors"
              style={{
                borderColor: 'var(--border)',
                background: selectedDealId === deal.id ? 'var(--accent-glow)' : 'transparent',
              }}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium">{deal.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{deal.company}</p>
                </div>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}
                >
                  G{deal.gate}
                </span>
              </div>
              {deal.score !== null && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--border)' }}>
                    <div
                      className="h-1 rounded-full"
                      style={{
                        width: `${deal.score}%`,
                        background: deal.score >= 70 ? 'var(--green)' : deal.score >= 40 ? 'var(--yellow)' : 'var(--red)',
                      }}
                    />
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{deal.score}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedDeal && (
          <div className="px-4 py-2 border-b flex items-center gap-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <span className="text-sm font-medium">{selectedDeal.name}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              G{selectedDeal.gate}: {GATES[selectedDeal.gate - 1]?.name}
            </span>
          </div>
        )}
        <Chat dealId={selectedDealId} deal={selectedDeal} onDealUpdate={handleDealUpdate} />
      </div>

      {/* Right panel — Deal details */}
      <div
        className="w-80 flex-shrink-0 border-l"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
      >
        <DealPanel deal={selectedDeal} />
      </div>
    </div>
  );
}
