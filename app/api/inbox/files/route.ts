import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { MAX_FILE, humanSize, storeUpload } from '@/lib/message-files';

/**
 * POST /api/inbox/files — multipart, one `file` per request: keep a file to send with a message (core 104). The page
 * uploads as soon as a file is chosen and sends the returned id with the reply / first message. Unsent uploads are
 * cleared after a day.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_FILE + 64 * 1024) return NextResponse.json({ error: `A file can be at most ${humanSize(MAX_FILE)}.` }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Send the file as multipart form data.' }, { status: 400 }); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file.' }, { status: 400 });
  const out = await storeUpload(session.userId, file.name, file.type, Buffer.from(await file.arrayBuffer()));
  if ('error' in out) return NextResponse.json(out, { status: 400 });
  return NextResponse.json({ file: out });
}
