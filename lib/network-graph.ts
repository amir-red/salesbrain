/**
 * Pure functions to build an Obsidian-style graph from contacts/accounts/prospects/deals/messages.
 * Used by the /api/network route to produce the payload consumed by /network.
 */

export type GraphNodeType = 'contact' | 'account' | 'industry' | 'location';

export interface GraphNode {
  id: string;                              // 'contact:{uuid}' / 'account:{uuid}' / 'industry:{name}' / 'location:{name}'
  type: GraphNodeType;
  label: string;
  category: string | null;                 // industry name (used for color mapping)
  size: number;                            // 8-32 px radius
  metadata: Record<string, unknown>;
}

export type EdgeType = 'works_at' | 'in_industry' | 'based_in';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationship_type: EdgeType;
  weight: number;
}

export interface ContactRow {
  id: string;
  account_id: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  seniority: string | null;
  persona_type: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  source: string | null;
  owner_user_id: string | null;
  communication_profile: unknown;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  hq_location: string | null;
  notes: string | null;
}

export interface ProspectRow {
  id: string;
  account_id: string | null;
  contact_id: string | null;
  stage: string | null;
  reply_status: string | null;
  converted_deal_id: string | null;
  last_contacted_at: string | null;
}

export interface DealRow {
  id: string;
  name: string;
  company: string;
  gate: number;
  deal_type: string;
}

export interface MessageCountRow {
  contact_id: string;
  msg_count: number;
}

export interface BuildGraphInput {
  contacts: ContactRow[];
  accounts: AccountRow[];
  prospects: ProspectRow[];
  deals: DealRow[];
  messageCounts: MessageCountRow[];
}

export interface BuildGraphOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    industries: string[];
    locations: string[];
    companies: { id: string; name: string }[];
    contact_count: number;
    account_count: number;
  };
}

const UNKNOWN_INDUSTRY = 'Unknown industry';
const UNKNOWN_LOCATION = 'Unknown location';

function safeIndustryKey(name: string | null | undefined): string {
  return (name && name.trim()) || UNKNOWN_INDUSTRY;
}
function safeLocationKey(name: string | null | undefined): string {
  return (name && name.trim()) || UNKNOWN_LOCATION;
}

/**
 * Pure builder: given pre-fetched data, return the full graph payload.
 * No DB / IO here — easily testable.
 */
export function buildGraphFromData(input: BuildGraphInput): BuildGraphOutput {
  const { contacts, accounts, prospects, deals, messageCounts } = input;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const msgByContact = new Map(messageCounts.map((m) => [m.contact_id, m.msg_count]));

  // contact_id → linked prospect / deal
  const prospectByContact = new Map<string, ProspectRow>();
  for (const p of prospects) {
    if (p.contact_id) prospectByContact.set(p.contact_id, p);
  }
  // deal lookup by company name (case-insensitive)
  const dealsByCompany = new Map<string, DealRow[]>();
  for (const d of deals) {
    const key = (d.company || '').trim().toLowerCase();
    if (!key) continue;
    if (!dealsByCompany.has(key)) dealsByCompany.set(key, []);
    dealsByCompany.get(key)!.push(d);
  }

  // contact counts per account (for account sizing)
  const contactsByAccount = new Map<string, number>();
  for (const c of contacts) {
    if (c.account_id) {
      contactsByAccount.set(c.account_id, (contactsByAccount.get(c.account_id) ?? 0) + 1);
    }
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Track which industries/locations actually appear so we only emit nodes for those
  const industriesUsed = new Set<string>();
  const locationsUsed = new Set<string>();
  const accountsUsed = new Set<string>();

  // 1. Contact nodes + works_at edges
  for (const c of contacts) {
    const account = c.account_id ? accountById.get(c.account_id) ?? null : null;
    const industry = safeIndustryKey(account?.industry);
    const location = safeLocationKey(account?.hq_location);
    const linkedProspect = prospectByContact.get(c.id);
    const companyName = (account?.name || '').trim().toLowerCase();
    const linkedDeal = companyName ? dealsByCompany.get(companyName)?.[0] ?? null : null;
    const msgCount = msgByContact.get(c.id) ?? 0;

    // size = base 10 + 2 per linkage (prospect, deal, recent msg), capped 24
    let size = 10;
    if (linkedProspect) size += 2;
    if (linkedDeal) size += 2;
    if (msgCount > 0) size += Math.min(8, msgCount); // up to +8
    size = Math.min(24, size);

    nodes.push({
      id: `contact:${c.id}`,
      type: 'contact',
      label: c.full_name || c.email || 'Unknown',
      category: industry,
      size,
      metadata: {
        contact_id: c.id,
        full_name: c.full_name,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        title: c.title,
        seniority: c.seniority,
        phone: c.phone,
        linkedin_url: c.linkedin_url,
        notes: c.notes,
        source: c.source,
        last_contacted_at: linkedProspect?.last_contacted_at ?? null,
        msg_count: msgCount,
        company: account?.name ?? null,
        industry,
        location,
        account_id: account?.id ?? null,
        prospect_id: linkedProspect?.id ?? null,
        prospect_stage: linkedProspect?.stage ?? null,
        deal_id: linkedDeal?.id ?? null,
        deal_gate: linkedDeal?.gate ?? null,
      },
    });

    if (account) {
      accountsUsed.add(account.id);
      edges.push({
        id: `e:works_at:${c.id}:${account.id}`,
        source: `contact:${c.id}`,
        target: `account:${account.id}`,
        relationship_type: 'works_at',
        weight: 5,
      });
    }
  }

  // 2. Account nodes (only those with at least one contact)
  for (const a of accounts) {
    if (!accountsUsed.has(a.id)) continue;
    const numContacts = contactsByAccount.get(a.id) ?? 0;
    const industry = safeIndustryKey(a.industry);
    const location = safeLocationKey(a.hq_location);
    const size = Math.min(32, 14 + numContacts * 2);

    nodes.push({
      id: `account:${a.id}`,
      type: 'account',
      label: a.name,
      category: industry,
      size,
      metadata: {
        account_id: a.id,
        name: a.name,
        domain: a.domain,
        website: a.website,
        industry,
        location,
        company_size: a.company_size,
        contact_count: numContacts,
      },
    });

    // 3. account → industry / location edges (only when real data, not Unknown)
    if (a.industry && a.industry.trim()) {
      industriesUsed.add(industry);
      edges.push({
        id: `e:in_industry:${a.id}:${industry}`,
        source: `account:${a.id}`,
        target: `industry:${industry}`,
        relationship_type: 'in_industry',
        weight: 3,
      });
    }
    if (a.hq_location && a.hq_location.trim()) {
      locationsUsed.add(location);
      edges.push({
        id: `e:based_in:${a.id}:${location}`,
        source: `account:${a.id}`,
        target: `location:${location}`,
        relationship_type: 'based_in',
        weight: 2,
      });
    }
  }

  // 4. Industry nodes
  for (const industry of industriesUsed) {
    nodes.push({
      id: `industry:${industry}`,
      type: 'industry',
      label: industry,
      category: industry,
      size: 22,
      metadata: { industry },
    });
  }

  // 5. Location nodes
  for (const location of locationsUsed) {
    nodes.push({
      id: `location:${location}`,
      type: 'location',
      label: location,
      category: null,
      size: 20,
      metadata: { location },
    });
  }

  // Meta: dropdown choices (sorted)
  const companies = Array.from(accountsUsed)
    .map((id) => ({ id, name: accountById.get(id)?.name || '' }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    nodes,
    edges,
    meta: {
      industries: Array.from(industriesUsed).sort(),
      locations: Array.from(locationsUsed).sort(),
      companies,
      contact_count: contacts.length,
      account_count: accountsUsed.size,
    },
  };
}

/**
 * Deterministic palette mapping for industry → color. 10-color rotation.
 */
const INDUSTRY_PALETTE = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#fb7185', '#22d3ee', '#84cc16', '#fb923c', '#e879f9',
];

export function colorForIndustry(industry: string | null | undefined): string {
  if (!industry || industry === UNKNOWN_INDUSTRY) return '#64748b'; // muted slate
  let hash = 0;
  for (let i = 0; i < industry.length; i++) {
    hash = (hash * 31 + industry.charCodeAt(i)) >>> 0;
  }
  return INDUSTRY_PALETTE[hash % INDUSTRY_PALETTE.length];
}
