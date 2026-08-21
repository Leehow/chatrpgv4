/**
 * Gateway-specific thinking metadata that Pi's built-in catalog cannot
 * supply: custom provider ids (jellytoken, etc.) have no catalog file, so a
 * fetched `{id, name}` entry otherwise advertises only "off".
 *
 * JellyToken Chat Completions probe (2026-08-20):
 * - `thinking: {type:"disabled"}` turns thinking off on models that honor it.
 * - `reasoning_effort` accepts `low` / `medium` / `high` / `xhigh` / `max`.
 * - `none` / `off` / `minimal` are rejected (400).
 * - Default (omit) leaves thinking on. Pi must use thinkingFormat=deepseek
 *   so `off` sends `thinking: {type:"disabled"}` rather than omitting the field.
 * - The gateway accepts these fields on every reachable model. DeepSeek, GLM,
 *   and Kimi honor off vs effort; some Qwen/MiniMax models ignore them.
 */

const JELLYTOKEN_HOST = /jellytoken\.com/i;

const JELLYTOKEN_DEFAULT = {
  reasoning: true,
  thinkingLevelMap: {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  compat: {
    thinkingFormat: "deepseek",
    supportsReasoningEffort: true,
    supportsDeveloperRole: false,
    supportsStore: false,
  },
};

export function isJellyTokenGateway({ providerId, baseUrl } = {}) {
  return providerId === "jellytoken" || JELLYTOKEN_HOST.test(String(baseUrl || ""));
}

/** Known thinking overlay for one model, or null if we have no probe. */
export function knownThinkingMeta({ providerId, baseUrl, modelId } = {}) {
  if (!isJellyTokenGateway({ providerId, baseUrl })) return null;
  if (!String(modelId || "").trim()) return null;
  const compat = { ...JELLYTOKEN_DEFAULT.compat };
  if (/deepseek/i.test(String(modelId))) {
    compat.requiresReasoningContentOnAssistantMessages = true;
  }
  return {
    reasoning: true,
    thinkingLevelMap: JELLYTOKEN_DEFAULT.thinkingLevelMap,
    compat,
  };
}

/**
 * Stamp known thinking metadata onto a models.json entry when it has no
 * thinkingLevelMap of its own (a user-tuned map always wins).
 */
export function applyKnownThinking({ providerId, baseUrl } = {}, model) {
  if (!model || typeof model !== "object" || !model.id) return model;
  if (model.thinkingLevelMap && typeof model.thinkingLevelMap === "object") return model;
  const known = knownThinkingMeta({ providerId, baseUrl, modelId: model.id });
  if (!known) return model;
  return {
    ...model,
    reasoning: true,
    thinkingLevelMap: known.thinkingLevelMap,
    compat: { ...(model.compat || {}), ...known.compat },
  };
}
