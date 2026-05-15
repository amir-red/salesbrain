'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import PricingForm, { type PricingFormValues } from '@/components/PricingForm';
import PricingResult from '@/components/PricingResult';
import type { PricingOutputs, PricingPnl } from '@/lib/pricing/inputs';

interface CalcResponse {
  tool: { id: string; version: number; filename: string };
  inputs: Record<string, unknown>;
  outputs: PricingOutputs;
  pnl: PricingPnl;
}

interface DealOption { id: string; name: string; company: string; }

export default function PricingPage() {
  const [values, setValues] = useState<PricingFormValues>({
    customer_name: '',
    country: '',
    seats: 25,
    customer_annual_revenue: 5_000_000,
    customer_annual_labor_cost: 1_500_000,
    ebitda_pct: 0.18,
    pilot_discount: 0.1,
  });
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // "Save as quote against deal …" picker
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string>('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/deals');
        if (res.ok) {
          const all = (await res.json()) as Array<{ id: string; name: string; company: string }>;
          setDeals(all);
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function calculate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: values }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Calculation failed');
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveQuote() {
    if (!result) return;
    setSaveBusy(true);
    try {
      const res = await fetch('/api/pricing/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: selectedDealId || null,
          pricing_tool_id: result.tool.id,
          inputs: result.inputs,
          outputs: result.outputs,
          pnl: result.pnl,
          notes: quoteNotes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      flash(selectedDealId ? 'Quote saved against deal' : 'Quote saved');
      setQuoteNotes('');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaveBusy(false);
    }
  }

  function reset() {
    setValues({
      customer_name: '', country: '', seats: 25,
      customer_annual_revenue: 5_000_000, customer_annual_labor_cost: 1_500_000,
      ebitda_pct: 0.18, pilot_discount: 0.1,
    });
    setResult(null);
    setError(null);
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <header className="p-4 border-b flex items-start justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Pricing Calculator</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              What-if explorer. Standalone — not tied to a deal. Save a quote to attach it to one.
            </p>
          </div>
          <Link
            href="/admin/pricing-tool"
            className="text-xs px-3 py-1.5 rounded border whitespace-nowrap"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title="Upload a new .xlsx, view past versions, activate a version"
          >
            Manage versions →
          </Link>
        </header>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto">
          <div>
            <PricingForm
              values={values}
              onChange={setValues}
              onCalculate={calculate}
              onReset={reset}
              busy={busy}
            />
            {error && <p className="mt-3 text-sm" style={{ color: '#fb7185' }}>{error}</p>}
          </div>

          <div>
            {result ? (
              <>
                <PricingResult
                  outputs={result.outputs}
                  pnl={result.pnl}
                  toolLabel={`Using ${result.tool.filename} (v${result.tool.version})`}
                />

                <div className="rounded-lg p-4 mt-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                    Save as quote
                  </h3>
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
                        Attach to deal (optional)
                      </span>
                      <select
                        value={selectedDealId}
                        onChange={(e) => setSelectedDealId(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border text-sm"
                        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        <option value="">— Standalone (no deal) —</option>
                        {deals.map((d) => (
                          <option key={d.id} value={d.id}>{d.company} · {d.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
                        Notes (optional)
                      </span>
                      <textarea
                        value={quoteNotes}
                        onChange={(e) => setQuoteNotes(e.target.value)}
                        rows={2}
                        placeholder="Context for this quote (e.g. 'Aggressive pilot discount for end of quarter')"
                        className="w-full px-2 py-1.5 rounded border text-sm"
                        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <button
                      onClick={saveQuote}
                      disabled={saveBusy}
                      className="w-full px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: '#0b1220' }}
                    >
                      {saveBusy ? 'Saving…' : 'Save quote'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Fill the inputs on the left and click Calculate.
              </p>
            )}
          </div>
        </div>

        {toast && (
          <div className="fixed bottom-4 right-4 px-3 py-2 rounded text-sm shadow-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
