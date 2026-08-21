/** Coerce unknown tool/receipt values into a React-safe string. */
export function safeDisplayText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.name === "string" && rec.name.trim()) {
      const extra = typeof rec.skill_point_formula === "string" && rec.skill_point_formula.trim()
        ? `（${rec.skill_point_formula.trim()}）`
        : "";
      return `${rec.name.trim()}${extra}`;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

/** Body text for a content_block that is not a specialized receipt type. */
export function contentBlockFallbackText(block: unknown): string {
  if (!block || typeof block !== "object") return safeDisplayText(block);
  if (isStructuredContentBlock(block)) return "";
  const rec = block as { type?: unknown; text?: unknown };
  if (typeof rec.text === "string") return rec.text;
  if (rec.text != null) return safeDisplayText(rec.text);
  return safeDisplayText(block);
}

export function isStructuredContentBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const type = (block as { type?: unknown }).type;
  return type === "roll_group" || type === "roll" || type === "asset_changes" || type === "cash";
}
