/** Provider-hosted search and exact protocol replay. No external search client or reference library. */
import {createHash} from 'node:crypto';
import {getApiProvider} from '@earendil-works/pi-ai/compat';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
const KEY = Symbol.for('pipicoc.native-search.v1');
const object = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const clone = x => JSON.parse(JSON.stringify(x));
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const LOCAL_SEARCH = new Set(['web_search', 'browser_search', 'browser_fetch']);
export const NATIVE_SEARCH_ENTRY = 'coc-native-search';
export function nativeSearchState() {
  return globalThis[KEY] ??= {policy: undefined, records: [], pending: undefined, carry: [], routes: new Set(), closedRuns: new Set(), persist: undefined, report: undefined};
}
export function setNativeSearchPolicy(policy) {
  const state=nativeSearchState();
  if (state.policy?.run !== policy?.run) {state.routes.clear();state.closedRuns.clear();state.carry=[];}
  state.policy=policy;
}
export function clearNativeSearchState() {
  const state = nativeSearchState();
  state.policy = undefined; state.records = []; state.pending = undefined; state.carry = []; state.routes.clear();state.closedRuns.clear();
}
export function nativeSearchCapability(model) {
  const api = model?.api, provider = model?.provider;
  const origins={'deepseek-extended':['https://api.deepseek.com'],'openai':['https://api.openai.com'],'openai-codex':['https://chatgpt.com','https://api.openai.com'],'google':['https://generativelanguage.googleapis.com'],'anthropic':['https://api.anthropic.com'],'grok-build':['https://api.x.ai']};
  if (model?.baseUrl) {try {if (!origins[provider]?.includes(new URL(model.baseUrl).origin)) return;} catch {return;}}
  if (provider === 'deepseek-extended' && api === 'openai-responses' && model.capabilities?.nativeSearch?.tools?.includes('web_search')) return {api: 'anthropic-messages', tools: ['web_search'], route: 'deepseek-messages'};
  if (api === 'openai-codex-responses' && provider === 'openai-codex') return {api, tools: ['web_search']};
  if (api === 'openai-responses' && provider === 'openai') return {api, tools: ['web_search']};
  if (api === 'google-generative-ai' && provider === 'google' && (model.capabilities?.nativeSearch?.tools?.includes('web_search') || /^gemini-3(?:[.-])/.test(model.id))) return {api, tools: ['web_search']};
  if (api === 'anthropic-messages' && provider === 'anthropic') return {api, tools: ['web_search']};
  if (api === 'openai-responses' && provider === 'grok-build') {
    const tools = model.capabilities?.nativeSearch?.tools ?? model.capabilities?.hostedTools?.tools ?? [];
    return tools.includes('web_search') ? {api, tools: ['web_search']} : undefined;
  }
}
export function nativeSearchContextBound(model, context) {
  const policy = nativeSearchState().policy;
  if (context) {
    const note = context.messages?.findLast(message => {
      const parts = typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter(p => p.type === 'text').map(p => p.text);
      return parts.some(text => {try {const row=JSON.parse(text); return row.native_search_scope?.run === policy?.run && row.native_search_scope?.step === policy?.step;} catch {return false;}});
    });
    if (!note) return false;
  }
  return !!(policy?.campaign && policy.run && policy.step
    && (!policy.model || policy.model === `${model.provider}/${model.id}`) && nativeSearchCapability(model));
}
export function nativeSearchAllowed(model, context) {
  const policy = nativeSearchState().policy;
  return !!(policy?.enabled && policy.allowed && !nativeSearchState().closedRuns.has(routeKey(model)) && nativeSearchContextBound(model, context));
}
function routeKey(model) {const p=nativeSearchState().policy;return JSON.stringify([p?.campaign,p?.worldline,p?.loop,p?.run,model.provider,model.id]);}
function searchTool(tool) {
  return tool?.type === 'web_search' || typeof tool?.type === 'string' && tool.type.startsWith('web_search_')
    || tool?.googleSearch !== undefined || tool?.google_search !== undefined;
}
function withoutLocalSearch(tools) {
  return (tools ?? []).filter(tool => !(tool?.type === 'function' && LOCAL_SEARCH.has(tool.name ?? tool.function?.name)))
    .map(tool => Array.isArray(tool.functionDeclarations)
      ? {...tool, functionDeclarations: tool.functionDeclarations.filter(row => !LOCAL_SEARCH.has(row.name))} : tool)
    .filter(tool => !Array.isArray(tool.functionDeclarations) || tool.functionDeclarations.length);
}
function canonicalArguments(value) {if (typeof value !== 'string') return value;try {return JSON.parse(value);} catch {return value;}}
function fingerprint(content, api) {
  const rows=content??[];
  if (api === 'anthropic-messages') {
    const calls=rows.filter(b=>b.type==='tool_use');
    return digest(calls.length ? calls.map(b=>['tool',b.id,b.name,b.input]) : rows.filter(b=>b.type==='text').map(b=>['text',b.text]));
  }
  const calls=rows.filter(b=>b.type==='function_call'||b.type==='custom_tool_call');
  return digest(calls.length ? calls.map(b=>['tool',b.call_id,b.name,canonicalArguments(b.arguments??b.input)])
    : rows.filter(b=>b.type==='message').map(b=>['text',(b.content??[]).filter(p=>p.type==='output_text').map(p=>p.text).join('')]));
}
function protocolBlocks(record, current) {
  if (record.api === 'anthropic-messages') {
    const original=record.content.filter(b=>['thinking','redacted_thinking','server_tool_use','web_search_tool_result'].includes(b.type));
    return [...clone(original),...current.filter(b=>!['thinking','redacted_thinking'].includes(b.type))];
  }
  const prefix=record.content.filter(b=>['reasoning','web_search_call','x_search_call'].includes(b.type));
  const rest=current.filter(b=>b.type!=='reasoning').map(item=>{
    if(item.type!=='message')return item;
    return {...item,content:(item.content??[]).map(part=>{
      if(part.type!=='output_text')return part;
      const original=record.content.filter(b=>b.type==='message').flatMap(b=>b.content??[]).find(p=>p.type==='output_text'&&p.text===part.text);
      return original?.annotations ? {...part,annotations:clone(original.annotations)} : part;
    })};
  });
  return [...clone(prefix),...rest];
}
function restore(payload, api, model, binding) {
  const records = nativeSearchState().records.filter(r => r.api === api && r.model === `${model.provider}/${model.id}` && r.campaign === binding?.campaign && r.worldline === binding?.worldline && r.loop === binding?.loop);
  if (!records.length) return payload;
  if (api === 'anthropic-messages') return {...payload, messages: (payload.messages ?? []).map(message => {
    if (message.role !== 'assistant') return message;
    const content = typeof message.content === 'string' ? [{type: 'text', text: message.content}] : message.content;
    const key = fingerprint(content, api), record = records.findLast(r => r.fingerprint === key);
    if (record) nativeSearchState().report?.({event:'restored',api,model:record.model,run:binding?.run,response_id:record.responseId,server_blocks:record.content.filter(b=>b.type==='server_tool_use'||b.type==='web_search_tool_result').length});
    return record ? {...message, content: protocolBlocks(record, content)} : message;
  })};
  if (!Array.isArray(payload.input)) return payload;
  const input = []; let index = 0;
  while (index < payload.input.length) {
    const item = payload.input[index];
    if (item.role !== 'assistant' && !['reasoning','function_call','custom_tool_call'].includes(item.type)) {input.push(item); index++; continue;}
    const chunk = []; while (index < payload.input.length) {
      const row = payload.input[index];
      if (row.role !== 'assistant' && !['reasoning','function_call','custom_tool_call'].includes(row.type)) break;
      chunk.push(row); index++;
    }
    const record = records.findLast(r => r.fingerprint === fingerprint(chunk, api));
    if (record) nativeSearchState().report?.({event:'restored',api,model:record.model,run:binding?.run,response_id:record.responseId,server_blocks:record.content.filter(b=>b.type==='web_search_call'||b.type==='x_search_call').length});
    input.push(...(record ? protocolBlocks(record, chunk) : chunk));
  }
  return {...payload, input};
}
/** Applies after Pi has built its API-specific request. Tool-choice restrictions remain authoritative. */
export function nativeSearchPayload(payload, model) {
  if (!payload || typeof payload !== 'object') return;
  const state = nativeSearchState(), policy = state.policy, capability = nativeSearchCapability(model);
  if (!capability || !policy?.campaign) return;
  const api = Array.isArray(payload.messages) && capability?.route ? 'anthropic-messages' : model.api;
  let body = restore(payload, api, model, policy);
  const allowed = nativeSearchAllowed(model) && (!capability.route || api === capability.api) && body.tool_choice !== 'none'
    && body.tool_choice?.type !== 'none' && body.config?.toolConfig?.functionCallingConfig?.mode !== 'NONE';
  const google = api === 'google-generative-ai';
  const declared = google ? body.config?.tools : body.tools;
  const tools = withoutLocalSearch(declared).filter(tool => !searchTool(tool));
  if (allowed) {
    tools.push(google ? {googleSearch: {}} : api === 'anthropic-messages'
      ? {type: 'web_search_20250305', name: 'web_search', max_uses: 2} : {type: 'web_search'});
  }
  if (google) body = {...body, config: {...body.config, tools}};
  else body = {...body, tools};
  state.pending = {api, model: `${model.provider}/${model.id}`, campaign: policy?.campaign, worldline: policy?.worldline, loop: policy?.loop, run: policy?.run, step: policy?.step,
    enabled: allowed, blocks: [], items: new Map(), inputJson: new Map(), startedAt: Date.now()};
  state.report?.({event: 'request', api, model: state.pending.model, enabled: allowed, run: policy?.run, step: policy?.step});
  return body;
}
function sourcesOf(blocks, api) {
  if (api === 'anthropic-messages') return blocks.filter(b => b.type === 'web_search_tool_result').flatMap(b => Array.isArray(b.content) ? b.content : [])
    .filter(b => b.type === 'web_search_result').map(({url, title}) => ({url, title}));
  return blocks.flatMap(b => b.type === 'message' ? (b.content ?? []).flatMap(p => p.annotations ?? []) : b.action?.sources ?? [])
    .filter(row => typeof row.url === 'string').map(({url, title}) => ({url, title}));
}
function retain(pending, content, terminal, responseId) {
  const state = nativeSearchState();
  const native = content.some(b => ['server_tool_use','web_search_tool_result','web_search_call','x_search_call'].includes(b.type));
  const combined = [...state.carry, ...content];
  if (!native && !state.carry.length || !pending.campaign) return;
  if (Buffer.byteLength(JSON.stringify(combined)) > 1_048_576) {
    state.report?.({event:'unavailable',reason:'protocol_retention_bound',run:pending.run,step:pending.step});
    state.closedRuns.add(JSON.stringify([pending.campaign,pending.worldline,pending.loop,pending.run,...pending.model.split("/")]));state.carry=[];return;
  }
  const record = {api: pending.api, model: pending.model, campaign: pending.campaign, worldline: pending.worldline, loop: pending.loop, run: pending.run,
    responseId, fingerprint: fingerprint(content, pending.api), content: clone(combined), terminal};
  state.records.push(record); if (state.records.length > 64) state.records.shift();
  state.persist?.(record);
  state.report?.({event: 'response', api: pending.api, model: pending.model, run: pending.run, step: pending.step,
    terminal, response_id: responseId, protocol: record, sources: sourcesOf(content, pending.api), elapsed_ms: Date.now() - pending.startedAt,
    calls: content.filter(b => b.type === 'server_tool_use' && b.name === 'web_search' || b.type === 'web_search_call').length});
  state.carry = terminal === 'pause_turn' ? combined : [];
}
/** Original server blocks are observed before Pi's normalized-message conversion discards them. */
export function nativeSearchEvent(event) {
  const state = nativeSearchState(), p = state.pending;
  if (!p || event.provider && p.model !== `${event.provider}/${event.model}`) return;
  if (p.campaign !== state.policy?.campaign || p.run !== state.policy?.run || p.step !== state.policy?.step
    || p.worldline !== state.policy?.worldline || p.loop !== state.policy?.loop || p.finished) return;
  const raw = object(event.data ?? event);
  if (p.api === 'anthropic-messages') {
    if (raw.type === 'message_start') p.responseId = raw.message?.id;
    if (raw.type === 'content_block_start') p.blocks[raw.index] = clone(raw.content_block);
    if (raw.type === 'content_block_delta') {
      const block = p.blocks[raw.index], delta = raw.delta;
      if (!block || !delta) return;
      if (delta.type === 'text_delta') block.text = (block.text ?? '') + delta.text;
      if (delta.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + delta.thinking;
      if (delta.type === 'signature_delta') block.signature = (block.signature ?? '') + delta.signature;
      if (delta.type === 'input_json_delta') p.inputJson.set(raw.index, (p.inputJson.get(raw.index) ?? '') + delta.partial_json);
      if (delta.type === 'citations_delta') (block.citations ??= []).push(delta.citation);
    }
    if (raw.type === 'content_block_stop' && p.inputJson.has(raw.index)) {
      try {p.blocks[raw.index].input = JSON.parse(p.inputJson.get(raw.index));}
      catch {state.report?.({event:'unavailable',reason:'native_arguments_incomplete',run:p.run,step:p.step});}
    }
    if (raw.type === 'message_delta') p.terminal = raw.delta?.stop_reason;
    if (raw.type === 'message_stop') {retain(p, p.blocks.filter(Boolean), p.terminal, p.responseId);p.finished=true;}
  } else if (p.api === 'google-generative-ai') {
    const grounding = raw.candidates?.[0]?.groundingMetadata;
    if (grounding) state.persist?.({api: p.api, model: p.model, campaign: p.campaign, run: p.run, grounding: clone(grounding)});
  } else {
    if (raw.type === 'response.output_item.done') p.items.set(raw.output_index, clone(raw.item));
    if (['response.completed','response.done','response.incomplete'].includes(raw.type)) {
      const content = raw.response?.output ?? [...p.items.entries()].sort((a,b) => a[0]-b[0]).map(row => row[1]);
      retain(p, content, raw.response?.status, raw.response?.id);p.finished=true;
    }
  }
}
/** A contributed provider may keep its ordinary transport while routing granted native-search requests. */
export function nativeSearchStream(fallback, route) {
  return (model, context, options) => {
    const state = nativeSearchState(), key = routeKey(model);
    if (!nativeSearchContextBound(model, context) || !nativeSearchAllowed(model, context) && !state.routes.has(key)) return fallback(model, context, options);
    state.routes.add(key);
    const capability = nativeSearchCapability(model);
    if (!capability?.route && !route.resume) return fallback(model, context, options);
    const physical = {...model, api: route.api, baseUrl: route.baseUrl ?? model.baseUrl, compat: {...model.compat, allowEmptySignature: true}};
    const provider = route.streamSimple ? {streamSimple:route.streamSimple} : getApiProvider(route.api);
    if (!provider) throw new Error('Native search transport is unavailable');
    const stream = new AssistantMessageEventStream();
    void (async () => {
      let messages = context.messages, continuations = 0, started = false;
      const usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
      const accumulate = current => {for(const key of Object.keys(usage)){if(key==='cost'){for(const field of Object.keys(usage.cost))usage.cost[field]+=current?.cost?.[field]??0;}else usage[key]+=current?.[key]??0;}};
      try {
        while (true) {
          const inner = provider.streamSimple(physical, {...context, messages}, {...options, onPayload: async (payload, physicalModel) => {
            const prepared = route.preparePayload ? route.preparePayload(payload, options) : payload;
            return options?.onPayload ? await options.onPayload(prepared, physicalModel) : prepared;
          }});
          let terminal;
          for await (const event of inner) {
            if (event.type === 'start') {if (started) continue;started=true;}
            if (event.type === 'done') {
              accumulate(event.message.usage);
              if (event.message?.rawStopReason === 'pause_turn') {terminal = event.message; continue;}
              stream.push({...event,message:{...event.message,usage:clone(usage)}});continue;
            }
            stream.push(event);
          }
          if (!terminal) {stream.end(); return;}
          if (++continuations > 3 || options?.signal?.aborted) throw new Error('Native search continuation could not finish');
          messages = [...messages, terminal];
        }
      } catch (error) {
        stream.push({type: 'error', reason: options?.signal?.aborted ? 'aborted' : 'error', error: {
          role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
          stopReason: options?.signal?.aborted ? 'aborted' : 'error', errorMessage: error.message, timestamp: Date.now()}});
        stream.end();
      }
    })();
    return stream;
  };
}
