/**
 * Server-only agent memory store.
 *
 * Memories are plain markdown files under `memory/` in the repo:
 *   - memory/org.md                 → team-wide lessons (everyone reads + writes)
 *   - memory/users/<localpart>.md   → per-user preferences (only owner reads/writes)
 *
 * Each bullet ends with an HTML comment carrying a stable `mem_xxxx` id +
 * writer + date + source deal — invisible in markdown previews, parseable
 * here so the agent can address memories by id (e.g. for the `forget` tool).
 *
 * Writes are serialized through a per-file in-process mutex (single PM2
 * worker → no cross-process race) and auto-committed to git so they survive
 * deploys and give us free history. Push failures are logged but don't fail
 * the agent turn — the next write does `git pull --rebase` first to recover.
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

// ─── Paths ──────────────────────────────────────────────────────

const MEMORY_DIR = path.join(process.cwd(), 'memory');
const ORG_FILE = path.join(MEMORY_DIR, 'org.md');
const USERS_DIR = path.join(MEMORY_DIR, 'users');

// ─── Filename slug for per-user files ──────────────────────────

/**
 * Derive the per-user filename from an email. `amir@chipchip.social` →
 * `amir`. Lowercased, stripped of anything not [a-z0-9_-]. Collisions
 * across domains (vanishingly rare on a single-org tool) are resolved at
 * first-write by appending a domain hint.
 */
export function userSlug(email: string): string {
  const local = email.toLowerCase().split('@')[0] || 'unknown';
  return local.replace(/[^a-z0-9_\-]/g, '-');
}

function userFile(email: string): string {
  return path.join(USERS_DIR, `${userSlug(email)}.md`);
}

// ─── Mem ID generation ─────────────────────────────────────────

/** Short 4-char hex id, prefixed `mem_`. Cheap, human-typeable, collision-acceptable at this scale. */
function newMemId(): string {
  return 'mem_' + crypto.randomBytes(2).toString('hex');
}

// ─── Bullet parser ─────────────────────────────────────────────

export interface MemoryBullet {
  id: string | null;       // mem_xxxx parsed from the trailing comment, or null
  fact: string;            // bullet text, without the leading dash and provenance comment
  raw: string;             // the exact line as it appears in the file (for surgical edits)
}

/** Parse `- some fact <!-- mem_a1b2 · ... -->` into `{id, fact, raw}`. */
function parseLine(line: string): MemoryBullet | null {
  const trimmed = line.trimEnd();
  // Match a markdown bullet: leading `- ` or `* `.
  const m = trimmed.match(/^[-*]\s+(.*)$/);
  if (!m) return null;
  let body = m[1];

  let id: string | null = null;
  // Strip a trailing HTML comment if present, capturing mem_xxxx.
  const commentMatch = body.match(/\s*<!--\s*(mem_[a-z0-9]+)[\s\S]*?-->\s*$/i);
  if (commentMatch) {
    id = commentMatch[1];
    body = body.slice(0, commentMatch.index).trimEnd();
  }

  return { id, fact: body, raw: line };
}

export async function readBullets(filePath: string): Promise<MemoryBullet[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: MemoryBullet[] = [];
  for (const line of text.split(/\r?\n/)) {
    const b = parseLine(line);
    if (b && b.fact.trim() && !/^_\(.*\)_$/.test(b.fact.trim())) {
      out.push(b);
    }
  }
  return out;
}

// ─── Per-file mutex ────────────────────────────────────────────

const locks = new Map<string, Promise<void>>();
async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(filePath, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Clean up the map when the chain settles to avoid unbounded growth.
    if (locks.get(filePath) === next.then(() => undefined)) {
      locks.delete(filePath);
    }
  }
}

// ─── Git helper ────────────────────────────────────────────────

/**
 * Stage + commit the given paths. Push is best-effort: failure is logged
 * but does not throw. Disabled in tests/CI via SALESBRAIN_MEMORY_GIT=off.
 */
async function gitCommit(message: string, files: string[]): Promise<void> {
  if (process.env.SALESBRAIN_MEMORY_GIT === 'off') return;
  const cwd = process.cwd();
  try {
    // Pull --rebase first so a stale local tree doesn't block the commit.
    // Failures here are non-fatal (e.g. detached HEAD, no remote).
    try { await execFileP('git', ['pull', '--rebase', '--autostash'], { cwd }); } catch { /* non-fatal */ }
    await execFileP('git', ['add', ...files], { cwd });
    // Allow empty in case the change was already staged elsewhere.
    await execFileP('git', ['commit', '-m', message, '--allow-empty', '--no-verify'], { cwd });
    try { await execFileP('git', ['push'], { cwd }); } catch (e) {
      console.warn('[memory] git push failed (memory still saved locally):', (e as Error).message);
    }
  } catch (err) {
    console.warn('[memory] git commit failed:', (err as Error).message);
  }
}

// ─── Atomic write ──────────────────────────────────────────────

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, filePath);
}

// ─── Header bootstrap ──────────────────────────────────────────

function defaultHeader(scope: 'org' | 'user', label: string): string {
  if (scope === 'org') {
    return '# Team lessons\n\n';
  }
  return `# Preferences for ${label}\n\n`;
}

// ─── Public API ────────────────────────────────────────────────

export interface AppendCtx {
  byEmail?: string;       // who wrote it (for provenance)
  sourceDealId?: string;  // deal id this lesson came from
}

/**
 * Append a new fact to a scope. Returns the freshly-generated mem id.
 * For user scope, `userEmail` selects the file (`users/<slug>.md`).
 */
export async function appendMemory(
  scope: 'org' | 'user',
  fact: string,
  opts: { userEmail?: string } & AppendCtx
): Promise<string> {
  const filePath = scope === 'org' ? ORG_FILE : userFile(opts.userEmail || 'unknown');
  return withLock(filePath, async () => {
    let existing = '';
    try { existing = await fs.readFile(filePath, 'utf8'); } catch { /* will bootstrap */ }
    if (!existing.trim()) {
      const label = scope === 'user' ? (opts.userEmail || 'this user') : '';
      existing = defaultHeader(scope, label);
    } else if (!existing.endsWith('\n')) {
      existing += '\n';
    }
    // If the file still has the empty-state placeholder, strip it.
    existing = existing.replace(/^_\(empty.*?\)_\s*$/im, '').replace(/\n{3,}/g, '\n\n');

    const id = newMemId();
    const cleanFact = fact.trim().replace(/\s*\n\s*/g, ' ');
    const date = new Date().toISOString().slice(0, 10);
    const writerBit = opts.byEmail ? ` by ${userSlug(opts.byEmail)}` : '';
    const sourceBit = opts.sourceDealId ? ` · from deal ${opts.sourceDealId.slice(0, 8)}` : '';
    const line = `- ${cleanFact} <!-- ${id} · added ${date}${writerBit}${sourceBit} -->\n`;

    const next = (existing.endsWith('\n\n') ? existing : existing + (existing.endsWith('\n') ? '' : '\n')) + line;
    await atomicWrite(filePath, next);
    const rel = path.relative(process.cwd(), filePath);
    await gitCommit(`mem: ${scope} · ${cleanFact.slice(0, 60)}`, [rel]);
    return id;
  });
}

/**
 * Remove a memory by `mem_xxxx` id. Searches the org file and (if userEmail
 * given) that user's file. Returns true if a row was removed.
 */
export async function removeMemory(
  memId: string,
  opts: { userEmail?: string } & { byEmail?: string }
): Promise<{ removed: boolean; scope?: 'org' | 'user' }> {
  const candidates: Array<{ path: string; scope: 'org' | 'user' }> = [
    { path: ORG_FILE, scope: 'org' },
  ];
  if (opts.userEmail) candidates.push({ path: userFile(opts.userEmail), scope: 'user' });

  for (const c of candidates) {
    const removed = await withLock(c.path, async () => {
      let text: string;
      try { text = await fs.readFile(c.path, 'utf8'); } catch { return false; }
      const lines = text.split(/\r?\n/);
      let hit = false;
      const kept = lines.filter((line) => {
        const b = parseLine(line);
        if (b && b.id === memId) { hit = true; return false; }
        return true;
      });
      if (!hit) return false;
      // Collapse triple-blank-lines produced by the deletion.
      const next = kept.join('\n').replace(/\n{3,}/g, '\n\n');
      await atomicWrite(c.path, next);
      const rel = path.relative(process.cwd(), c.path);
      await gitCommit(`mem: ${c.scope} · forget ${memId}`, [rel]);
      return true;
    });
    if (removed) return { removed: true, scope: c.scope };
  }
  return { removed: false };
}

/**
 * Load org + (optionally) per-user memories for prompt injection.
 * Returns parsed bullet arrays; the prompt renderer formats them.
 */
export async function loadMemoriesForPrompt(userEmail?: string): Promise<{
  org: MemoryBullet[];
  user: MemoryBullet[];
}> {
  const [org, user] = await Promise.all([
    readBullets(ORG_FILE),
    userEmail ? readBullets(userFile(userEmail)) : Promise.resolve([] as MemoryBullet[]),
  ]);
  return { org, user };
}

/**
 * Build the `## Memory` block injected into the dynamic half of the system
 * prompt. Returns empty string when there's nothing to inject so the prompt
 * stays compact for fresh installs.
 */
export function formatMemoryBlock(mem: { org: MemoryBullet[]; user: MemoryBullet[] }): string {
  if (mem.org.length === 0 && mem.user.length === 0) return '';
  const renderBullet = (b: MemoryBullet) => {
    const prefix = b.id ? `[${b.id}] ` : '';
    return `- ${prefix}${b.fact}`;
  };
  const parts: string[] = ['', '## Memory'];
  if (mem.user.length > 0) {
    parts.push('', '### Your preferences');
    parts.push(...mem.user.map(renderBullet));
  }
  if (mem.org.length > 0) {
    parts.push('', '### Team lessons');
    parts.push(...mem.org.map(renderBullet));
  }
  parts.push(
    '',
    'Apply these whenever they\'re relevant. Don\'t mention the memory system unless the user asks. ' +
    'Use `remember(scope, fact)` to save new durable lessons; use `forget(mem_id)` to remove one.',
  );
  return parts.join('\n');
}
