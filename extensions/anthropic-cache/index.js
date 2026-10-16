import { enabledInHost, observeBrief, placeBreakpoints, prefixSnapshot, policyFor, mergeReportedUsage, usageObservation } from "./shared/policy.js";

/** Request policy, also reused by isolated authors. Inference, retry and billing stay with the provider. */
export default function anthropicCache(pi, env = process.env) {
  if (!enabledInHost(env)) return;
  let brief = { status: "absent" }, request, previous, ordinal = 0;
  const record = row => {
    try { pi.appendEntry("coc-telemetry", { lane: "anthropic-cache", at: new Date().toISOString(), ...row }); }
    catch { /* Diagnostics must not interrupt a model request. */ }
  };
  const reset = () => { brief = { status: "absent" }; request = undefined; };
  const finish = (stopReason, completed) => {
    if (!request) return;
    record({phase:'usage',request:request.request,provider:request.provider,model:request.model,
      stop_reason:stopReason ?? null,...usageObservation(request.usage)});
    if (completed && request.snapshot) previous=request.snapshot;
    request=undefined;
  };
  pi.on("session_start", () => {reset();previous=undefined;});
  pi.on("session_shutdown", () => {reset();previous=undefined;});
  pi.on("turn_start", reset);
  pi.on("context_with_system", event => { brief = observeBrief(event.messages); });
  pi.on("before_provider_request", (event, ctx) => {
    // A provider continuation can begin a new HTTP request before Pi ends its logical message.
    if (request) finish(request.rawStopReason, false);
    if (!policyFor(ctx.model)) return;
    const result = placeBreakpoints(event.payload, ctx.model, brief, previous);
    request = { request: ++ordinal, provider: ctx.model.provider, model: ctx.model.id, usage: {},
      snapshot:result.observation.status === 'applied' ? prefixSnapshot(result.payload,ctx.model) : undefined };
    record({ phase: "request", request: request.request, provider: request.provider, model: request.model, ...result.observation });
    if (result.payload !== event.payload) return result.payload;
  });
  pi.on("provider_stream_event", event => {
    if (!request || event.provider !== request.provider || event.model !== request.model || event.api !== "anthropic-messages") return;
    request.usage = mergeReportedUsage(request.usage, event.data);
    if (event.data?.type === 'message_delta' && event.data.delta?.stop_reason) request.rawStopReason=event.data.delta.stop_reason;
    if (event.data?.type === 'message_stop') finish(request.rawStopReason,Boolean(request.rawStopReason));
  });
  pi.on("message_end", event => {
    const message = event.message;
    if (!request || message?.role !== "assistant" || message.provider !== request.provider || message.model !== request.model) return;
    finish(message.stopReason,message.stopReason !== 'error' && message.stopReason !== 'aborted');
  });
}
