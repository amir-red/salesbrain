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

    // Page routes get redirected to login
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|signup|api/auth|api/cron|api/telegram|api/health|_next/static|_next/image|favicon\\.ico).*)',
  ],
};
