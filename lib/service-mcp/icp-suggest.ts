/**
 * `suggest_icp` is now the objective-aware ICP optimizer — see lib/icp-optimize.
 * Kept as a thin re-export so the service dispatch import stays stable.
 */
export { optimizeIcp as suggestIcp } from '../icp-optimize';
export type { IcpOptimizeInput as IcpSuggestInput } from '../icp-optimize';
