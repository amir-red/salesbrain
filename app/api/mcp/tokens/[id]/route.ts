/**
 * DELETE /api/mcp/tokens/:id  — soft-revoke a token owned by the caller.
 *
 * You can only revoke YOUR OWN tokens. Admins don't get cross-user
 * revocation via this endpoint (kept intentionally strict — a compromised
 * admin session shouldn't be able to lock other users out of their MCP
 * integrations without their consent).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revokeToken } from '@/lib/mcp/tokens';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const revoked = await revokeToken(id, session.userId);
  if (!revoked) return NextResponse.json({ error: 'Token not found or not yours' }, { status: 404 });

  return NextResponse.json({ revoked: true });
}
