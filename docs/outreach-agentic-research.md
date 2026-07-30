# Outreach Tools, Sales Navigator Handling & Agentic Outreach — Research Brief

*Researched 2026-07-28 via three parallel web-research passes (outreach-tool landscape; LinkedIn/Sales Navigator mechanics & risk; agentic/AI-SDR landscape). Research only — nothing here has been built or bought.*

*Source caveat: the 2026 sales-tool content ecosystem is saturated with vendor-authored "comparisons." Hard claims below are anchored to primary sources (TechCrunch, Microsoft Learn, court outcomes, official docs, GitHub) where possible; pricing is directional (±10%) — verify on live pages before purchase.*

---

## TL;DR

1. **The 2026 consensus small-team stack is Clay (data/orchestration) + Smartlead or Instantly (email) + HeyReach (LinkedIn), ~$400–600/rep/mo.** Enterprise suites (Outreach, Salesloft) are the wrong cost class for an 8-exec, ~40-deal team.
2. **The single most important development for us: sales tools became agent-addressable in 2025–26.** Apollo, HubSpot, Clay, lemlist, Smartlead, Instantly, HeyReach, and Unipile all expose official or mature MCP servers / REST APIs. Our Hermes gateway can drive these as tools — the same pattern as our 48 `crm_` tools. We do not need anyone's UI, and we do not need to buy an "AI SDR."
3. **The AI-SDR category crashed and validated our architecture.** 11x: fake-customer scandal, 70–80% churn (TechCrunch, Mar 2025). Artisan: LinkedIn bans. Category churn ~50–70%/yr. What won: inbound agents (Qualified's Piper), operator workbenches (Clay: $100M ARR, $3.1–5B valuation), and the "GTM engineer" pattern — **one operator + agent stack + human approval gates**, which is literally what Relationship OS already is.
4. **There is no official programmatic path into Sales Navigator for us.** LinkedIn's SNAP partner program is closed to new partners ("We are not currently accepting new partners" — Microsoft Learn, current as of 2026). No messaging API, no connection API, no search-export API exists officially. Every third-party LinkedIn automation tool violates LinkedIn's ToS; the only variance is detection probability and enforcement appetite.
5. **LinkedIn enforcement escalated to the vendor level in 2025–26**: Proxycurl sued (Jan 2025) → dead (Jul 2025); ProAPIs sued → settled; HeyReach's company page permanently removed + founder's profile banned (Mar 2026 — a reputational warning shot; the product kept running, contrary to competitor claims of a takedown). Any LinkedIn-automation dependency is one enforcement action from dead.
6. **Recommended posture: agent reads and drafts; humans send on LinkedIn; the agent sends on channels we own (email/Telegram).** If we experiment with programmatic LinkedIn at all, the best-in-class gray-area architecture is **Unipile** (user's own session, per-account pricing from ~€49/mo, no fake accounts, no scraped data hoard — the posture LinkedIn has historically not sued) — read-mostly, one warmed account, hard self-imposed caps, human-approved sends. Eyes open: it is still a ToS breach.

---

## 1. Outreach tool landscape (2026)

### Multichannel sales-engagement platforms

| Tool | Best at | Pricing | API / agent surface |
|---|---|---|---|
| Outreach.io | Enterprise sequencing, governance | ~$100–150/user/mo + $15–30K/yr platform fees | Mature REST API; enterprise-weight OAuth/contract |
| Salesloft | Cadence workflows for SDR teams | ~$75–165/user/mo | REST v2 + webhooks; merged with Clari Dec 2025 |
| **Apollo.io** | The value bundle: 275M-contact DB + sequences + dialer | $49–119/seat/mo (real spend $150–400 w/ credits) | REST API on Pro+; search/enrich/sequences; **official MCP** (`mcp.apollo.io`) |
| Reply.io | Multichannel + "Jason AI" | $49–89/user/mo; Jason from $500/mo | Good API v3 + webhooks + OAuth |
| Amplemarket | Contact-data quality + AI suite | ~$300/user/mo (2-seat min, annual) | **No public API** — avoid for agent control |
| lemlist | Personalization (images/video, liquid) | $79–109/user/mo | REST API + **official MCP (40+ tools)** |
| La Growth Machine | LinkedIn+email+X per-identity | $70–195/mo | API/webhooks locked to top tiers |
| Salesforge stack | Vertically-integrated infra (Mailforge/Infraforge/Primeforge/Warmforge) + Agent Frank AI SDR ($499–599/mo) | mailboxes $2–4/mo | Infra-as-API + CLI; provision domains/mailboxes programmatically |

### Cold-email specialists (deliverability-first)

| Tool | Best at | Pricing | API / agent surface |
|---|---|---|---|
| **Smartlead** | Best-in-class mailbox rotation & deliverability engineering; agency favorite | $39–379/mo | Full REST API + 3-scope webhooks + **the richest cold-email MCP (~116 tools)** |
| **Instantly** | Volume + UX; unlimited mailboxes/warmup; expanding to full platform (CRM, Lead Finder) | $47–358/mo (webhooks need $97+ tier) | Strong API v2, scoped keys + **MCP (38 tools, Mar 2026)** |
| Woodpecker | Safe, simple; per-prospect pricing | from ~$29/mo | API/webhooks/**MCP/CLI as $20/mo add-on** |
| Mailreef | Dedicated cold-email infrastructure (servers/IPs/mailboxes) | $249/mo + $0.001/email | API-first provisioning; pairs with Smartlead/Instantly |

Reviewer shorthand: *"Smartlead for deliverability, Instantly for volume+UX, lemlist for personalization."*

### LinkedIn-specialist tools (market position — mechanics & risk in §2)

| Tool | Architecture | Pricing | API |
|---|---|---|---|
| **HeyReach** | Cloud browser, multi-sender rotation | $79/mo (3 senders) → $999+ agency | **Only true LinkedIn campaign-creation API + official MCP** — explicitly built for AI agents (Campaign API, Apr 2026) |
| Expandi | Cloud browser, dedicated IP/seat | ~$99/seat/mo | Outbound webhooks only — weak for driving |
| Waalaxy | Extension-led, freemium | €19–69/user/mo (prices ~doubled 2025–26) | Thin API on Advanced+ |
| Linked Helper | Local app w/ embedded browser | $15–45/mo | No real cloud API |
| Dripify | Cloud, shared IPs | $39–79/mo | No public API |
| Dux-Soup | Chrome extension | from $15/mo | Surprisingly deep API, but extension architecture = highest detection risk |
| PhantomBuster | Cookie-based scraping "Phantoms" | $69–159/mo (execution hours) | Full dev API — useful as a scraping utility, not a sequencer |

### Data / enrichment / orchestration

| Tool | Best at | Pricing | API |
|---|---|---|---|
| **Clay** | THE orchestration layer: 100+-provider waterfall enrichment, Claygent AI research, signal workflows. $100M ARR Dec 2025; $3.1B→$5B valuation | Free → $185/mo Launch → $495/mo Growth (repriced Mar 2026: data credits −50–90%) | **No classic REST API** — webhook-in per table, HTTP-action callbacks out, official MCP. Treat as an async peer, or skip and orchestrate in Hermes directly |
| FullEnrich | Waterfall email+phone across 15+ providers (75–90% match vs 50–60% single-source) | from $59/mo | Clean REST — very agent-friendly |
| Prospeo | Proprietary email finding, LinkedIn-URL→email | $49–249/mo | Yes, well-ranked |
| Findymail | Cheap accurate emails (~$0.049/email) | — | Simple REST |
| Ocean.io | Lookalike company discovery (give best customers → similar companies) | $299/mo | 20 endpoints incl. lookalike search |
| Apollo (data) | Best $/contact SMB coverage | see above | see above |

**Target-market fit: our clients are mostly US/Europe/global — exactly where these providers are strongest.** Apollo/Clay/FullEnrich waterfalls hit their headline 75–95% match rates on US/EU B2B contacts. For Europe-heavy lists, **Cognism** (EU-strong data + phones, GDPR-positioned) is worth a look as an Apollo alternative — flagged, not deeply researched in this pass. Still test any provider on a ~100-contact sample of OUR actual ICP before committing.

### Common stacks (reviewer consensus)

- **Small team (2026 consensus):** Clay + Smartlead + HeyReach + lightweight CRM ≈ $400–600/rep/mo
- **Budget solo/duo:** Apollo alone (or Instantly alone) < $150/mo
- **Enterprise:** Clay + ZoomInfo + Outreach/Salesloft + Salesforce ≈ $800–1,000+/user/mo

### Agent-drivability ranking (our lens)

1. **Smartlead** — best programmable email engine (API + webhooks + MCP)
2. **HeyReach** — only real LinkedIn campaign API + MCP (but see vendor risk, §2)
3. **Instantly** — excellent API v2 + MCP; more all-in-one
4. **Apollo** — best programmatic data+sequences combo; API gated to Pro
5. **Clay** — powerful but webhook-model; async peer, not a callee
6. **Avoid for agent control:** Amplemarket (no API), Expandi (webhooks only), Waalaxy/Dripify/Linked Helper (thin/none), Outreach/Salesloft (wrong cost class)

---

## 2. LinkedIn & Sales Navigator: how it actually works, and the risk

### 2.1 Official surface (2026)

**Sales Navigator tiers:** Core $119.99/mo (~$90 annual) · Advanced $159.99/mo · Advanced Plus custom (~$1,600+/seat/yr). All include 50 InMail credits/mo.

- **Core:** advanced search, lead/account lists, alerts (job changes, posts, company news), Account IQ/Lead IQ.
- **Advanced:** + Smart Links (trackable content w/ viewer analytics), Buyer Intent, TeamLink, CSV upload (**account lists only, max ~1,000 companies — you cannot bulk-import people at any tier**), team features.
- **Advanced Plus:** + CRM Sync (**Salesforce, Dynamics 365, HubSpot only**), activity writeback, Data Validation (flags CRM contacts who changed company).

**Official APIs — the door is closed:**
- SNAP (Sales Navigator Application Platform: Display/Analytics/Sync services incl. Data Validation API) is partner-gated and **"not currently accepting new partners"** (Microsoft Learn, current 2026). Consumable only through existing partners (Salesforce, Dynamics, HubSpot, Outreach, Salesloft, Gong…).
- Marketing/Community API: company-page content + ads only. Consumer APIs: sign-in + share only.
- **Explicitly nonexistent officially: 1:1 messaging API, InMail API, connection-request API, people-search/export API, third-party profile enrichment.**

### 2.2 The three third-party architectures

1. **Browser extensions / local automation** (Dux-Soup, Linked Helper, Waalaxy, Evaboot-style CSV exporters): run in your own logged-in session; DOM-fingerprintable; **highest detection risk**.
2. **Cloud browsers with dedicated IPs** (Expandi, HeyReach, Dripify, La Growth Machine): headless sessions against your account, one stable IP per identity, human-like pacing. Lower detection than extensions; still ToS-violating; **vendor-level enforcement risk proven in 2026**.
3. **Unofficial-API aggregators** ("LinkedIn API as a service"): 
   - *User-session model* (Unipile, Linked API, Linkup, GTM API): your own account, per-user consent, no scraped corpus — best legal posture of the gray options.
   - *Cookie-based* (PhantomBuster): you paste your `li_at` cookie; acts as you.
   - *Fake-account/scraped-corpus model* (Proxycurl, ProAPIs): **this is the pattern LinkedIn actually sues over — both flagship vendors are dead or settled.**
   - *Static datasets* (Coresignal, People Data Labs, Bright Data): no account risk to you; freshness and provenance questions.

### 2.3 Enforcement record (facts, not vendor marketing)

- **hiQ v. LinkedIn (final, Dec 2022):** CFAA turned out weak against scraping public data, but **LinkedIn won on breach of contract** — the User Agreement's anti-automation terms are enforceable. This is now LinkedIn's litigation playbook.
- **Proxycurl (Jan→Jul 2025):** sued over fake-account scraping at scale; shut down rather than fight; permanent injunction + data destruction. Founder's candid post-mortems: nubela.co/blog/goodbye-proxycurl.
- **ProAPIs:** similar suit; settled in principle (2026 filings).
- **HeyReach (Mar 2026, verified from both sides):** LinkedIn permanently removed HeyReach's ~16.4k-follower company page and banned the founder's + executives' personal profiles. **Nuance:** circulating claims of "30,000 users cut off," an API cease-and-desist, and a "pivot to email" are competitor marketing (northlight/joinvalley/wonda SEO cluster) — HeyReach's product kept running and still sells LinkedIn automation (verified on heyreach.io, Jul 2026). Read it as a public warning shot at the vendor's marketing presence — and proof escalation can arrive with zero notice.
- The widely repeated "~40% of accounts on automation tools restricted in Q1 2026" stat traces to a competing vendor with no methodology — **treat as unverified**.

### 2.4 Account-level mechanics & folk limits

Restrictions ladder: temporary automation-suspicion locks (hours–days) → ID-verification locks (3–14 days) → permanent bans (appeals rarely succeed). Reported detection signals: velocity spikes, acceptance rate <~25%, >500–700 pending invites, template repetition, datacenter IPs, extension DOM fingerprints, automation on unwarmed accounts.

Community-reported 2026 operating ranges for warmed Sales Nav accounts (survivorship folklore, not official): connections 20–50/day (~100/week soft cap); messages 30–60/day; profile views 100–150/day; InMail bounded by credits (Open Profile InMails are credit-free — why tools push them); ~150 total actions/day; ~4-week warm-up. **The only ToS-safe automation volume is zero.**

### 2.5 Sales Navigator workflows tools actually support

- **SalesNav search-URL import** is the universal pattern: paste a people-search URL into Clay ("Find People → External List," ≤2,500 results, 1 credit/result), HeyReach, Expandi, Dripify, LGM; Evaboot/Scalelist export to CSV with filter-mismatch cleaning + email waterfall.
- **Signals:** SalesNav natively alerts on saved-lead job changes (fastest job-change source anywhere), posts, company news; Buyer Intent at Advanced+. Third-party signal layers: UserGems ($20–50K/yr), Champify, Trigify.
- **Canonical 2026 stack wiring:** signal fires → Clay enriches → HeyReach/Expandi executes → CRM logs.

### 2.6 Unipile deep-dive (the "LinkedIn API for agents")

- **What:** ~100+ REST endpoints + webhooks: LinkedIn messaging (incl. **InMail on SalesNav/Recruiter seats**), invitations (send/track/withdraw), profile retrieval, **search incl. SalesNav-level lead search**, posts; plus Email/WhatsApp/IG/Telegram under one API. Official MCP + community MCP servers (one exposes ~95 tools).
- **How:** the end user connects **their own LinkedIn account** (hosted auth); every call executes as that user within what they could do manually. Unipile provides per-account stable proxies and keeps **no independent database of LinkedIn data** (deliberate post-Proxycurl posture: no fake accounts, no scraped corpus).
- **Pricing:** per linked account, unlimited usage — min ~€49/mo (covers up to 10 accounts), ~€5/account beyond; 7-day trial.
- **Reputation:** most professional operator in the category (SOC 2 II, GDPR); G2 flags webhook reliability; safety throttles are **your** responsibility — it will send whatever volume you ask.
- **Honesty:** not a LinkedIn partner; "ToS-aligned" language is marketing. Using it is still a user-side ToS breach — the architecture reduces *detection* and *vendor-lawsuit* risk, not *contractual* risk.
- **Captain Data** — the other aggregator — retreated: legacy automation discontinued Dec 31 2025; now a "People & Company Data API for AI agents" (500M profiles, MCP, ~$399+/mo realistic). Its own blog argues session-based automation is fragile.
- Newcomers (Linked API, Linkup API, LinkdAPI, GTM API…) churn fast post-Proxycurl; assume any can vanish.

### 2.7 Risk ladder (ascending)

| Approach | ToS | Account risk | Continuity risk | Verdict |
|---|---|---|---|---|
| Manual SalesNav + alerts + Advanced CSV account-upload | ✅ | none | low | The compliant baseline |
| Advanced Plus CRM Sync | ✅ | none | low | Only if we lived in Salesforce/Dynamics/HubSpot — we don't |
| Read-mostly export (Evaboot-style) + human sends | ❌ | low–med | med | Lowest-risk gray option at human-scale volumes |
| Unofficial user-session API (Unipile) w/ hard caps | ❌ | med | med | **Best gray architecture** if we experiment programmatically |
| Cloud-browser tools (HeyReach, Expandi…) | ❌ | med | med–high (vendor enforcement proven) | Renting risk; conservative volumes only |
| Browser extensions | ❌ | **highest** | med | Avoid |
| Fake-account/scraped-corpus APIs & datasets | ❌ | n/a | **extreme** (lawsuit pattern) | Avoid for anything load-bearing |

---

## 3. The agentic landscape

### 3.1 AI-SDR market reality (2026)

- **11x.ai:** TechCrunch (Mar 2025) — listed ZoomInfo/Airtable as customers when they weren't; ARR inflated by booking trials as annual; churn 70–80%; CEO stepped down May 2025.
- **Artisan (Ava):** $25M raise, "Stop Hiring Humans" billboards, ~$6M ARR, LinkedIn account bans late 2025; ~$18–24K/yr.
- **Qualified (Piper):** the strongest-reputation product — because it does **inbound** (website hand-raisers), a far easier problem. ~$40–68K/yr, requires Salesforce.
- **Category data:** AI-SDR tools churn 50–70%/yr (~2× the human SDRs they replace); AI 0.7% email→meeting vs 1.1% human; 8% of AI emails marked spam vs 3% human; median 38-point sender-reputation drop within 90 days of scaling AI-SDR volume (ESPs detect template homogeneity).
- **Consolidation:** Clari–Salesloft merged (Dec 2025); Apollo bought Pocus (Mar 2026); ZoomInfo bought Common Room.
- **The tell:** AI-native vendors selling "replace your SDRs" **doubled their own human SDR headcount** (Growth Unhinged hiring analysis). GTM-engineer listings +205% YoY. The market converged on *one operator + agent stack + human gates* — our architecture.

### 3.2 MCP / agent-API building blocks (what Hermes could mount)

| Layer | Official MCP / agent API | Notes |
|---|---|---|
| Data/sequences | **Apollo** (`mcp.apollo.io`, 13 tools, in the MCP Registry) | search, enrich, sequences |
| CRM | **HubSpot** (remote MCP GA Apr 2026) | n/a for us — we are the CRM |
| Enrichment orchestration | **Clay** (official MCP + webhook-in/HTTP-callback-out) | async peer pattern fits an agent loop |
| Email sending | Smartlead (community MCP, 113–116 tools, mature) · **Instantly** (official-endorsed 38-tool MCP) · **lemlist** (official MCP, 40+ tools) · Woodpecker (MCP add-on) | the agent-drivable send layer |
| LinkedIn | **HeyReach** (official Campaign API + MCP, Apr 2026) · **Unipile** (official MCP + community 95-tool server) | both gray; see §2 |
| To avoid | Clay community MCP (session-cookie auth), linkedin-mcp-server-style scrapers | cookie-auth = fragile + ToS-red |

### 3.3 Browser agents

Managed cloud browsers for agents are a funded infra category (Browserbase/Stagehand, Anchor Browser $6M seed, Airtop — which markets LinkedIn automation with login/2FA handling directly). Credible enterprise use skews to **research/demo automation, not outreach**. "Agent drives Sales Navigator in a cloud browser" is technically commonplace and exactly what LinkedIn spent 2026 proving it will punish at the vendor level. Claude for Chrome remains beta with reported extension-hijack vulnerabilities (Jul 2026). **Defensible use for us: read-side research only, human-plausible volumes, real session.**

### 3.4 Orchestration patterns that actually work (practitioner consensus)

- **Signal-based beats volume:** signal-referencing emails get 5–18% reply rates vs 1–3% generic; platform-wide average reply fell 5.1%→3.4% (2024→26) from AI-slop saturation. Generic funding/job-change alerts are commodity now — edge is second-order signals + speed.
- **Waterfall enrichment:** 5 providers ≈ 85–95% coverage vs 40–60% single-source.
- **Deliverability regime rewards us:** Google/Yahoo (2024) + Microsoft (May 2025) bulk-sender rules — SPF/DKIM/DMARC, one-click unsubscribe, complaints <0.3%/0.2%, Microsoft weighing *engagement* — actively punish high-volume templated AI email and reward low-volume, high-relevance sending. Our quiet hours / frequency caps / channel ladder map directly onto this.
- **HITL that works:** selective routing (only uncertain/high-stakes to the human), reasoning shown next to the draft, audit trails — vs rubber-stamp "presence without practice." (EU AI Act Art. 14 lands Aug 2026 for high-risk systems; sales outreach mostly out of scope, patterns transfer.)
- **Uncontested autonomous ROI niches:** reply triage/sentiment tagging and inbound speed-to-lead. Everything else wants a human gate.

---

## 4. What this means for Relationship OS (recommendation — nothing built)

Our existing architecture (Hermes gateway + policy engine with quiet hours/caps/channel ladder + Telegram approval + value-first covenant) **is** the pattern the market converged on. The research suggests a three-lane posture:

**Lane 1 — Email as the agent-owned send channel (lowest risk, highest leverage).**
Email is the only channel where agent-driven sending is both permitted and API-native. Candidate: Smartlead or Instantly driven from a future ring toolset (their MCPs/APIs slot into our existing tool pattern; Instantly webhooks need the $97/mo tier). Prerequisite regardless of tool: proper sending infra (separate domain, SPF/DKIM/DMARC, warmup) — cold volume must never touch chipchip.social's domain reputation. **EU-prospect compliance (matters because Europe is a target market):** B2B cold email to the EU needs a GDPR legitimate-interest basis, sender identification, unsubscribe, and data-source disclosure on request; ePrivacy rules vary by country (Germany/Austria are effectively opt-in for email even B2B; UK/France/Netherlands are more permissive for corporate addresses under legitimate interest). Practical pattern: per-country policy flags in the outreach policy engine — our kernel already enforces policy as data (`policy_rules`), so country rules are one more row, not new architecture. US side is CAN-SPAM (light: identification + unsubscribe + no deceptive headers).

**Lane 2 — LinkedIn/Sales Navigator: agent reads and drafts, human sends (compliant-by-default).**
- A SalesNav Core/Advanced seat used manually, with its native job-change/post/news alerts as our signal source (fastest job-change signal that exists).
- The agent's role: consume signals + our 12.9k-contact reservoir (`crm_network_insights`), research (`crm_research_company`), draft the touch, deliver via the existing Telegram approval flow; the human performs the LinkedIn action. This is our current channel ladder's "linkedin-assisted" rung, made real.

**Lane 3 — Optional gray experiment, eyes open: Unipile on ONE account.**
If we want to test programmatic SalesNav handling: Unipile trial (~€49/mo, 7-day free) connected to one warmed account — read-mostly (SalesNav search, profile retrieval, inbox sync into the relationship graph) with sends still human-approved and hard caps well under the §2.4 folk limits. Accept in writing that it breaches LinkedIn's ToS and the account could be restricted; never connect an account we can't afford to lose. Avoid: browser extensions, scraped-corpus APIs, and betting anything load-bearing on cloud-browser vendors (HeyReach's Campaign API is genuinely excellent and genuinely one enforcement action from dead).

**Explicitly not recommended:** buying an AI SDR (11x/Artisan-class — the churn data is damning); Outreach/Salesloft (wrong size); Amplemarket (no API); anything cookie-auth.

**Decision points for Amir (in rough order):** (1) stand up a cold-email lane at all? (currently the pipeline is warm/relationship-driven — Lane 1 may be premature); (2) buy a SalesNav seat for the signal + manual lane? (3) run the Unipile experiment or stay compliant-only? (4) enrichment budget (FullEnrich $59/mo is the cheapest useful waterfall; Cognism worth evaluating for Europe-heavy lists; test on a sample of our real ICP first).

---

## 5. Key sources (selected)

**Official LinkedIn/Microsoft:** learn.microsoft.com/en-us/linkedin/sales/ (SNAP; "not accepting new partners") · business.linkedin.com/sales-solutions/compare-plans · linkedin.com/help/linkedin/answer/a1341387 (prohibited software)

**Enforcement/legal:** techcrunch.com/2025/03/24 (11x fake customers) · nubela.co/blog/goodbye-proxycurl · privacyworld.blog (hiQ contract ruling) · heyreach.io/blog/quick-update-from-nick + linkedcamp.com (HeyReach event, both sides) · thelinkedblog.com (ProAPIs settlement)

**Market/pricing:** sacra.com/c/clay · businesswire.com (Clay $5B tender) · vendr.com/marketplace/outreach · landbase.com/blog/instantly-ai-pricing · derrick-app.com/tools/heyreach-pricing · growthunhinged.com/p/who-s-actually-hiring-in-gtm-right-now

**APIs/MCP:** developer.instantly.ai · api.smartlead.ai · heyreach.io/blog/campaign-api · docs.apollo.io · developers.clay.com/concepts/mcp · lemlist.com/product/lemlist-mcp · unipile.com/pricing-api · github.com/LeadMagic/smartlead-mcp-server · github.com/bcharleson/Instantly-MCP

**Deliverability/patterns:** instantly.ai/cold-email-benchmark-report-2026 · paved.com/blog/bulk-sending-requirements-update · digitalapplied.com/blog/case-against-ai-sdrs-contrarian-analysis-2026 · redsift.com/guides/bulk-email-sender-requirements

*(Full source lists — 200+ URLs — are in the three research-agent transcripts from the 2026-07-28 session.)*
