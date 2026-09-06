# Warm-intro research — 02: External survey

*Read time ≈ 4 min. Vendor claims are marked as such; the benchmark numbers below come from vendor blogs and should be treated as directional.*

## How warm-intro products model relationship strength

| Product | Signals | Score | Path surfacing |
|---|---|---|---|
| **Affinity** | Email + calendar metadata: who emailed whom, how often, how recently, meetings | 10 (weak) → 100 (strong), from **recency × frequency** | Click a contact → everyone who can introduce you; "warm intros close 25% faster" (vendor) |
| **Connect The Dots (CTD)** | Communication metadata across the team | Scores every relationship in the network | Each AE's book sorted by strength, "work the warmest first" |
| **The Swarm** | Members' connections + interaction warmth | "Relationship status" estimating warmth | Reveal warm paths → send intro requests; also sold as a data product (API/CSV) |
| **Cabal** | Email, calendar, **work history** inferred by AI | Mapped + queryable network | VC-oriented: who at the fund knows whom |
| **Boomerang** | Four-pillar graph: **team, customer, investor, partner** | **Connector Score** per path | Surfaces the highest-Connector-Score path to any target account |
| **Clay** | LinkedIn "people also viewed" + 100+ enrichment providers | n/a (orchestration) | Automates finding 2nd-degree intro candidates |
| **Common Room / Warmly** | Product/community/web *intent* signals, visitor ID | n/a | "Who to reach now", not "how to reach them" — adjacent, not this problem |

**Pattern across all of them:** strength = *interaction recency × frequency*, decayed; sources ranked roughly thread/meeting > email > connection > shared background; and the *connector* is scored separately from the *edge* (responsiveness, seniority, how many intros they've made).

## Pathfinding at our scale

- **Yen's k-shortest simple paths**: O(k·n·(m + n log n)); the standard way to return the top-k *diverse* paths. Neo4j GDS ships it; trivially implementable over an in-memory edge list.
- **Bidirectional BFS**: meets in the middle, big win on dense graphs — but only correct for unweighted graphs. Useful as the ≤3-hop *existence* check.
- **Beam search**: bounded frontier per hop, the natural fit for a hop cap with a scoring function.
- **Postgres recursive CTE vs graph DB**: with an indexed edges table, recursive CTEs handle **tens of millions of edges at sub-second latency for typical depths**; performance degrades on dense relationships **beyond 3–4 levels**. Neo4j's index-free adjacency is an orders-of-magnitude win only for deep traversals (**6+ hops**). Our cap is 5 with a hard preference for ≤3, over thousands of nodes per employee — **below the threshold where a graph store pays**.

## Evidence for the depth penalty and intro etiquette

- **Warm vs cold**: warm intro/referral conversion **15–25%** vs cold email ~3%; meeting rates **40–60%** warm vs ~3% cold-call response; referred prospects close **4–5× faster**; "a warm intro converts 10× better than a scraped list." (Vendor/aggregator blogs — directional.)
- **Chains decay steeply**: a Milgram-style reproduction reached a **28% completion** rate over long chains; a network-introduction study saw overall success fall **45% → 11% once incidental attrition is counted**; referral-chain research finds success depends on **path length *and* the strength of the intermediate links**. No rigorous per-degree (2nd vs 3rd) study was found — **the ~0.5 per-hop penalty in the spec is a grounded estimate, not a measured constant, and must be tunable.**
- **Double opt-in** (Fred Wilson, AVC 2009): ask *both* sides before connecting; making an intro without it is "one of the biggest faux pas" in investor circles. The **forwardable email**: a short note the connector can forward with one click — who you are, exactly why you want to meet the target, one ask. The connector never brokers; they *forward and step back*.

## What we adopt / what we reject

**Adopt**
- Source-weighted edge strength × recency decay (Affinity-style), with the **connector scored separately** from the edge (Boomerang's Connector Score).
- Beam search with a hop cap, Yen-style top-k diverse paths, **entirely in Postgres/Python** — no graph database.
- A steep, tunable per-hop penalty (default ~0.5) and a hard preference for ≤3 hops.
- **Forwardable-blurb, double-opt-in** as the *only* intro mechanic: every hop asks the connector to forward, never to vouch or broker.
- "People who engage with the target's posts" (Clay's insight) as a cheap one-hop ring — via Unipile's third-party posts, not "people also viewed" (which Unipile doesn't expose).

**Reject**
- Purchased relationship-graph data (The Swarm-as-data, ZoomInfo-style) — GDPR exposure and it contradicts the per-employee-owned-edges rule.
- Any invitation automation — decided 2026-07-30 and unchanged.
- Intent/visitor signals (Common Room, Warmly) — a different problem.
- A graph store — our depth and scale don't justify the operational cost.

**Sources:** [Affinity — relationship strengths](https://support.affinity.co/s/article/Leveraging-your-Connections-and-Relationship-Strengths) · [Affinity — relationship intelligence](https://www.affinity.co/blog/relationship-intelligence) · [Connect The Dots](https://ctd.ai/) · [The Swarm — how status is calculated](https://help.theswarm.com/en/articles/8117404-how-is-relationship-status-calculated) · [Cabal — relationship intelligence for VC](https://cabal.ghost.io/relationship-intelligence-for-venture-capital/) · [Boomerang — warm intro software comparison](https://getboomerang.ai/glossaries/warm-intro-software-comparison) · [Clay — "people also viewed" warm intros](https://www.clay.com/blog/harnessing-people-also-viewed-find-warm-intros-in-your-linkedin-network-automatically-with-clay) · [Neo4j — Yen's algorithm](https://neo4j.com/docs/graph-data-science/current/algorithms/yens/) · [Postgres recursive CTEs vs Neo4j](https://medium.com/codex/graph-queries-with-recursive-ctes-you-dont-need-neo4j-3aade6fb7f85) · [Neo4j vs PostgreSQL (2026)](https://www.modern-datatools.com/compare/neo4j-vs-postgresql) · [Bidirectional BFS](https://codemia.io/knowledge-hub/path/how_do_you_use_a_bidirectional_bfs_to_find_the_shortest_path) · [Warm intro vs cold — data](https://gasimo.org/warm-intro-vs-cold-outreach-what-the-data-actually-says/) · [Draftboard — measuring warm intros](https://www.draftboard.com/blog/how-to-measure-the-impact-of-warm-intros-on-your-sales-pipeline) · [Fred Wilson — the double opt-in introduction](https://avc.com/2009/11/the-double-optin-introduction/) · [Entrepreneur — the forwardable introduction email](https://www.entrepreneur.com/starting-a-business/why-and-how-you-should-write-a-forwardable-introduction/247692) · [Unipile API reference — relations](https://developer.unipile.com/reference/userscontroller_getrelations.md) · [Unipile — posts & comments](https://developer.unipile.com/docs/posts-and-comments)
