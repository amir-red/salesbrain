import { NextRequest, NextResponse } from 'next/server';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * POST /api/warm/whatsapp (multipart: file, contact?, my_name?, person_id?, tz_offset_minutes?)
 *
 * A WhatsApp chat export (.txt, or the .zip an iPhone makes) becomes dated conversation records on that person
 * (core commands/whatsapp.py), so warmth and the funnel see the relationship. The file is written to the upload folder
 * the kernel accepts (os.tmpdir()/salesbrain-uploads), imported as the signed-in teammate, then deleted.
 */
const MAX = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Send the chat as a file' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose the exported chat file' }, { status: 400 });
  const ext = path.extname(file.name).toLowerCase();
  if (ext !== '.txt' && ext !== '.zip') {
    return NextResponse.json({ error: 'Send the WhatsApp export: a .txt, or the .zip an iPhone makes (Export chat → Without media)' }, { status: 400 });
  }
  if (file.size > MAX) return NextResponse.json({ error: 'The export is larger than 20 MB — export the chat without media' }, { status: 400 });
  const dir = path.join(tmpdir(), 'salesbrain-uploads');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${randomUUID()}${ext}`);
  await writeFile(tmp, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  const args: Record<string, unknown> = { path: tmp, filename: file.name };
  for (const k of ['contact', 'my_name', 'person_id'] as const) {
    const v = form.get(k);
    if (typeof v === 'string' && v.trim()) args[k] = v.trim().slice(0, 200);
  }
  const tz = Number(form.get('tz_offset_minutes'));
  if (Number.isFinite(tz) && Math.abs(tz) <= 14 * 60) args.tz_offset_minutes = Math.round(tz);
  try {
    const out = await kernelCall('whatsapp_import', args, session.userId) as Record<string, unknown>;
    if (out.error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not import the chat' }, { status: 502 });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
