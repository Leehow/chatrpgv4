/**
 * Grok / xAI Responses structured outputs — a request contract, never a tool.
 *
 * Official payload is Responses `text.format` with `type: "json_schema"`.
 * Apply only when model capability `structuredOutputs` is explicitly on.
 * Ordinary text requests (no option) leave the payload untouched.
 */
export const STRUCTURED_OUTPUT_SCHEMA_MAX_CHARS = 64 * 1024;
export const STRUCTURED_OUTPUT_NAME_MAX = 64;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function redactStructuredOutputDiagnostics(message) {
    return message
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
        .replace(/\b(at|rt)-[A-Za-z0-9._-]+/g, "[redacted]")
        .replace(/\bfile-[A-Za-z0-9]+/g, "[file_id]")
        .replace(/data:[^\s"';]+;base64,[A-Za-z0-9+/=]+/gi, "[base64]")
        .replace(/(?:[A-Za-z]:)?(?:\/|\\)(?:Users|home|private|var|tmp)[^\s"'`]+/gi, "[path]");
}
/** Tag consumed by PipiUI `emitBeforeProviderRequest` fail-closed propagation. */
export const PIPIUI_FATAL_HOOK_ERROR = "PipiUIFatalHookError";
export function isPipiUIFatalHookError(error) {
    if (!error || typeof error !== "object")
        return false;
    const value = error;
    return value.pipiuiFatalHook === true || value.name === PIPIUI_FATAL_HOOK_ERROR;
}
export function fatalStructuredOutputError(cause) {
    if (isPipiUIFatalHookError(cause) && cause instanceof Error)
        return cause;
    const raw = typeof cause === "string"
        ? cause
        : cause instanceof Error
            ? cause.message
            : "could not apply the Structured Output request; refusing to silently fall back to a plain send";
    const message = redactStructuredOutputDiagnostics(raw).trim()
        || "could not apply the Structured Output request; refusing to silently fall back to a plain send";
    const error = new Error(message);
    error.name = PIPIUI_FATAL_HOOK_ERROR;
    error.pipiuiFatalHook = true;
    return error;
}
/** `true` / object = declared; absent / false / non-object = off. Never infer. */
export function structuredOutputsEnabled(capabilities) {
    if (!isRecord(capabilities))
        return false;
    const flag = capabilities.structuredOutputs;
    if (flag === true)
        return true;
    if (!isRecord(flag))
        return false;
    return flag.jsonSchema !== false;
}
export function normalizeStructuredOutputRequest(request) {
    if (!isRecord(request)) {
        throw new Error("invalid structured output request");
    }
    const name = typeof request.name === "string" ? request.name.trim() : "";
    if (!name) {
        throw new Error("the structured output name must not be empty");
    }
    if (name.length > STRUCTURED_OUTPUT_NAME_MAX) {
        throw new Error("the structured output name is clearly over the length limit");
    }
    if (request.strict !== undefined && typeof request.strict !== "boolean") {
        throw new Error("structured output strict must be a boolean");
    }
    if (request.description !== undefined && typeof request.description !== "string") {
        throw new Error("the structured output description must be a string");
    }
    const description = typeof request.description === "string" ? request.description.trim() : "";
    return {
        name,
        schema: assertJsonSchemaObject(request.schema),
        strict: request.strict ?? true,
        ...(description ? { description } : {}),
    };
}
function assertJsonSchemaObject(schema) {
    if (!isRecord(schema)) {
        throw new Error("the structured output schema must be a JSON object");
    }
    let serialized;
    try {
        serialized = JSON.stringify(schema, (_key, value) => {
            if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
                throw new Error("the structured output schema is not serializable");
            }
            return value;
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("not serializable"))
            throw error;
        if (/circular|cyclic/i.test(message)) {
            throw new Error("the structured output schema contains a circular reference");
        }
        throw new Error("the structured output schema is not serializable");
    }
    if (typeof serialized !== "string") {
        throw new Error("the structured output schema is not serializable");
    }
    if (serialized.length > STRUCTURED_OUTPUT_SCHEMA_MAX_CHARS) {
        throw new Error("the structured output schema is clearly over the size limit");
    }
    return JSON.parse(serialized);
}
export function toResponsesTextFormat(request) {
    return {
        type: "json_schema",
        name: request.name,
        schema: request.schema,
        strict: request.strict ?? true,
        ...(request.description ? { description: request.description } : {}),
    };
}
/**
 * Compose `text.format` onto a Responses-shaped payload.
 * Never writes `tools`. Leaves `input` / `stream` / existing tools intact.
 * Missing option returns the same payload reference.
 */
export function applyStructuredOutput(payload, request, capabilities) {
    if (request == null)
        return payload;
    if (!structuredOutputsEnabled(capabilities)) {
        throw new Error("the model does not declare the structuredOutputs capability");
    }
    const normalized = normalizeStructuredOutputRequest(request);
    const prevText = isRecord(payload.text) ? payload.text : {};
    return {
        ...payload,
        text: {
            ...prevText,
            format: toResponsesTextFormat(normalized),
        },
    };
}
function stringOf(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function collectOutputItems(response) {
    const buckets = [];
    if (Array.isArray(response.output))
        buckets.push(...response.output);
    if (Array.isArray(response.choices))
        buckets.push(...response.choices);
    const items = [];
    for (const item of buckets) {
        if (!isRecord(item))
            continue;
        items.push(item);
        if (isRecord(item.message))
            items.push(item.message);
        if (isRecord(item.item))
            items.push(item.item);
    }
    return items;
}
function collectContent(response) {
    const content = [];
    if (Array.isArray(response.content)) {
        for (const part of response.content) {
            if (isRecord(part))
                content.push(part);
        }
    }
    for (const item of collectOutputItems(response)) {
        if (Array.isArray(item.content)) {
            for (const part of item.content) {
                if (isRecord(part))
                    content.push(part);
            }
        }
    }
    return content;
}
function refusalOf(response) {
    const direct = stringOf(response.refusal);
    if (direct)
        return redactStructuredOutputDiagnostics(direct);
    for (const item of collectOutputItems(response)) {
        const message = stringOf(item.refusal);
        if (message)
            return redactStructuredOutputDiagnostics(message);
    }
    for (const part of collectContent(response)) {
        const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
        if (type === "refusal") {
            const message = stringOf(part.refusal) ?? stringOf(part.text);
            if (message)
                return redactStructuredOutputDiagnostics(message);
        }
    }
    return undefined;
}
function rawTextOf(response) {
    if (typeof response.output_text === "string" && response.output_text.length) {
        return response.output_text;
    }
    const chunks = [];
    for (const part of collectContent(response)) {
        const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
        if (type === "refusal")
            continue;
        const text = stringOf(part.text) ?? stringOf(part.output_text);
        if (text)
            chunks.push(text);
    }
    if (!chunks.length) {
        for (const item of collectOutputItems(response)) {
            if (typeof item.content === "string" && item.content)
                chunks.push(item.content);
        }
    }
    return chunks.length ? chunks.join("") : undefined;
}
function parsedOf(response) {
    if (response.output_parsed !== undefined)
        return response.output_parsed;
    if (response.parsed !== undefined)
        return response.parsed;
    for (const item of collectOutputItems(response)) {
        if (item.parsed !== undefined)
            return item.parsed;
        if (item.output_parsed !== undefined)
            return item.output_parsed;
    }
    for (const part of collectContent(response)) {
        if (part.parsed !== undefined)
            return part.parsed;
    }
    return undefined;
}
function providerErrorOf(response) {
    const raw = response.error;
    if (typeof raw === "string" && raw.trim()) {
        return { message: redactStructuredOutputDiagnostics(raw) };
    }
    if (isRecord(raw)) {
        const message = stringOf(raw.message) ?? stringOf(raw.error) ?? "provider error";
        return {
            message: redactStructuredOutputDiagnostics(message),
            ...(typeof raw.code === "string" && raw.code ? { code: raw.code } : {}),
        };
    }
    if (response.status === "failed") {
        return { message: "structured output provider failure" };
    }
    return undefined;
}
function incompleteReason(response) {
    if (response.status === "incomplete") {
        const details = isRecord(response.incomplete_details) ? response.incomplete_details : undefined;
        return stringOf(details?.reason) ?? "incomplete";
    }
    for (const item of collectOutputItems(response)) {
        if (item.finish_reason === "length" || item.status === "incomplete") {
            return stringOf(item.finish_reason) ?? "incomplete";
        }
    }
    return undefined;
}
export function normalizeStructuredOutputResult(response, expectedName) {
    const name = typeof expectedName === "string" && expectedName.trim() ? expectedName.trim() : undefined;
    if (!isRecord(response)) {
        return { kind: "provider_error", ...(name ? { name } : {}), message: "invalid structured output response" };
    }
    const error = providerErrorOf(response);
    if (error) {
        return { kind: "provider_error", ...(name ? { name } : {}), ...error };
    }
    const refusal = refusalOf(response);
    if (refusal) {
        return { kind: "refusal", ...(name ? { name } : {}), message: refusal };
    }
    const incomplete = incompleteReason(response);
    const text = rawTextOf(response);
    const parsed = parsedOf(response);
    if (incomplete) {
        return {
            kind: "incomplete",
            ...(name ? { name } : {}),
            message: redactStructuredOutputDiagnostics(incomplete),
            ...(text !== undefined ? { text } : {}),
        };
    }
    if (parsed !== undefined) {
        return {
            kind: "valid_json",
            ...(name ? { name } : {}),
            value: parsed,
            text: text ?? JSON.stringify(parsed),
        };
    }
    if (text !== undefined) {
        try {
            return {
                kind: "valid_json",
                ...(name ? { name } : {}),
                value: JSON.parse(text),
                text,
            };
        }
        catch {
            return {
                kind: "invalid",
                ...(name ? { name } : {}),
                message: "the structured output is not valid JSON",
                text,
            };
        }
    }
    return {
        kind: "invalid",
        ...(name ? { name } : {}),
        message: "the structured output response is missing JSON",
    };
}
