/**
 * M4 — Images transport error model.
 * Error codes follow spec §D10; every message is redacted before surfacing.
 */
export class ImagesError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.name = "ImagesError";
        this.code = code;
        this.status = status;
    }
}
/**
 * Advisory upsell prose returned (as a successful text result) when the
 * client-side tier gate short-circuits a call for free / X Basic tiers.
 * Mirrors official Grok Build `TIER_RESTRICTED_UPSELL` semantics; the
 * server remains the final authority.
 */
export const TIER_RESTRICTED_UPSELL = "Image generation is a SuperGrok subscription feature and is not available on the Free or X Basic tier. Tell the user they can upgrade to SuperGrok to unlock image and video generation: https://grok.com/supergrok?referrer=grok-build — do not retry this tool.";
