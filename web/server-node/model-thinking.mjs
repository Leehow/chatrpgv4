/** Resolve one exact Pi thinking level from the selected model capability. */
export function effectiveThinkingLevel(requested, supportedLevels) {
  const levels = Array.isArray(supportedLevels)
    ? supportedLevels.filter((level) => typeof level === "string" && level)
    : [];
  const wanted = String(requested || "").trim();
  if (levels.includes(wanted)) return wanted;
  if (levels.includes("off")) return "off";
  return levels[0] || "off";
}

/**
 * Validate the UI selection against the same /api/models payload it sees.
 * This is also the server-side boundary for stale localStorage or a custom
 * client: only an exact model-supported thinking level reaches Pi.
 */
export function resolveRequestedModelSettings(catalog, request = {}) {
  const providers = catalog?.providers && typeof catalog.providers === "object"
    ? catalog.providers
    : {};
  const requestedProvider = String(request.provider || "").trim();
  const defaultProvider = String(catalog?.default?.provider || "").trim();
  const provider = providers[requestedProvider]
    ? requestedProvider
    : providers[defaultProvider]
      ? defaultProvider
      : Object.keys(providers)[0] || requestedProvider;
  const models = Array.isArray(providers[provider]?.models) ? providers[provider].models : [];
  const requestedModel = String(request.model || "").trim();
  const defaultModel = provider === defaultProvider ? String(catalog?.default?.model || "").trim() : "";
  const selected = models.find((entry) => entry?.id === requestedModel)
    || models.find((entry) => entry?.id === defaultModel)
    || models[0];
  const model = String(selected?.id || requestedModel).trim();
  return {
    provider,
    model,
    thinking: effectiveThinkingLevel(request.thinking, selected?.thinkingLevels),
  };
}
