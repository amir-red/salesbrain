'use client';

/**
 * Email replies in the Inbox (core 108, Mateo 2026-11-11):
 * - ReadingCard: what the conversation reader made of the thread (what kind of conversation, what they ask, what you
 *   owe, who is who with an "Add as lead" for people not in the CRM).
 * - RecipientsEditor: whom the reply goes to. Reply-all by default (To = whoever wrote last, the rest in Cc); every
 *   address can be moved between To, Cc and Bcc, removed, or added.
 */
import { useState } from 'react';
import type { EmailReading, EmailReadingPerson } from '@/lib/inbox';
import { EMAIL_RE, type Recipients } from '@/lib/email-recipients';

const KIND_LABEL: Record<EmailReading['kind'], string> = {
  intro: 'Introduction', cc_fyi: 'You are in copy', scheduling: 'Finding a time', question: 'Question',
  decision: 'Decision', thanks: 'Thank-you', update: 'Update', other: 'Conversation',
};
const ROLE_LABEL: Record<string, string> = {
  introducer: 'made the introduction', introduced: 'introduced to you', introduced_colleague: 'colleague of the person introduced',
  teammate: 'your teammate', assistant: 'assistant', decision_maker: 'decision maker', colleague: 'colleague', other: '',
};

export function roleOf(reading: EmailReading | null | undefined, email: string): string {
  const p = reading?.people?.find((x) => x.email === email);
  return p ? (ROLE_LABEL[p.role] ?? '') : '';
}

function PersonLine({ p, onAdd }: { p: EmailReadingPerson; onAdd?: (p: EmailReadingPerson) => Promise<string | null> }) {
  const [state, setState] = useState<'idle' | 'adding' | 'added' | string>('idle');
  const role = ROLE_LABEL[p.role] ?? '';
  const sub = [p.title, p.company].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <span className="font-medium">{p.name || p.email}</span>
        {role && <span style={{ color: 'var(--text-muted)' }}> · {role}</span>}
        {sub && <span style={{ color: 'var(--text-muted)' }}> · {sub}</span>}
        {p.notes && <p className="truncate" style={{ color: 'var(--text-muted)' }} title={p.notes}>{p.notes}</p>}
      </div>
      {p.teammate ? <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>team</span>
        : p.in_crm || state === 'added' ? <span className="shrink-0" style={{ color: 'var(--green)' }}>in the CRM</span>
          : onAdd ? (
            <button type="button" disabled={state === 'adding'} className="shrink-0 underline disabled:opacity-50" style={{ color: 'var(--accent)' }}
              title="Add them as a lead with what this thread says about them (name, company, title, who introduced them)"
              onClick={async () => { setState('adding'); const err = await onAdd(p); setState(err ? err : 'added'); }}>
              {state === 'adding' ? 'Adding…' : state !== 'idle' && state !== 'added' ? state : 'Add as lead'}
            </button>
          ) : null}
    </li>
  );
}

export function ReadingCard({ reading, onAdd }: {
  reading: EmailReading; onAdd?: (p: EmailReadingPerson) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const people = (reading.people || []).filter((p) => p.email);
  return (
    <div className="rounded-xl px-3 py-2 mb-2 text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 px-1.5 rounded-full font-medium" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
          {KIND_LABEL[reading.kind] ?? 'Conversation'}
        </span>
        <p className="flex-1 min-w-0">{reading.summary || 'Read before drafting.'}</p>
        {people.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="shrink-0 underline" style={{ color: 'var(--text-muted)' }}
            aria-expanded={open}>{open ? 'Hide who is who' : `Who is who (${people.length})`}</button>
        )}
      </div>
      {(reading.ask || reading.we_owe) && (
        <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
          {reading.ask && <>They ask: <span style={{ color: 'var(--text)' }}>{reading.ask}</span></>}
          {reading.ask && reading.we_owe && ' · '}
          {reading.we_owe && <>You owe: <span style={{ color: 'var(--text)' }}>{reading.we_owe}</span></>}
        </p>
      )}
      {open && (
        <ul className="mt-2 space-y-1">
          {people.map((p) => <PersonLine key={p.email} p={p} onAdd={onAdd} />)}
        </ul>
      )}
    </div>
  );
}

type Field = keyof Recipients;
const FIELDS: { k: Field; label: string }[] = [{ k: 'to', label: 'To' }, { k: 'cc', label: 'Cc' }, { k: 'bcc', label: 'Bcc' }];

export function RecipientsEditor({ value, onChange, names, reading, proposed }: {
  value: Recipients; onChange: (r: Recipients) => void; names?: Record<string, string>;
  reading?: EmailReading | null;
  /** what the reader proposed: a changed recipient is marked, so the person sees what they changed */
  proposed?: Recipients | null;
}) {
  const [adding, setAdding] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const showBcc = value.bcc.length > 0 || adding === 'bcc';
  const showCc = value.cc.length > 0 || adding === 'cc' || showBcc;
  const move = (email: string, to: Field | null) => {
    const next: Recipients = { to: value.to.filter((e) => e !== email), cc: value.cc.filter((e) => e !== email), bcc: value.bcc.filter((e) => e !== email) };
    if (to) next[to] = [...next[to], email];
    onChange(next);
  };
  const add = (k: Field) => {
    const e = draft.trim().toLowerCase().replace(/^<|>$/g, '');
    if (!EMAIL_RE.test(e)) { setErr('That is not an email address.'); return; }
    if ([...value.to, ...value.cc, ...value.bcc].includes(e)) { setErr('Already on the reply.'); return; }
    onChange({ ...value, [k]: [...value[k], e] });
    setDraft(''); setAdding(null); setErr(null);
  };
  const wasIn = (email: string): Field | null => (proposed ? (FIELDS.find((f) => proposed[f.k].includes(email))?.k ?? null) : null);
  return (
    <div className="mb-2 text-xs space-y-1">
      {FIELDS.filter((f) => f.k === 'to' || (f.k === 'cc' ? showCc : showBcc)).map((f) => (
        <div key={f.k} className="flex items-center gap-1.5 flex-wrap">
          <span className="w-8 shrink-0" style={{ color: 'var(--text-muted)' }}>{f.label}</span>
          {value[f.k].map((e) => {
            const role = roleOf(reading, e);
            const changed = proposed && wasIn(e) !== f.k;
            return (
              <span key={e} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full"
                style={{ background: 'var(--bg-card)', border: `1px solid ${changed ? 'var(--accent)' : 'var(--border)'}` }}
                title={`${e}${role ? ` · ${role}` : ''}${changed ? ' · you changed this' : ''}`}>
                <span className="max-w-[180px] truncate">{names?.[e] || e}</span>
                {role && <span className="hidden sm:inline" style={{ color: 'var(--text-muted)' }}>· {role}</span>}
                <select value={f.k} onChange={(ev) => move(e, ev.target.value as Field)} aria-label={`Move ${e}`}
                  className="bg-transparent text-[10px] cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                  {FIELDS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
                </select>
                <button type="button" onClick={() => move(e, null)} aria-label={`Remove ${e}`} className="px-1" style={{ color: 'var(--text-muted)' }}>×</button>
              </span>
            );
          })}
          {adding === f.k ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="name@company.com"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(f.k); } if (e.key === 'Escape') { setAdding(null); setDraft(''); setErr(null); } }}
              onBlur={() => { if (draft.trim()) add(f.k); else setAdding(null); }}
              className="z-input !h-6 !py-0 !w-48 text-xs" aria-label={`Add to ${f.label}`} />
          ) : (
            <button type="button" onClick={() => { setAdding(f.k); setErr(null); }} className="underline" style={{ color: 'var(--text-muted)' }}>+ add</button>
          )}
          {f.k === 'to' && !showCc && <button type="button" onClick={() => setAdding('cc')} className="underline" style={{ color: 'var(--text-muted)' }}>Cc</button>}
          {f.k === 'to' && !showBcc && <button type="button" onClick={() => setAdding('bcc')} className="underline" style={{ color: 'var(--text-muted)' }}>Bcc</button>}
        </div>
      ))}
      {!value.to.length && <p style={{ color: 'var(--red)' }}>Add at least one address in To.</p>}
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
}
