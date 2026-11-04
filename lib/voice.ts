/**
 * Brand & Voice (core 079) + the AI learns the sender (core 098) — client-safe types and labels. The kernel
 * (policy/voice.py, policy/sender_style.py, policy/sender_trust.py, commands/*) owns every rule; this file only
 * names things for the UI. Keep REASONS / CHIP_ROW / TONES / STEPS in step with policy/voice.py.
 */

export type VoiceStep = 'connect' | 'first' | 'followup' | 'reply' | 'intro';
export type VoiceChannel = 'linkedin' | 'email' | 'whatsapp';

/** Sent back with a draft when it is filed: what the model wrote, which drafter, which rules it saw — and since 098
 * why it wrote it, which facts, which profile version and examples, the trust level at the time. */
export interface VoiceStamp {
  draft_original: string; drafted_by: string; voice_rule_ids: string[];
  draft_reasoning?: string | null; draft_facts?: string[]; draft_situation?: VoiceStep;
  sender_profile_version?: number | null; example_ids?: string[]; trust_level_at_draft?: string | null;
}
export interface VoiceFlag { check: string; detail: string }

export const REASONS: { key: string; label: string }[] = [
  { key: 'too_long', label: 'Too long' },
  { key: 'too_pushy', label: 'Too pushy' },
  { key: 'wrong_tone', label: 'Wrong tone' },
  { key: 'wrong_step', label: 'Wrong step' },
  { key: 'missed_link', label: "Didn't use our link" },
  { key: 'wrong_language', label: 'Wrong language' },
  { key: 'wrong_facts', label: 'Wrong facts' },
  { key: 'not_my_words', label: 'Not my words' },
  { key: 'wrong_person', label: 'Wrong person' },
  { key: 'good', label: 'Good as is' },
];
/** The one row of chips shown after a skip or an edited send (098). */
export const CHIP_ROW = ['too_long', 'wrong_step', 'missed_link', 'wrong_language', 'wrong_facts', 'not_my_words'];

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

export type RuleKind = 'rule' | 'never_write' | 'judgment';

export interface VoiceRule {
  id: string; scope: 'sender' | 'team' | 'list'; kind: RuleKind; content: string;
  channels: string[] | null; steps: string[] | null; status: 'active' | 'superseded' | 'archived';
  source: 'stated' | 'edit' | 'rating' | 'shared' | 'weekly' | 'app';
  evidence: { approval_id?: string; before?: string; after?: string | null; rating?: number; reason?: string } | null;
  confirmations: number; created_at: string; owner_user_id?: string | null; position?: number | null;
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
  decision?: 'learn' | 'golden' | 'none'; rating?: number | null; reason?: string | null; keys?: string[];
  fact_noted?: string | null; learned?: VoiceRule[]; reinforced?: VoiceRule[]; say?: string; note?: string; error?: string;
}

/** 098: the measured style of one sender for one channel × language. */
export interface SenderProfile {
  id: string; channel: string; language: string; version: number; n_messages: number; active: boolean;
  eval_score: number | null; built_at: string; activated_at: string | null; block: string;
  measured: { n?: number; words?: { mean: number; p25: number; p75: number }; greetings?: [string, number][];
              signoffs?: [string, number][]; question_pct?: number; du_pct?: number | null; sie_pct?: number | null;
              languages?: { de: number; en: number } };
}
export interface CorpusChannel {
  n: number; replied: number; reply_known: number; hand_written: number; newest: string | null; oldest: string | null;
  situations: Record<string, number>;
}
export interface SenderProfilePayload {
  owner_user_id: string; profiles: SenderProfile[]; corpus: Record<string, CorpusChannel> | null; error?: string;
}

/** 098: the trust ladder, one row per situation × channel. */
export type TrustLevel = 'shadow' | 'draft' | 'trusted' | 'autonomous';
export interface SenderTrustRow {
  situation: VoiceStep; channel: VoiceChannel; level: TrustLevel; opted_in: boolean; unchanged_streak: number;
  eval_score: number | null; last_reset_at: string | null; reset_reason: string | null; needs: string[]; promotable: boolean;
}
export interface SenderTrustPayload {
  owner_user_id: string; slices: SenderTrustRow[]; trust_after: number; eval_min: number; auto_send_enabled: boolean; error?: string;
}
export const TRUST_LABEL: Record<TrustLevel, string> = {
  shadow: 'measured only', draft: 'you decide every draft', trusted: 'sends without a tap', autonomous: 'sends without a tap (admin-set)',
};

export interface DraftEval {
  id: string; run_at: string; channel: string; situation: string | null; n: number; mean_similarity: number | null;
  judge_mean: number | null; score: number | null; profile_version: number | null; kept: boolean | null;
}

/** 098: a filed draft as the feedback UI reads it (GET /api/drafts/[id]). */
export interface DraftRecord {
  id: string; status: string; message: string; draft_original: string | null; draft_reasoning: string | null;
  draft_facts: string[] | null; edit_ratio: number | null; rating: number | null; feedback_source: string | null;
  feedback_keys: string[] | null; decided_by: 'human' | 'auto' | null; kind: string; channel: string;
}
