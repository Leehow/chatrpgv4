import { applyMaterializedInputFiles } from "./files/input.js";
import { SessionInputFileStore } from "./files/state.js";
import { modelHasInputFiles } from "./files/types.js";
import { tryResolveAgentHome } from "./oauth/home.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sessionIdOf(ctx) {
    return ctx.sessionManager?.getSessionId?.()?.trim() ?? "";
}
function is2xx(status) {
    return typeof status === "number" && status >= 200 && status < 300;
}
function isCompletionsPayload(payload) {
    return Array.isArray(payload.messages) && !Array.isArray(payload.input);
}
function unsentOf(files) {
    return files.filter((file) => file.sent !== true);
}
function isReadyWithFileId(file) {
    return file.status === "ready" && typeof file.fileId === "string" && Boolean(file.fileId.trim());
}
function pendingStatusLabel(files) {
    const statuses = [...new Set(files.map((file) => file.status))];
    return statuses.join("/");
}
export function createInputFilesHooks(options = {}) {
    const resolveHome = options.resolveHome ?? tryResolveAgentHome;
    const createStore = options.createStore ?? ((home) => new SessionInputFileStore(home));
    let pending;
    const clearPending = () => {
        pending = undefined;
    };
    const storeFor = (home) => createStore(home);
    return {
        clearPending,
        async beforeProviderRequest(event, ctx) {
            if (!isRecord(event.payload))
                return;
            const home = resolveHome();
            const sessionId = sessionIdOf(ctx);
            if (!home || !sessionId)
                return;
            const attachments = await storeFor(home).list(sessionId);
            const unsent = unsentOf(attachments);
            if (unsent.length === 0) {
                clearPending();
                return;
            }
            if (!modelHasInputFiles(ctx.model)) {
                clearPending();
                throw new Error("the model does not declare the inputFiles capability; refusing to silently drop unsent attachments");
            }
            const blocked = unsent.filter((file) => !isReadyWithFileId(file));
            if (blocked.length > 0) {
                clearPending();
                throw new Error(`attachments are not ready yet (${pendingStatusLabel(blocked)}); refusing to send without attachments`);
            }
            if (isCompletionsPayload(event.payload)) {
                clearPending();
                throw new Error("Chat with Files supports only Responses /responses; refusing to write chat/completions");
            }
            const next = applyMaterializedInputFiles(event.payload, unsent);
            pending = {
                sessionId,
                ...(typeof ctx.model?.id === "string" && ctx.model.id.trim() ? { modelId: ctx.model.id.trim() } : {}),
                attachmentIds: unsent.map((file) => file.id),
            };
            return next;
        },
        async afterProviderResponse(event, ctx) {
            const current = pending;
            if (!current)
                return;
            if (sessionIdOf(ctx) !== current.sessionId)
                return;
            if (current.modelId && ctx.model?.id && current.modelId !== ctx.model.id)
                return;
            if (!is2xx(event.status)) {
                clearPending();
                return;
            }
            const home = resolveHome();
            if (!home) {
                clearPending();
                return;
            }
            const store = storeFor(home);
            const attachments = await store.list(current.sessionId);
            const injected = new Set(current.attachmentIds);
            await store.write(current.sessionId, attachments.map((file) => (injected.has(file.id) ? { ...file, sent: true } : file)));
            clearPending();
        },
    };
}
export function registerInputFilesHooks(pi, options) {
    const hooks = createInputFilesHooks(options);
    pi.on("before_provider_request", (event, ctx) => hooks.beforeProviderRequest(event, ctx));
    pi.on("after_provider_response", (event, ctx) => hooks.afterProviderResponse(event, ctx));
    pi.on("session_start", () => {
        hooks.clearPending();
    });
    pi.on("session_shutdown", () => {
        hooks.clearPending();
    });
    return hooks;
}
