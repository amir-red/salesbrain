'use client';

import Link from 'next/link';
import { ENRICH_KINDS, ENRICH_RESULTS, pct } from '@/lib/icp-panel';
import type { PanelPayload } from '@/lib/icp-panel';
import { relativeTime } from '@/lib/time';
import SectionCard from '@/components/panel/SectionCard';
import ProgressBar from '@/components/panel/ProgressBar';
import { ActivityList, RunPill } from '@/components/icp/IcpLeads';
import type { RunMode } from '@/components/icp/IcpRow';

function CoverageBar({ label, n, d, hint }: { label: string; n: number; d: number; hint: string }) {
  const p = pct(n, d);
  return (
    <div title={hint}>
      <div className="flex justify-between text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>
        <span>{label}</span><span className="font-mono" style={{ color: 'var(--text)' }}>{p === null ? '—' : `${p}%`} <span style={{ color: 'var(--text-muted)' }}>({n}/{d})</span></span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
        <div className="h-full rounded-full" style={{ width: `${p ?? 0}%`, background: 'var(--green)' }} />
      </div>
    </div>
  );
}

const RESULT_COLOR: Record<string, string> = {
  found: 'var(--green)', no_match: 'var(--text-muted)', low_confidence: 'var(--yellow)', conflict: 'var(--orange)',
  suppressed: 'var(--orange)', error: 'var(--red)', skipped: 'var(--text-muted)',
};

/** Step 4: the Enricher — what the list still lacks, what it tried this week, what it spent. */
export default function EnricherSection({ data, canAct, busy, onRun, disabledReason }: {
  data: PanelPayload; canAct: boolean; busy: RunMode | null; onRun: (mode: RunMode) => void; disabledReason?: string;
}) {
  const { enricher, coverage, quota, policy } = data;
  const cfg = policy.enricher;
  const d = coverage.eligible || coverage.total;
  const cell = (kind: string, result: string) => enricher.attempts_7d.find((a) => a.kind === kind && a.result === result)?.n ?? 0;
  const kindsSeen = ENRICH_KINDS.filter((k) => enricher.attempts_7d.some((a) => a.kind === k));
  const resultsSeen = ENRICH_RESULTS.filter((r) => enricher.attempts_7d.some((a) => a.result === r));
  const credits7d = enricher.attempts_7d.reduce((a, r) => a + r.credits, 0);
  return (
    <SectionCard title="4 · Enricher" subtitle={`${policy.enabled.enricher ? 'enabled' : 'disabled'} · works leads scoring ≥ ${String(cfg.min_score ?? 60)} · email via ${String(cfg.email_provider ?? 'none')} · retries after ${String(cfg.retry_days ?? 14)} days`}
                 right={<button onClick={() => onRun('enrich')} disabled={!canAct || !!busy} title={canAct ? undefined : disabledReason}
                                className="px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-40" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>
                          {busy === 'enrich' ? '…' : 'Enrich now'}
                        </button>}>
      <div className="flex flex-wrap items-center gap-3">
        <RunPill run={enricher.runs[0] ?? null} queued={enricher.queued} state={null} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CoverageBar label="employer" n={coverage.employer} d={d} hint="leads with a company attached (LinkedIn profile fetch)" />
        <CoverageBar label="research" n={coverage.research} d={d} hint="leads with a research summary" />
        <CoverageBar label="email" n={coverage.email} d={d} hint="leads with an email on file" />
        <CoverageBar label="warm angle" n={coverage.warm} d={d} hint="leads with at least one warm angle (colleague, shared past, …)" />
      </div>
      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>coverage over the {coverage.eligible} leads the Enricher works (score ≥ {String(cfg.min_score ?? 60)}){coverage.eligible === 0 && coverage.total > 0 ? ` — falling back to all ${coverage.total}` : ''}</div>
      <div className="grid gap-3 md:grid-cols-2">
        <ProgressBar label="profile fetches today" used={quota.profile.used} cap={quota.profile.cap} title="LinkedIn profile look-ups on the owner's account today" />
        <ProgressBar label="email credits today" used={quota.email_credits.used} cap={quota.email_credits.cap} title="Paid email-provider credits spent today" />
      </div>
      {enricher.attempts_7d.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="text-[11px]">
            <thead><tr style={{ color: 'var(--text-muted)' }}><th className="text-left pr-3 font-medium">7 days</th>{resultsSeen.map((r) => <th key={r} className="text-right px-2 font-medium" style={{ color: RESULT_COLOR[r] }}>{r.replace(/_/g, ' ')}</th>)}</tr></thead>
            <tbody>
              {kindsSeen.map((k) => (
                <tr key={k} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="pr-3 py-0.5">{k}</td>
                  {resultsSeen.map((r) => { const n = cell(k, r); return <td key={r} className="text-right px-2 py-0.5 tabular-nums" style={{ color: n ? RESULT_COLOR[r] : 'var(--border)' }}>{n || '·'}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
          {credits7d > 0 && <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{credits7d} credits spent this week</div>}
        </div>
      ) : <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No enrichment attempts on this list in the last 7 days.</p>}
      {enricher.failures.length > 0 && (
        <details>
          <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--red)' }}>{enricher.failures.length} recent failures</summary>
          <div className="mt-1 space-y-0.5 text-[11px]">
            {enricher.failures.map((f, i) => (
              <div key={i} className="truncate">
                <Link href={`/prospects/${f.prospect_id}`} className="hover:underline">{f.full_name || f.prospect_id.slice(0, 8)}</Link>
                <span style={{ color: 'var(--text-muted)' }}> · {f.kind}{f.source ? ` via ${f.source}` : ''} · <span style={{ color: RESULT_COLOR[f.result] }}>{f.result}</span> · {relativeTime(f.created_at)}{f.detail && typeof f.detail.error === 'string' ? ` — ${f.detail.error}` : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {enricher.runs.length > 0 && (
        <details>
          <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--text-muted)' }}>last {enricher.runs.length} enricher runs</summary>
          <div className="mt-2"><ActivityList runs={enricher.runs} showIcp /></div>
        </details>
      )}
    </SectionCard>
  );
}
