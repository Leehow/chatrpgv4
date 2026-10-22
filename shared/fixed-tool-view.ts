/**
 * Whether the single Keeper's request carries the fixed tool view (§228.1 apply envelope, entry place/output, in-turn
 * read folds). Measured 2026-10-21/22 (chatrpgv4-research/reports/tool-slim-20261021): on Grok it stopped dropping the
 * sections the table's state owes; MiniMax answered the envelope with lookup loops. `PI_COC_FIXED_TOOLS` overrides:
 * `1` forces it on, `0` forces it off; otherwise the Keeper's provider decides.
 */
export const FIXED_TOOL_PROVIDERS: readonly string[] = Object.freeze(['grok-build', 'grok-relay', 'xai']);
export function fixedToolView(env: Record<string, string | undefined>, provider: string | null | undefined): boolean {
    const forced = env.PI_COC_FIXED_TOOLS?.trim();
    if (forced === '1') return true;
    if (forced === '0') return false;
    return typeof provider === 'string' && FIXED_TOOL_PROVIDERS.includes(provider);
}
