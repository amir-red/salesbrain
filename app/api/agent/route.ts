import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runAgent } from '@/lib/agent';
import { getSession } from '@/lib/auth';

const RequestSchema = z.object({
  deal_id: z.string().uuid(),
  message: z.string().min(1).max(10000),
});

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
      JSON.stringify({ error: 'Validation failed', details: parsed.error.flatten() }),
      { status: 400 }
    );
  }

  const { deal_id, message } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(deal_id, message, session.userId)) {
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
