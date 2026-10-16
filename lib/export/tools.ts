import { buildExport, cleanArgs } from '@/lib/export/build';
import { exportUrl, signExport, type ExportKind } from '@/lib/export/sign';

/**
 * What the export MCP tools do, for both MCP surfaces: validate the request by actually building the workbook as the
 * caller (so a bad filter or an invisible ICP fails HERE, with its reason), then return a 15-minute signed link.
 */
export const EXPORT_TOOL_KIND: Record<string, ExportKind> = {
  export_sales_leads: 'sales-leads',
  export_prospects: 'prospects',
  export_icp: 'icp',
};

export async function exportTool(
  tool: string, args: Record<string, unknown>, who: { userId: string; role: string },
): Promise<Record<string, unknown>> {
  const kind = EXPORT_TOOL_KIND[tool];
  const clean = cleanArgs(kind, args);
  const built = await buildExport({ kind, args: clean }, who);
  const { token, expires_at } = signExport(who.userId, { kind, args: clean });
  return {
    download_url: exportUrl(token), filename: built.filename, expires_at,
    rows: built.rows, sheets: built.sheets,
    note: 'Open the link (any browser, no login needed) within 15 minutes to download the .xlsx. It is built when opened, ' +
          'so it reflects the data at that moment. Anyone with the link can download it until it expires.',
  };
}

const VIEWS = ['working', 'due', 'must', 'new', 'contacted', 'replied', 'converted', 'archived', 'all'];

/** Tool definitions, in the MCP shape both surfaces use. */
export const EXPORT_TOOL_DEFS = [
  {
    name: 'export_sales_leads',
    description:
      "Excel export of the sales-leads inbox: one sheet of leads (name, title, company, contact details, status, priority, " +
      "order, back / front office, journey, last contact, ping date, notes, talking points) and one sheet with every " +
      "track-record line. Returns a 15-minute download link plus the row count. `view` as on the page: working (default), " +
      "due, must, new, contacted, replied, converted, archived, all; `mine` + `role` (responsible | front) narrow to the caller's " +
      "own seats; `q` searches name / company / title / where met.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        view: { type: 'string', enum: VIEWS, default: 'working' },
        mine: { type: 'boolean', description: 'only leads where the caller is back or front office' },
        role: { type: 'string', enum: ['responsible', 'front'] },
        q: { type: 'string' },
        sort: { type: 'string', enum: ['priority', 'contact', 'newest'], default: 'priority' },
      },
    },
  },
  {
    name: 'export_prospects',
    description:
      "Excel export of the caller's prospects (leads before they are deals): contact, company, fit score and why, LinkedIn " +
      "request state, messages sent, replies, follow-up date, owner, source, research. Returns a 15-minute download link " +
      "plus the row count. Filters: `stage` (e.g. P5_SENT, P6_REPLIED), `icp_id`, `reply_status`, `q`, `mine`.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        stage: { type: 'string' }, icp_id: { type: 'string' }, reply_status: { type: 'string' }, q: { type: 'string' },
        mine: { type: 'boolean' },
      },
    },
  },
  {
    name: 'export_icp',
    description:
      "Full Excel export of one ICP: its definition and criteria, every lead on its list with all details, the stage " +
      "funnel, and the agent run history. Returns a 15-minute download link plus row counts. Owner or admin only; `icp_id` " +
      "from the ICP list.",
    inputSchema: { type: 'object' as const, properties: { icp_id: { type: 'string' } }, required: ['icp_id'] },
  },
];
