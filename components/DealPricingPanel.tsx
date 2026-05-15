'use client';

import { useEffect, useState } from 'react';
import PricingForm, { type PricingFormValues } from '@/components/PricingForm';
import PricingResult from '@/components/PricingResult';
import { prefillFromDeal, type PricingOutputs, type PricingPnl } from '@/lib/pricing/inputs';

interface DealLike {
  id: string;
  company: string;
  contact_email: string | null;
  fields: Record<string, unknown>;
  currency: string | null;
}

interface SavedQuote {
  id: string;
  inputs: Record<string, unknown>;
  outputs: PricingOutputs;
  pnl: PricingPnl | null;
  tool_version: number | null;
  tool_filename: string | null;
  created_by_name: string | null;
  notes: string | null;
  created_at: string;
}

interface CalcResponse {
  tool: { id: string; version: number; filename: string };
  inputs: Record<string, unknown>;
  outputs: PricingOutputs;
  pnl: PricingPnl;
}

/**
 * The "Generate Quote" section on a deal page. Form prefilled from the deal's
 * captured fields, calculate-and-save inline, list past quotes for this deal.
 */
export default function DealPricingPanel({ deal }: { deal: DealLike }) {
  const initial: PricingFormValues = {
    pilot_discount: 0.1,
    ...prefillFromDeal({ company: deal.company, fields: deal.fields, contact_email: deal.contact_email }),
  };
  const [values, setValues] = useState<PricingFormValues>(initial);
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<SavedQuote[]>([]);
  const [showForm, setShowForm] = useState(false);

  async function loadQuotes() {
    try {
      const res = await fetch(`/api/pricing/quotes?deal_id=${deal.id}`);
      const json = await res.json();
      if (res.ok) setQuotes(json);
    } catch { /* non-fatal */ }
  }
  useEffect(() => { loadQuotes(); }, [deal.id]);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2500); }

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
          deal_id: deal.id,
          pricing_tool_id: result.tool.id,
          inputs: result.inputs,
          outputs: result.outputs,
          pnl: result.pnl,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      flash('Quote saved to this deal');
      await loadQuotes();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Pricing & Quotes
        </h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--accent)', color: '#0b1220' }}
        >
          {showForm ? 'Hide form' : 'Generate quote'}
        </button>
      </div>

      {/* Saved quotes */}
      {quotes.length === 0 && !showForm && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No quotes saved for this deal yet. Click <strong>Generate quote</strong> to create one — inputs prefill from the deal's captured fields.
        </p>
      )}
      {quotes.length > 0 && (
        <div className="space-y-2 mb-4">
          {quotes.map((q) => (
            <details key={q.id} className="rounded border p-2" style={{ borderColor: 'var(--border)' }}>
              <summary className="text-xs cursor-pointer flex items-center justify-between" style={{ color: 'var(--text)' }}>
                <span>
                  <strong>{fmtUSD(deal.currency, q.outputs.year_1_total)} year-1</strong>
                  {' · '}
                  {fmtUSD(deal.currency, q.outputs.monthly_total)} /mo
                  {' · '}
                  <span style={{ color: 'var(--text-muted)' }}>{new Date(q.created_at).toLocaleDateString()}</span>
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  v{q.tool_version} · by {q.created_by_name ?? 'unknown'}
                </span>
              </summary>
              <div className="mt-3">
                <PricingResult outputs={q.outputs} pnl={q.pnl ?? ({} as PricingPnl)} currency={deal.currency ?? 'USD'} />
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Inline form */}
      {showForm && (
        <div className="space-y-4 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <PricingForm values={values} onChange={setValues} onCalculate={calculate} busy={busy} />
          {error && <p className="text-sm" style={{ color: '#fb7185' }}>{error}</p>}
          {result && (
            <>
              <PricingResult
                outputs={result.outputs}
                pnl={result.pnl}
                toolLabel={`Using ${result.tool.filename} (v${result.tool.version})`}
                currency={deal.currency ?? 'USD'}
              />
              <button
                onClick={saveQuote}
                disabled={saveBusy}
                className="w-full px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#0b1220' }}
              >
                {saveBusy ? 'Saving…' : 'Save quote to this deal'}
              </button>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 px-3 py-2 rounded text-sm shadow-lg"
             style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function fmtUSD(currency: string | null, n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const cur = currency ?? 'USD';
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${cur} ${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `${cur} ${Math.round(v).toLocaleString()}`;
  return `${cur} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
