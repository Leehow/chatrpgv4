import { streamSimple as anthropicStream } from '@earendil-works/pi-ai/api/anthropic-messages';
import { getApiProvider } from '@earendil-works/pi-ai/compat';
import { nativeSearchStream, registerNativeSearchCapability } from '../../../runtime/native-search.js';
import { enabledInHost, EXTENSION_ID, IMAGE_MODELS, ORIGINS, PROVIDERS } from './config.js';
import { createMiniMaxHostLibrary } from './host.js';
import { parseModelSpec, readConfiguredModel, writeConfiguredModel } from '../../image-gen/agent/config.js';
import {cacheStatistics} from '../../anthropic-cache/shared/policy.js';

export { createMiniMaxHostLibrary } from './host.js';
export function miniMaxStream(fallback = anthropicStream) {
  const search = nativeSearchStream(fallback, {api:'anthropic-messages',streamSimple:fallback,resume:true});
  return (model, context, options) => model.api !== 'anthropic-messages'
    ? getApiProvider(model.api).streamSimple(model,context,options)
    : search({...model,compat:{...model.compat,allowEmptySignature:true}}, context, options);
}
function recentTasks(ctx) {
  return (ctx.sessionManager?.getBranch?.() ?? []).filter(entry => entry.type === 'custom' && entry.customType === 'minimax-media')
    .map(entry => entry.data).filter(row => row.operation === 'video-create').slice(-8);
}
export default function minimaxEnhanced(pi, deps = {}) {
  const env = deps.env ?? process.env;
  if (!enabledInHost(env)) return;
  const remove = PROVIDERS.map(provider => {
    pi.registerProvider(provider, {api:'anthropic-messages',streamSimple:miniMaxStream(deps.stream)});
    return registerNativeSearchCapability(provider, {api:'anthropic-messages',origins:ORIGINS,
      models:['MiniMax-M3','MiniMax-M3.1-Flash-Preview'],declaration:{type:'web_search_20250305',name:'web_search'},exactReplay:true});
  });
  pi.on('session_shutdown', () => { for (const revoke of remove) revoke(); });
  let activeContext, invokeRegistry;
  const invokeDisposers=[];
  const bindInvoke=ctx=>{
    activeContext=ctx;
    const registry=globalThis[Symbol.for('pipiui.ext-invoke.registry')];
    if (!registry?.register || registry===invokeRegistry) return;
    for(const dispose of invokeDisposers.splice(0)) dispose();
    invokeRegistry=registry;
    for(const method of ['status','image-model','video-create','video-status']) {
      invokeDisposers.push(registry.register(EXTENSION_ID,method,args=>invoke(method,args ?? {},activeContext)));
    }
  };
  pi.on('session_start',(_event,ctx)=>bindInvoke(ctx));
  pi.on('before_agent_start',(_event,ctx)=>bindInvoke(ctx));
  pi.on('session_shutdown',()=>{for(const dispose of invokeDisposers.splice(0))dispose();invokeRegistry=undefined;activeContext=undefined;});
  const host = ctx => createMiniMaxHostLibrary(ctx, {env,...deps.media});
  async function invoke(method, args, ctx) {
    try {
      if (method === 'status') return {ok:true,data:{...await host(ctx).status(), imageModel:readConfiguredModel()?.model ?? null,
        cache:cacheStatistics(ctx.sessionManager?.getBranch?.() ?? [],PROVIDERS),tasks:recentTasks(ctx)}};
      if (method === 'image-model') {
        const {provider,modelId} = parseModelSpec(args.model ?? '');
        if (!PROVIDERS.includes(provider) || !IMAGE_MODELS.includes(modelId)) throw Error('Choose minimax-cn/image-01, minimax-cn/image-01-live or their minimax equivalents');
        writeConfiguredModel(args.model);
        return {ok:true,data:{model:args.model}};
      }
      if (method === 'video-create') {
        const data = await host(ctx).createVideo(args);
        try {pi.appendEntry('minimax-media', {operation:method,...data,created_at:new Date().toISOString()});}
        catch {data.receipt='unavailable';}
        return {ok:true,data};
      }
      if (method === 'video-status') return {ok:true,data:await host(ctx).queryVideo(args)};
      throw Error('Unknown MiniMax Enhanced operation');
    } catch (error) { return {ok:false,error:{code:'minimax_operation_failed',message:error.message}}; }
  }
  pi.registerCommand(EXTENSION_ID, {
    description:'MiniMax Enhanced host invoke: status, image-model, video-create, video-status',
    handler: (args,ctx) => typeof args === 'object' && args ? invoke(args.method,args.args ?? {},ctx) : invoke('status',{},ctx),
  });
  for (const [command,method] of [['minimax:status','status'],['minimax:image-model','image-model'],['minimax:video','video-create'],['minimax:video-status','video-status']]) {
    pi.registerCommand(command, {description:`MiniMax Enhanced ${method}; video submission accepts a JSON object`,handler:async (raw,ctx) => {
      let args={};
      try {
        if (method === 'image-model') args={model:String(raw).trim()};
        else if (method !== 'status') args=String(raw).trim().startsWith('{') ? JSON.parse(raw) : {task_id:String(raw).trim()};
      } catch {ctx.ui.notify('Invalid JSON arguments for the MiniMax operation','error');return;}
      const result=await invoke(method,args,ctx);
      ctx.ui.notify(JSON.stringify(result.ok ? result.data : result.error), result.ok ? 'info' : 'error');
    }});
  }
}
