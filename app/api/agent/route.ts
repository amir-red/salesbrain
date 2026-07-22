import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runAgent } from '@/lib/agent';
import { getSession } from '@/lib/auth';
import pool from '@/lib/db';
import {
  attachmentTextBlock,
  ensureAgentSession,
  hermesRuntimeEnabled,
  streamHermesTurn,
} from '@/lib/hermes-proxy';

const RequestSchema = z.object({
  deal_id: z.string().uuid(),
  message: z.string().max(100000).default(''),
  attachment_ids: z.array(z.string().uuid()).max(10).optional(),
}).refine(
  (d) => (d.message && d.message.length > 0) || (d.attachment_ids && d.attachment_ids.length > 0),
  { message: 'Either a message or at least one attachment is required' }
);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', details: parsed.error.issues }),
      { status: 400 }
    );
  }

  const { deal_id, message, attachment_ids } = parsed.data;

  // Runtime selection: env-wide flag, or per-request admin override for
  // staged testing (?runtime=hermes|legacy). Default: legacy — byte-identical
  // to the pre-Relationship-OS behavior.
  const override = req.nextUrl.searchParams.get('runtime');
  const useHermes =
    session.role === 'admin' && (override === 'hermes' || override === 'legacy')
      ? override === 'hermes'
      : hermesRuntimeEnabled();

  const encoder = new TextEncoder();

  if (useHermes) {
    // Visibility gate (same rule as the legacy loop enforces internally).
    const isAdmin = session.role === 'admin';
    const { rows } = await pool.query(
      isAdmin
        ? 'SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL'
        : 'SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL AND (user_id = $2 OR lead_id = $2)',
      isAdmin ? [deal_id] : [deal_id, session.userId]
    );
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), { status: 404 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const sessionId = await ensureAgentSession(session.userId, deal_id);
          const attachments = await attachmentTextBlock(attachment_ids, deal_id);
          const turnMessage =
            `${message}${attachments}` +
            `\n\n[context] deal_id=${deal_id} — use crm_get_deal first if you need current state.`;
          for await (const event of streamHermesTurn(sessionId, turnMessage)) {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          }
        } catch (err) {
          const errorEvent = {
            type: 'error',
            error: err instanceof Error ? err.message : 'Hermes agent failed',
          };
          controller.enqueue(encoder.encode(JSON.stringify(errorEvent) + '\n'));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Admins can chat with any deal (no userId scoping)
        const agentUserId = session.role === 'admin' ? undefined : session.userId;
        for await (const event of runAgent(deal_id, message, agentUserId, attachment_ids, session.email)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        }
      } catch (err) {
        const errorEvent = {
          type: 'error',
          error: err instanceof Error ? err.message : 'Agent failed',
        };
        controller.enqueue(encoder.encode(JSON.stringify(errorEvent) + '\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  });
}
