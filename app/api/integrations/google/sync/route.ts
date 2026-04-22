import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  getValidAccessToken,
  listGoogleContacts,
  listGmailMessages,
  parseGmailMessage,
  extractEmail,
} from '@/lib/google-oauth';
import { normalizeCompanyName, normalizeDomain } from '@/lib/prospecting';

/**
 * POST body: { mode: 'contacts' | 'messages' | 'both', contact_id?: string, max?: number }
 *
 * - mode='contacts': imports all Google contacts as accounts + contacts
 * - mode='messages': for each contact with an email, pulls last N Gmail messages with that person
 * - mode='both': runs contacts then messages
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = await getValidAccessToken(session.userId);
  if (!token) return NextResponse.json({ error: 'Not connected to Google' }, { status: 400 });

  const body: { mode?: string; contact_id?: string; max?: number } = await req.json().catch(() => ({}));
  const mode = body.mode || 'both';
  const max = Math.min(body.max || 10, 50);

  const stats = { contacts_imported: 0, messages_imported: 0, errors: 0 };

  // ── Contacts sync ──
  if (mode === 'contacts' || mode === 'both') {
    try {
      let pageToken: string | undefined = undefined;
      do {
        const page = await listGoogleContacts(token.accessToken, pageToken);
        for (const conn of page.connections || []) {
          const email = conn.emailAddresses?.[0]?.value?.toLowerCase();
          const fullName = conn.names?.[0]?.displayName;
          const firstName = conn.names?.[0]?.givenName;
          const lastName = conn.names?.[0]?.familyName;
          const orgName = conn.organizations?.[0]?.name;
          const title = conn.organizations?.[0]?.title;
          const phone = conn.phoneNumbers?.[0]?.value;

          if (!fullName && !email) continue;

          // Resolve or create account
          let accountId: string | null = null;
          if (orgName) {
            const normalizedOrg = normalizeCompanyName(orgName);
            const { rows } = await pool.query(
              `SELECT id FROM accounts WHERE LOWER(name) = $1 LIMIT 1`,
              [normalizedOrg]
            );
            if (rows[0]) {
              accountId = rows[0].id;
            } else {
              const { rows: newRows } = await pool.query(
                `INSERT INTO accounts (name, source) VALUES ($1, 'google_contacts') RETURNING id`,
                [orgName]
              );
              accountId = newRows[0].id;
            }
          }

          // Dedup contact by email first, else by name+account — SCOPED TO CURRENT USER
          // Two users can each have their own "Jane Doe" contact pointing at the same shared account.
          let exists: { rows: Array<{ id: string }> } = { rows: [] };
          if (email) {
            exists = await pool.query(
              `SELECT id FROM contacts WHERE LOWER(email) = $1 AND owner_user_id = $2 LIMIT 1`,
              [email, session.userId]
            );
          } else if (fullName && accountId) {
            exists = await pool.query(
              `SELECT id FROM contacts WHERE account_id = $1 AND LOWER(full_name) = LOWER($2) AND owner_user_id = $3 LIMIT 1`,
              [accountId, fullName, session.userId]
            );
          }
          if (exists.rows.length > 0) continue;

          await pool.query(
            `INSERT INTO contacts (account_id, full_name, first_name, last_name, email, title, phone, source, owner_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'google_contacts', $8)`,
            [accountId, fullName || `${firstName} ${lastName}`.trim(), firstName || null, lastName || null, email || null, title || null, phone || null, session.userId]
          );
          stats.contacts_imported++;
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (err) {
      console.error('[Google sync contacts]', err);
      stats.errors++;
    }
  }

  // ── Messages sync ──
  if (mode === 'messages' || mode === 'both') {
    try {
      // Only sync messages for contacts this user owns (or legacy contacts without owner)
      const contacts = body.contact_id
        ? await pool.query(
            `SELECT id, email FROM contacts WHERE id = $1 AND email IS NOT NULL
             AND (owner_user_id = $2 OR owner_user_id IS NULL)`,
            [body.contact_id, session.userId]
          )
        : await pool.query(
            `SELECT c.id, c.email FROM contacts c
             WHERE c.email IS NOT NULL
               AND (c.owner_user_id = $1 OR c.owner_user_id IS NULL)
               AND NOT EXISTS (
                 SELECT 1 FROM imported_messages im
                 WHERE im.contact_id = c.id AND im.user_id = $1 AND im.source = 'gmail'
                   AND im.created_at > now() - interval '24 hours'
               )
             ORDER BY c.updated_at DESC LIMIT 20`,
            [session.userId]
          );

      for (const contact of contacts.rows) {
        try {
          const query = `(from:${contact.email} OR to:${contact.email}) -in:chats`;
          const msgs = await listGmailMessages(token.accessToken, query, max);
          for (const m of msgs) {
            const parsed = parseGmailMessage(m);
            const fromEmail = extractEmail(parsed.from);
            const toEmail = extractEmail(parsed.to);
            const direction = fromEmail === token.email?.toLowerCase() ? 'sent' : 'received';

            // Dedup by (user_id, contact_id, gmail message id) — per-user ownership of messages
            const { rows: existing } = await pool.query(
              `SELECT id FROM imported_messages
               WHERE user_id = $1 AND contact_id = $2 AND source = 'gmail'
                 AND raw_metadata->>'id' = $3 LIMIT 1`,
              [session.userId, contact.id, m.id]
            );
            if (existing.length > 0) continue;

            await pool.query(
              `INSERT INTO imported_messages (contact_id, user_id, source, direction, sent_at, from_email, to_email, subject, body, raw_metadata)
               VALUES ($1, $2, 'gmail', $3, $4, $5, $6, $7, $8, $9)`,
              [
                contact.id,
                session.userId,
                direction,
                parsed.sent_at,
                fromEmail,
                toEmail,
                parsed.subject,
                parsed.body,
                JSON.stringify({ id: m.id, threadId: m.threadId }),
              ]
            );
            stats.messages_imported++;
          }
        } catch (err) {
          console.error(`[Gmail sync for contact ${contact.id}]`, err);
          stats.errors++;
        }
      }
    } catch (err) {
      console.error('[Google sync messages]', err);
      stats.errors++;
    }
  }

  return NextResponse.json(stats);
}

// Keep for reference - not used in import but could be useful later
void normalizeDomain;
