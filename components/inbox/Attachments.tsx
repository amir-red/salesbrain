'use client';

/**
 * Files in the Inbox (core 104): the paperclip in the reply box, the chips of what goes out, and the files on a message.
 * A file is uploaded as soon as it is chosen (POST /api/inbox/files) and only its id travels with the Send; the send
 * gate binds it to that one message.
 */
import { useCallback, useRef, useState } from 'react';
import { Download, FileIcon, Paperclip } from '@/components/icons';
import type { InboxAttachment } from '@/lib/inbox';

export const MAX_FILES = 5;
export const MAX_TOTAL = 15 * 1024 * 1024;

export function humanSize(n: number | null | undefined): string {
  const v = Number(n || 0);
  if (!v) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

export interface PickedFile { key: string; id: string | null; name: string; size: number; error?: string }

/** The files waiting in a reply box: upload on pick, remove, and the ids for the Send. */
export function useAttachments() {
  const [files, setFilesState] = useState<PickedFile[]>([]);
  const ref = useRef<PickedFile[]>([]);   // the current list, readable inside the async upload loop
  const setFiles = useCallback((fn: (cur: PickedFile[]) => PickedFile[]) => {
    ref.current = fn(ref.current);
    setFilesState(ref.current);
  }, []);
  const add = useCallback(async (list: FileList | File[] | null) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    const ok = ref.current.filter((f) => !f.error);
    let room = MAX_FILES - ok.length;
    let total = ok.reduce((a, f) => a + f.size, 0);
    for (const f of picked) {
      const key = `${f.name}:${f.size}:${Math.random().toString(36).slice(2)}`;
      const tooMany = room <= 0;
      const tooBig = total + f.size > MAX_TOTAL;
      if (tooMany || tooBig) {
        setFiles((cur) => [...cur, { key, id: null, name: f.name, size: f.size,
          error: tooMany ? `At most ${MAX_FILES} files per message.` : `Over ${humanSize(MAX_TOTAL)} in one message.` }]);
        continue;
      }
      room -= 1; total += f.size;
      setFiles((cur) => [...cur, { key, id: null, name: f.name, size: f.size }]);
      const body = new FormData();
      body.append('file', f);
      try {
        const res = await fetch('/api/inbox/files', { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || `Upload failed (${res.status})`);
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, id: data.file.id, name: data.file.name } : x)));
      } catch (e) {
        room += 1; total -= f.size;
        setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : 'Upload failed' } : x)));
      }
    }
  }, [setFiles]);
  const remove = useCallback((key: string) => {
    const f = ref.current.find((x) => x.key === key);
    if (f?.id) fetch(`/api/inbox/files/${f.id}`, { method: 'DELETE' }).catch(() => {});
    setFiles((cur) => cur.filter((x) => x.key !== key));
  }, [setFiles]);
  /** after a send: the files are bound to that message now, so they are only taken out of the box */
  const clear = useCallback(() => setFiles(() => []), [setFiles]);
  const ids = files.filter((f) => f.id && !f.error).map((f) => f.id as string);
  const uploading = files.some((f) => !f.id && !f.error);
  return { files, add, remove, clear, ids, uploading, count: ids.length };
}

/** The paperclip: opens the file picker. */
export function AttachButton({ onPick, disabled, compact }: { onPick: (f: FileList | null) => void; disabled?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={disabled}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs disabled:opacity-50"
        style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        title={`Attach files — up to ${MAX_FILES}, ${humanSize(MAX_TOTAL)} in all`} aria-label="Attach files">
        <Paperclip width={13} height={13} />{compact ? null : 'Attach'}
      </button>
      <input ref={input} type="file" multiple hidden onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
    </>
  );
}

/** What goes out with the message: one chip per file, with its upload state and a remove ×. */
export function AttachmentChips({ files, onRemove }: { files: PickedFile[]; onRemove: (key: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {files.map((f) => (
        <span key={f.key} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] max-w-[260px]"
          title={f.error || f.name}
          style={{ background: f.error ? 'color-mix(in srgb, var(--red) 10%, transparent)' : 'var(--bg-input)',
                   color: f.error ? 'var(--red)' : 'var(--text)', border: '1px solid var(--border)' }}>
          <FileIcon width={12} height={12} />
          <span className="truncate">{f.name}</span>
          <span style={{ color: f.error ? 'var(--red)' : 'var(--text-muted)' }}>
            {f.error ? f.error : f.id ? humanSize(f.size) : 'uploading…'}
          </span>
          <button type="button" onClick={() => onRemove(f.key)} aria-label={`Remove ${f.name}`} className="ml-0.5"
            style={{ color: 'var(--text-muted)' }}>×</button>
        </span>
      ))}
    </div>
  );
}

/** Files dropped on the reply box are attached too. */
export function dropProps(onPick: (f: FileList | null) => void, enabled: boolean) {
  if (!enabled) return {};
  return {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { if (e.dataTransfer.files?.length) { e.preventDefault(); onPick(e.dataTransfer.files); } },
  };
}

/** The files on a message: images as small previews, everything else as a download chip. */
export function MessageFiles({ files, mine }: { files: InboxAttachment[] | undefined; mine: boolean | null }) {
  if (!files?.length) return null;
  return (
    <div className={`flex flex-col gap-1.5 mt-1.5 ${mine ? 'items-end' : 'items-start'}`}>
      {files.map((f, i) => (f.unavailable ? (
        <span key={i} className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>{f.name} — no longer available</span>
      ) : f.image ? <ImageFile key={i} f={f} /> : <FileChip key={i} f={f} />))}
    </div>
  );
}

function FileChip({ f }: { f: InboxAttachment }) {
  return (
    <a href={f.url} className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs max-w-[280px]"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
      title={`Download ${f.name}`}>
      <FileIcon width={14} height={14} />
      <span className="truncate">{f.name}</span>
      {f.size ? <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>{humanSize(f.size)}</span> : null}
      <Download width={12} height={12} />
    </a>
  );
}

/** An image shown in the conversation; when it cannot be loaded (the mailbox is disconnected, the app dropped it) the
 *  download chip takes its place, which says why when opened. */
function ImageFile({ f }: { f: InboxAttachment }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <FileChip f={f} />;
  return (
    <a href={f.url} target="_blank" rel="noreferrer" title={`${f.name}${f.size ? ` · ${humanSize(f.size)}` : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${f.url}?inline=1`} alt={f.name} loading="lazy" onError={() => setFailed(true)}
        className="rounded-lg max-h-48 max-w-[240px] object-cover" style={{ border: '1px solid var(--border)' }} />
    </a>
  );
}
