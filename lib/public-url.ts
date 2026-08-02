import type { NextRequest } from 'next/server';

/**
 * Build an absolute URL anchored at the PUBLIC origin, not the internal Node
 * bind (localhost:3002).
 *
 * Any URL handed to an external service — an OAuth callback, a hosted-auth
 * return, an unsubscribe link — has to be one a browser can actually reach.
 * `req.nextUrl.origin` is the internal bind behind the reverse proxy, so a
 * redirect built from it sends the user to localhost and dies there. That is
 * exactly what happened to the LinkedIn connect flow (fixed 2026-08-02): the
 * account was created at the provider, but the user never returned to claim it.
 *
 * This lived privately inside the Google callback route, which is why the
 * LinkedIn route was written without it. It belongs here so the next
 * integration finds it.
 */
export function publicUrl(req: NextRequest, path: string): URL {
  // NEXT_PUBLIC_APP_URL is the most reliable source when configured.
  const envBase = process.env.NEXT_PUBLIC_APP_URL;
  if (envBase) {
    return new URL(path, envBase);
  }
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host') || req.nextUrl.host;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(':', '') || 'https';
  return new URL(path, `${proto}://${host}`);
}
