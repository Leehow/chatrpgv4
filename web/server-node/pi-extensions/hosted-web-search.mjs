/**
 * Pure helpers for provider-native hosted web_search.
 *
 * Official `openai` (openai-responses), `openai-codex` (openai-codex-responses),
 * and `xai` only. Custom OpenAI-compatible provider ids must not match — never
 * substring-match "openai" / "openai-codex".
 */

const HOSTED_WEB_SEARCH_TOOL = Object.freeze({ type: "web_search" });

export const OPENAI_HOSTED_SEARCH_FAMILIES = Object.freeze(["openai", "openai-codex"]);
export const XAI_HOSTED_SEARCH_FAMILIES = Object.freeze(["xai"]);

export const HOSTED_WEB_SEARCH_TIP_HEADING = "## Hosted web search";

export const HOSTED_WEB_SEARCH_TIP = [
  "",
  HOSTED_WEB_SEARCH_TIP_HEADING,
  "优先使用模型原生搜索。其次才用客户端 web_search。禁止用 bash/curl 搜网。",
].join("\n");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerId(model) {
  return String(model?.provider || "").trim().toLowerCase();
}

/**
 * @returns {"openai" | "openai-codex" | "xai" | null}
 */
export function hostedWebSearchFamily(model) {
  if (!isRecord(model)) return null;
  const provider = providerId(model);
  const api = typeof model.api === "string" ? model.api : "";
  if (provider === "openai") {
    return api === "openai-responses" ? "openai" : null;
  }
  if (provider === "openai-codex") {
    return api === "openai-codex-responses" ? "openai-codex" : null;
  }
  if (provider === "xai") return "xai";
  return null;
}

function familyAllowed(family, allow) {
  if (!family) return false;
  if (allow == null) return true;
  return Array.from(allow).includes(family);
}

function isHostedWebSearchTool(tool) {
  return (
    isRecord(tool)
    && tool.type === "web_search"
    && tool.function === undefined
    && (typeof tool.name !== "string" || tool.name === "web_search")
  );
}

function isClientWebSearchTool(tool) {
  if (!isRecord(tool) || isHostedWebSearchTool(tool)) return false;
  const type = typeof tool.type === "string" ? tool.type : "";
  const name = typeof tool.name === "string" ? tool.name : "";
  if (name === "web_search") return true;
  if (type === "function") {
    const fn = isRecord(tool.function) ? tool.function : undefined;
    return typeof fn?.name === "string" && fn.name === "web_search";
  }
  return false;
}

export function mergeHostedWebSearchTools(existing) {
  const current = Array.isArray(existing) ? [...existing] : [];
  const filtered = current.filter((tool) => !isClientWebSearchTool(tool));
  if (!filtered.some(isHostedWebSearchTool)) {
    filtered.push({ ...HOSTED_WEB_SEARCH_TOOL });
  }
  return filtered;
}

function dropClientWebSearchTools(existing) {
  const current = Array.isArray(existing) ? existing : [];
  return current.filter((tool) => !isClientWebSearchTool(tool));
}

/**
 * Transform a provider request payload, or return null when this family
 * must not touch it (unsupported / custom OpenAI-compatible).
 */
export function applyHostedWebSearch(model, payload, allow) {
  const family = hostedWebSearchFamily(model);
  if (!familyAllowed(family, allow) || !isRecord(payload)) return null;

  const isResponses = Array.isArray(payload.input);
  const isCompletions = Array.isArray(payload.messages) && !isResponses;

  if (isResponses) {
    return { ...payload, tools: mergeHostedWebSearchTools(payload.tools) };
  }

  // xAI leftover Chat Completions: never inject hosted tools here; still drop
  // a colliding client web_search so it cannot shadow a later Responses remap.
  if (family === "xai" && isCompletions) {
    return { ...payload, tools: dropClientWebSearchTools(payload.tools) };
  }

  return null;
}

export function applyHostedWebSearchSystemTip(model, systemPrompt, allow) {
  const family = hostedWebSearchFamily(model);
  if (!familyAllowed(family, allow)) return null;
  const prompt = typeof systemPrompt === "string" ? systemPrompt : "";
  if (prompt.includes(HOSTED_WEB_SEARCH_TIP_HEADING)) return null;
  return { systemPrompt: `${prompt}${HOSTED_WEB_SEARCH_TIP}` };
}
