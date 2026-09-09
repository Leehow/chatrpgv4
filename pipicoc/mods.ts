/** Explicit-session panel adapter; it does not expose Keeper-only Mod context. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { readFile } from "node:fs/promises";
import { documentPresentationStatus } from "../extensions/mods/document-presentation.ts";
import { loadUiWords, type UiWords } from "../runtime/ui-words.ts";
import type { HostRuntime } from "../runtime/host.ts";

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
  /** The chrome's words for this table's language, one read per content root and tag. */
  const words = new Map<string, Promise<UiWords | undefined>>();
  function chrome(): Promise<UiWords | undefined> {
    const contentRoot = runtime?.contentRoot;
    if (!contentRoot) return Promise.resolve(undefined);
    const key = JSON.stringify([contentRoot, language ?? null]);
    let pending = words.get(key);
    if (!pending) {
      pending = loadUiWords(contentRoot, language).catch(() => {words.delete(key); return undefined;});
      words.set(key, pending);
    }
    return pending;
  }
  pi.on("session_shutdown", async () => {abort.abort();});
  pi.on("session_start", async (_event, ctx) => {context = ctx;});
  pi.on("before_agent_start", async (_event, ctx) => {context = ctx;});
  pi.events.on("coc:kernel-bridge", (value) => {
    const event = value as {call?:typeof call; campaign?:string; runtime?:HostRuntime};
    call = event?.call;
    runtime = event?.runtime;
    campaign = event?.campaign;
  });
  pi.events.on("coc:session-bound", value => {
    campaign = (value as any)?.campaign;
    if ((value as any)?.play_language) language = (value as any).play_language;
  });
  pi.events.on("coc:table-open", value => {
    const tag = (value as any)?.open?.campaign?.play_language;
    if (typeof tag === "string" && tag) language = tag;
  });
  const notify = () => { void emitToPanel("coc-keeper", "mods-changed"); };
  for (const event of ["coc:turn-committed", "coc:table-open", "coc:capsule"]) pi.events.on(event, notify);

  async function invoke(method:string, params:Record<string, unknown> = {}) {
    if (!call) throw refuse("runtime_unavailable", "The game runtime is not ready");
    const owner = runtime;
    if (method === "mods.configure" && !campaign) throw refuse("campaign_unbound", "Select a campaign before changing its Mods");
    if (method.startsWith("mods.document.") && !campaign) throw refuse("campaign_unbound", "Select the document's campaign");
    let result = await call(method, {...params, ...(campaign ? {campaign} : {})});
    if (method === "mods.document.apply") void emitToPanel("coc-keeper", "sheet-changed");
    else if (method !== "mods.list" && !method.startsWith("mods.document.")) notify();
    if (method.startsWith("mods.document.")) {
      if (!owner || owner !== runtime || owner.signal.aborted) throw refuse("document_unavailable", "The document runtime is no longer available");
      result = documentPresentationStatus({owner, home:owner.home, resourceRoot:owner.resourceRoot,
        model:context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
        thinking:context?.thinkingLevel, signal:AbortSignal.any([abort.signal,owner.signal]),
        runner:request=>owner.runTask({kind:'mod',request},request.signal)}, result as any);
    }
    if (method.startsWith("mods.document.") && (result as any)?.editor?.renderer === "paper") {
      result = {...result as any, texture:await paperTexture()};
    }
    // Every Mods answer the panel draws from carries the words it draws them with (contract §23).
    const ui = await chrome();
    return ui && result && typeof result === "object" && !Array.isArray(result) ? {...result as any, ui} : result;
  }
  registerInvokeHandlers("coc-keeper", Object.fromEntries(
    ["mods.list", "mods.install", "mods.defaults", "mods.configure", "mods.order", "mods.document.view", "mods.document.apply"].map(method => [method,
      (raw:unknown) => {
        if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) throw refuse("invalid_params", "Expected Mod parameters");
        const params = {...(raw as Record<string, unknown> ?? {})};
        delete params.campaign;
        const pending = invoke(method, params);
        return method.startsWith("mods.document.") ? pending.catch(error=>({ok:false,error:{
          code:typeof error?.code === "string" && error.code ? error.code : "kernel_error",
          message:error instanceof Error ? error.message : String(error)}})) : pending;
      }]),
  ));
}
