/**
 * The warm lane (funnel Phase C, core migration 089). The kernel scores warmth (policy/warmth.py); this file carries
 * the words, colours and API shapes. Client-safe.
 */

export const WARMTH_BANDS = { hot: 'Hot', warm: 'Warm', cool: 'Cool', cold: 'Cold' } as const;
export type WarmthBand = keyof typeof WARMTH_BANDS;

export const WARMTH_COLOR: Record<WarmthBand, string> = {
  hot: 'var(--red)',
  warm: 'var(--orange)',
  cool: 'var(--cat-blue)',
  cold: 'var(--text-muted)',
};

export interface WarmPerson {
  person_id: string;
  name: string;
  company: string | null;
  headline: string | null;
  linkedin: string | null;
  email: string | null;
  warmth: number;
  band: WarmthBand;
  reasons: string[];
  via: { id: string; name: string };
  last_two_way_at: string | null;
  last_touch_at: string | null;
  fit: number | null;
  list: string | null;
  prospect_id: string | null;
  stage: string | null;
  resting: boolean;
  has_card: boolean;
  being_worked: boolean;
}

export interface WarmPeople {
  people: WarmPerson[];
  total: number;
  by_band: Partial<Record<WarmthBand, number>>;
  left_out_being_worked: number;
  owner: { id: string; name: string } | null;
  band: WarmthBand;
  note?: string;
}

export interface InsightRow {
  value: string; contacted: number; answered: number; meetings: number;
  answer_rate: number | null; meeting_rate: number | null; enough: boolean;
}

export interface FunnelInsights {
  overall: { contacted: number; answered: number; answer_rate: number | null; meetings: number; meeting_rate: number | null };
  dimensions: Record<string, { label: string; rows: InsightRow[] }>;
  findings: { dimension: string; value: string; kind: 'works' | 'weak'; ratio: number; text: string }[];
  suggestions: string[];
  note: string | null;
}

export function linkedinUrl(handle: string | null): string | null {
  if (!handle) return null;
  return handle.startsWith('http') ? handle : `https://www.linkedin.com/in/${handle.replace(/^\/+|\/+$/g, '')}`;
}
