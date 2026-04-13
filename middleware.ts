import { NextRequest, NextResponse } from 'next/server';
import { unsealData } from 'iron-session';

interface SessionData {
  userId: string;
  email: string;
  name: string;
}

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get('salesbrain_session');

  let authenticated = false;

  if (cookie?.value) {
    try {
      const session = await unsealData<SessionData>(cookie.value, {
        password: process.env.SESSION_SECRET!,
      });
      authenticated = !!session.userId;
    } catch {
      // Invalid/expired cookie
    }
  }

  if (!authenticated) {
    const { pathname } = req.nextUrl;

    // API routes get 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Build redirect URL from forwarded public origin when behind reverse proxies.
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || req.headers.get('host') || req.nextUrl.host;
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const proto = forwardedProto || req.nextUrl.protocol.replace(':', '') || 'https';

    // Page routes get redirected to login
    const loginUrl = new URL('/login', `${proto}://${host}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|signup|api/auth|api/cron|api/telegram|api/health|_next/static|_next/image|favicon\\.ico).*)',
  ],
};
