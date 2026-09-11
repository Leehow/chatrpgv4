import { createHash } from "node:crypto";
import { redactMessage } from "../oauth/redact.js";
import { classifyFilesStatus, FilesError } from "./errors.js";
import { assertInputFileBounds, DEFAULT_DELETE_TIMEOUT_MS, DEFAULT_FILES_BASE_URL, DEFAULT_UPLOAD_TIMEOUT_MS, INPUT_FILE_PURPOSE, MAX_INPUT_FILE_BYTES, safeFileName, } from "./types.js";
export { DEFAULT_FILES_BASE_URL, DEFAULT_UPLOAD_TIMEOUT_MS, MAX_INPUT_FILE_BYTES };
export function normalizeFilesBaseUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        throw new FilesError("invalid_params", "the xAI Files API base URL must not be empty");
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new FilesError("invalid_params", "invalid xAI Files API base URL");
    }
    if (url.protocol !== "https:") {
        throw new FilesError("invalid_params", "Grok file uploads allow HTTPS only");
    }
    return trimmed.replace(/\/+$/, "");
}
export function digestOf(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
function redact(message, bearer) {
    const tokens = bearer ? [bearer] : [];
    return redactMessage(message, tokens)
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\/(?:Users|home|private|var|tmp)\/[^\s"'`]+/gi, "[path]");
}
function throwIfAborted(signal) {
    if (signal?.aborted) {
        const err = new FilesError("aborted", "file upload cancelled");
        throw err;
    }
}
function raceWithAbort(promise, signal) {
    if (signal.aborted)
        return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
        }, (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
        });
    });
}
export class FilesClient {
    baseUrl;
    fetchImpl;
    timeoutMs;
    deleteTimeoutMs;
    constructor(options = {}) {
        this.baseUrl = normalizeFilesBaseUrl(options.baseUrl?.trim() || DEFAULT_FILES_BASE_URL);
        this.fetchImpl = (options.fetchImpl ?? fetch);
        this.timeoutMs = options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
        this.deleteTimeoutMs = options.deleteTimeoutMs ?? DEFAULT_DELETE_TIMEOUT_MS;
    }
    async upload(input) {
        const name = safeFileName(input.name);
        const mimeType = (input.mimeType ?? "application/octet-stream").trim() || "application/octet-stream";
        assertInputFileBounds({ name, size: input.bytes.byteLength, mimeType });
        if (!input.bearer?.trim()) {
            throw new FilesError("auth_expired", "not logged in — log in to Grok Build first");
        }
        throwIfAborted(input.signal);
        const form = new FormData();
        const payload = new Uint8Array(input.bytes.byteLength);
        payload.set(input.bytes);
        form.append("file", new Blob([payload], { type: mimeType }), name);
        form.append("purpose", INPUT_FILE_PURPOSE);
        const json = await this.requestJson({
            method: "POST",
            path: "/files",
            body: form,
            bearer: input.bearer,
            signal: input.signal,
            timeoutMs: this.timeoutMs,
            action: "upload",
        });
        const fileId = typeof json.id === "string" ? json.id.trim() : "";
        if (!fileId)
            throw new FilesError("invalid_response", "the file upload response is missing a file id");
        if (json.bytes !== undefined && (typeof json.bytes !== "number" || !Number.isFinite(json.bytes))) {
            throw new FilesError("invalid_response", "the file upload response metadata is invalid");
        }
        if (json.filename !== undefined && typeof json.filename !== "string") {
            throw new FilesError("invalid_response", "the file upload response metadata is invalid");
        }
        return {
            fileId,
            name,
            size: input.bytes.byteLength,
            mimeType,
            digest: digestOf(input.bytes),
        };
    }
    async remove(input) {
        const fileId = input.fileId.trim();
        if (!fileId)
            throw new FilesError("invalid_params", "missing file id");
        if (!input.bearer?.trim())
            throw new FilesError("auth_expired", "not logged in — log in to Grok Build first");
        throwIfAborted(input.signal);
        await this.requestJson({
            method: "DELETE",
            path: `/files/${encodeURIComponent(fileId)}`,
            bearer: input.bearer,
            signal: input.signal,
            timeoutMs: this.deleteTimeoutMs,
            action: "delete",
        });
    }
    async requestJson(input) {
        const url = `${this.baseUrl}${input.path}`;
        const signals = [AbortSignal.timeout(input.timeoutMs)];
        if (input.signal)
            signals.push(input.signal);
        const signal = AbortSignal.any(signals);
        let res;
        try {
            res = await raceWithAbort(Promise.resolve(this.fetchImpl(url, {
                method: input.method,
                headers: { authorization: `Bearer ${input.bearer}` },
                ...(input.body ? { body: input.body } : {}),
                signal,
            })), signal);
        }
        catch (err) {
            if (input.signal?.aborted)
                throw new FilesError("aborted", `file ${input.action} cancelled`);
            if (signal.aborted)
                throw new FilesError("upstream_error", `file ${input.action} timed out`);
            const msg = err instanceof Error ? err.message : String(err);
            throw new FilesError("upstream_error", redact(`file ${input.action} failed: ${msg}`, input.bearer));
        }
        if (input.signal?.aborted)
            throw new FilesError("aborted", `file ${input.action} cancelled`);
        const raw = await res.text().catch(() => "");
        if (!res.ok) {
            const { code } = classifyFilesStatus(res.status);
            throw new FilesError(code, redact(`file ${input.action} failed HTTP ${res.status}: ${[...raw].slice(0, 160).join("")}`, input.bearer), res.status);
        }
        if (!raw.trim())
            return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : {};
        }
        catch {
            throw new FilesError("invalid_response", redact(`could not parse the file ${input.action} response`, input.bearer));
        }
    }
}
