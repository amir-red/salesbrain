'use client';

import { useState } from 'react';

/**
 * Modal that captures a structured "lesson learned" at the moment a deal
 * is marked lost. The Submit fires `POST /api/deals/:id/mark-lost` which
 * atomically flips the deal status AND inserts the lesson row.
 *
 * Designed to be reused: drop it on the deal page header, or anywhere
 * else we want to surface the same flow. Caller controls open/close.
 */

const ROOT_CAUSES = [
  { value: 'price', label: 'Price — they wanted cheaper, we couldn\'t match' },
  { value: 'timeline', label: 'Timeline — they needed it sooner / later than we could' },
  { value: 'fit', label: 'Fit — solution didn\'t match their problem' },
  { value: 'decision_maker', label: 'Decision-maker — wrong person, no champion' },
  { value: 'capability', label: 'Capability — they doubted our ability to deliver' },
  { value: 'competition', label: 'Competition — another vendor won' },
  { value: 'budget', label: 'Budget — they had no money / their ceiling was below us' },
  { value: 'eligibility', label: 'Eligibility — structural disqualifier (grants: donor entity rules, geography, sector, org-age)' },
  { value: 'other', label: 'Other (describe in reason)' },
] as const;

type RootCause = typeof ROOT_CAUSES[number]['value'];

export interface MarkAsLostModalProps {
  dealId: string;
  dealName: string;
  dealType: 'sales' | 'grant';
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful mark-lost. Caller decides how to refresh. */
  onMarked: (lessonId: string) => void;
}

export default function MarkAsLostModal({
  dealId,
  dealName,
  dealType,
  isOpen,
  onClose,
  onMarked,
}: MarkAsLostModalProps) {
  const [reason, setReason] = useState('');
  const [rootCause, setRootCause] = useState<RootCause | ''>('');
  const [competitor, setCompetitor] = useState('');
  const [lesson, setLesson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const canSubmit = reason.trim().length > 0 && lesson.trim().length > 0 && rootCause !== '';

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/mark-lost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          root_cause: rootCause,
          competitor: competitor.trim() || null,
          lesson: lesson.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to mark lost');
      onMarked(data.lesson_id || '');
      // Clear locally so opening again doesn't show stale text
      setReason(''); setCompetitor(''); setLesson(''); setRootCause('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--red, #ef4444)' }}>
            Mark as Lost
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Capture <strong>why</strong> we lost <span style={{ color: 'var(--text)' }}>{dealName}</span> — so we don&apos;t make the same mistake on the next {dealType === 'grant' ? 'grant' : 'deal'}.
          </p>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {error && (
            <div className="rounded p-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              {error}
            </div>
          )}

          <Field label="What happened?" required>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={dealType === 'grant'
                ? `e.g. "Donor wanted only registered NGOs; we're a private company. Eligibility was a hard no — they emailed us a polite decline two weeks after submission."`
                : `e.g. "Client wanted on-prem at ~$25K. We quoted SaaS at $40K. They went with a smaller vendor offering on-prem at $22K."`}
              className="w-full px-3 py-2 rounded text-sm outline-none resize-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </Field>

          <Field label="Root cause" required>
            <select
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value as RootCause)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <option value="">— Pick one —</option>
              {ROOT_CAUSES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Competitor / winner (if known)">
            <input
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              placeholder={dealType === 'grant' ? 'e.g. "BrightFund grant program"' : 'e.g. "OnPremCo"'}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </Field>

          <Field label="Lesson for next time" required>
            <textarea
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              rows={3}
              placeholder={`e.g. "Always ask the buyer's hard budget ceiling at G2. If our proposed price is >20% above it, disqualify or re-scope before drafting an offer."`}
              className="w-full px-3 py-2 rounded text-sm outline-none resize-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              This is what the agent will surface when a similar new deal comes in. Make it concrete and actionable.
            </p>
          </Field>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
            style={{ background: '#ef4444' }}
          >
            {submitting ? 'Saving…' : 'Mark as Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </label>
      {children}
    </div>
  );
}
