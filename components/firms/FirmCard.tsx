'use client';

import { useCallback, useEffect, useState } from 'react';
import { STATUS_LABEL, VERDICT_STYLE, chequeRange, money, type FirmDetail, type FirmStatus, type FirmVerdict } from '@/lib/firms';
import { relativeTime } from '@/lib/time';

/** One firm, opened under its row: what the research found (with sources), why the verdict, the team, how to reach it. */
export default function FirmCard({ firmId, onChanged }: { firmId: string; onChanged: () => void }) {
  const [f, setF] = useState<FirmDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/firms/${firmId}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { setError(out.error || 'Could not load the firm.'); return; }
    setF(out); setNotes(out.notes || '');
  }, [firmId]);
  useEffect(() => { void load(); }, [load]);

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setError(null);
    try {
      const res = await fetch(`/api/firms/${firmId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) setError(out.error || 'Could not save.');
      await load(); onChanged();
    } finally { setBusy(null); }
  };
  const findPeople = async (names?: string[]) => {
    setBusy(names ? `add:${names[0]}` : 'people'); setError(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/people`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(names ? { names } : {}) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) setError(out.error || 'Could not find people.');
      else if (!out.landed?.length) setError(out.already?.length ? `Already on the list: ${out.already.map((a: { name: string }) => a.name).join(', ')}` : 'Nobody found to add.');
      await load(); onChanged();
    } finally { setBusy(null); }
  };
  const research = async () => {
    setBusy('research'); setError(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/research`, { method: 'POST' });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) setError(out.error || 'Research failed.');
      await load(); onChanged();
    } finally { setBusy(null); }
  };

  if (error && !f) return <div className="p-3 text-xs" style={{ color: 'var(--red)' }}>{error}</div>;
  if (!f) return <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  const p = f.research?.profile;
  const v = VERDICT_STYLE[f.eligibility as FirmVerdict];
  const muted = { color: 'var(--text-muted)' };
  const fact = (label: string, value: React.ReactNode) => (
    <div><div className="z-eyebrow">{label}</div><div className="text-sm">{value || '—'}</div></div>
  );

  return (
    <div className="p-4 grid gap-4 lg:grid-cols-[1fr_18rem]" style={{ background: 'var(--bg-input)' }}>
      <div className="grid gap-4 min-w-0">
        {!p && (
          <div className="text-sm" style={muted}>
            Not researched yet.{f.research_error ? <span style={{ color: 'var(--red)' }}> Last try: {f.research_error}</span> : null}
          </div>
        )}
        {p && (
          <>
            <div className="grid gap-1">
              {p.summary && <p className="text-sm">{p.summary}</p>}
              {p.thesis && <p className="text-sm" style={muted}><b style={{ color: 'var(--text)' }}>Invests in:</b> {p.thesis}</p>}
            </div>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {fact('Stages', (p.stages || []).join(', '))}
              {fact('First cheque', chequeRange({ cheque_min: p.cheque_min, cheque_max: p.cheque_max, currency: p.currency }))}
              {fact('Geographies', (p.geographies || []).join(', '))}
              {fact('Latest fund', p.last_fund ? `${p.last_fund.name || 'Fund'}${p.last_fund.size ? ` · ${money(p.last_fund.size, p.last_fund.currency)}` : ''}${p.last_fund.year ? ` · ${p.last_fund.year}` : ''}` : null)}
              {fact('Investing now', p.actively_investing ? `${p.actively_investing}${p.actively_investing_why ? ` — ${p.actively_investing_why}` : ''}` : null)}
              {fact('Sectors', (p.sectors || []).slice(0, 6).join(', '))}
              {fact('HQ', p.hq_location || f.hq_location)}
              {fact('Researched', f.research ? `${relativeTime(f.research.researched_at)} · ${f.research.confidence || '?'} confidence` : null)}
            </div>
            {(p.hook || p.how_to_pitch) && (
              <div className="rounded-lg px-3 py-2 text-sm grid gap-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                {p.hook && <div><span className="z-eyebrow mr-2">Opening line</span>{p.hook}</div>}
                {p.how_to_pitch && <div><span className="z-eyebrow mr-2">How to pitch</span>{p.how_to_pitch}</div>}
              </div>
            )}
            {!!p.recent_investments?.length && (
              <div>
                <div className="z-eyebrow mb-1">Recent investments</div>
                <ul className="text-sm grid gap-0.5">
                  {p.recent_investments.slice(0, 8).map((r, i) => (
                    <li key={i}>{r.company}<span style={muted}>{[r.round, r.date].filter(Boolean).length ? ` · ${[r.round, r.date].filter(Boolean).join(' · ')}` : ''}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {!!p.team?.length && (
              <div>
                <div className="z-eyebrow mb-1">Team on their site ({p.team.length})</div>
                <ul className="text-sm grid gap-0.5 sm:grid-cols-2">
                  {p.team.slice(0, 24).map((m, i) => {
                    const onList = f.people.some((x) => (x.full_name || '').trim().toLowerCase() === m.name.trim().toLowerCase());
                    return (
                      <li key={i} className="truncate">
                        <b>{m.name}</b><span style={muted}>{m.title ? ` · ${m.title}` : ''}{m.focus ? ` · ${m.focus}` : ''}</span>
                        {m.linkedin_url && <a href={m.linkedin_url} target="_blank" rel="noreferrer" className="ml-1 text-xs underline" style={{ color: 'var(--accent)' }}>in</a>}
                        {m.email && <span className="ml-1 text-xs" style={muted}>{m.email}</span>}
                        {onList ? <span className="ml-1 text-[11px]" style={{ color: 'var(--green)' }}>on the list</span>
                          : <button type="button" onClick={(e) => { e.stopPropagation(); void findPeople([m.name]); }} disabled={busy !== null}
                              className="ml-1 text-[11px] underline disabled:opacity-40" style={{ color: 'var(--accent)' }} title="Add as a lead and look up LinkedIn + email">
                              {busy === `add:${m.name}` ? 'adding…' : 'add as lead'}</button>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {!!f.research?.sources?.length && (
              <div>
                <button type="button" onClick={() => setShowSources((s) => !s)} className="text-xs underline" style={muted}>
                  {showSources ? 'Hide' : 'Show'} {f.research.sources.length} sources
                </button>
                {showSources && (
                  <ul className="mt-1 text-xs grid gap-0.5">
                    {f.research.sources.map((s, i) => (
                      <li key={i} className="truncate"><span style={muted}>{s.supports}: </span>
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>{s.title || s.url}</a></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {!!f.people.length && (
          <div>
            <div className="z-eyebrow mb-1">People on this list</div>
            <ul className="text-sm grid gap-0.5">
              {f.people.map((x) => (
                <li key={x.id}><a href={`/prospects/${x.id}`} className="underline">{x.full_name || 'Unnamed'}</a>
                  <span style={muted}>{x.title ? ` · ${x.title}` : ''}{x.email ? ` · ${x.email}` : ''}{x.linkedin_public_id ? ' · LinkedIn ✓' : ''}</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-3 content-start">
        <div className="rounded-lg p-3 grid gap-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <span className="z-eyebrow">Verdict</span>
            <span className="text-xs font-semibold" style={{ color: v.color }}>{v.label}{f.eligibility_override ? ' · set by hand' : ''}</span>
          </div>
          <ul className="text-xs grid gap-0.5" style={muted}>{(f.eligibility_reasons || []).map((r, i) => <li key={i}>· {r}</li>)}</ul>
          <select id={`firm-verdict-${f.id}`} aria-label="Change the verdict" value="" disabled={busy !== null}
            onChange={(e) => { const val = e.target.value; if (!val) return; const reason = val === 'auto' ? undefined : prompt('Why? (optional)') ?? undefined; void patch({ eligibility: val, reason }, 'verdict'); }}
            className="z-input text-xs py-1">
            <option value="">Change verdict…</option>
            <option value="go">Go</option><option value="later">Check</option><option value="out">Out</option>
            {f.eligibility_override && <option value="auto">Back to the rules</option>}
          </select>
        </div>
        <div className="rounded-lg p-3 grid gap-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <span className="z-eyebrow">Reach the firm</span>
          <div className="text-xs grid gap-1">
            <div>Email: {f.contact_email ? <a href={`mailto:${f.contact_email}`} className="underline">{f.contact_email}</a> : <span style={muted}>none found</span>}</div>
            {p?.contact?.general_email && p.contact.general_email !== f.contact_email && <div style={muted}>Also: {p.contact.general_email}</div>}
            <div>Form: {f.contact_route ? <a href={f.contact_route} target="_blank" rel="noreferrer" className="underline">{f.contact_route.replace(/^https?:\/\//, '').slice(0, 40)}</a> : <span style={muted}>none</span>}</div>
            {f.website && <div>Site: <a href={f.website} target="_blank" rel="noreferrer" className="underline">{f.domain || f.website}</a></div>}
          </div>
          <button type="button" className="text-[11px] underline justify-self-start" style={muted} disabled={busy !== null}
            onClick={() => { const e = prompt('Contact email for this firm ("" clears):', f.contact_email || ''); if (e !== null) void patch({ contact_email: e }, 'email'); }}>Edit email</button>
        </div>
        <div className="rounded-lg p-3 grid gap-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <label className="z-eyebrow" htmlFor={`firm-status-${f.id}`}>Status</label>
          <select id={`firm-status-${f.id}`} value={f.status} disabled={busy !== null}
            onChange={(e) => void patch({ status: e.target.value }, 'status')} className="z-input text-xs py-1">
            {(Object.keys(STATUS_LABEL) as FirmStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <label className="z-eyebrow" htmlFor={`firm-notes-${f.id}`}>Notes</label>
          <textarea id={`firm-notes-${f.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="z-input text-xs"
            onBlur={() => { if (notes !== (f.notes || '')) void patch({ notes }, 'notes'); }} />
        </div>
        <button type="button" onClick={() => findPeople()} disabled={busy !== null} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }} title="Pick the best partners, add them as leads, find LinkedIn + email (~1-2 min)">
          {busy === 'people' ? 'Finding people… (up to 2 min)' : f.people.length ? 'Find more people' : 'Find people now'}
        </button>
        {f.people_error && !f.people.length && <div className="text-[11px]" style={muted}>Last try: {f.people_error}</div>}
        <button type="button" onClick={research} disabled={busy !== null} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }} title="Reads the firm's site and searches Google (~20-60 s)">
          {busy === 'research' ? 'Researching… (up to a minute)' : f.research ? 'Research again now' : 'Research now'}
        </button>
        {error && <div className="text-xs" role="alert" style={{ color: 'var(--red)' }}>{error}</div>}
      </div>
    </div>
  );
}
