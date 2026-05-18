import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runAgent } from '@/lib/agent';
import { getSession } from '@/lib/auth';

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

  const encoder = new TextEncoder();
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
