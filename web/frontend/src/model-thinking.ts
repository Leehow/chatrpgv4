/** Match a saved/requested level to the active model's advertised Pi levels. */
export function effectiveThinkingLevel(requested: string, supportedLevels?: string[]): string {
  if (supportedLevels == null) return requested || "off";
  const levels = (supportedLevels ?? []).filter(Boolean);
  if (levels.includes(requested)) return requested;
  if (levels.includes("off")) return "off";
  return levels[0] ?? "off";
}

export interface ModelRouteIdentity {
  provider: string;
  model: string;
  providerLabel: string;
  modelLabel: string;
  label: string;
}

/** Keep duplicate model ids tied to their selected provider and show that
 * channel anywhere the route is rendered. */
export function modelRouteIdentity(route: {
  provider: string;
  model: string;
  providerLabel?: string;
  modelLabel?: string;
}): ModelRouteIdentity {
  const providerLabel = route.providerLabel?.trim() || route.provider;
  const modelLabel = route.modelLabel?.trim() || route.model;
  return {
    provider: route.provider,
    model: route.model,
    providerLabel,
    modelLabel,
    label: `${providerLabel} · ${modelLabel}`,
  };
}
