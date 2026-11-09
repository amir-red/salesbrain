'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Button from '@/components/panel/Button';
import { Pill } from '@/components/panel/PageHeader';
import PriorityPicker from '@/components/PriorityPicker';
import ScoreBadge from '@/components/ScoreBadge';
import { Building, External, Mail, MapPin, Phone, Send, Sparkle } from '@/components/icons';
import type { Prospect } from '@/lib/prospects';
import { PROSPECT_STAGES } from '@/lib/prospecting';

/**
 * The top of a person page (2026-11-09): a profile, not a form — picture, name, role at company, where, the list,
 * how to reach them, and the one action a seller takes from here: Write message (→ the Inbox, from your own account).
 */
export default function ProfileHero({ p, backHref, backLabel, onChanged, actions, researching, onResearch, enriching, onEnrich, converting, onConvert }: {
  p: Prospect; backHref: string; backLabel: string; onChanged: () => void; actions?: React.ReactNode;
  researching: boolean; onResearch: () => void; enriching: boolean; onEnrich: () => void; converting: boolean; onConvert: () => void;
}) {
  const stage = PROSPECT_STAGES.find((s) => s.stage === p.stage);
  const canConvert = !p.converted_deal_id && ((p.trust_total ?? 0) >= 50 || (p.icp_score ?? 0) >= 40);
  const where = p.person_city || p.hq_location;
  const site = p.website ? p.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : p.domain;
  const contact = { color: 'var(--text-muted)' } as const;
  return (
    <header className="px-6 pt-4 pb-0 border-b" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link href={backHref} className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>← {backLabel}</Link>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {actions}
          <Button size="sm" onClick={onEnrich} disabled={enriching} title="Employer, company research, email — the Enricher's own steps, now">
            {enriching ? 'Enriching…' : 'Enrich'}
          </Button>
          <Button size="sm" onClick={onResearch} disabled={researching} title="LinkedIn profile, the web and one Google lookup; then the brief is refreshed">
            <Sparkle width={13} height={13} />{researching ? 'Researching…' : 'Research again'}
          </Button>
          {p.converted_deal_id
            ? <Button size="sm" variant="success" href={`/deals/${p.converted_deal_id}`}>View opportunity →</Button>
            : <Button size="sm" onClick={onConvert} disabled={!canConvert || converting} title={canConvert ? 'Open an opportunity for this person' : 'Needs a trust score of 50+ or a fit of 40+'}>
                {converting ? 'Converting…' : 'Convert to opportunity'}
              </Button>}
          <Button variant="primary" href={`/inbox?compose=${p.id}`} title="Write to them from your own LinkedIn or Gmail — the Inbox opens with the message">
            <Send width={14} height={14} />Write message
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-5 pb-5">
        <Avatar name={p.full_name} src={p.picture_url} size={84} className="shadow-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight truncate">{p.full_name || '—'}</h1>
            <PriorityPicker value={p.priority} prospectId={p.id} size="md" onChanged={onChanged} />
            {p.trust_total != null && <ScoreBadge s={p} prospectId={p.id} size="md" onChanged={onChanged} />}
            {stage && <Pill color="var(--blue)">{stage.label}</Pill>}
            {p.converted_deal_id && <Pill color="var(--green)">Opportunity</Pill>}
          </div>
          <p className="text-base mt-0.5 truncate">
            {p.title || <span style={{ color: 'var(--text-muted)' }}>role unknown</span>}
            {p.company_name && <> <span style={{ color: 'var(--text-muted)' }}>at</span> {p.company_name}</>}
          </p>
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-xs" style={contact}>
            {where && <span className="inline-flex items-center gap-1"><MapPin width={12} height={12} />{where}</span>}
            {p.list_name && <span className="inline-flex items-center gap-1"><Building width={12} height={12} />{p.list_name}</span>}
            {p.owner_name && <span>held by {p.owner_name}</span>}
          </div>
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-xs">
            {p.linkedin_url
              ? <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--accent)' }}>LinkedIn <External width={11} height={11} /></a>
              : <span style={contact}>no LinkedIn profile on file</span>}
            {p.email
              ? <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--accent)' }}><Mail width={12} height={12} />{p.email}</a>
              : <span className="inline-flex items-center gap-1" style={contact}><Mail width={12} height={12} />no email</span>}
            {p.phone && <span className="inline-flex items-center gap-1" style={contact}><Phone width={12} height={12} />{p.phone}</span>}
            {site && <a href={p.website || `https://${p.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--accent)' }}>{site} <External width={11} height={11} /></a>}
          </div>
          {p.trust_why && <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted)' }}>{p.trust_why}</p>}
        </div>
      </div>
    </header>
  );
}
