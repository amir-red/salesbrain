/**
 * The trust score as the app shows it (core migration 095). Mirrors salesbrain-core policy/trust_score.py
 * (PARTS, PART_LABELS, VALUE_LABELS, band); test_trust_parity.py keeps them in step — change both.
 * Client-safe: no DB, no IO.
 */
export const TRUST_PARTS = ['authority', 'trust', 'fit', 'openness'] as const;
export type TrustPart = (typeof TRUST_PARTS)[number];

export const PART_LABELS: Record<TrustPart, string> = {
  authority: 'Decision authority', trust: 'Warmth & trust path', fit: 'Market & P&L fit', openness: 'Openness & speed',
};
export const PART_SHORT: Record<TrustPart, string> = { authority: 'Authority', trust: 'Trust path', fit: 'Fit', openness: 'Openness' };
export const DEFAULT_WEIGHTS: Record<TrustPart, number> = { authority: 30, trust: 30, fit: 20, openness: 20 };

export const VALUE_LABELS: Record<string, string> = {
  buyer: 'could buy', connector: 'could introduce us', both: 'could buy or introduce us', none: 'no clear value yet',
};
export const TRUST_KIND_LABELS: Record<string, string> = {
  own: 'our own tie', route: 'via someone who knows them', mutual: 'mutual connections', connected: '1st degree, nothing written yet', none: 'no path yet',
};

export type TrustBand = 'top' | 'good' | 'fair' | 'low' | 'unscored';

/** Same thresholds as policy/trust_score.band. */
export function trustBand(total: number | null | undefined): TrustBand {
  if (total == null) return 'unscored';
  return total >= 70 ? 'top' : total >= 50 ? 'good' : total >= 30 ? 'fair' : 'low';
}

export const BAND_COLOR: Record<TrustBand, string> = {
  top: 'var(--green)', good: 'var(--yellow)', fair: 'var(--orange)', low: 'var(--red)', unscored: 'var(--text-muted)',
};

/** What a row carries about its score (the list and queue routes select these next to the person). */
export interface TrustSummary {
  trust_total?: number | null;
  trust_parts?: Partial<Record<TrustPart, number>> | null;
  trust_why?: string | null;
  trust_via?: string | null;
  trust_kind?: string | null;
  value_to_us?: string | null;
  multiplier?: number | null;
  held?: number | null;
  has_feedback?: boolean | null;
}

/** The parts as fractions of their weights, for the four small bars. */
export function partFractions(parts: Partial<Record<TrustPart, number>> | null | undefined,
                              weights: Partial<Record<TrustPart, number>> | null | undefined = DEFAULT_WEIGHTS) {
  return TRUST_PARTS.map((p) => {
    const max = Math.max(1, Number(weights?.[p] ?? DEFAULT_WEIGHTS[p]));
    const v = Number(parts?.[p] ?? 0);
    return { part: p, label: PART_SHORT[p], points: v, max, fraction: Math.max(0, Math.min(1, v / max)) };
  });
}
