import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseWhatsAppExport, parseGenericText } from '@/lib/message-parsers';

const Schema = z.object({
  contact_id: z.string().uuid(),
  source: z.enum(['whatsapp', 'email_paste', 'linkedin_paste', 'generic']),
  text: z.string().min(1),
  my_name: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }
  const { contact_id, source, text, my_name } = parsed.data;

  let messages: Array<{ direction: string; sent_at: Date | null; body: string; from_name?: string; subject?: string }> = [];
  if (source === 'whatsapp') {
    messages = parseWhatsAppExport(text, my_name || session.name);
  } else {
    messages = parseGenericText(text, source === 'email_paste' || source === 'linkedin_paste' ? 'sent' : 'unknown');
  }

  let inserted = 0;
  for (const m of messages) {
    await pool.query(
      `INSERT INTO imported_messages (contact_id, user_id, source, direction, sent_at, body, raw_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        contact_id,
        session.userId,
        source,
        m.direction,
        m.sent_at,
        m.body.slice(0, 20000),
        m.from_name ? JSON.stringify({ from_name: m.from_name }) : null,
      ]
    );
    inserted++;
  }

  return NextResponse.json({ imported: inserted, source });
}
