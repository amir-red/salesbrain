import { NextRequest } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { anthropic } from '@/lib/llm';
import { getSession } from '@/lib/auth';


// Compact per-contact record. Keep this small — we send up to 400 of them per
// request, so each extra field is paid 400×.
const ContactSampleSchema = z.object({
  contact_id: z.string().uuid(),
  full_name: z.string().nullable(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  industry: z.string().nullable(),
  location: z.string().nullable(),
  has_email: z.boolean(),
  has_linkedin: z.boolean(),
  has_prospect: z.boolean(),
  has_deal: z.boolean(),
  last_contacted_days: z.number().nullable(),
});

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const RequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  graph_summary: z.object({
    contact_count: z.number().int().nonnegative(),
    account_count: z.number().int().nonnegative(),
    industries: z.array(z.string()).max(200),
    companies: z.array(z.string()).max(500),
    locations: z.array(z.string()).max(200),
    contacts_sample: z.array(ContactSampleSchema).max(400),
  }),
});

// Tools Claude uses to drive the graph UI. Each tool maps 1:1 to a client-side
// callback in NetworkInsights → page.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'highlight_contacts',
    description:
      'Highlight a specific set of contacts on the graph by their UUIDs. Use this when the user asks to find or focus on a specific group of people. The graph dims everything else.',
    input_schema: {
      type: 'object',
      properties: {
        contact_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'UUIDs from the contacts_sample. Max 50.',
        },
        reason: {
          type: 'string',
          description: 'One short sentence explaining why these contacts were chosen.',
        },
      },
      required: ['contact_ids', 'reason'],
    },
  },
  {
    name: 'filter_graph',
    description:
      'Apply structural filters (industry / company / location / title / data presence) to narrow the graph. Use when the user describes a *category* rather than specific people. Multiple filters are AND-combined.',
    input_schema: {
      type: 'object',
      properties: {
        industries: { type: 'array', items: { type: 'string' }, description: 'Exact industry names from the available industries list.' },
        companies: { type: 'array', items: { type: 'string' }, description: 'Exact company names from the available companies list.' },
        locations: { type: 'array', items: { type: 'string' }, description: 'Exact location names from the available locations list.' },
        title_contains: { type: 'string', description: 'Substring match against contact titles.' },
        has_email: { type: 'boolean' },
        has_linkedin: { type: 'boolean' },
        has_prospect: { type: 'boolean' },
        has_deal: { type: 'boolean' },
        last_contacted: {
          type: 'string',
          enum: ['any', 'never', 'lt30', 'gt30', 'gt90'],
          description: 'never = never contacted, lt30 = within 30 days, gt30 = >30 days ago, gt90 = >90 days ago.',
        },
        explanation: { type: 'string', description: 'One short sentence describing the filter intent.' },
      },
      required: ['explanation'],
    },
  },
  {
    name: 'clear_view',
    description: 'Reset all highlights and filters so the full graph is visible. Use when the user says "show all", "reset", or starts a new search.',
    input_schema: { type: 'object', properties: {} },
  },
];

const MAX_ITERATIONS = 4;

const SYSTEM_PROMPT = `You are a sales-network exploration assistant attached to a graph view of a salesperson's LinkedIn / CRM contacts. The user is looking at a force-directed graph and asks you to find, filter, or analyze parts of their network.

You have three tools:
- highlight_contacts(contact_ids[], reason) — pick specific people, max 50.
- filter_graph(industries?, companies?, locations?, title_contains?, has_email?, has_linkedin?, has_prospect?, has_deal?, last_contacted?, explanation) — apply category filters.
- clear_view() — reset to the full graph.

Rules:
- ALWAYS call exactly ONE tool per response. Never reply with prose alone — the user expects the graph to update.
- After the tool call, write a 1-2 sentence summary of what you did and why. Be specific (cite industries, titles, counts).
- Prefer filter_graph for broad "show me X" requests (e.g. "show me Tech industry", "people I haven't contacted in 90 days"). Prefer highlight_contacts when the user wants a specific small set (e.g. "the most senior people at FinTech companies").
- All contact_ids you pass MUST come from the provided contacts_sample. Never invent UUIDs.
- All industry / company / location strings in filter_graph MUST exactly match values from the provided lists.
- If the request is ambiguous, make your best guess and explain it; don't ask clarifying questions before acting (the user can refine after seeing the result).`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', details: parsed.error.issues }),
      { status: 400 }
    );
  }
  const { messages, graph_summary } = parsed.data;

  // Build the message array. The first user message is augmented with the
  // (large, stable-per-session) graph summary so the model has the data
  // available without us having to send it each turn separately. The rest
  // of the turns are passed through verbatim.
  const augmentedMessages: Anthropic.MessageParam[] = messages.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Here is a snapshot of my contact network. Use it to answer the question that follows.\n\n' +
              JSON.stringify(graph_summary),
            // Cache the (large) graph data so subsequent turns reuse it.
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        const convo: Anthropic.MessageParam[] = [...augmentedMessages];
        let iter = 0;

        while (iter < MAX_ITERATIONS) {
          iter++;

          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2000,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages: convo,
          });

          // Emit any text deltas first (non-streaming for simplicity — full
          // text comes back as one chunk). Then emit each tool_use as its
          // own event so the client can drive the graph.
          for (const block of response.content) {
            if (block.type === 'text' && block.text) {
              send({ type: 'text', text: block.text });
            } else if (block.type === 'tool_use') {
              send({
                type: 'tool_call',
                tool: block.name,
                input: block.input,
              });
            }
          }

          // Persist the assistant turn for the next iteration / next user msg.
          convo.push({ role: 'assistant', content: response.content });

          if (response.stop_reason !== 'tool_use') break;

          // Synthesize tool_results (we don't actually run server-side work —
          // the *client* applies the tool. Send back a noop ack so Claude can
          // produce its summary text in the next iteration if it wants to.)
          const toolResults: Anthropic.ToolResultBlockParam[] = response.content
            .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
            .map((b) => ({
              type: 'tool_result' as const,
              tool_use_id: b.id,
              content: 'Applied to the graph view.',
            }));
          convo.push({ role: 'user', content: toolResults });

          // Most of the time Claude returns text + a single tool_use in one
          // response, so one iteration is enough. We loop just in case it
          // fires a tool with no preceding text and wants to summarize next.
        }

        send({ type: 'done' });
      } catch (err) {
        send({
          type: 'error',
          error: err instanceof Error ? err.message : 'Chat failed',
        });
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
