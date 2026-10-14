/**
 * Contract for per-person agent memory (core `agent_memories`, migration 055).
 * Mirrors `salesbrain_core.commands.memory`; reads come through the app-only
 * kernel RPCs `memory_list` / `memory_team_overview`, writes through the
 * `crm_memory_*` tools (same gate and audit as in chat).
 */

export type MemoryScope = 'personal' | 'team';
export type MemoryKind = 'preference' | 'fact' | 'rule' | 'procedure';
export type MemoryStatus = 'active' | 'proposed' | 'superseded' | 'archived';
export type MemorySource = 'conversation' | 'review' | 'promotion' | 'app';

export type Memory = {
  id: string;
  owner_user_id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  status: MemoryStatus;
  source: MemorySource;
  supersedes_id: string | null;
  shared_from_id: string | null;
  hermes_session_id: string | null;
  created_by: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  owner_name?: string | null;
  owner_email?: string | null;
};

export type MemoryList = { memories: Memory[]; user_id: string };

export type TeamOverview = {
  proposed: Memory[];
  active: Memory[];
  per_user: { user_id: string; name: string | null; email: string; personal_active: number; learned_by_review: number; last_at: string | null }[];
};

export const KIND_LABELS: Record<MemoryKind, string> = {
  rule: 'rule', preference: 'preference', fact: 'fact', procedure: 'procedure',
};

export const SOURCE_LABELS: Record<MemorySource, string> = {
  conversation: 'you asked in chat',
  review: 'learned from a conversation',
  promotion: 'shared from a personal note',
  app: 'added here',
};

export function statusLabel(m: Memory): string {
  if (m.status === 'proposed') return 'awaiting admin approval';
  if (m.status === 'superseded') return 'forgotten';
  if (m.status === 'archived') return 'archived';
  return m.scope === 'team' ? 'shared with the team' : 'active';
}
