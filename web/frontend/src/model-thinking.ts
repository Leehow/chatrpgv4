/** Match a saved/requested level to the active model's advertised Pi levels. */
export function effectiveThinkingLevel(requested: string, supportedLevels?: string[]): string {
  if (supportedLevels == null) return requested || "off";
  const levels = (supportedLevels ?? []).filter(Boolean);
  if (levels.includes(requested)) return requested;
  if (levels.includes("off")) return "off";
  return levels[0] ?? "off";
}
