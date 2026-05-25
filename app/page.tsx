'use client';

import { useState, useEffect, useCallback } from 'react';
import Chat from '@/components/Chat';
import DealPanel from '@/components/DealPanel';
import Sidebar from '@/components/Sidebar';
import { GATES } from '@/lib/gates';
import ThemeToggle from '@/components/ThemeToggle';

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
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  missing: string[];
  flags: string[];
  fields: Record<string, unknown>;
  gate_entered_at: string;
  created_at: string;
  deal_type: 'sales' | 'grant';
}

type MobileTab = 'deals' | 'chat' | 'details';

export default function Home() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [newDealType, setNewDealType] = useState<'sales' | 'grant'>('sales');
  const [newDealName, setNewDealName] = useState('');
  const [newDealCompany, setNewDealCompany] = useState('');
  const [loading, setLoading] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>('deals');

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

  const selectDeal = (id: string) => {
    setSelectedDealId(id);
    setMobileTab('chat'); // Auto-switch to chat on mobile when deal is selected
  };

  const createDeal = async () => {
    if (!newDealName.trim() || !newDealCompany.trim()) return;
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newDealName.trim(),
          company: newDealCompany.trim(),
          deal_type: newDealType,
        }),
      });
      if (res.ok) {
        const deal = await res.json();
        setDeals((prev) => [deal, ...prev]);
        setSelectedDealId(deal.id);
        setShowNewDeal(false);
        setNewDealName('');
        setNewDealCompany('');
        setNewDealType('sales');
        setMobileTab('chat');
      }
    } catch {
      // ignore
    }
  };

  const handleDealUpdate = () => {
    if (selectedDealId) fetchDeal(selectedDealId);
    fetchDeals();
  };

  // ─── Deal List Panel ─────────────────────────────────────────
  const dealListPanel = (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-card)' }}
    >
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">SalesBrain</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Agentic B2B CRM</p>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
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
          {/* Deal type selector */}
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setNewDealType('sales')}
              className="flex-1 py-1.5 rounded text-xs font-medium transition-colors"
              style={{
                background: newDealType === 'sales' ? 'var(--accent)' : 'transparent',
                color: newDealType === 'sales' ? '#fff' : 'var(--text-muted)',
              }}
            >
              Sales (Zeami)
            </button>
            <button
              onClick={() => setNewDealType('grant')}
              className="flex-1 py-1.5 rounded text-xs font-medium transition-colors"
              style={{
                background: newDealType === 'grant' ? 'var(--accent)' : 'transparent',
                color: newDealType === 'grant' ? '#fff' : 'var(--text-muted)',
              }}
            >
              Grant (ChipChip)
            </button>
          </div>
          <input
            value={newDealName}
            onChange={(e) => setNewDealName(e.target.value)}
            placeholder={newDealType === 'grant' ? 'Opportunity name' : 'Deal name'}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          <input
            value={newDealCompany}
            onChange={(e) => setNewDealCompany(e.target.value)}
            placeholder={newDealType === 'grant' ? 'Donor / Funding body' : 'Company'}
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
            onClick={() => selectDeal(deal.id)}
            className="w-full text-left px-4 py-3 border-b transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: selectedDealId === deal.id ? 'var(--accent-glow)' : 'transparent',
            }}
          >
            <div className="flex justify-between items-start">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {deal.deal_type === 'grant' && (
                    <span
                      className="text-[8px] px-1 py-0.5 rounded font-bold flex-shrink-0"
                      style={{ background: 'var(--green)', color: '#fff' }}
                    >
                      GRANT
                    </span>
                  )}
                  <p className="text-sm font-medium truncate">{deal.name}</p>
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{deal.company}</p>
              </div>
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}
              >
                G{deal.gate}
              </span>
            </div>
            {deal.lead_name && (
              <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <span className="inline-flex w-4 h-4 rounded-full items-center justify-center text-[8px] font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>
                  {deal.lead_name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                </span>
                {deal.lead_name}
              </p>
            )}
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
  );

  return (
    <>
      {/* ─── Desktop Layout (md+) ──────────────────────────────── */}
      <div className="hidden md:flex h-screen">
        <Sidebar />
        <div className="w-64 flex-shrink-0 border-r" style={{ borderColor: 'var(--border)' }}>
          {dealListPanel}
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
          <DealPanel deal={selectedDeal} onDealUpdate={handleDealUpdate} />
        </div>
      </div>

      {/* ─── Mobile Layout (<md) ───────────────────────────────── */}
      <div className="md:hidden flex flex-col h-screen">
        {/* Mobile content area */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'deals' && dealListPanel}

          {mobileTab === 'chat' && (
            <div className="flex flex-col h-full">
              {selectedDeal ? (
                <>
                  <div className="px-4 py-2 border-b flex items-center gap-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                    <button
                      onClick={() => setMobileTab('deals')}
                      className="text-xs"
                      style={{ color: 'var(--accent)' }}
                    >
                      ← Back
                    </button>
                    <span className="text-sm font-medium truncate">{selectedDeal.name}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      G{selectedDeal.gate}
                    </span>
                  </div>
                  <Chat dealId={selectedDealId} deal={selectedDeal} onDealUpdate={handleDealUpdate} />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                  <div className="text-center">
                    <p className="text-lg mb-2">No deal selected</p>
                    <button
                      onClick={() => setMobileTab('deals')}
                      className="text-sm"
                      style={{ color: 'var(--accent)' }}
                    >
                      ← Go to deals
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {mobileTab === 'details' && (
            <div className="h-full" style={{ background: 'var(--bg-card)' }}>
              {selectedDeal ? (
                <DealPanel deal={selectedDeal} onDealUpdate={handleDealUpdate} />
              ) : (
                <div className="flex-1 flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
                  <p>Select a deal first</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile bottom tab bar */}
        <div
          className="flex border-t flex-shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          {([
            { tab: 'deals' as MobileTab, label: 'Deals', icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
            )},
            { tab: 'chat' as MobileTab, label: 'Chat', icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            )},
            { tab: 'details' as MobileTab, label: 'Details', icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )},
          ]).map(({ tab, label, icon }) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className="flex-1 py-3 flex flex-col items-center gap-1"
              style={{ color: mobileTab === tab ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {icon}
              <span className="text-[10px]">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
