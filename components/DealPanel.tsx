'use client';

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

interface DealPanelProps {
  deal: Deal | null;
}

function ScoreRing({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="w-24 h-24 rounded-full border-4 flex items-center justify-center" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>N/A</span>
      </div>
    );
  }

  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--red)';

  return (
    <div className="relative w-24 h-24">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="42" fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle
          cx="48" cy="48" r="42"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null;
  const colors: Record<string, string> = {
    low: 'var(--green)',
    medium: 'var(--yellow)',
    high: 'var(--orange)',
    critical: 'var(--red)',
  };
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: `${colors[risk]}20`, color: colors[risk], border: `1px solid ${colors[risk]}40` }}
    >
      {risk.toUpperCase()}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  const colors: Record<string, string> = {
    STRONG: 'var(--green)',
    PROCEED_WITH_CAUTION: 'var(--yellow)',
    WEAK: 'var(--orange)',
    WALK_AWAY: 'var(--red)',
  };
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-bold"
      style={{ color: colors[verdict] || 'var(--text-muted)' }}
    >
      {verdict.replace(/_/g, ' ')}
    </span>
  );
}

function GateStrip({ currentGate }: { currentGate: number }) {
  return (
    <div className="flex gap-1">
      {GATES.map((g) => (
        <div
          key={g.number}
          className="flex-1 h-2 rounded-full"
          style={{
            background:
              g.number < currentGate
                ? 'var(--green)'
                : g.number === currentGate
                ? 'var(--accent)'
                : 'var(--border)',
          }}
          title={`G${g.number}: ${g.name}`}
        />
      ))}
    </div>
  );
}

export default function DealPanel({ deal }: DealPanelProps) {
  if (!deal) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        <p>Select a deal to view details</p>
      </div>
    );
  }

  const fields = deal.fields || {};
  const fieldKeys = Object.keys(fields);
  const totalRequired = GATES[1]?.requiredFields?.length || 7;
  const filledRequired = GATES[1]?.requiredFields?.filter((f) => fields[f] !== undefined && fields[f] !== null && fields[f] !== '')?.length || 0;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">{deal.name}</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{deal.company}</p>
      </div>

      {/* Gate strip */}
      <div>
        <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          <span>G{deal.gate}: {GATES[deal.gate - 1]?.name}</span>
          <span>G9</span>
        </div>
        <GateStrip currentGate={deal.gate} />
      </div>

      {/* Score + Risk */}
      <div className="flex items-center gap-4">
        <ScoreRing score={deal.score} />
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Risk:</span>
            <RiskBadge risk={deal.risk} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Verdict:</span>
            <VerdictBadge verdict={deal.verdict} />
          </div>
          {deal.value && (
            <p className="text-sm font-medium">
              {deal.currency} {Number(deal.value).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Field completion */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span style={{ color: 'var(--text-muted)' }}>G2 Field Completion</span>
          <span style={{ color: 'var(--text)' }}>{filledRequired}/{totalRequired}</span>
        </div>
        <div className="w-full h-2 rounded-full" style={{ background: 'var(--border)' }}>
          <div
            className="h-2 rounded-full transition-all"
            style={{
              width: `${(filledRequired / totalRequired) * 100}%`,
              background: filledRequired === totalRequired ? 'var(--green)' : 'var(--accent)',
            }}
          />
        </div>
        {deal.missing.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {deal.missing.map((f) => (
              <span
                key={f}
                className="px-2 py-0.5 rounded text-xs"
                style={{ background: 'var(--red)', color: '#fff', opacity: 0.8 }}
              >
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Contact info */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Contact
        </h3>
        <p className="text-sm">{deal.contact_name || 'Unknown'}</p>
        {deal.contact_email && (
          <p className="text-xs" style={{ color: 'var(--accent)' }}>{deal.contact_email}</p>
        )}
        {deal.owner && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Owner: {deal.owner}</p>
        )}
      </div>

      {/* Risk signals / flags */}
      {deal.flags.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Flags & Signals
          </h3>
          <div className="flex flex-wrap gap-1">
            {deal.flags.map((f, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  background: f.startsWith('sla_') ? 'var(--red)' : 'var(--bg-input)',
                  color: f.startsWith('sla_') ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${f.startsWith('sla_') ? 'var(--red)' : 'var(--border)'}`,
                }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fields data */}
      {fieldKeys.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Deal Fields
          </h3>
          <div className="space-y-1">
            {fieldKeys.map((key) => (
              <div key={key} className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-muted)' }}>{key}</span>
                <span className="text-right ml-2" style={{ color: 'var(--text)' }}>
                  {String(fields[key])}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
