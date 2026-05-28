/**
 * Public endpoint for the zeami.io "Request Demo" form (and any future
 * intake forms on the marketing site).
 *
 *   POST /api/public/sales-leads
 *     Body: { full_name, company, email, description? }
 *     Auth: x-api-key (or Authorization: Bearer <key>) matching ONBOARDING_API_KEY
 *           Same-origin in-app requests bypass the key check.
 *     Response: 201 { id, created_at }
 *
 * The submission is captured verbatim into `sales_leads` at status='new'.
 * No notifications, no auto-assess, no agent assessment — manual triage
 * happens at /sales-leads inside the CRM.
 *
 * CORS: locked to `PUBLIC_FORM_ALLOWED_ORIGIN` (typically https://zeami.io)
 * when set. See lib/public-api.ts for the full auth/CORS rationale.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { requireApiKey, jsonWithCors, corsOptions } from '@/lib/public-api';

const BodySchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  description: z.string().trim().max(5000).optional().nullable(),
  source: z.string().trim().max(120).optional(),   // override default if you want
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

  const { full_name, company, email, description, source } = parsed.data;

  // Keep the raw payload around for debugging if the form ever changes shape.
  const rawPayload = { ...(body as Record<string, unknown>), _ua: req.headers.get('user-agent') ?? null };

  const { rows } = await pool.query(
    `INSERT INTO sales_leads (full_name, company, email, description, source, raw_payload)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'zeami.io:request-demo'), $6)
     RETURNING id, created_at`,
    [full_name, company, email, description ?? null, source ?? null, JSON.stringify(rawPayload)],
  );

  return jsonWithCors(req, { id: rows[0].id, created_at: rows[0].created_at }, 201);
}
