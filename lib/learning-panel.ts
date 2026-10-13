/**
 * Contract for /admin/learning — the human side of Hermes' self-improvement
 * loop. Mirrors `salesbrain_hermes.learning` (ring); the kernel RPC
 * `learning_pending` / `learning_decide` are app-only (never agent tools).
 */

export type Subsystem = 'skills' | 'memory';
export type Decision = 'approve' | 'reject';

export type SurfaceStatus = { configured: boolean; skills: boolean; memory: boolean; toolsets: string[] };

export type LoopStatus = {
  memory_enabled: boolean;
  user_profile_enabled: boolean;
  memory_nudge_interval: number;
  memory_write_approval: boolean;
  memory_provider: string | null;
  skills_write_approval: boolean;
  skills_nudge_interval: number;
  skills_create_dir: string | null;
  skills_external_dirs: string[];
  review_model: string | null;
  review_provider: string | null;
  review_enabled: boolean;
  curator_enabled: boolean;
  curator_consolidate: boolean;
  surfaces: Record<'telegram' | 'api_server' | 'cron', SurfaceStatus>;
};

export type PendingWrite = {
  id: string;
  subsystem: Subsystem;
  action: string | null;
  summary: string | null;
  origin: string | null;
  created_at: number;
  age_days: number | null;
  // skills
  skill?: string | null;
  targets_repo_skill?: boolean;
  diff?: string;
  // memory
  target?: string | null;
  content?: string | null;
  old_text?: string | null;
};

export type AgentSkill = { name: string; description: string; chars: number; updated_at: number; path: string };

export type ProfileLearning = {
  profile: string;
  home: string;
  status: LoopStatus;
  pending_skills: PendingWrite[];
  pending_memory: PendingWrite[];
  memory: Record<'MEMORY.md' | 'USER.md', { text: string; chars: number; updated_at: number | null }>;
  agent_skills: AgentSkill[];
  curator: Record<string, unknown> | null;
};

export type LearningReport = { profiles: ProfileLearning[]; pending_total: number; root: string };

export const SURFACE_LABELS: Record<keyof LoopStatus['surfaces'], string> = {
  telegram: 'Telegram',
  api_server: 'Web chat',
  cron: 'Routines',
};

export const PROFILE_LABELS: Record<string, string> = {
  default: "Amir's admin agent (default)",
  crm: 'Team CRM bot (crm)',
};

export function profileLabel(name: string): string {
  return PROFILE_LABELS[name] ?? name;
}

export function originLabel(origin: string | null | undefined): string {
  if (origin === 'background_review') return 'background review';
  if (origin === 'foreground') return 'in a conversation';
  return origin || 'unknown';
}

/** Every surface where the loop is wired = both toolsets present AND memory on. */
export function loopHealth(st: LoopStatus): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!st.memory_enabled) problems.push('built-in memory is off (memory.memory_enabled)');
  if (!(st.memory_nudge_interval > 0)) problems.push('memory review never runs (memory.nudge_interval = 0)');
  if (!st.review_enabled) problems.push('background review disabled (auxiliary.background_review.enabled)');
  if (!st.skills_write_approval) problems.push('skill writes are NOT gated (skills.write_approval off)');
  for (const key of ['telegram', 'api_server'] as const) {
    const s = st.surfaces[key];
    const missing = (['skills', 'memory'] as const).filter((t) => !s[t]);
    if (s.configured && missing.length) problems.push(`${SURFACE_LABELS[key]} lacks ${missing.join(' + ')}`);
  }
  return { ok: problems.length === 0, problems };
}

export function fmtAge(days: number | null | undefined): string {
  if (days == null) return '';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  return `${Math.round(days)} d`;
}
