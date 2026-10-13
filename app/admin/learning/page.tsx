'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SectionCard from '@/components/panel/SectionCard';
import StatTile from '@/components/panel/StatTile';
import {
  fmtAge, loopHealth, originLabel, profileLabel, SURFACE_LABELS,
} from '@/lib/learning-panel';
import type { Decision, LearningReport, PendingWrite, ProfileLearning, Subsystem } from '@/lib/learning-panel';

/**
 * /admin/learning — what the agents learned and want to keep. Hermes stages
 * every agent-written skill (and, on the team bot, every memory note) for a
 * human; this is the review surface, plus the loop's health per profile and
 * surface, the memory files, and the skills the agents wrote themselves.
 * One kernel call per load (`learning_pending`, app-only); refreshed by hand.
 */
export default function LearningAdminPage() {
  const [data, setData] = useState<LearningReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/learning');
      if (res.status === 403) { setForbidden(true); return; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load the learning queue');
      setData(json as LearningReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (profile: string, subsystem: Subsystem, id: string, decision: Decision) => {
    const key = `${profile}/${subsystem}/${id}`;
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/learning/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, subsystem, id, decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || json.message || `Decision failed (${res.status})`);
      setNotice(json.message || `${decision === 'approve' ? 'Applied' : 'Rejected'} ${id}`);
      await load();
    } catch (e) {
      setNotice(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  }, [load]);

  const total = data?.pending_total ?? 0;
  const skillsPending = data?.profiles.reduce((n, p) => n + p.pending_skills.length, 0) ?? 0;
  const memoryPending = data?.profiles.reduce((n, p) => n + p.pending_memory.length, 0) ?? 0;
  const agentSkills = data?.profiles.reduce((n, p) => n + p.agent_skills.length, 0) ?? 0;
  const unhealthy = data?.profiles.filter((p) => !loopHealth(p.status).ok).length ?? 0;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Learning</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              What the agents learned and want to keep — staged skill and memory writes awaiting your review, and whether the loop is wired on every surface
              {' · '}<button onClick={() => load()} className="underline" disabled={loading}>{loading ? 'loading…' : 'refresh'}</button>
            </p>
          </div>
        </div>

        <div className="p-4 space-y-4 max-w-6xl">
          {forbidden && <Banner tone="red">Admin only.</Banner>}
          {error && <Banner tone="red">{error}</Banner>}
          {notice && <Banner tone={notice.startsWith('Error') ? 'red' : 'green'}>{notice}</Banner>}

          {data && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Awaiting review" value={String(total)} sub={`${skillsPending} skill · ${memoryPending} memory`}
                        color={total ? 'var(--yellow)' : undefined} />
              <StatTile label="Agent-written skills" value={String(agentSkills)} sub="in skills-agent" />
              <StatTile label="Profiles" value={String(data.profiles.length)} sub={unhealthy ? `${unhealthy} not fully wired` : 'loop wired everywhere'}
                        color={unhealthy ? 'var(--red)' : 'var(--green)'} />
              <StatTile label="Review model" value={data.profiles[0]?.status.review_model ? 'routed' : 'main model'}
                        sub={data.profiles[0]?.status.review_model || 'background review runs on the chat model'} />
            </div>
          )}

          {data?.profiles.map((p) => (
            <ProfileSection key={p.profile} p={p} busy={busy} decide={decide} />
          ))}

          {data && total === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Nothing is waiting. The agents stage a write when a conversation taught them something: a correction, a preference, a procedure worth repeating.
              In chat, <code>/skills pending</code> and <code>/memory pending</code> show the same queue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  const color = tone === 'red' ? 'var(--red)' : 'var(--green)';
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)` }}>
      {children}
    </div>
  );
}

function ProfileSection({ p, busy, decide }: {
  p: ProfileLearning; busy: string | null;
  decide: (profile: string, subsystem: Subsystem, id: string, decision: Decision) => Promise<void>;
}) {
  const health = loopHealth(p.status);
  const [showMemory, setShowMemory] = useState(false);
  return (
    <SectionCard
      title={profileLabel(p.profile)}
      subtitle={p.home}
      tone={health.ok ? undefined : 'warn'}
      right={<span className="text-[11px]" style={{ color: health.ok ? 'var(--green)' : 'var(--red)' }}>{health.ok ? 'loop wired' : `${health.problems.length} issue(s)`}</span>}
    >
      <div className="space-y-4">
        {/* Loop status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
          {(Object.keys(SURFACE_LABELS) as Array<keyof typeof SURFACE_LABELS>).map((k) => {
            const s = p.status.surfaces[k];
            return (
              <div key={k} className="rounded-lg p-2" style={{ border: '1px solid var(--border)' }}>
                <div className="font-semibold">{SURFACE_LABELS[k]}</div>
                {!s.configured ? (
                  <div style={{ color: 'var(--text-muted)' }}>not configured on this profile</div>
                ) : (
                  <div className="flex gap-2 mt-1">
                    <Pill on={s.skills} label="skills" />
                    <Pill on={s.memory} label="memory" />
                    <span style={{ color: 'var(--text-muted)' }}>{s.toolsets.filter((t) => t.startsWith('crm_')).length} crm families</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span>memory: {p.status.memory_enabled ? 'on' : 'OFF'} · review every {p.status.memory_nudge_interval} turns · writes {p.status.memory_write_approval ? 'staged' : 'direct'}</span>
          <span>skills: nudge every {p.status.skills_nudge_interval} iterations · writes {p.status.skills_write_approval ? 'staged' : 'DIRECT'}</span>
          <span>review: {p.status.review_enabled ? (p.status.review_model || 'main model') : 'disabled'}</span>
          <span>curator: {p.status.curator_enabled ? (p.status.curator_consolidate ? 'prune + consolidate' : 'prune only') : 'off'}</span>
        </div>
        {!health.ok && (
          <ul className="text-[11px] list-disc pl-4" style={{ color: 'var(--red)' }}>
            {health.problems.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}

        {/* Pending writes */}
        {(p.pending_skills.length + p.pending_memory.length) > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold">Awaiting review</div>
            {[...p.pending_skills, ...p.pending_memory].map((w) => (
              <PendingCard key={`${w.subsystem}/${w.id}`} w={w} busy={busy === `${p.profile}/${w.subsystem}/${w.id}`}
                           onDecide={(d) => decide(p.profile, w.subsystem, w.id, d)} />
            ))}
          </div>
        )}

        {/* Agent-written skills */}
        {p.agent_skills.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-1">Skills the agents wrote</div>
            <ul className="text-[11px] space-y-0.5">
              {p.agent_skills.map((s) => (
                <li key={s.name}><span className="font-mono">{s.name}</span> <span style={{ color: 'var(--text-muted)' }}>— {s.description || 'no description'} · {new Date(s.updated_at * 1000).toLocaleDateString()}</span></li>
              ))}
            </ul>
          </div>
        )}

        {/* Memory files */}
        <div>
          <button className="text-xs underline" onClick={() => setShowMemory((v) => !v)}>
            {showMemory ? 'hide' : 'show'} memory files ({p.memory['MEMORY.md'].chars + p.memory['USER.md'].chars} chars)
          </button>
          {showMemory && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              {(['MEMORY.md', 'USER.md'] as const).map((f) => (
                <div key={f} className="rounded-lg p-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                  <div className="text-[11px] font-semibold mb-1">{f} <span style={{ color: 'var(--text-muted)' }}>· {p.memory[f].chars} chars</span></div>
                  <pre className="text-[11px] whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{p.memory[f].text || '(empty)'}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function Pill({ on, label }: { on: boolean; label: string }) {
  const color = on ? 'var(--green)' : 'var(--red)';
  return (
    <span className="rounded-full px-2 py-0.5" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      {label} {on ? '✓' : '✗'}
    </span>
  );
}

function PendingCard({ w, busy, onDecide }: { w: PendingWrite; busy: boolean; onDecide: (d: Decision) => void }) {
  const [open, setOpen] = useState(false);
  const isSkill = w.subsystem === 'skills';
  return (
    <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs">
          <span className="rounded-full px-2 py-0.5 mr-2 text-[10px] uppercase tracking-wide"
                style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
            {isSkill ? `skill · ${w.action || 'write'}` : `memory · ${w.action || 'write'}${w.target ? ` → ${w.target}` : ''}`}
          </span>
          <span className="font-semibold">{isSkill ? (w.skill || w.summary) : (w.content || w.summary)}</span>
          <span className="ml-2" style={{ color: 'var(--text-muted)' }}>from {originLabel(w.origin)} · {fmtAge(w.age_days)} ago · #{w.id}</span>
        </div>
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => onDecide('approve')} className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)', opacity: busy ? 0.6 : 1 }}>
            {busy ? '…' : isSkill ? 'Approve & apply' : 'Approve & save'}
          </button>
          <button disabled={busy} onClick={() => onDecide('reject')} className="rounded-full px-3 py-1 text-xs"
                  style={{ border: '1px solid var(--border)', opacity: busy ? 0.6 : 1 }}>Reject</button>
        </div>
      </div>
      {w.targets_repo_skill && (
        <div className="text-[11px]" style={{ color: 'var(--orange)' }}>
          Targets a git-deployed skill: approving applies it on the box, but the next deploy overwrites it — port the change into assets/skills/ in the repo.
        </div>
      )}
      {isSkill && w.summary && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{w.summary}</div>}
      {!isSkill && w.old_text && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>replaces: {w.old_text}</div>}
      {isSkill && w.diff && (
        <div>
          <button className="text-[11px] underline" onClick={() => setOpen((v) => !v)}>{open ? 'hide' : 'show'} diff</button>
          {open && <pre className="mt-1 text-[11px] whitespace-pre-wrap break-words max-h-96 overflow-y-auto">{w.diff}</pre>}
        </div>
      )}
    </div>
  );
}
