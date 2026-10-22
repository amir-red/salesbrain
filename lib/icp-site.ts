/**
 * Server-side page reader for the ICP "draft from a website" step. No Next or
 * DB imports so it can be exercised from a plain node script.
 */

const UA = 'SalesBrain/1.0 (+https://salescrm.chipchip.social)';

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;|&#39;/g, (m) => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'" }[m] || ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Tailwind-ish class strings and code-like literals — the noise a JS bundle is
// mostly made of. Anything matching is not marketing copy.
const BUNDLE_NOISE = /[{}<>=;\\]|https?:\/\/|\.(js|css|png|svg|woff)|\b(react|hook|render|component|props|callback|listener|argument|element|keydown|focus|scroll|selection|variables|minified|canplay|durationchange|infinite)\b|(^|\s)(text|bg|md|sm|lg|xl|flex|grid|rounded|border|px|py|pl|pr|mb|mt|mx|my|gap|w|h|max|min|absolute|relative|inline|font|tracking|leading|shadow|opacity|hover|transition|animate|z|top|left|right|bottom|space|items|justify|uppercase|overflow)[-:\[]/i;

/**
 * Marketing copy out of a single-page app's JS bundle. zeami.io (Vite + React)
 * serves a 450-byte HTML shell with every sentence inside /assets/index-*.js,
 * so a plain HTML fetch sees only the <title>. String literals of five-plus
 * words that don't look like code or utility classes are, in practice, the
 * page text. Best-effort and same-origin only; capped so a vendor bundle
 * cannot balloon the prompt.
 */
async function bundleText(base: string, html: string): Promise<string> {
  const srcs = Array.from(html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/gi)).map((m) => m[1]).slice(0, 2);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const src of srcs) {
    const url = src.startsWith('http') ? src : `${base}${src.startsWith('/') ? '' : '/'}${src}`;
    if (!url.startsWith(base)) continue; // same-origin only
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const js = (await res.text()).slice(0, 2_000_000);
      // Vendor code (React etc.) is bundled FIRST and the app's own code last,
      // so scan the tail first; a bundle whose tail yields little gets a full pass.
      const literals = (src: string) =>
        [...src.matchAll(/"((?:[^"\\]|\\.){30,600})"/g), ...src.matchAll(/'((?:[^'\\]|\\.){30,600})'/g)].map((m) => m[1]);
      const tail = literals(js.slice(Math.floor(js.length * 0.55)));
      const lits = tail.join('').length > 3000 ? tail : literals(js);
      for (const raw of lits) {
        const t = raw.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
        if (t.split(' ').length < 5 || BUNDLE_NOISE.test(t) || !/[a-z]{3,} [a-z]{3,}/i.test(t)) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
        if (out.join('\n').length > 9000) break;
      }
    } catch { /* skip bundle */ }
    if (out.length) break;
  }
  return out.join('\n');
}

/** Same-origin pages a near-empty homepage points at: its <link rel="canonical"> and a meta refresh. */
function shellTargets(base: string, html: string): string[] {
  const out: string[] = [];
  for (const re of [/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
                    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i,
                    /<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"';]+)/i]) {
    const m = html.match(re);
    if (!m) continue;
    const href = m[1].trim();
    const url = href.startsWith('http') ? href : `${base}${href.startsWith('/') ? '' : '/'}${href}`;
    if (url.startsWith(base) && url.replace(/\/$/, '') !== base) out.push(url);
  }
  return out;
}

export async function fetchSite(website: string): Promise<{ url: string; pages: { url: string; text: string; via: 'html' | 'bundle' }[] }> {
  const base = (website.startsWith('http') ? website : `https://${website}`).replace(/\/$/, '');
  const pages: { url: string; text: string; via: 'html' | 'bundle' }[] = [];
  let shellHtml: string | null = null;
  // A homepage can be a script-only language switch (zeami.io since 2026-10: `/` holds no text and sends
  // visitors to /de/ or /en/; a server never runs that script). When the homepage has no text, read the page its
  // canonical link names and the usual language paths before giving up.
  const queue = [base, `${base}/about`, `${base}/about-us`];
  const tried = new Set<string>();
  for (let i = 0; i < queue.length && i < 8; i++) {
    const url = queue[i];
    if (tried.has(url)) continue;
    tried.add(url);
    // One language version is enough: /de/ and /en/ are the same page twice.
    const lang = /\/[a-z]{2}\/?$/.test(url);
    if (lang && pages.some((p) => /\/[a-z]{2}\/?$/.test(p.url))) continue;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('html') && !ct.includes('text')) continue;
      const html = await res.text();
      const text = stripHtml(html).slice(0, 7000);
      if (text.length > 200) pages.push({ url, text, via: 'html' });
      else if (url === base) {
        shellHtml = html;
        queue.splice(1, 0, ...shellTargets(base, html), `${base}/en/`, `${base}/de/`);
      }
    } catch { /* skip page */ }
    if (pages.length >= 2) break;
  }
  // JS-only site: the shell had no text, so mine the bundle it loads.
  if (pages.length === 0 && shellHtml) {
    const text = await bundleText(base, shellHtml);
    if (text.length > 200) pages.push({ url: `${base} (app bundle)`, text, via: 'bundle' });
  }
  return { url: base, pages };
}

