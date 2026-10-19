/** Private foreground retrieval shared by provider-specific search backends. */
import {createHash} from 'node:crypto';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import {nativeSearchAllowed,nativeSearchCapability,nativeSearchContextBound,nativeSearchState} from './native-search.js';
const LIMIT = 1_048_576;
const clone = value => structuredClone(value);
const identity = model => `${model.provider}/${model.id}`;
const runKey = (model, p) => JSON.stringify([p?.campaign,p?.worldline,p?.loop,p?.run,model.provider,model.id]);
const sameScope = (a,b) => ['campaign','worldline','loop','run','step','model'].every(key => a?.[key] === b?.[key]);
const anchor = message => {
  const calls = message.content.filter(block => block.type === 'toolCall');
  if (!calls.length && !message.content.some(block => block.type === 'text' && block.text.trim())) return;
  return createHash('sha256').update(JSON.stringify(calls.length
    ? calls.map(({id,name,arguments:args}) => [id,name,args])
    : message.content.filter(block => block.type === 'text').map(block => [block.textSignature ?? message.timestamp,block.text]))).digest('hex');
};

function declarations(api,tools) {
  if (api === 'anthropic-messages') return tools.map(({name,description,parameters}) => ({name,description,input_schema:parameters}));
  return api === 'openai-completions' ? tools.map(({type,...definition}) => ({type:'function',function:definition})) : tools;
}
/** Retrieval calls never enter the ordinary game-tool dispatcher. */
export function privateSearchStream(fallback,{transport,tools,retrieve}) {
  const TRANSPORT = transport, names = new Set(tools.map(tool => tool.name));
  const internal = block => block.type === 'toolCall' && names.has(block.name);
  function replay(messages, model, binding) {
    const records = nativeSearchState().records.filter(row => row.transport === TRANSPORT && row.model === identity(model)
      && row.campaign === binding.campaign && row.worldline === binding.worldline && row.loop === binding.loop && completeExchange(row.content));
    return messages.flatMap(message => {
      if (message.role !== 'assistant') return [message];
      const key = anchor(message);
      const record = key && records.findLast(row => row.anchor === key);
      if (!record) return [message];
      const thinking = record.content.filter(row => row.role === 'assistant').flatMap(row => row.content)
        .filter(block => block.type === 'thinking');
      const remaining = [...thinking];
      const content = message.content.filter(block => {
        if (block.type !== 'thinking') return true;
        const index = remaining.findIndex(saved => saved.thinking === block.thinking
          && saved.thinkingSignature === block.thinkingSignature && saved.redacted === block.redacted);
        if (index < 0) return true;
        remaining.splice(index,1); return false;
      });
      return [...clone(record.content), {...message,content}];
    });
  }
  function completeExchange(messages) {
    if (!Array.isArray(messages) || !messages.length || Buffer.byteLength(JSON.stringify(messages)) > LIMIT) return false;
    const pending = new Map(), seen = new Set(); let pairs = 0;
    for (const message of messages) {
      if (!Array.isArray(message.content)) return false;
      if (message.role === 'assistant') {
        if (pending.size) return false;
        for (const block of message.content) {
          if (block.type === 'thinking') continue;
          if (!internal(block) || !block.id || seen.has(block.id)) return false;
          seen.add(block.id);
          pending.set(block.id,block.name);
        }
      } else if (message.role === 'toolResult') {
        if (pending.get(message.toolCallId) !== message.toolName) return false;
        pending.delete(message.toolCallId); pairs++;
      } else return false;
    }
    return pairs > 0 && pending.size === 0;
  }
  function emptyMessage(model) {
    return {role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[],timestamp:Date.now(),stopReason:'stop',
      usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  }
  function addUsage(total, current) {
    for (const key of Object.keys(total)) {
      if (key === 'cost') { for (const field of Object.keys(total.cost)) total.cost[field] += current?.cost?.[field] ?? 0; }
      else total[key] += current?.[key] ?? 0;
    }
  }

  return (model, context, options = {}) => {
    if (nativeSearchCapability(model)?.route !== TRANSPORT || !nativeSearchContextBound(model, context)) return fallback(model, context, options);
    const binding = clone(nativeSearchState().policy);
    const stream = new AssistantMessageEventStream();
    void (async () => {
      const state = nativeSearchState(), prefix = [], sources = [], visible = emptyMessage(model);
      const messages = replay(context.messages, model, binding); let started = false, calls = 0, continuations = 0;
      const bound = () => sameScope(binding,state.policy) && nativeSearchContextBound(model,context) && !options.signal?.aborted;
      const allowed = () => bound() && nativeSearchAllowed(model,context) && calls < 4;
      const close = reason => {
        state.closedRuns.add(runKey(model,binding));
        state.report?.({event:'unavailable',api:model.api,model:identity(model),run:binding.run,step:binding.step,reason});
      };
      try {
        while (true) {
          if (!bound()) throw new Error('Reference search scope changed or was cancelled');
          let declared = false, terminal;
          const base = visible.content.length;
          const project = message => ({...message,content:[...visible.content,...message.content.filter(block => !internal(block))]});
          const inner = fallback(model,{...context,messages:[...messages,...prefix]}, {...options,onPayload:async (payload, physical) => {
            const prepared = await options.onPayload?.(payload,physical) ?? payload;
            const choice = prepared.tool_choice;
            declared = allowed() && (choice == null || choice === 'auto' || choice === 'required'
              || model.api === 'anthropic-messages' && ['auto','any'].includes(choice?.type));
            return {...prepared,tools:[...(prepared.tools ?? []).filter(tool => !names.has(tool.name ?? tool.function?.name)
              && tool.type !== 'web_search'),...(declared ? clone(declarations(model.api,tools)) : [])]};
          }});
          for await (const event of inner) {
            if (!bound()) throw new Error('Reference search scope changed or was cancelled');
            if (event.type === 'done' || event.type === 'error') { terminal = event; continue; }
            if (event.type === 'start') { if (!started) { started = true; stream.push({...event,partial:project(event.partial)}); } continue; }
            const block = event.partial?.content[event.contentIndex];
            if (block && internal(block)) continue;
            stream.push(event.partial ? {...event,partial:project(event.partial),contentIndex:base + event.partial.content.slice(0,event.contentIndex).filter(block => !internal(block)).length} : event);
          }
          if (!bound()) throw new Error('Reference search scope changed or was cancelled');
          if (!terminal) throw new Error('Reference response ended without a terminal event');
          const message = terminal.message ?? terminal.error;
          addUsage(visible.usage,message.usage);
          const combined = project(message);
          visible.content = combined.content; visible.stopReason = message.stopReason;
          const searches = message.stopReason === 'toolUse' ? message.content.filter(internal) : [];
          if (terminal.type === 'error') {
            stream.push({...terminal,error:{...message,content:visible.content,usage:clone(visible.usage)}}); stream.end(); return;
          }
          if (searches.length) {
            if (++continuations > 5) throw new Error('Reference did not continue with available game tools after retrieval closed');
            const privateAssistant = {...message,content:message.content.filter(block => block.type === 'thinking' || internal(block))};
            prefix.push(privateAssistant);
            if (Buffer.byteLength(JSON.stringify(prefix)) > LIMIT - 4096) {
              close('protocol_retention_bound');
              throw new Error('Reference retrieval call exceeds the retention bound');
            }
            for (const call of searches) {
              let value, failed = false;
              try {
                if (!declared || !allowed()) throw new Error('Optional retrieval is unavailable for this request');
                calls++;
                value = await retrieve(call,options);
              } catch (error) {
                if (!bound()) throw new Error('Reference search scope changed or was cancelled');
                failed = true; close('retrieval_unavailable');
                value = {unavailable:true,message:error.message};
              }
              if (!bound()) throw new Error('Reference search scope changed or was cancelled');
              if (!failed && !nativeSearchAllowed(model,context)) throw new Error('Reference search authorization was revoked');
              let result = {role:'toolResult',toolCallId:call.id,toolName:call.name,content:[{type:'text',text:JSON.stringify(value)}],isError:failed,timestamp:Date.now()};
              if (Buffer.byteLength(JSON.stringify([...prefix,result])) > LIMIT) {
                failed = true; close('protocol_retention_bound');
                result = {...result,isError:true,content:[{type:'text',text:JSON.stringify({unavailable:true,message:'Retrieval exceeds the retention bound'})}]};
              }
              prefix.push(result);
              if (!failed) sources.push(...(value.results ?? [{url:value.url,title:value.title}] ).map(({url,title}) => ({url,title})));
            }
          }
          const gameCalls = message.content.some(block => block.type === 'toolCall' && !internal(block));
          if (searches.length && !gameCalls) continue;
          if (prefix.length && bound()) {
            const record = {transport:TRANSPORT,api:model.api,model:identity(model),campaign:binding.campaign,worldline:binding.worldline,
              loop:binding.loop,run:binding.run,step:binding.step,anchor:anchor({...message,content:visible.content}),content:clone(prefix),terminal:message.stopReason};
            state.records.push(record); if (state.records.length > 64) state.records.shift();
            state.persist?.(record);
            state.report?.({event:'response',api:model.api,model:identity(model),run:binding.run,step:binding.step,protocol:record,sources,calls});
          }
          stream.push({type:'done',reason:visible.stopReason,message:{...message,content:visible.content,usage:clone(visible.usage)}});
          stream.end(); return;
        }
      } catch (error) {
        stream.push({type:'error',reason:options.signal?.aborted ? 'aborted' : 'error',error:{...visible,
          stopReason:options.signal?.aborted ? 'aborted' : 'error',errorMessage:error.message}});
        stream.end();
      }
    })();
    return stream;
  };
}
