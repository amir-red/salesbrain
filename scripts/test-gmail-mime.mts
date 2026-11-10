/**
 * The Gmail message with files (core 104): `buildMime` → a valid multipart/mixed mail.
 *   node --experimental-strip-types --no-warnings scripts/test-gmail-mime.mts > out.eml   (then parse it)
 * Prints the raw message so a mail parser can check it; asserts the basics itself.
 */
import { buildMime } from '../lib/gmail-mime.ts';

const raw = buildMime({
  from: 'amir@zeami.io', fromName: 'Amir Redwan', to: 'anna@x.io', subject: 'Re: Angebot für Müller', body: 'Hallo Anna,\nanbei das Angebot.',
  inReplyTo: '<m1@mail>',
  files: [
    { name: 'Angebot Müller.pdf', mime: 'application/pdf', content: Buffer.from('%PDF-1.4 test') },
    { name: 'logo.png', mime: 'image/png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ],
});
const ok = (c: boolean, m: string) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
ok(/^Content-Type: multipart\/mixed; boundary="/m.test(raw), 'multipart header');
ok(!/^Content-Transfer-Encoding/m.test(raw.split('\r\n\r\n')[0]), 'no top-level transfer encoding');
ok(raw.includes('In-Reply-To: <m1@mail>'), 'threading kept');
const plain = buildMime({ from: 'a@b.io', to: 'c@d.io', subject: 'x', body: 'y' });
ok(plain.includes('Content-Type: text/plain; charset="UTF-8"') && !plain.includes('multipart'), 'no files = plain text as before');
process.stdout.write(raw);
