import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';

const MAX_BYTES = 10 * 1024 * 1024;     // 10 MB cap
const ACCEPTED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

/**
 * GET /api/pricing/tools
 * List uploaded versions (newest first). Any authenticated user.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows } = await pool.query(
    `SELECT t.id, t.version, t.filename, t.size_bytes, t.uploaded_at,
            t.is_active, t.notes,
            u.name as uploaded_by_name, u.email as uploaded_by_email
     FROM pricing_tools t
     LEFT JOIN users u ON u.id = t.uploaded_by
     ORDER BY t.version DESC`
  );
  return NextResponse.json(rows);
}

/**
 * POST /api/pricing/tools
 * Upload a new .xlsx pricing tool. Any authenticated user. The first upload
 * auto-activates; subsequent uploads do NOT — someone clicks "Activate"
 * explicitly. Every upload is attributed to its uploader so the version
 * list shows who shipped what.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');
  const notes = (formData.get('notes') as string | null)?.toString() ?? null;

  if (!file || typeof file === 'string' || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit` }, { status: 400 });
  }
  const isXlsxByExt = file.name.toLowerCase().endsWith('.xlsx');
  if (!isXlsxByExt && !ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || 'unknown'}. Upload a .xlsx file.` },
      { status: 400 }
    );
  }

  // Compute the next version number
  const { rows: vRows } = await pool.query<{ next_v: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_v FROM pricing_tools`
  );
  const version = vRows[0].next_v;

  // Store on disk under uploads/pricing-tools/v<N>-<ts>.xlsx.
  // CRITICAL: persist a path RELATIVE to the project root in the DB. Storing
  // the absolute path breaks the moment the row leaves the machine that
  // uploaded it (laptop → server, container restart on a different volume
  // mount, etc.). At read time the engine resolves the relative path against
  // `process.cwd()`, so the same DB row works on every host.
  const relDir = path.join('uploads', 'pricing-tools');
  const uploadDir = path.join(process.cwd(), relDir);
  await fs.mkdir(uploadDir, { recursive: true });
  const filename = `v${version}-${Date.now()}.xlsx`;
  const absPath = path.join(uploadDir, filename);
  const storagePath = path.join(relDir, filename);  // <- what we save in DB
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(absPath, buf);

  // Insert + auto-activate if this is the very first upload.
  const { rows: existing } = await pool.query<{ n: string }>(
    `SELECT count(*) as n FROM pricing_tools`
  );
  const isFirst = parseInt(existing[0].n, 10) === 0;

  if (isFirst) {
    await pool.query(
      `INSERT INTO pricing_tools (version, filename, storage_path, size_bytes, uploaded_by, is_active, notes)
       VALUES ($1, $2, $3, $4, $5, true, $6)`,
      [version, file.name, storagePath, file.size, session.userId, notes]
    );
  } else {
    await pool.query(
      `INSERT INTO pricing_tools (version, filename, storage_path, size_bytes, uploaded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [version, file.name, storagePath, file.size, session.userId, notes]
    );
  }

  return NextResponse.json({ version, is_active: isFirst }, { status: 201 });
}
