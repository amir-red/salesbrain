/**
 * Centralized LLM configuration: which model + which server tools.
 *
 * Every `anthropic.messages.create(...)` call site in this codebase reads
 * MODEL from here so model upgrades are one constant change, not a 4-file
 * search-and-replace.
 *
 * Cost notes (rough — check Anthropic pricing for exact numbers):
 *   - Opus 4.6 ≈ 5× the input + output cost of Sonnet 4.5.
 *   - Each `web_search` call ≈ $0.01 (a few cents). max_uses caps the bleed
 *     per API request so a runaway tool-loop can't drain the budget.
 *
 * Prompt caching (already wired in `runAgent`) cuts repeat-turn input cost
 * to ~10% of list price for the stable prefix — that's what makes Opus
 * affordable on the conversational agent at LIMIT 200.
 *
 * If background jobs (prep_meeting, prospect research, mass outreach) ever
 * become too expensive on Opus, introduce a `BACKGROUND_MODEL` constant
 * here (e.g. `'claude-sonnet-4-5'`) and have those call sites read it
 * instead of MODEL. One change, no refactor anywhere else.
 */

/** Primary model for every Claude call in the app. */
// We use the undated alias rather than a dated id (e.g. claude-opus-4-6-YYYYMMDD)
// because the SDK only publishes `claude-opus-4-6` in its Model type union — the
// dated id may exist on the API but isn't confirmed in our installed SDK. Easy
// to pin to a specific dated id later by editing this one line.
export const MODEL = 'claude-opus-4-6' as const;

/**
 * Anthropic's hosted Web Search server tool.
 *
 * "Server tool" = the API runs it for us; we don't dispatch it in our
 * `executeTool` switch. The model decides to search, Anthropic executes
 * the query, results come back as `web_search_tool_result` blocks the
 * model can cite from. Costs ~$0.01 per search request.
 *
 * The version date in `type` is the schema version Anthropic published
 * — decoupled from the model version. Bump if Anthropic ships a newer
 * web_search spec we want to opt into.
 *
 * `max_uses: 5` caps how many searches the model can fire in a single
 * API request. Worst-case ~$0.05 of search per turn, which keeps a
 * runaway tool-loop from blowing the budget if the model gets greedy.
 */
export const webSearchTool = {
  type: 'web_search_20260209' as const,
  name: 'web_search' as const,
  max_uses: 5,
};
