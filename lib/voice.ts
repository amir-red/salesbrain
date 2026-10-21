/**
 * Brand & Voice (core 079) — client-safe types and labels. The kernel (policy/voice.py, commands/voice.py,
 * commands/brand.py) owns every rule; this file only names things for the UI. Keep REASONS / TONES / STEPS in step
 * with policy/voice.py.
 */

export type VoiceStep = 'connect' | 'first' | 'followup' | 'reply' | 'intro';
export type VoiceChannel = 'linkedin' | 'email' | 'whatsapp';

/** Sent back with a draft when it is filed: what the model wrote, which drafter, which rules it saw. */
export interface VoiceStamp { draft_original: string; drafted_by: string; voice_rule_ids: string[] }
export interface VoiceFlag { check: string; detail: string }

export const REASONS: { key: string; label: string }[] = [
  { key: 'too_long', label: 'Too long' },
  { key: 'too_pushy', label: 'Too pushy' },
  { key: 'wrong_tone', label: 'Wrong tone' },
  { key: 'wrong_language', label: 'Wrong language' },
  { key: 'wrong_facts', label: 'Wrong facts' },
  { key: 'wrong_person', label: 'Wrong person' },
  { key: 'good', label: 'Good as is' },
];

export const TONES: { key: string; label: string; hint: string }[] = [
  { key: 'professional', label: 'Professional', hint: 'Polished and business-appropriate' },
  { key: 'conversational', label: 'Conversational', hint: 'Warm and natural, like a colleague writing' },
  { key: 'direct', label: 'Direct', hint: 'Short sentences, straight to the point' },
  { key: 'authoritative', label: 'Authoritative', hint: 'Confident and expert, no hedging' },
  { key: 'technical', label: 'Technical', hint: "Precise, uses the reader's own vocabulary" },
  { key: 'casual', label: 'Casual', hint: 'Relaxed and informal' },
  { key: 'consultative', label: 'Consultative', hint: 'Asks about their situation before offering anything' },
];

export const FORMALITY: { key: string; label: string }[] = [
  { key: 'auto', label: 'Match the person (default)' },
  { key: 'formal', label: 'Formal (Sie)' },
  { key: 'informal', label: 'Informal (du)' },
];

export const STEPS: { key: VoiceStep; label: string }[] = [
  { key: 'connect', label: 'Connection note' },
  { key: 'first', label: 'First message' },
  { key: 'followup', label: 'Follow-up' },
  { key: 'reply', label: 'Reply' },
  { key: 'intro', label: 'Intro ask' },
];

export const LIMIT_KEYS: { key: string; label: string; fallback: number }[] = [
  { key: 'linkedin_connect', label: 'LinkedIn connection note', fallback: 45 },
  { key: 'linkedin_first', label: 'LinkedIn first message', fallback: 90 },
  { key: 'linkedin_followup', label: 'LinkedIn follow-up', fallback: 70 },
  { key: 'linkedin_reply', label: 'LinkedIn reply', fallback: 120 },
  { key: 'email_first', label: 'Email first message', fallback: 150 },
  { key: 'email_followup', label: 'Email follow-up', fallback: 100 },
  { key: 'email_reply', label: 'Email reply', fallback: 180 },
];

export interface VoiceRule {
  id: string; scope: 'sender' | 'team' | 'list'; kind: 'rule' | 'never_write'; content: string;
  channels: string[] | null; steps: string[] | null; status: 'active' | 'superseded' | 'archived';
  source: 'stated' | 'edit' | 'rating' | 'shared' | 'weekly' | 'app';
  evidence: { approval_id?: string; before?: string; after?: string | null; rating?: number; reason?: string } | null;
  confirmations: number; created_at: string; owner_user_id?: string | null;
}

export const SOURCE_LABEL: Record<VoiceRule['source'], string> = {
  stated: 'you said so', app: 'added here', edit: 'learned from your edit', rating: 'learned from your rating',
  shared: 'shared by a teammate', weekly: 'weekly tidy-up',
};

export interface CaseStudy { company?: string; challenge?: string; solution?: string; result?: string }
export interface ValueGive { title?: string; description?: string; format?: string; url?: string }
export interface Objection { objection?: string; answer?: string }

export interface Product {
  id: string; name: string; description: string | null; pain: string | null;
  case_studies: CaseStudy[]; value_gives: ValueGive[]; objections: Objection[];
}
export interface Competitor { id: string; name: string; domain: string | null; differentiation: string | null }
export interface MessageTemplate {
  id: string; name: string; channels: string[]; step: VoiceStep; kind: 'guided' | 'fixed'; subject: string | null;
  body: string; tag: string | null; owner_user_id: string | null;
}
export interface Brand {
  id: string; key: string; name: string; website: string | null; industry: string | null; description: string | null;
  pain_points: string | null; tone: string; formality: string; language: string | null; never_write: string[];
  limits: Record<string, number>; ai_drafted: Record<string, string>; updated_at: string;
}
export interface BrandPayload {
  brand: Brand; products: Product[]; competitors: Competitor[]; templates: MessageTemplate[]; missing: string[];
}

export interface FeedbackResult {
  decision?: 'learn' | 'golden' | 'none'; rating?: number | null; reason?: string | null;
  learned?: VoiceRule[]; reinforced?: VoiceRule[]; say?: string; note?: string; error?: string;
}
