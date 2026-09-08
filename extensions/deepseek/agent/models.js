/**
 * Canonical DeepSeek conversation models.
 *
 * Declared once and consumed by:
 * - the Pi provider factory (`createAuthProvider`) so session runtime can stream;
 * - the manifest `auth.provider.models` contribution so the host catalog can
 *   overlay the same ids when the Pi runtime catalog is empty.
 *
 * These ids are conversation models only. They are never written to models.json.
 */
/** Independent extension provider. Must not collide with reserved official `deepseek`. */
export const AUTH_PROVIDER_ID = "deepseek-extended";
export const DEEPSEEK_PROVIDER_ID = AUTH_PROVIDER_ID;
export const DEEPSEEK_PROVIDER_NAME = "DeepSeek Extended";
export const DEEPSEEK_CHAT_API = "openai-responses";
export const DEEPSEEK_RESPONSES_API = DEEPSEEK_CHAT_API;
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_VISION_MODEL_ID = "deepseek-v4-flash-vision-exp";
/**
 * Time-boxed public beta. The id encodes its own sunset: DeepSeek stops serving
 * it after 2026-09-10, after which every request 400s. It is a normal catalog
 * row so it inherits the V4 transport unchanged; delete the row once it lapses.
 */
export const DEEPSEEK_V41_FLASH_BETA_MODEL_ID = "deepseek-v4.1-flash-expires-on-0910";
const V4_THINKING = {
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    max: "max",
};
const V4_COMPAT = {
    supportsStore: false,
    supportsDeveloperRole: false,
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "deepseek",
};
/** Hosted Responses `web_search`. Files API / code_interpreter are phase 2. */
export const DEEPSEEK_HOSTED_TOOLS = {
    tools: ["web_search"],
};
export const DEEPSEEK_CAPABILITIES = {
    hostedTools: { tools: [...DEEPSEEK_HOSTED_TOOLS.tools] },
    structuredOutputs: true,
    nativeSearch: { tools: [...DEEPSEEK_HOSTED_TOOLS.tools] },
};
// Off-peak USD / 1M tokens from official pricing (vision matches V4 Flash).
const V4_FLASH_COST = { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 };
/**
 * Current DeepSeek conversation catalog (phase 1).
 * Text model matches the live V4 docs; the vision id and the V4.1 Flash beta
 * are the multimodal rows. The beta stays last so it never becomes a default.
 */
export const DEEPSEEK_CONVERSATION_MODELS = [
    {
        id: DEEPSEEK_VISION_MODEL_ID,
        name: "DeepSeek V4 Flash Vision",
        api: DEEPSEEK_CHAT_API,
        reasoning: true,
        input: ["text", "image"],
        cost: { ...V4_FLASH_COST },
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        thinkingLevelMap: { ...V4_THINKING },
        compat: { ...V4_COMPAT },
        capabilities: { ...DEEPSEEK_CAPABILITIES },
    },
    {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: DEEPSEEK_CHAT_API,
        reasoning: true,
        input: ["text"],
        cost: { ...V4_FLASH_COST },
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        thinkingLevelMap: { ...V4_THINKING },
        compat: { ...V4_COMPAT },
        capabilities: { ...DEEPSEEK_CAPABILITIES },
    },
    {
        // Sourced from the beta announcement: native multimodal input, billed at
        // the V4 Flash rate, 20 concurrent requests per account, same base URL.
        // Context/output limits, thinking format and hosted web_search are NOT in
        // any announcement — they are inherited from V4 Flash, which is the same
        // family on the same /responses endpoint. Verify against a live key.
        id: DEEPSEEK_V41_FLASH_BETA_MODEL_ID,
        name: "DeepSeek V4.1 Flash Beta (expires 2026-09-10)",
        api: DEEPSEEK_CHAT_API,
        reasoning: true,
        input: ["text", "image"],
        cost: { ...V4_FLASH_COST },
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        thinkingLevelMap: { ...V4_THINKING },
        compat: { ...V4_COMPAT },
        capabilities: { ...DEEPSEEK_CAPABILITIES },
    },
];
export const DEEPSEEK_CONVERSATION_MODEL_IDS = DEEPSEEK_CONVERSATION_MODELS.map((model) => model.id);
/**
 * Capability evidence from the canonical catalog: does this DeepSeek Extended
 * model declare hosted `web_search`? Unknown ids never qualify — search support
 * comes from declared model capabilities, never from prompts or provider names.
 */
export function modelSupportsHostedWebSearch(modelId) {
    const id = typeof modelId === "string" ? modelId.trim() : "";
    if (!id)
        return false;
    const model = DEEPSEEK_CONVERSATION_MODELS.find((candidate) => candidate.id === id);
    const tools = model?.capabilities?.hostedTools.tools.length
        ? model.capabilities.hostedTools.tools
        : (model?.capabilities?.nativeSearch.tools ?? []);
    return tools.includes("web_search");
}
/** Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export function deepseekManifestModels() {
    return DEEPSEEK_CONVERSATION_MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        api: model.api,
        input: [...model.input],
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { ...model.cost },
        ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
        ...(model.compat ? { compat: { ...model.compat } } : {}),
        capabilities: {
            hostedTools: {
                tools: [...(model.capabilities?.hostedTools.tools ?? DEEPSEEK_HOSTED_TOOLS.tools)],
            },
            structuredOutputs: true,
            nativeSearch: {
                tools: [...(model.capabilities?.nativeSearch.tools ?? DEEPSEEK_HOSTED_TOOLS.tools)],
            },
        },
    }));
}
