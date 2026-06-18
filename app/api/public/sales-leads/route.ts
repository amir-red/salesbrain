/**
 * Public endpoint for the zeami.io "Request Demo" form (and any future
 * intake forms on the marketing site).
 *
 *   POST /api/public/sales-leads
 *     Body: { full_name, company, email, description?, preferred_demo_* }
 *     Auth: x-api-key (or Authorization: Bearer <key>) matching ONBOARDING_API_KEY
 *           Same-origin in-app requests bypass the key check.
 *     Response: 201 { id, created_at }
 *
 * The submission is captured verbatim into `sales_leads` at status='new'.
 * After the row persists, two transactional emails are fired (fire-and-forget,
 * non-blocking) via `lib/demo-emails.ts`:
 *   (1) prospect confirmation  → noreply@zeami.io
 *   (2) team notification      → beck@ (rollout) / tesfa+beck+mateo (full)
 *
 * CORS: locked to `PUBLIC_FORM_ALLOWED_ORIGIN` (typically https://zeami.io)
 * when set. See lib/public-api.ts for the full auth/CORS rationale.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { requireApiKey, jsonWithCors, corsOptions } from '@/lib/public-api';
import { sendDemoEmails } from '@/lib/demo-emails';

const BodySchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  description: z.string().trim().max(5000).optional().nullable(),
  source: z.string().trim().max(120).optional(),   // override default if you want

  // Optional preferred-demo fields added when zeami.io's form sends them.
  // Stored verbatim — no timezone conversion at intake so we preserve the
  // prospect's original intent ("9:00 AM in Africa/Nairobi") exactly.
  preferred_demo_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').optional().nullable(),
  preferred_demo_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'HH:MM or HH:MM:SS (24h)').optional().nullable(),
  preferred_demo_timezone: z.string().trim().max(64).optional().nullable(),  // IANA tz string
});

export async function OPTIONS(req: NextRequest) {
  return corsOptions(req);
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonWithCors(req, { error: 'Invalid JSON' }, 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonWithCors(
      req,
      { error: 'Validation failed', details: parsed.error.issues },
      400,
    );
  }

  const {
    full_name, company, email, description, source,
    preferred_demo_date, preferred_demo_time, preferred_demo_timezone,
  } = parsed.data;

  // Keep the raw payload around for debugging if the form ever changes shape.
  const rawPayload = { ...(body as Record<string, unknown>), _ua: req.headers.get('user-agent') ?? null };

  const { rows } = await pool.query(
    `INSERT INTO sales_leads
       (full_name, company, email, description, source, raw_payload,
        preferred_demo_date, preferred_demo_time, preferred_demo_timezone)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'zeami.io:request-demo'), $6, $7, $8, $9)
     RETURNING id, created_at`,
    [
      full_name, company, email, description ?? null, source ?? null, JSON.stringify(rawPayload),
      preferred_demo_date ?? null,
      preferred_demo_time ?? null,
      preferred_demo_timezone?.trim() || null,
    ],
  );

  // Fire-and-forget: lead-confirmation + team-notification emails. NEVER
  // awaited and `sendDemoEmails` never throws — a Resend outage or missing
  // RESEND_API_KEY can't break lead capture. Errors are logged.
  void sendDemoEmails({
    fullName: full_name,
    workEmail: email,
    company,
    preferredDate: preferred_demo_date ?? undefined,
    preferredTime: preferred_demo_time ?? undefined,
    timeZone: preferred_demo_timezone?.trim() || undefined,
    details: description ?? undefined,
  });

  return jsonWithCors(req, { id: rows[0].id, created_at: rows[0].created_at }, 201);
}
