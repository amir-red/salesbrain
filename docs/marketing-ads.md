# Marketing in SalesBrain — paid ads integration plan

Status (2026-10-13, `feat/marketing`): **round 1 + the connectors + a live read are built.** Marketing nav group,
`/marketing` (live spend / impressions / clicks / CTR / CPC per campaign, spend sparkline, read straight from the
platforms with a 10-min cache), `/marketing/connectors` (Google Ads = service account verified with one call;
LinkedIn Ads = OAuth connect/reconnect/disconnect), `lib/marketing.ts` (client vocabulary), `lib/ads/{google,linkedin,
cache}.ts` (server). Nothing is stored yet: the tables, the daily sync, lead capture and the closed loop (§1, §2, §4,
§6) are the next rounds. No migration applied. Owner: Amir.

## 0. What "international standard" means for a CRM here

The pattern HubSpot Marketing Hub, Salesforce (Marketing Cloud Account Engagement) and Attio/Close-style tools all
converge on. Five rules, each one load-bearing:

1. **Two systems of record, never mixed.** The ad platform is the truth for *spend, impressions, clicks*. The CRM is
   the truth for *leads, qualified leads, pipeline, revenue*. Cost per lead, cost per SQL, pipeline per euro and ROAS
   are computed in the CRM from both sides. A platform's own "conversions" column is stored for reference and never
   shown as "leads".
2. **Closed-loop attribution via click identifiers.** Every ad link carries UTMs **and** the platform click id
   (`gclid` for Google, `li_fat_id` for LinkedIn). The form that captures the lead posts them along; they are stored
   as the lead's **first touch**. Converting the lead to a deal keeps the touch, so won revenue rolls back to the
   campaign. Without the click id you can report, but you cannot feed results back (rule 4).
3. **Daily grain, restated.** Metrics are stored as one row per (account, campaign, day). Platforms restate the last
   days (late conversions, invalid-click refunds), so every pull re-fetches a 3-day lookback and upserts.
4. **Feed outcomes back to the platform (offline conversions).** "Lead became a deal" and "deal won, value X" are
   uploaded to Google (Enhanced Conversions for Leads / `ClickConversion` with `gclid`) and LinkedIn (Conversions API
   with `li_fat_id` or SHA-256 email). This is what lets Smart Bidding / LinkedIn's optimisation bid for *pipeline*
   instead of form fills. It is the single biggest lever and the part most teams skip.
5. **Read-only connectors, per-person consent, no ad management.** The CRM never creates, edits or pauses an ad. OAuth
   scopes are reporting-only; each user connects their own login (same as Gmail today); tokens live in
   `oauth_tokens`. Spend is money, so disconnect never deletes pulled history.

What we deliberately do **not** build: a campaign builder, audience sync (uploading contact lists to the platforms),
multi-touch attribution models (W-shaped, time-decay). First-touch + last-touch with a per-lead touch log is the
honest version at our volume; models come after there are a few hundred attributed leads to model.

## 1. Data model (core, migrations 055–057, round 2)

```
ad_accounts        id, provider ('google_ads'|'linkedin_ads'), external_id (customer id / sponsoredAccount urn),
                   name, currency, timezone, owner_user_id (who connected), connected_at, revoked_at,
                   sync_cursor jsonb (last pulled day, lookback), last_sync_at, last_error
ad_campaigns       id, account_id, external_id, name, status, objective, channel ('search'|'pmax'|'display'|
                   'sponsored_content'|'lead_gen'|…), start_date, end_date, utm_campaign (what the links carry),
                   icp_id NULL (which ICP the campaign targets — ties ads to the prospecting pipeline),
                   raw jsonb; unique (account_id, external_id)
ad_metrics_daily   account_id, campaign_id, day, impressions, clicks, spend_micros, currency,
                   platform_conversions numeric, platform_leads int (LinkedIn Lead Gen only), video_views …
                   unique (campaign_id, day). spend in micros + currency; never a float of money.
lead_touchpoints   id, entity_type ('sales_lead'|'prospect'|'deal'), entity_id, occurred_at,
                   source ('google_ads'|'linkedin_ads'|'organic'|'referral'|'direct'|'outbound'),
                   medium, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                   gclid, li_fat_id, campaign_id NULL (resolved to ad_campaigns when the id/utm matches),
                   landing_page, referrer, is_first_touch bool, raw jsonb
ad_conversion_outbox  id, provider, account_id, entity_type, entity_id, event ('lead'|'sql'|'won'),
                   value_micros, currency, click_id, hashed_email, occurred_at, uploaded_at, result jsonb
policy_rules       'agents.ads_sync' {enabled false, lookback_days 3, pull_hour 5,
                   reporting_currency 'EUR', fx_rates {...}}  — the costs.rates pattern: tokens/micros stored,
                   money applied at read time.
```

Why `lead_touchpoints` and not columns on `sales_leads`: a person can touch us several times (ad → later a LinkedIn
reply → later a webinar); the log keeps all of them, first/last touch are flags, and the same table serves
prospects (outbound) and deals, so the whole pipeline has one attribution vocabulary. `sales_leads.source` stays as
the coarse label it is today; the touchpoint is the detail.

## 2. Capture — where the touch enters the CRM

- **zeami.io demo form → `POST /api/public/sales-leads`**: schema gains optional `utm_source/medium/campaign/
  content/term`, `gclid`, `li_fat_id`, `landing_page`, `referrer`. The route writes the lead AND a first-touch
  `lead_touchpoints` row. zeami.io's dev: read those from the URL on landing, persist in a first-party cookie for
  90 days, post them with the form (`docs/external-api.md` gets the field list). Until then, everything is
  `source='direct'`.
- **LinkedIn Lead Gen Forms**: pulled by the sync (`leadFormResponses` / `leadNotifications`) → `sales_leads` with
  `source='linkedin:leadgen:<form name>'` + touchpoint with `campaign_id` set (we know the campaign; no cookie needed).
- **Calendly webhook** already lands sales leads; Calendly passes `utm_*` through its scheduling link — forward them.
- **Outbound** (LinkedIn connect/first message, email) writes `source='outbound'` touchpoints from
  `mark_approval_result`, so the funnel compares paid vs outbound on one page. One line in the kernel.

## 3. Connectors (app — BUILT, env-driven)

**Google Ads — service account, not per-user OAuth** (decided 2026-10-13: Amir has a Cloud project + service account,
and a company ad account has no reason to depend on one person's Google login). `lib/ads/google.ts` signs an RS256
JWT with the key in `GOOGLE_ADS_SERVICE_ACCOUNT_JSON` for the `adwords` scope and calls REST `googleAds:searchStream`
with `developer-token` (+ `login-customer-id` when `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is set). Env:
`GOOGLE_ADS_SERVICE_ACCOUNT_JSON` (key file as one-line JSON or base64), `GOOGLE_ADS_DEVELOPER_TOKEN`,
`GOOGLE_ADS_CUSTOMER_ID` (the ad account), optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION` (default
`v21`; bump when Google retires it). Operator steps: enable the Google Ads API in the project, create a JSON key for
the service account, invite the service account email as a (read-only) user in Google Ads → Admin → Access and
security, get the developer token from a MANAGER account's API Center (a test token only reads test accounts; Basic
access is needed for the live account). "Verify access" on the connectors page runs `SELECT customer.id,
customer.descriptive_name, customer.currency_code FROM customer` and shows what it sees. Metrics query (per day, per
campaign, status != REMOVED):
`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date,
metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date
BETWEEN …` via `customers/{id}/googleAds:searchStream` (REST, no SDK, same raw-fetch style as `lib/google-oauth.ts`).
Accounts are listed with `customers:listAccessibleCustomers` at connect time; the user picks which to attach.

**LinkedIn Ads — 3-legged OAuth** (`lib/ads/linkedin.ts`). Env: `LINKEDIN_ADS_CLIENT_ID`, `LINKEDIN_ADS_CLIENT_SECRET`,
`LINKEDIN_ADS_ACCOUNT_ID` (the company ad account; digits or urn), optional `LINKEDIN_API_VERSION` (default `202509`).
The app needs the **Advertising API** product approved (review takes days to weeks) and the redirect URL
`<app url>/api/marketing/connectors/linkedin_ads/callback` registered. Scopes `r_ads`, `r_ads_reporting`. One teammate
with Viewer+ access connects; the token row (`oauth_tokens.provider='linkedin_ads'`) is used org-wide (newest wins).
Access tokens last 60 days; refresh works only if the app has programmatic refresh tokens, otherwise the page says
"reconnect". Pull = `adAnalytics?q=
analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=…&accounts=List(urn:li:sponsoredAccount:N)&fields=
impressions,clicks,costInLocalCurrency,externalWebsiteConversions,oneClickLeads` with the versioned headers
(`LinkedIn-Version: YYYYMM`, `X-Restli-Protocol-Version: 2.0.0`); campaigns via `adCampaigns?q=search`.

Live read today: `GET /api/marketing/overview?days=` calls both libraries (10-min per-process cache, each provider
carries its own `ok`/`error`, yesterday is the last day because platforms close a day late). Round 2 keeps the same
response shape but serves it from `ad_metrics_daily`, and `ad_accounts` replaces the two env ids when we have more
than one account per platform.

## 4. Sync — the Hermes cron, the kernel, the tools

Follows §5.af Phase B exactly: a `hermes cron --no-agent --script ads_sync.py` job at 05:30 Addis (after the
platforms close the previous day), created by `deploy-server.sh`, writing `agent_runs(agent='ads_sync')`, detail →
stderr, one delivered line only when spend or leads changed materially (`_cron.py` contract). Per account: refresh
token → pull `today-lookback..yesterday` → upsert campaigns + metrics → pull Lead Gen responses → resolve
touchpoints (`gclid`/`li_fat_id`/`utm_campaign` → `campaign_id`) → advance `sync_cursor`. Provider errors pause the
account (`last_error`), never the job. Kernel: `commands/ads.py` (`upsert_account`, `upsert_metrics`,
`record_touchpoint`, `resolve_touchpoints`, `ads_report(actor, days)`), pure `policy/ads.py` (currency, CPL/CPSQL/
ROAS, first/last touch). Tools (`tools/ads.py`, family `crm_marketing`): `crm_ads_summary {days}`,
`crm_ads_campaigns {days, provider?}`, `crm_ads_sync_now` (owner, budget-free — these APIs are not rate-scarce like
Unipile) — so Telegram can answer "how did ads do this week" and the attention digest gets a Monday ads line.
`ads_report` is also exposed as an app RPC for the page (`kernelCall`), like `cost_report`.

## 5. Reporting — what the page shows (round 3)

`/marketing` overview: the six tiles already framed (Spend, Impressions, Clicks, Leads, Cost/lead, Pipeline) + CTR,
CPC, cost per SQL (lead converted to deal), won revenue, ROAS; a funnel bar spend → clicks → leads → SQL → won; a
channel × campaign table (sortable, sparkline per row, platform conversions shown greyed "as reported"); a daily
spend/leads chart; "unattributed leads" count with a link, so a broken UTM shows up as a number instead of
vanishing. `/marketing/campaigns/[id]`: the campaign's leads, their deals, touch log. `/sales-leads` rows get a
source chip (Google Ads · campaign name). The `/admin/costs` page lists ad spend as its own line (it is running cost,
but marketing-owned — shown, not merged into the LLM/Unipile total). Reads follow the panel rule: ONE checked-out
client, sequential queries, polled 45 s (`lib/use-poll.ts`).

## 6. Closed loop — offline conversions back to the platforms (round 4)

Kernel events `sales_lead converted` (SQL, value = the deal's value or a policy default) and `deal won` enqueue
`ad_conversion_outbox` rows when a touchpoint with a click id or an email exists. `ads_sync` (or a 15-min lane)
uploads: Google `conversionUploads:uploadClickConversions` with `gclid` (fallback: enhanced conversions for leads with
hashed email + conversion action id), LinkedIn Conversions API (`conversionEvents`, `li_fat_id` or SHA-256 email,
conversion rule per event). Requires one conversion action per event created once in each platform (ids in
`policy_rules['agents.ads_sync'].conversion_actions`). GDPR: hashes only, EU-based leads, no raw PII leaves the
CRM; the privacy notice on zeami.io must name advertising measurement.

## 7. Phasing

| Round | Scope | Repos | Migrations |
|---|---|---|---|
| 1 ✅ | Nav group, `/marketing`, `/marketing/connectors`, connector API contract, this plan | app | — |
| 1b ✅ | Google Ads service-account reader, LinkedIn Ads OAuth + reader, live overview (no storage) | app | — |
| 2 | Tables 055–057, `ads_sync` cron (stores what 1b reads live), multi-account picker, kernel commands + 3 tools, public form captures UTM/click ids, Lead Gen Forms | core, hermes, app | 055 ad tables, 056 touchpoints, 057 policy + outbox |
| 3 | Reporting: tiles with real numbers, funnel, campaign table, campaign page, source chip on `/sales-leads`, costs line, ads line in the attention digest | app, core | — |
| 4 | Offline conversion upload (Google + LinkedIn), unattributed-leads review, ICP ↔ campaign link in the ICP panel | core, hermes, app | — |

Lead times outside the code, start now: LinkedIn Advertising API approval (weeks), Google Ads developer token
approval (days; a test token is instant), zeami.io form change (their dev), conversion actions created in both
platforms (round 4).

## 8. Decisions for Amir

- Reporting currency (EUR assumed; ads accounts may bill in USD/EUR — FX rates as policy rows, monthly).
- Who may connect a shared ad account: any user (like Gmail) or admin only? Plan assumes any user, org-wide visibility
  of the numbers (like `/pipeline`).
- Whether a Lead Gen Form lead goes straight to `/sales-leads` triage (assumed yes) or becomes a prospect on an ICP.
- Round 4 value for "SQL": fixed default (e.g. 500 EUR) or the deal's entered value.
