'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/panel/SectionCard';
import FirmCard from '@/components/firms/FirmCard';
import FirmBriefEditor from '@/components/firms/FirmBriefEditor';
import ImportFirmsModal from '@/components/firms/ImportFirmsModal';
import { STATUS_LABEL, VERDICT_STYLE, chequeRange, type FirmListPayload, type FirmVerdict } from '@/lib/firms';

/**
 * Firms on this list (core 075): import firms before anyone there is known, research what they invest in, see the
 * verdict against the list's brief, open a firm for sources, team and contact. Loads on open and after every action
 * (not polled: 500+ rows, and research runs in the background sweep).
 */
const PAGE = 100;
const VERDICTS: (FirmVerdict | 'all')[] = ['all', 'go', 'later', 'out', 'unknown'];

export default function FirmsSection({ icpId, canEdit }: { icpId: string; canEdit: boolean }) {
  const [data, setData] = useState<FirmListPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<FirmVerdict | 'all'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [importing, setImporting] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/icp/${icpId}/firms`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { setError(out.error || 'Could not load the firms.'); return; }
    setData(out);
  }, [icpId]);
  useEffect(() => { void load(); }, [load]);

  const queue = async (limit: number, what: 'research' | 'people' = 'research') => {
    setBusy(true); setNote(null);
    try {
      const res = await fetch(`/api/icp/${icpId}/firms/${what}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit }) });
      const out = await res.json().catch(() => ({}));
      setNote(out.error || out.note || 'Queued.');
      await load();
    } finally { setBusy(false); }
  };

  const firms = useMemo(() => {
    const all = data?.firms || [];
    const needle = q.trim().toLowerCase();
    return all.filter((f) => (verdict === 'all' || f.eligibility === verdict)
      && (!needle || f.firm.toLowerCase().includes(needle) || (f.domain || '').includes(needle)));
  }, [data, verdict, q]);

  const c = data?.counts;
  // A people list with no firms: one slim line instead of a whole card.
  if (data && !c?.total && !importing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-2 text-xs" style={{ border: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
        <span>No firms on this list. Import firms to research them (what they invest in, who to contact) before anyone there is known.</span>
        {canEdit && <button type="button" onClick={() => setImporting(true)} className="px-2.5 py-1 rounded-lg shrink-0" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}>Import firms</button>}
      </div>
    );
  }
  const subtitle = c ? `${c.total} firms · ${c.researched} researched${c.queued ? ` (${c.queued} queued)` : ''} · ${c.go} go · ${c.later} to check · ${c.out} out · ${c.with_people} with people${c.people_queued ? ` (${c.people_queued} queued)` : ''} · ${c.with_email} with a firm email` : 'Loading…';
  const hasBrief = data && Object.keys(data.brief || {}).length > 0;

  return (
    <SectionCard title="Firms" subtitle={subtitle} right={canEdit ? (
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={() => setImporting(true)} className="px-2.5 py-1 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}>Import firms</button>
        <button type="button" onClick={() => setBriefOpen((o) => !o)} className="px-2.5 py-1 rounded-lg text-xs" style={{ border: '1px solid var(--border)' }}
          title="What each firm is judged against">{hasBrief ? 'Edit brief' : 'Set the brief'}</button>
        {!!c?.total && (
          <button type="button" onClick={() => queue(25)} disabled={busy} className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }} title="Queue the next 25 unresearched firms in the list's order; the sweep researches them within 15 minutes">
            {busy ? 'Queuing…' : 'Research next 25'}
          </button>
        )}
        {!!c?.total && (
          <button type="button" onClick={() => queue(10, 'people')} disabled={busy} className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }} title="Queue the next 10 firms with nobody on the list (not Out): the sweep picks their partners, adds them as leads and finds LinkedIn + email">
            Find people for next 10
          </button>
        )}
      </div>
    ) : undefined}>
      {importing && <ImportFirmsModal icpId={icpId} onClose={() => setImporting(false)} onImported={(n) => { setNote(`${n} firm(s) added.`); void load(); }} />}
      {briefOpen && data && (
        <div className="mb-3"><FirmBriefEditor icpId={icpId} brief={data.brief || {}} onCancel={() => setBriefOpen(false)}
          onSaved={(t) => { setBriefOpen(false); setNote(`Brief saved; the list was re-judged: ${Object.entries(t).map(([k, n]) => `${n} ${VERDICT_STYLE[k as FirmVerdict]?.label.toLowerCase() || k}`).join(', ') || 'nothing researched yet'}.`); void load(); }} /></div>
      )}
      {data && !hasBrief && !briefOpen && !!c?.total && (
        <div className="mb-3 text-xs rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--yellow) 10%, transparent)', color: 'var(--text)' }}>
          Set the brief (our stage, round, where we are, sectors) so researched firms get a Go / Check / Out verdict.
        </div>
      )}
      {note && <div className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>{note}</div>}
      {error && <div className="mb-2 text-xs" role="alert" style={{ color: 'var(--red)' }}>{error}</div>}

      {data && !c?.total && (
        <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          No firms on this list yet. {canEdit ? 'Import a file of firms to research them before anyone there is known.' : ''}
        </div>
      )}

      {!!c?.total && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {VERDICTS.map((v) => {
              const n = v === 'all' ? c.total : c[v as 'go'];
              const active = verdict === v;
              return (
                <button key={v} type="button" onClick={() => { setVerdict(v); setShown(PAGE); }} className="px-2.5 py-1 rounded-full text-xs"
                  style={{ border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {v === 'all' ? 'All' : VERDICT_STYLE[v].label} {n}
                </button>
              );
            })}
            <input id="firms-search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search firms" aria-label="Search firms"
              className="z-input text-xs py-1 ml-auto w-48" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                  <th className="px-2 py-1.5 font-medium w-10">#</th><th className="px-2 py-1.5 font-medium">Firm</th>
                  <th className="px-2 py-1.5 font-medium">Verdict</th><th className="px-2 py-1.5 font-medium">Invests in</th>
                  <th className="px-2 py-1.5 font-medium">Stage</th><th className="px-2 py-1.5 font-medium">Cheque</th>
                  <th className="px-2 py-1.5 font-medium">Fund</th><th className="px-2 py-1.5 font-medium">People</th>
                  <th className="px-2 py-1.5 font-medium">Contact</th><th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {firms.slice(0, shown).map((f) => {
                  const v = VERDICT_STYLE[f.eligibility];
                  const r = f.research;
                  const isOpen = open === f.id;
                  return (
                    <Fragment key={f.id}>
                      <tr onClick={() => setOpen(isOpen ? null : f.id)} className="cursor-pointer align-top" style={{ borderTop: '1px solid var(--border)', background: isOpen ? 'var(--bg-input)' : undefined }}>
                        <td className="px-2 py-1.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>{f.rank ?? '—'}{f.priority ? <div className="text-[10px]">P{f.priority}</div> : null}</td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{f.firm}</div>
                          {f.domain && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{f.domain}</div>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap" title={(f.eligibility_reasons || []).join('\n') || v.hint}>
                          <span className="px-1.5 py-0.5 rounded font-medium" style={{ color: v.color, background: `color-mix(in srgb, ${v.color} 14%, transparent)` }}>{v.label}</span>
                          {f.research_requested_at && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>queued</div>}
                          {f.research_error && !f.research_requested_at && <div className="text-[10px] mt-0.5" style={{ color: 'var(--red)' }} title={f.research_error}>failed</div>}
                          {f.people_requested_at && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>finding people</div>}
                        </td>
                        <td className="px-2 py-1.5 max-w-[22rem]"><div className="line-clamp-2" style={{ color: r?.thesis ? 'var(--text)' : 'var(--text-muted)' }}>{r?.thesis || '—'}</div></td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r?.stages?.slice(0, 2).join(', ') || '—'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{chequeRange(r)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r?.last_fund?.year || '—'}</td>
                        <td className="px-2 py-1.5 tabular-nums">{f.people || (r?.team_size ? <span style={{ color: 'var(--text-muted)' }} title="People on their site, not yet leads">0 / {r.team_size}</span> : 0)}</td>
                        <td className="px-2 py-1.5 max-w-[12rem] truncate">{f.contact_email || (f.contact_route ? 'form' : '—')}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{STATUS_LABEL[f.status]}</td>
                      </tr>
                      {isOpen && <tr><td colSpan={10} className="p-0"><FirmCard firmId={f.id} onChanged={load} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {firms.length > shown && (
            <button type="button" onClick={() => setShown((s) => s + PAGE)} className="mt-2 text-xs underline" style={{ color: 'var(--text-muted)' }}>
              Show {Math.min(PAGE, firms.length - shown)} more of {firms.length - shown}
            </button>
          )}
        </>
      )}
    </SectionCard>
  );
}
