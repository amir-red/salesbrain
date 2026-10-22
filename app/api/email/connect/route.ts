import { NextRequest, NextResponse } from 'next/server';
import { publicUrl } from '@/lib/public-url';

/** GET /api/email/connect — kept for old links: sending is part of the one Google connection now (Profile → Google). */
export async function GET(req: NextRequest) {
  return NextResponse.redirect(publicUrl(req, '/api/integrations/google/connect'));
}
