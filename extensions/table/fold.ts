/** The persisted-fold pressure threshold; request history is bounded independently. */
export const DEFAULT_COMPACT_AT = 0.8;

/** Read on each call. Accept a percentage (80) or a fraction (0.8); 1 means 100%. */
export function compactAt(): number {
    const raw = process.env.PI_COC_COMPACT_AT?.trim();
    if (!raw) return DEFAULT_COMPACT_AT;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_COMPACT_AT;
    const fraction = value > 1 ? value / 100 : value;
    return fraction > 0 && fraction <= 1 ? fraction : DEFAULT_COMPACT_AT;
}
