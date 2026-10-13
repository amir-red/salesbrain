/**
 * POST /api/translate { texts: string[] }  →  { translations: string[] }
 *
 * English renderings of outreach messages for people who don't read the
 * language they were written in (the NRW campaign is German). One batched model
 * call per request; a process-wide cache keyed on the text means a message is
 * translated once, not on every page load. Display only — nothing is stored.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { MODEL } from '@/lib/llm';
import { createMessage } from '@/lib/llm-usage';

const Body = z.object({ texts: z.array(z.string().max(4000)).min(1).max(40) });

const cache = new Map<string, string>();
const CACHE_MAX = 2000;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });

  const texts = parsed.data.texts;
  const out: (string | null)[] = texts.map((t) => (t.trim() ? cache.get(t) ?? null : ''));
  const todo = texts.map((t, i) => ({ t, i })).filter(({ i }) => out[i] === null);

  if (todo.length) {
    const prompt = `Translate each of the following messages into natural English. Keep the tone, line breaks and names; do not add commentary.
Return ONLY a JSON array of strings, one per message, in the same order.

${todo.map(({ t }, n) => `### ${n + 1}\n${t}`).join('\n\n')}`;
    try {
      const res = await createMessage({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] },
        { feature: 'translate', userId: session.userId });
      const text = res.content.map((b) => ('text' in b ? b.text : '')).join('');
      const m = text.match(/\[[\s\S]*\]/);
      const arr = m ? (JSON.parse(m[0]) as unknown) : null;
      if (!Array.isArray(arr) || arr.length !== todo.length) {
        return NextResponse.json({ error: 'The model returned an unexpected shape' }, { status: 502 });
      }
      todo.forEach(({ t, i }, n) => {
        const tr = String(arr[n] ?? '');
        out[i] = tr;
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(t, tr);
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }
  return NextResponse.json({ translations: out });
}
