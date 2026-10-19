/**
 * Conversation request adapter for contributed DeepSeek chat models.
 *
 * Pi's built-in `anthropic-messages` streamer is the session transport
 * (`api` + `baseUrl` + stored API key). This module is the host-owned,
 * testable seam: HTTPS Messages URLs, x-api-key from the Pi credential store
 * (settings fallback), fail-closed without a key, and no key material in
 * thrown messages.
 */
import { buildDeepSeekRequest, buildDeepSeekRequestAsync, } from "./client.js";
import { resolveBaseUrl, resolveSettingsApiKey } from "./config.js";
import { DeepSeekFilesClient } from "./files/client.js";
import { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API } from "./models.js";
import {messagesBaseUrl, rewriteMessagesPayload, rewriteMessagesImages} from './messages.js';
export { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API };
const MISSING_KEY = "No DeepSeek API key configured — run /login deepseek-extended or set ext.deepseek.apiKey in settings";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Pull the API key out of a Pi credential. Never returns refresh tokens. */
export function apiKeyFromCredentials(credentials) {
    if (typeof credentials === "string" && credentials.trim())
        return credentials.trim();
    if (!isRecord(credentials)) {
        throw new Error(MISSING_KEY);
    }
    const key = credentials.key;
    if (typeof key === "string" && key.trim())
        return key.trim();
    const access = credentials.access;
    if (typeof access === "string" && access.trim())
        return access.trim();
    throw new Error(MISSING_KEY);
}
/**
 * Pi credential store first, then `ext.deepseek.apiKey`.
 * Throws a user-actionable message and never echoes secrets.
 */
export function resolveDeepSeekApiKey(credentials) {
    if (credentials !== undefined) {
        try {
            return apiKeyFromCredentials(credentials);
        }
        catch (error) {
            if (resolveSettingsApiKey()) {
                /* fall through to settings */
            }
            else {
                throw error;
            }
        }
    }
    const fallback = resolveSettingsApiKey();
    if (fallback)
        return fallback;
    throw new Error(MISSING_KEY);
}
function requireModelId(modelId) {
    const id = typeof modelId === "string" ? modelId.trim() : "";
    if (!id)
        throw new Error("Missing DeepSeek conversation model id");
    return id;
}
/** Same credential chain as conversation requests: Pi store first, then settings. */
export function createConversationFilesClient(input = {}) {
    return new DeepSeekFilesClient({
        baseUrl: resolveBaseUrl(input.baseUrl),
        apiKey: resolveDeepSeekApiKey(input.credentials),
        fetchImpl: input.fetchImpl,
    });
}
function messagesRequest(input, apiKey) {
    return {url: `${messagesBaseUrl(input.baseUrl)}/v1/messages`,
        headers: {'x-api-key':apiKey,'content-type':'application/json','anthropic-beta':'files-api-2025-04-14'},
        body: {model:requireModelId(input.modelId),stream:true,messages:input.messages ?? [],max_tokens:384000,
            ...(input.instructions ? {system:input.instructions} : {}),...(input.extra ?? {})}};
}
export function buildConversationRequest(input) {
    const apiKey = resolveDeepSeekApiKey(input.credentials);
    if (!input.endpoint || input.endpoint === 'messages') {
        const request = messagesRequest(input,apiKey);
        return {...request,body:rewriteMessagesPayload(request.body)};
    }
    return buildDeepSeekRequest({
        endpoint: input.endpoint ?? "responses",
        model: requireModelId(input.modelId),
        apiKey,
        baseUrl: input.baseUrl,
        messages: input.messages,
        input: input.input,
        instructions: input.instructions,
        extra: input.extra,
    });
}
export async function buildConversationRequestAsync(input) {
    const apiKey = resolveDeepSeekApiKey(input.credentials);
    if (!input.endpoint || input.endpoint === 'messages') {
        const request = messagesRequest(input,apiKey);
        request.body = rewriteMessagesPayload(await rewriteMessagesImages(request.body,
            {baseUrl:messagesBaseUrl(input.baseUrl)}, {...input,apiKey,fetch:input.fetchImpl}));
        return request;
    }
    return buildDeepSeekRequestAsync({
        endpoint: input.endpoint ?? "responses",
        model: requireModelId(input.modelId),
        apiKey,
        baseUrl: input.baseUrl,
        messages: input.messages,
        input: input.input,
        instructions: input.instructions,
        extra: input.extra,
        files: input.files,
        filesClient: input.filesClient ?? createConversationFilesClient(input),
        fileCache: input.fileCache,
        limits: input.limits,
        fetchImpl: input.fetchImpl,
        signal: input.signal,
    });
}
/** Provider-level transport fields consumed by Pi ModelRuntime. */
export function conversationProviderTransport() {
    return {
        api: DEEPSEEK_CHAT_API,
        baseUrl: messagesBaseUrl(),
        authHeader: true,
    };
}
