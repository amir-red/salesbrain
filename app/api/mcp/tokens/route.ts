/**
 * Internal API for MCP token management. Used by /settings/mcp.
 *
 *   GET  /api/mcp/tokens        list the signed-in user's active tokens
 *   POST /api/mcp/tokens        create a new token, return the raw value ONCE
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createToken, listUserTokens } from '@/lib/mcp/tokens';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tokens = await listUserTokens(session.userId);
  return NextResponse.json({ tokens });
}

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { raw, row } = await createToken(session.userId, parsed.data.name);

  // The RAW token is returned ONCE — the UI must show it to the user
  // immediately with a "save this now" warning. Subsequent GET calls
  // only return the prefix.
  return NextResponse.json({ raw_token: raw, token: row }, { status: 201 });
}
