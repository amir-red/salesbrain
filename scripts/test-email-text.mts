/** Run: node --experimental-strip-types --no-warnings scripts/test-email-text.mts — the Inbox's quote cutting. */
import { stripQuoted } from '../lib/email-text.ts';
const cases: [string, string][] = [
  ['Thanks, Tuesday works.\n\nOn Wed, 22 Oct 2026 at 20:44, Amir Redwan <amir@zeami.io> wrote:\n> Hi Tesfa', 'Thanks, Tuesday works.'],
  ['Danke!\n\nAm Mi., 22. Okt. 2026 um 20:44 Uhr schrieb Amir Redwan <amir@zeami.io>:\n> Hallo', 'Danke!'],
  ['Sure.\n\nFrom: Amir Redwan <amir@zeami.io>\nSent: Wednesday\nTo: x\n\nHello', 'Sure.'],
  ['Line one\nline two\n\n> quoted\n> more', 'Line one\nline two'],
  ['Long line\n\nOn Wed, 22 Oct 2026 at 20:44, Amir Redwan <amir@zeami.io>\nwrote:\n> x', 'Long line'],
];
let bad = 0;
for (const [i, want] of cases) { const got = stripQuoted(i); if (got !== want) { bad++; console.log('FAIL', JSON.stringify(got)); } }
console.log(bad ? `${bad} failed` : "all passed"); process.exit(bad ? 1 : 0);
