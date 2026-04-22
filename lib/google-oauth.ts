/**
 * Google OAuth helpers for connecting Gmail + People API.
 * Uses raw fetch (no googleapis dependency) to keep the footprint small.
 *
 * Setup required ONCE in Google Cloud Console:
 * 1. Create a project → OAuth consent screen (External, test mode is fine)
 * 2. Create OAuth 2.0 Client ID (type: Web application)
 * 3. Add authorized redirect URI: https://salescrm.chipchip.social/api/integrations/google/callback
 *    (+ http://localhost:3000/api/integrations/google/callback for dev)
 * 4. Enable APIs: Gmail API, People API (Contacts)
 * 5. Set env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 */

import pool from './db';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export function getGoogleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirect) throw new Error('Google OAuth not configured');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getGoogleUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

/**
 * Get a valid access token for this user, refreshing if needed.
 */
export async function getValidAccessToken(userId: string): Promise<{ accessToken: string; email: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT * FROM oauth_tokens WHERE user_id = $1 AND provider = 'google'`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires > now + 60000) {
    return { accessToken: row.access_token, email: row.account_email };
  }

  if (!row.refresh_token) return null;

  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await pool.query(
      `UPDATE oauth_tokens SET access_token = $1, expires_at = $2, updated_at = now() WHERE id = $3`,
      [refreshed.access_token, newExpires, row.id]
    );
    return { accessToken: refreshed.access_token, email: row.account_email };
  } catch (err) {
    console.error('[Google OAuth] Refresh failed:', err);
    return null;
  }
}

// ─── Gmail API ──────────────────────────────────────────────────

interface GmailMessageList {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

interface GmailHeader { name: string; value: string }

interface GmailMessagePayload {
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePayload[];
  mimeType?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePayload;
}

export async function listGmailMessages(accessToken: string, query: string, maxResults = 20): Promise<GmailMessage[]> {
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
  const data: GmailMessageList = await res.json();
  if (!data.messages) return [];

  // Fetch each message in parallel (batched)
  const messages = await Promise.all(
    data.messages.map(async (m) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return null;
      return r.json() as Promise<GmailMessage>;
    })
  );
  return messages.filter((m): m is GmailMessage => !!m);
}

function extractBodyFromPayload(payload: GmailMessagePayload | undefined): string {
  if (!payload) return '';
  if (payload.body?.data) {
    // Base64url decode
    const buf = Buffer.from(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return buf.toString('utf8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      }
    }
    for (const part of payload.parts) {
      const nested = extractBodyFromPayload(part);
      if (nested) return nested;
    }
  }
  return '';
}

export function parseGmailMessage(msg: GmailMessage): {
  sent_at: Date | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  body: string;
} {
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || null;
  const sentAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
  const body = extractBodyFromPayload(msg.payload) || msg.snippet || '';
  return {
    sent_at: sentAt,
    from: getHeader('From'),
    to: getHeader('To'),
    subject: getHeader('Subject'),
    body: body.slice(0, 20000), // cap per message
  };
}

// ─── People API (Contacts) ──────────────────────────────────────

interface PeopleConnectionsResponse {
  connections?: Array<{
    resourceName?: string;
    names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
    emailAddresses?: Array<{ value?: string }>;
    organizations?: Array<{ name?: string; title?: string }>;
    phoneNumbers?: Array<{ value?: string }>;
  }>;
  nextPageToken?: string;
  totalPeople?: number;
}

export async function listGoogleContacts(accessToken: string, pageToken?: string): Promise<PeopleConnectionsResponse> {
  const params = new URLSearchParams({
    personFields: 'names,emailAddresses,organizations,phoneNumbers',
    pageSize: '200',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google People API failed: ${res.status}`);
  return res.json();
}

/**
 * Extract clean email address from Gmail header format (e.g., "Amir <amir@x.com>" -> "amir@x.com").
 */
export function extractEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase().trim();
  if (raw.includes('@')) return raw.toLowerCase().trim();
  return null;
}
