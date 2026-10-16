import {createHash} from 'node:crypto';

/** Explicit protocol policies. A compatible API alone never opts a provider in. */
const miniMax = Object.freeze({ api: "anthropic-messages", maxBreakpoints: 4 });
export const PROVIDER_POLICIES = Object.freeze({ "minimax-cn": miniMax, minimax: miniMax });
export const BRIEF_TYPE = "coc-context-brief";
const cacheable = new Set(["text", "image", "tool_use", "tool_result"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const owns = (value, key) => object(value) && Object.hasOwn(value, key);

/** Shared COC mounts must still obey the desktop host's extension lifecycle. */
export function enabledInHost(env) {
  const managed = env.PIPIUI_SPAWN_CONTRACT !== undefined || env.PIPIUI_HOST_PROTOCOL !== undefined;
  return !managed || env.PIPIUI_MOUNTED_EXTENSIONS?.split(',').map(id => id.trim()).includes('anthropic-cache') === true;
}

export function policyFor(model) {
  const policy = model && Object.hasOwn(PROVIDER_POLICIES, model.provider) ? PROVIDER_POLICIES[model.provider] : undefined;
  return policy && policy.api === model.api ? policy : undefined;
}

/** Typed host context only; never infer a brief from player text or parse its prose. */
export function observeBrief(messages) {
  const briefs = messages.filter(message => message.role === "custom" && message.customType === BRIEF_TYPE);
  if (briefs.length !== 1) return { status: briefs.length ? "ambiguous_context" : "absent" };
  const text = briefs[0].content;
  return typeof text === "string" && text.length ? { status: "available", text } : { status: "unsupported_content" };
}

/** Enumerate only protocol-level blocks; nested tool-result bodies are never changed. */
function blocks(payload) {
  const result = [];
  if (Array.isArray(payload.tools)) payload.tools.forEach((block, index) => {
    if (object(block)) result.push({ block, path: `tools/${index}`, kind: "tool" });
  });
  if (Array.isArray(payload.system)) payload.system.forEach((block, index) => {
    if (object(block)) result.push({ block, path: `system/${index}`, kind: "system" });
  });
  payload.messages.forEach((message, index) => {
    if (!Array.isArray(message?.content)) return;
    message.content.forEach((block, contentIndex) => {
      if (object(block)) result.push({ block, path: `messages/${index}/content/${contentIndex}`, kind: "message", role: message.role });
    });
  });
  return result;
}

/** Cache controls are the only edited values; request order and all content remain exact. */
export function placeBreakpoints(payload, model, brief = { status: "absent" }, previous) {
  const policy = policyFor(model);
  const skipped = reason => ({ payload, observation: { status: "skipped", reason } });
  if (!policy) return skipped("unsupported_provider");
  if (!object(payload) || payload.model !== model.id || !Array.isArray(payload.messages)) return skipped("request_mismatch");
  if (owns(payload, "cache_control")) return skipped("request_level_policy");
  if (!blocks(payload).some(({ block }) => owns(block, "cache_control"))) return skipped("cache_disabled");

  const next = structuredClone(payload);
  if (typeof next.system === "string" && next.system.length) next.system = [{ type: "text", text: next.system }];
  for (const message of next.messages) {
    if (typeof message.content === "string" && message.content.length) message.content = [{ type: "text", text: message.content }];
  }
  const entries = blocks(next);
  for (const { block } of entries) delete block.cache_control;
  const selected = [];
  const add = (entry, purpose) => {
    if (!entry || selected.some(point => point.path === entry.path)) return;
    entry.block.cache_control = { type: "ephemeral" };
    selected.push({ purpose, path: entry.path });
  };
  if (model.compat?.supportsCacheControlOnTools !== false) {
    add(entries.findLast(entry => entry.kind === "tool" && typeof entry.block.name === "string"), "tools");
  }
  add(entries.findLast(entry => entry.kind === "system" && entry.block.type === "text"), "system");
  const matches = brief.text ? entries.filter(entry => entry.kind === "message" && entry.role === "user"
    && entry.block.type === "text" && entry.block.text === brief.text) : [];
  const briefStatus = !brief.text ? brief.status : matches.length === 1 ? "marked" : matches.length ? "ambiguous_payload" : "not_serialized";
  if (matches.length === 1) add(matches[0], "brief");
  add(entries.findLast(entry => entry.kind === "message" && ["user", "assistant"].includes(entry.role)
    && cacheable.has(entry.block.type)), "conversation");
  const current = prefixSnapshot(next, model);
  let reuse;
  if (previous) {
    const age = current.at - previous.at;
    const eligible = previous.model === current.model && age >= 0 && age < 300000;
    let matching = 0;
    if (eligible) while (matching < current.prefixes.length && matching < previous.prefixes.length
      && current.prefixes[matching].digest === previous.prefixes[matching].digest) matching++;
    reuse = {matching_blocks:matching, first_changed:eligible ? current.settings !== previous.settings ? 'request_settings' : current.prefixes[matching]?.path ?? null : null,
      status:eligible ? 'compared' : previous.model !== current.model ? 'model_changed' : 'expired'};
    const candidate = eligible ? entries.findLast((entry, index) => index < matching
      && previous.prefixes[index].marked && entry.kind === 'message' && cacheable.has(entry.block.type)
      && entries.length - index - 1 >= 20 && !selected.some(point => point.path === entry.path)) : undefined;
    if (candidate) {
      // A system prefix already includes the tools; spend that redundant slot on old history.
      const redundant = selected.findIndex(point => point.purpose === 'tools');
      if (selected.length === policy.maxBreakpoints && redundant >= 0 && selected.some(point => point.purpose === 'system')) {
        const [removed] = selected.splice(redundant, 1);
        delete entries.find(entry => entry.path === removed.path).block.cache_control;
      }
      if (selected.length < policy.maxBreakpoints) add(candidate, 'previous-prefix');
    }
  }
  // Four distinct purposes, deduplicated when the brief is also the request tail.
  if (selected.length > policy.maxBreakpoints) return skipped("breakpoint_capacity");
  return { payload: next, observation: { status: "applied", ttl_seconds: 300, brief: briefStatus, breakpoints: selected,
    ...(reuse ? {prefix_reuse:reuse} : {}) } };
}

/** Hash only, never retain request content. Cache annotations do not change prefix identity. */
export function prefixSnapshot(payload, model, at = Date.now()) {
  const hash = createHash('sha256').update(JSON.stringify([model.provider, model.id, payload.tool_choice,
    payload.thinking, payload.output_config]));
  const settings=hash.copy().digest('hex');
  const prefixes = blocks(payload).map(({block,path,kind,role}) => {
    const {cache_control, ...content} = block;
    hash.update('\n').update(JSON.stringify([kind, role, content]));
    return {path, digest:hash.copy().digest('hex'), marked:owns(block,'cache_control')};
  });
  return {model:`${model.provider}/${model.id}`,at,settings,prefixes};
}

/** Session-journal reader for host diagnostics; unknown counters stay unknown. */
export function cacheStatistics(entries, providers = Object.keys(PROVIDER_POLICIES)) {
  const rows = entries.filter(entry => entry.type === 'custom' && entry.customType === 'coc-telemetry'
    && entry.data?.lane === 'anthropic-cache' && entry.data.phase === 'usage' && providers.includes(entry.data.provider))
    .map(entry => entry.data);
  const sum = field => {
    const reported = rows.filter(row => Number.isSafeInteger(row[field]) && row[field] >= 0);
    return {tokens:reported.length ? reported.reduce((total,row) => total + row[field],0) : null,
      reported_requests:reported.length, unreported_requests:rows.length - reported.length};
  };
  const input=sum('input'),read=sum('read'),write=sum('write');
  const complete=rows.length > 0 && [input,read,write].every(counter => counter.unreported_requests === 0);
  const total=complete ? input.tokens + read.tokens + write.tokens : null;
  return {requests:rows.length,input,read,write,cache_read_ratio:total ? read.tokens / total : null,
    reported_read_share:rows.length && input.unreported_requests===0 && read.unreported_requests===0 && input.tokens+read.tokens>0
      ? read.tokens/(input.tokens+read.tokens) : null,
    recent:rows.slice(-8).map(row => ({request:row.request,provider:row.provider,model:row.model,
      input:row.input ?? null,read:row.read ?? null,write:row.write ?? null,stop_reason:row.stop_reason}))};
}

/** Read only the documented numeric usage fields, including partial streaming updates. */
export function mergeReportedUsage(previous, event) {
  const usage = event?.type === "message_start" ? event.message?.usage : event?.type === "message_delta" ? event.usage : undefined;
  const result = { ...previous };
  for (const [source, target] of [["input_tokens", "input"], ["cache_read_input_tokens", "read"],
    ["cache_creation_input_tokens", "write"], ["output_tokens", "output"]]) {
    if (Number.isSafeInteger(usage?.[source]) && usage[source] >= 0) result[target] = usage[source];
  }
  return result;
}

export function usageObservation(usage) {
  const complete = ["read", "write", "input"].every(key => Number.isSafeInteger(usage[key]));
  const total = complete ? usage.read + usage.write + usage.input : undefined;
  return { usage_status: complete ? "reported" : Object.keys(usage).length ? "partial" : "unreported",
    ...usage, ...(Number.isSafeInteger(total) ? { total_input: total, cache_read_ratio: total ? usage.read / total : null } : {}) };
}
