/**
 * Prompt-cache routing for xAI.
 *
 * xAI keeps prompt-cache entries per server and sends a request to the server that holds its prefix only when
 * the request carries `x-grok-conv-id` (docs.x.ai, Advanced API usage > Prompt caching). Pi's Responses
 * transport sends the session id as `prompt_cache_key` and `x-client-request-id`, which xAI does not route by,
 * so a Keeper turn's first call usually landed on another server and paid again for its whole prefix.
 * Measured on the installed App (2026-10-02, The Haunting turns 0-9): 40% of Keeper input tokens were cache
 * reads; later calls inside a turn reused 34-60k tokens, the first call of a turn reused 1,152 (384 on 4.5).
 *
 * The conversation id is the Pi session id, the same value Pi already sends as `prompt_cache_key`, so one
 * table's calls stay on one cache. A header already set by the caller is left as it is.
 */
import { GROK_BUILD_PROVIDER_ID } from "./models.js";

export const CONVERSATION_HEADER = "x-grok-conv-id";

function hasHeader(headers, name) {
    return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

/** The id one table's requests share: the Pi session id, else the request id Pi derived from it. */
export function conversationIdFor(headers, ctx) {
    let id;
    try {
        id = ctx?.sessionManager?.getSessionId?.();
    }
    catch {
        id = undefined;
    }
    if (typeof id !== "string" || !id.trim())
        id = headers?.["x-client-request-id"];
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/** Add `x-grok-conv-id` to every grok-build request whose session has an id. */
export function routeCacheByConversation(headers, ctx) {
    if (!headers || typeof headers !== "object")
        return;
    if (ctx?.model?.provider !== GROK_BUILD_PROVIDER_ID)
        return;
    if (hasHeader(headers, CONVERSATION_HEADER))
        return;
    const id = conversationIdFor(headers, ctx);
    if (id)
        headers[CONVERSATION_HEADER] = id;
}

export function registerCacheRoutingHooks(pi) {
    pi.on("before_provider_headers", (event, ctx) => routeCacheByConversation(event?.headers, ctx));
}
