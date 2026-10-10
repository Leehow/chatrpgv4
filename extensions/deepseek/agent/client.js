/**
 * DeepSeek API client: Chat Completions + Responses.
 *
 * Both endpoints are stateless — every call replays the full conversation.
 * Do not send `previous_response_id`. Image + JSON rewrites run before POST.
 */
import { resolveBaseUrl, resolveDeepSeekConfig } from "./config.js";
import { defaultFileIdCache } from "./files/cache.js";
import { FilesImageChannel } from "./files/channel.js";
import { DeepSeekFilesClient } from "./files/client.js";
import { assertRequestBodySize, rewritePayloadImages, rewritePayloadImagesAsync, } from "./images.js";
import { rewriteJsonOutput } from "./json-output.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function chatCompletionsUrl(baseUrl) {
    return `${resolveBaseUrl(baseUrl)}/chat/completions`;
}
export function responsesUrl(baseUrl) {
    return `${resolveBaseUrl(baseUrl)}/responses`;
}
/** Drop stateful Responses fields so every request is a full replay. */
export function withoutStatefulFields(body) {
    if (!("previous_response_id" in body))
        return body;
    const next = { ...body };
    delete next.previous_response_id;
    return next;
}
export function rewriteDeepSeekPayload(payload) {
    const withImages = rewritePayloadImages(payload);
    const withJson = rewriteJsonOutput(withImages);
    const next = isRecord(withJson) ? withoutStatefulFields(withJson) : withJson;
    assertRequestBodySize(next);
    return next;
}
/**
 * Measured against the live API (2026-09-12, n=9 per cell): effort "low" alone
 * does NOT shorten DeepSeek's chain-of-thought (3.1-4.1k reasoning tokens on a
 * keeper-style turn, statistically identical to "high"), while this directive
 * caps it at ~250 (worst 824) with none-level latency — and reasoning keeps
 * flowing, so the tool-call `reasoning_content` contract stays intact, unlike
 * effort "none", which disables thinking outright.
 */
export const THINKING_CAP_DIRECTIVE =
    "Hard rule: internal reasoning must stay under 150 words. No long analysis, " +
    "no enumerating possibilities, no restating rules. Decide on first judgment " +
    "and spend the length on the visible answer.";
const THINKING_CAP_MARKER = "internal reasoning must stay under";
const THINKING_CAP_SKIP_EFFORTS = new Set(["none", "high", "max"]);
/**
 * Prepend the thinking-cap developer message unless the caller made an
 * explicit thinking choice: "none" needs no cap, and "high"/"max" are the
 * deliberate escape hatches for hard turns. Low or unset effort gets the cap.
 * Idempotent: a payload already carrying the directive is returned unchanged.
 */
export function applyThinkingCap(payload) {
    if (!isRecord(payload) || !("input" in payload) && !Array.isArray(payload.messages))
        return payload;
    if (Array.isArray(payload.messages)) {
        if (payload.thinking?.type === 'disabled' || THINKING_CAP_SKIP_EFFORTS.has(payload.output_config?.effort)) return payload;
        const system = typeof payload.system === 'string' ? payload.system : payload.system ?? [];
        if (JSON.stringify(system).includes(THINKING_CAP_MARKER)) return payload;
        return {...payload, system: typeof system === 'string' ? THINKING_CAP_DIRECTIVE+'\n'+system : [{type:'text',text:THINKING_CAP_DIRECTIVE},...system]};
    }
    const effort = isRecord(payload.reasoning) && typeof payload.reasoning.effort === "string"
        ? payload.reasoning.effort.trim().toLowerCase()
        : "";
    if (THINKING_CAP_SKIP_EFFORTS.has(effort))
        return payload;
    if (JSON.stringify(payload.input ?? "").includes(THINKING_CAP_MARKER))
        return payload;
    const directive = { role: "developer", content: [{ type: "input_text", text: THINKING_CAP_DIRECTIVE }] };
    if (typeof payload.input === "string") {
        return {
            ...payload,
            input: [directive, { role: "user", content: [{ type: "input_text", text: payload.input }] }],
        };
    }
    if (Array.isArray(payload.input))
        return { ...payload, input: [directive, ...payload.input] };
    return payload;
}
function filesChannelFrom(options) {
    if (options.files)
        return options.files;
    const client = options.filesClient ??
        new DeepSeekFilesClient({
            baseUrl: options.baseUrl,
            apiKey: options.apiKey,
            fetchImpl: options.fetchImpl,
        });
    return new FilesImageChannel(client, options.fileCache ?? defaultFileIdCache());
}
export async function rewriteDeepSeekPayloadAsync(payload, options = {}) {
    const withImages = await rewritePayloadImagesAsync(payload, {
        files: options.files,
        limits: options.limits,
        signal: options.signal,
        resolveFiles: () => filesChannelFrom(options),
    });
    const withJson = rewriteJsonOutput(withImages);
    const next = isRecord(withJson) ? withoutStatefulFields(withJson) : withJson;
    assertRequestBodySize(next);
    return next;
}
function requireModelId(model) {
    const id = model.trim();
    if (!id)
        throw new Error("Missing DeepSeek model id");
    return id;
}
function rawChatCompletionsBody(input) {
    return {
        model: requireModelId(input.model),
        messages: input.messages,
        stream: input.stream ?? true,
        ...(input.extra ?? {}),
    };
}
function rawResponsesBody(input) {
    return {
        model: requireModelId(input.model),
        input: input.input,
        stream: input.stream ?? true,
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.extra ?? {}),
    };
}
export function buildChatCompletionsBody(input) {
    return rewriteDeepSeekPayload(rawChatCompletionsBody(input));
}
export async function buildChatCompletionsBodyAsync(input) {
    return rewriteDeepSeekPayloadAsync(rawChatCompletionsBody(input), input);
}
export function buildResponsesBody(input) {
    return rewriteDeepSeekPayload(rawResponsesBody(input));
}
export async function buildResponsesBodyAsync(input) {
    return rewriteDeepSeekPayloadAsync(rawResponsesBody(input), input);
}
const MISSING_KEY = "No DeepSeek API key configured — run /login deepseek-extended or set ext.deepseek.apiKey in settings";
function requireApiKey(apiKey) {
    const key = apiKey.trim();
    if (!key)
        throw new Error(MISSING_KEY);
    return key;
}
function requestEnvelope(input) {
    const apiKey = requireApiKey(input.apiKey);
    const baseUrl = resolveBaseUrl(input.baseUrl);
    return {
        url: input.endpoint === "responses" ? responsesUrl(baseUrl) : chatCompletionsUrl(baseUrl),
        headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
        },
        body: input.body,
    };
}
export function buildDeepSeekRequest(input) {
    const body = input.endpoint === "responses"
        ? buildResponsesBody({
            model: input.model,
            input: input.input ?? input.messages ?? [],
            instructions: input.instructions,
            stream: input.stream,
            extra: input.extra,
        })
        : buildChatCompletionsBody({
            model: input.model,
            messages: input.messages ?? input.input ?? [],
            stream: input.stream,
            extra: input.extra,
        });
    return requestEnvelope({ endpoint: input.endpoint, apiKey: input.apiKey, baseUrl: input.baseUrl, body });
}
export async function buildDeepSeekRequestAsync(input) {
    const filesOpts = {
        files: input.files,
        filesClient: input.filesClient,
        fileCache: input.fileCache,
        limits: input.limits,
        fetchImpl: input.fetchImpl,
        signal: input.signal,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
    };
    const body = input.endpoint === "responses"
        ? await buildResponsesBodyAsync({
            model: input.model,
            input: input.input ?? input.messages ?? [],
            instructions: input.instructions,
            stream: input.stream,
            extra: input.extra,
            ...filesOpts,
        })
        : await buildChatCompletionsBodyAsync({
            model: input.model,
            messages: input.messages ?? input.input ?? [],
            stream: input.stream,
            extra: input.extra,
            ...filesOpts,
        });
    return requestEnvelope({ endpoint: input.endpoint, apiKey: input.apiKey, baseUrl: input.baseUrl, body });
}
export class DeepSeekClient {
    baseUrl;
    apiKey;
    fetchImpl;
    filesClient;
    fileCache;
    constructor(options = {}) {
        const cfg = resolveDeepSeekConfig({ baseUrl: options.baseUrl, apiKey: options.apiKey });
        this.baseUrl = cfg.baseUrl;
        this.apiKey = cfg.apiKey;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.filesClient = options.filesClient;
        this.fileCache = options.fileCache ?? defaultFileIdCache();
    }
    request(input) {
        return buildDeepSeekRequest({
            ...input,
            apiKey: input.apiKey ?? this.apiKey ?? "",
            baseUrl: this.baseUrl,
        });
    }
    async requestAsync(input, signal) {
        return buildDeepSeekRequestAsync({
            ...input,
            apiKey: input.apiKey ?? this.apiKey ?? "",
            baseUrl: this.baseUrl,
            fetchImpl: this.fetchImpl,
            filesClient: this.filesClient,
            fileCache: this.fileCache,
            signal,
        });
    }
    async post(input, signal) {
        const req = await this.requestAsync(input, signal);
        return this.fetchImpl(req.url, {
            method: "POST",
            headers: req.headers,
            body: JSON.stringify(req.body),
            signal,
        });
    }
}
