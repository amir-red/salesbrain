import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { importContactsText, MAX_CSV_BYTES } from '@/lib/imports/contacts';

const MAX_BYTES = MAX_CSV_BYTES;

const ACCEPTED_MIME = new Set([
  'text/csv',
  'application/csv',
  'text/plain',                 // some browsers send CSVs as text/plain
  'application/vnd.ms-excel',   // legacy CSV mime in Safari
  'application/octet-stream',   // fallback for unknown senders
]);

/**
 * POST multipart/form-data with:
 *   - file: a Connections.csv (LinkedIn export)
 *   - source: 'linkedin_csv' | 'generic_csv' (optional, defaults to linkedin_csv)
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');
  const source = (formData.get('source') as string) || 'linkedin_csv';

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file must be a File' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds 10 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` }, { status: 400 });
  }

  // Be lenient about mime — accept anything that looks like csv by extension OR mime
  const isCsvByExt = file.name.toLowerCase().endsWith('.csv');
  const isCsvByMime = ACCEPTED_MIME.has(file.type);
  if (!isCsvByExt && !isCsvByMime) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || 'unknown'}. Upload a .csv file (LinkedIn Connections export).` },
      { status: 400 }
    );
  }

  const text = await file.text();
  if (!text.trim()) {
    return NextResponse.json({ error: 'File contents are empty' }, { status: 400 });
  }

  const { status, body } = await importContactsText(session.userId, text, source);
  return NextResponse.json(body, { status });
}
