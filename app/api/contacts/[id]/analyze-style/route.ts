import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL } from '@/lib/llm';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';


export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Load contact
  const { rows: contactRows } = await pool.query(
    `SELECT c.*, a.name as company_name FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [params.id]
  );
  if (contactRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const contact = contactRows[0];

  // Load last 30 imported messages — only the calling user's own messages.
  // Each user trains their own communication profile for this contact.
  const { rows: msgs } = await pool.query(
    `SELECT source, direction, sent_at, subject, LEFT(body, 2000) as body
     FROM imported_messages
     WHERE contact_id = $1 AND user_id = $2
     ORDER BY COALESCE(sent_at, created_at) DESC
     LIMIT 30`,
    [params.id, session.userId]
  );

  if (msgs.length === 0) {
    return NextResponse.json(
      { error: 'No imported messages. Import some conversations with this contact first.' },
      { status: 400 }
    );
  }

  // Analyze with Claude
  const analysisPrompt = `Analyze the communication style between this user and ${contact.full_name}${contact.title ? ' (' + contact.title + ')' : ''}${contact.company_name ? ' at ' + contact.company_name : ''}.

Below are ${msgs.length} messages. "sent" = written by the user. "received" = written by the contact.

Produce a JSON object with these exact fields:
{
  "relationship_type": "peer | subordinate | senior | client | vendor | friend | unknown",
  "formality": "formal | semi_formal | casual",
  "typical_length": "short | medium | long",
  "tone_patterns": ["direct","consultative","warm","transactional","..."],
  "greeting_style": "string (how the user typically opens with this person)",
  "sign_off": "string (how the user typically signs off)",
  "common_topics": ["..."],
  "quirks": ["..."],
  "language": "en | es | fr | ...",
  "sample_openers": ["...","..."],
  "summary": "2-3 sentence description of how the user communicates with this specific person"
}

Be specific and grounded in the actual messages. Don't invent patterns. If the data is thin, say so in "summary".

Return ONLY the JSON object, no preamble.

Messages:
${msgs.map((m, i) => `--- Message ${i + 1} (${m.direction}${m.sent_at ? ', ' + new Date(m.sent_at).toISOString().slice(0, 10) : ''}) ---\n${m.subject ? 'Subject: ' + m.subject + '\n' : ''}${m.body}`).join('\n\n')}`;

  const response = await anthropic.messages.create({
    // Shared constant, never a literal — a direct-API id does not exist on
    // Bedrock, where the client actually sends. See lib/llm.ts.
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: analysisPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Extract JSON from response
  let profile: Record<string, unknown>;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    profile = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
  } catch {
    profile = { raw: text, parse_error: true };
  }

  profile.generated_at = new Date().toISOString();
  profile.message_sample_size = msgs.length;

  await pool.query(
    `UPDATE contacts SET communication_profile = $1 WHERE id = $2`,
    [JSON.stringify(profile), params.id]
  );

  return NextResponse.json({ analyzed: true, profile, messages_analyzed: msgs.length });
}
