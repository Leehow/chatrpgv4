/** Explicit-session panel adapter; it does not expose Keeper-only Mod context. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { readFile } from "node:fs/promises";
import { documentPresentationStatus } from "../extensions/mods/document-presentation.ts";
import {withDocumentImage} from "../shared/handout-images.js";
import { uiWordsSurface } from "./ui-words.ts";
import type { UiWords } from "../runtime/ui-words.ts";
import type { HostRuntime } from "../runtime/host.ts";
import {join} from 'node:path';
import {renderMapView} from '../extensions/kernel/map-view.ts';
import {existsSync} from 'node:fs';

/**
 * A refusal the Mods panel can show (contract §23): the code it looks a word up by, and English
 * for the log. The panel never renders this message as the explanation, because the player does
 * not necessarily read the system language.
 */
function refuse(code: string, message: string): Error {
  return Object.assign(new Error(message), {code});
}

let texture: Promise<string | undefined> | undefined;
const paperTexture = () => texture ??= readFile(new URL("./assets/paper-texture.jpg", import.meta.url))
  .then(bytes => `data:image/jpeg;base64,${bytes.toString("base64")}`).catch(()=>undefined);

export function registerModsPanel(pi: ExtensionAPI): void {
  let call: ((method:string, params:Record<string, unknown>) => Promise<unknown>) | undefined;
  let campaign: string | undefined;
  let runtime: HostRuntime | undefined;
  let context: ExtensionContext | undefined;
  let language: string | undefined;
  const abort = new AbortController();
  const referenceWorkers=new Map<string,Promise<void>>();
  const referenceMaps=new Map<string,string|undefined>();
  /**
   * The chrome's words for this table's language (contract §23): a shipped seed or a cached
   * projection when there is one, and otherwise the authored words at once plus one background
   * projection for the tag. The panel redraws when that lands.
   */
  const words = uiWordsSurface((tag) => {
    pi.events.emit("coc:ui-words", {tag});
    void emitToPanel("coc-keeper", "mods-changed");
  });
  function chrome(): Promise<UiWords | undefined> {
    return words.words(language, runtime ? {runtime,
      model: context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
      thinking: context?.thinkingLevel, signal: abort.signal} : undefined);
  }
  pi.on("session_shutdown", async () => {abort.abort();});
  pi.on("session_start", async (_event, ctx) => {context = ctx;});
  pi.on("before_agent_start", async (_event, ctx) => {context = ctx;});
  pi.events.on("coc:kernel-bridge", (value) => {
    const event = value as {call?:typeof call; campaign?:string; runtime?:HostRuntime};
    call = event?.call;
    runtime = event?.runtime;
    campaign = event?.campaign;
    void resumeReferences();
  });
  pi.events.on("coc:session-bound", value => {
    campaign = (value as any)?.campaign;
    if ((value as any)?.play_language) language = (value as any).play_language;
    void resumeReferences();
  });
  pi.events.on("coc:table-open", value => {
    const tag = (value as any)?.open?.campaign?.play_language;
    if (typeof tag === "string" && tag) language = tag;
    void resumeReferences();
  });
  const notify = () => { void emitToPanel("coc-keeper", "mods-changed"); };
  for (const event of ["coc:turn-committed", "coc:table-open", "coc:capsule"]) pi.events.on(event, notify);

  function referenceChanged(reference?:unknown) {
    void emitToPanel('coc-keeper','sheet-changed',{campaign,reference});
    void emitToPanel('coc-keeper','mods-changed',{campaign,reference});
  }
  async function finishReference(referenceId:string) {
    const current=call,bound=campaign,owner=runtime;
    if(!current||!bound||!owner||owner.signal.aborted||abort.signal.aborted)throw refuse('runtime_unavailable','The image reference runtime is unavailable');
    const key=JSON.stringify([bound,referenceId]);
    if(!referenceMaps.has(key)){
      const view:any=await current('table.view',{campaign:bound});
      for(const actor of Array.isArray(view?.investigators)?view.investigators:[]){
        const result:any=await current('mods.document.references',{campaign:bound,actor:actor.id??actor.name});
        for(const job of Array.isArray(result?._reference_jobs)?result._reference_jobs:[])referenceMaps.set(JSON.stringify([bound,job.reference_id]),job.map);
      }
    }
    const map=referenceMaps.get(key);
    if(typeof map==='string'){
      try {
        const looked:any=await current('table.look',{campaign:bound,focus:'map',name:map});
        for(const view of Array.isArray(looked?.map_views)?looked.map_views:[])await renderMapView(view,{
          modulesRoot:join(owner.home,'.coc/modules'),sourceRoots:[join(owner.home,'.coc/module-campaigns',bound,'modules')],
          campaignDir:join(owner.home,'.coc/campaigns',bound)});
      }catch(error){
        console.warn(`[pipicoc] Image reference ${referenceId} rendering failed: ${error instanceof Error?error.message:String(error)}`);
        void emitToPanel('coc-keeper','reference-failed',{campaign:bound,reference_id:referenceId,code:'document_unavailable'});
        // The kernel owns the pinned source/cache verdict, including a retained refused entry.
      }
    }
    if(owner!==runtime||current!==call||bound!==campaign||owner.signal.aborted||abort.signal.aborted)
      throw refuse('runtime_unavailable','The image reference runtime changed');
    const result:any=await current('mods.document.reference_finish',{campaign:bound,reference_id:referenceId});
    if(result?.reference?.status==='refused')console.warn(`[pipicoc] Image reference ${referenceId} was refused: ${result.error?.message??'Its kernel diagnostic is retained'}`);
    referenceChanged(result?.reference);return result;
  }
  function scheduleReference(reference:any,map?:string) {
    if(reference?.status!=='queued'||typeof reference.id!=='string'||!campaign||abort.signal.aborted)return;
    const key=JSON.stringify([campaign,reference.id]);referenceMaps.set(key,map);
    if(referenceWorkers.has(key))return;
    const pending=Promise.resolve().then(()=>finishReference(reference.id)).then(()=>undefined).catch(error=>{
      console.warn(`[pipicoc] Image reference ${reference.id} failed: ${error instanceof Error?error.message:String(error)}`);
      void emitToPanel('coc-keeper','reference-failed',{campaign,reference_id:reference.id,code:typeof error?.code==='string'?error.code:'kernel_error'});
      referenceChanged();
    }).finally(()=>{if(referenceWorkers.get(key)===pending)referenceWorkers.delete(key);});
    referenceWorkers.set(key,pending);
  }
  let referenceScan:Promise<void>|undefined;
  function resumeReferences():Promise<void> {
    if(referenceScan)return referenceScan;
    const current=call,bound=campaign,owner=runtime;
    if(!current||!bound||!owner||typeof owner.home!=='string'||!owner.home||abort.signal.aborted
      ||!existsSync(join(owner.home,'.coc/campaigns',bound,'reference-items.json')))return Promise.resolve();
    referenceScan=(async()=>{
      const view:any=await current('table.view',{campaign:bound});
      for(const actor of Array.isArray(view?.investigators)?view.investigators:[]){
        const result:any=await current('mods.document.references',{campaign:bound,actor:actor.id??actor.name});
        if(current!==call||bound!==campaign||owner!==runtime||abort.signal.aborted)return;
        for(const reference of Array.isArray(result?.references)?result.references:[]){
          const job=(result._reference_jobs??[]).find((row:any)=>row.reference_id===reference.id);scheduleReference(reference,job?.map);
        }
      }
    })().catch(error=>{
      console.warn(`[pipicoc] Image reference recovery failed: ${error instanceof Error?error.message:String(error)}`);
      void emitToPanel('coc-keeper','reference-failed',{campaign:bound,code:typeof error?.code==='string'?error.code:'kernel_error'});
    }).finally(()=>{referenceScan=undefined;});
    return referenceScan;
  }

  async function invoke(method:string, params:Record<string, unknown> = {}) {
    if (!call) throw refuse("runtime_unavailable", "The game runtime is not ready");
    if(['mods.document.apply','mods.document.request'].includes(method))throw refuse('capability_denied','Physical editor requests must pass through the owning game session queue');
    const owner = runtime;
    if (method === "mods.configure" && !campaign) throw refuse("campaign_unbound", "Select a campaign before changing its Mods");
    if (method.startsWith("mods.document.") && !campaign) throw refuse("campaign_unbound", "Select the document's campaign");
    let result:any = method==='mods.document.reference_finish'
      ? await finishReference(String(params.reference_id??''))
      : await call(method, {...params, ...(campaign ? {campaign} : {})});
    if(method==='mods.document.collect'){
      scheduleReference(result.reference,result._reference_source?.map);referenceChanged(result.reference);
    }else if(method==='mods.document.references'){
      for(const reference of Array.isArray(result?.references)?result.references:[]){
        const job=(result._reference_jobs??[]).find((row:any)=>row.reference_id===reference.id);
        scheduleReference(reference,job?.map);
      }
    }
    if(method==='mods.document.collect'||method==='mods.document.references'||method==='mods.document.reference_finish'){
      const {_reference_source,_reference_jobs,...publicResult}=result;result=publicResult;
    }
    if (method === "mods.document.apply") void emitToPanel("coc-keeper", "sheet-changed");
    if (method === 'mods.equipment.retry') pi.events.emit('coc:equipment-retry');
    else if (method !== "mods.list" && !method.startsWith("mods.document.")) notify();
    if (['mods.document.view','mods.document.request_status'].includes(method)) {
      if (!owner || owner !== runtime || owner.signal.aborted) throw refuse("document_unavailable", "The document runtime is no longer available");
      result = documentPresentationStatus({owner, home:owner.home, resourceRoot:owner.resourceRoot,
        model:context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
        thinking:context?.thinkingLevel, signal:AbortSignal.any([abort.signal,owner.signal]),
        runner:request=>owner.runTask({kind:'mod',request},request.signal)}, result as any);
    }
    if (['mods.document.view','mods.document.request_status'].includes(method) && owner && campaign) {
      result=withDocumentImage(result,{home:owner.home,campaign});
    }
    if (method.startsWith("mods.document.") && (result as any)?.editor?.renderer === "paper" && (result as any)?.editing !== 'read_only') {
      result = {...result as any, texture:await paperTexture()};
    }
    // Every Mods answer the panel draws from carries the words it draws them with (contract §23).
    const ui = await chrome();
    return ui && result && typeof result === "object" && !Array.isArray(result) ? {...result as any, ui} : result;
  }
  registerInvokeHandlers("coc-keeper", Object.fromEntries(
    ["mods.list", "mods.install", "mods.defaults", "mods.configure", "mods.order", "mods.document.view", "mods.document.request_status", "mods.document.collect", "mods.document.references", "mods.document.reference_finish", "mods.equipment.retry"].map(method => [method,
      (raw:unknown) => {
        if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) throw refuse("invalid_params", "Expected Mod parameters");
        const params = {...(raw as Record<string, unknown> ?? {})};
        if(['mods.document.collect','mods.document.references','mods.document.reference_finish'].includes(method)
          ||method==='mods.document.view'&&Object.hasOwn(params,'reference_id')){
          const allowed=method==='mods.document.collect'?['actor','handout','presentation']:method==='mods.document.references'?['actor']
            :method==='mods.document.reference_finish'?['reference_id']:['actor','reference_id'];
          if(Object.keys(params).some(key=>!allowed.includes(key)))throw refuse('invalid_params','Reference parameters cannot override session or source authority');
        }
        delete params.campaign;
        const pending = invoke(method, params);
        return method.startsWith("mods.document.") ? pending.catch(error=>({ok:false,error:{
          code:typeof error?.code === "string" && error.code ? error.code : "kernel_error",
          message:error instanceof Error ? error.message : String(error)}})) : pending;
      }]),
  ));
}
