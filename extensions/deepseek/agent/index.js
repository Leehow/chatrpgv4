import { applyThinkingCap, rewriteDeepSeekPayloadAsync } from "./client.js";
import { refreshDeepSeekCatalog } from "./catalog-runtime.js";
import { createDeepSeekProvider, DEEPSEEK_PROVIDER_ID } from "./provider.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDeepSeekModel(model) {
    return (model?.provider || "").toLowerCase() === DEEPSEEK_PROVIDER_ID;
}
export default function (pi) {
    const registration = createDeepSeekProvider();
    pi.registerProvider(DEEPSEEK_PROVIDER_ID, registration);
    // Capability lookups answer from the catalog that was actually registered, so
    // a model discovered at runtime is not treated as unknown. Held in memory to
    // keep `before_provider_request` off the filesystem.
    // Registration above is synchronous by contract; this refresh runs behind it
    // and lands in the catalog on the next launch.
    void refreshDeepSeekCatalog();
    pi.on("before_provider_request", async (event, ctx) => {
        if (!isDeepSeekModel(ctx.model))
            return;
        if (!isRecord(event.payload))
            return;
        // Native search declarations and protocol routing belong to the generic Pi adapter.
        const payload = event.payload;
        // Thinking-length governor: caps chain-of-thought at ~150 words unless
        // the caller explicitly asked for none/high/max (measured: effort "low"
        // alone does not shorten DeepSeek's thinking).
        return rewriteDeepSeekPayloadAsync(applyThinkingCap(payload));
    });
}
