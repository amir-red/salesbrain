import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, extractText, classify } from '@/lib/file-extractor';

export const runtime = 'nodejs';

// Sanitize filename so it can't escape the upload dir
function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify deal access
  const isAdmin = session.role === 'admin';
  const { rows: dealRows } = await pool.query(
    isAdmin
      ? 'SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL'
      : 'SELECT id FROM deals WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    isAdmin ? [params.id] : [params.id, session.userId]
  );
  if (dealRows.length === 0) {
    return NextResponse.json({ error: 'Deal not found or no access' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const files = formData.getAll('file') as File[];
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  // Resolve upload dir relative to project root
  const uploadDir = path.join(process.cwd(), 'uploads', session.userId, params.id);
  await fs.mkdir(uploadDir, { recursive: true });

  const results: Array<Record<string, unknown>> = [];

  for (const file of files) {
    if (!(file instanceof File)) {
      results.push({ error: 'Invalid file in form data' });
      continue;
    }

    // Validate type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      results.push({
        filename: file.name,
        error: `File type "${file.type}" not allowed. Accepted: PDF, DOCX, TXT, MD, CSV, PNG, JPG, WEBP, GIF.`,
      });
      continue;
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      results.push({
        filename: file.name,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
      });
      continue;
    }

    try {
      const fileId = randomUUID();
      const safeName = safeFilename(file.name);
      const fileOnDisk = `${fileId}_${safeName}`;
      const fullPath = path.join(uploadDir, fileOnDisk);
      const relPath = path.relative(process.cwd(), fullPath);

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(fullPath, buffer);

      // Extract text where possible (DOCX/TXT/MD/CSV/JSON)
      const extracted = await extractText(buffer, file.type, file.name);

      const { rows } = await pool.query(
        `INSERT INTO file_attachments
           (id, deal_id, user_id, filename, mime_type, size_bytes, storage_path, extracted_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, filename, mime_type, size_bytes, created_at`,
        [
          fileId,
          params.id,
          session.userId,
          file.name,
          file.type,
          file.size,
          relPath,
          extracted,
        ]
      );

      results.push({
        ...rows[0],
        kind: classify(file.type),
        extracted_chars: extracted ? extracted.length : 0,
      });
    } catch (err) {
      console.error(`[upload] Failed for ${file.name}:`, err);
      results.push({
        filename: file.name,
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }

  return NextResponse.json({ uploaded: results });
}

/**
 * GET /api/deals/[id]/files — list attachments for a deal.
 * Useful for re-displaying attachments when the chat history loads.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = session.role === 'admin';
  const { rows: dealRows } = await pool.query(
    isAdmin
      ? 'SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL'
      : 'SELECT id FROM deals WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    isAdmin ? [params.id] : [params.id, session.userId]
  );
  if (dealRows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { rows } = await pool.query(
    `SELECT id, filename, mime_type, size_bytes, created_at
     FROM file_attachments WHERE deal_id = $1
     ORDER BY created_at DESC`,
    [params.id]
  );
  return NextResponse.json(rows);
}
