/** Explicit-session panel adapter; it does not expose Keeper-only Mod context. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { readFile } from "node:fs/promises";
import { documentPresentationStatus } from "../extensions/mods/document-presentation.ts";
import type { HostRuntime } from "../runtime/host.ts";

let texture: Promise<string | undefined> | undefined;
const paperTexture = () => texture ??= readFile(new URL("./assets/paper-texture.jpg", import.meta.url))
  .then(bytes => `data:image/jpeg;base64,${bytes.toString("base64")}`).catch(()=>undefined);

export function registerModsPanel(pi: ExtensionAPI): void {
  let call: ((method:string, params:Record<string, unknown>) => Promise<unknown>) | undefined;
  let campaign: string | undefined;
  let runtime: HostRuntime | undefined;
  let context: ExtensionContext | undefined;
  const abort = new AbortController();
  pi.on("session_shutdown", async () => {abort.abort();});
  pi.on("session_start", async (_event, ctx) => {context = ctx;});
  pi.on("before_agent_start", async (_event, ctx) => {context = ctx;});
  pi.events.on("coc:kernel-bridge", (value) => {
    const event = value as {call?:typeof call; campaign?:string; runtime?:HostRuntime};
    call = event?.call;
    runtime = event?.runtime;
    campaign = event?.campaign;
  });
  pi.events.on("coc:session-bound", value => { campaign = (value as any)?.campaign; });
  const notify = () => { void emitToPanel("coc-keeper", "mods-changed"); };
  for (const event of ["coc:turn-committed", "coc:table-open", "coc:capsule"]) pi.events.on(event, notify);

  async function invoke(method:string, params:Record<string, unknown> = {}) {
    if (!call) throw new Error("The game runtime is not ready");
    const owner = runtime;
    if (method === "mods.configure" && !campaign) throw new Error("Select a campaign before changing its Mods");
    if (method.startsWith("mods.document.") && !campaign) throw new Error("Select the document's campaign");
    let result = await call(method, {...params, ...(campaign ? {campaign} : {})});
    if (method === "mods.document.apply") void emitToPanel("coc-keeper", "sheet-changed");
    else if (method !== "mods.list" && !method.startsWith("mods.document.")) notify();
    if (method.startsWith("mods.document.")) {
      if (!owner || owner !== runtime || owner.signal.aborted) throw new Error("The document runtime is no longer available");
      result = documentPresentationStatus({owner, home:owner.home, resourceRoot:owner.resourceRoot,
        model:context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
        thinking:context?.thinkingLevel, signal:AbortSignal.any([abort.signal,owner.signal]),
        runner:request=>owner.runTask({kind:'mod',request},request.signal)}, result as any);
    }
    if (method.startsWith("mods.document.") && (result as any)?.editor?.renderer === "paper") {
      return {...result as any, texture:await paperTexture()};
    }
    return result;
  }
  registerInvokeHandlers("coc-keeper", Object.fromEntries(
    ["mods.list", "mods.install", "mods.defaults", "mods.configure", "mods.order", "mods.document.view", "mods.document.apply"].map(method => [method,
      (raw:unknown) => {
        if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) throw new Error("Expected Mod parameters");
        const params = {...(raw as Record<string, unknown> ?? {})};
        delete params.campaign;
        const pending = invoke(method, params);
        return method.startsWith("mods.document.") ? pending.catch(error=>({ok:false,error:{
          code:typeof error?.code === "string" ? error.code : "mods_failed",
          message:error instanceof Error ? error.message : String(error)}})) : pending;
      }]),
  ));
}
