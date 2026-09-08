/** Explicit-session panel adapter; it does not expose Keeper-only Mod context. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";

export function registerModsPanel(pi: ExtensionAPI): void {
  let call: ((method:string, params:Record<string, unknown>) => Promise<unknown>) | undefined;
  let campaign: string | undefined;
  pi.events.on("coc:kernel-bridge", (value) => {
    const event = value as {call?:typeof call; campaign?:string};
    call = event?.call;
    campaign = event?.campaign;
  });
  pi.events.on("coc:session-bound", value => { campaign = (value as any)?.campaign; });
  const notify = () => { void emitToPanel("coc-keeper", "mods-changed"); };
  for (const event of ["coc:turn-committed", "coc:table-open", "coc:capsule"]) pi.events.on(event, notify);

  async function invoke(method:string, params:Record<string, unknown> = {}) {
    if (!call) throw new Error("The game runtime is not ready");
    if (method === "mods.configure" && !campaign) throw new Error("Select a campaign before changing its Mods");
    const result = await call(method, {...params, ...(campaign ? {campaign} : {})});
    if (method !== "mods.list") notify();
    return result;
  }
  registerInvokeHandlers("coc-keeper", Object.fromEntries(
    ["mods.list", "mods.install", "mods.defaults", "mods.configure"].map(method => [method,
      (raw:unknown) => {
        if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) throw new Error("Expected Mod parameters");
        const params = {...(raw as Record<string, unknown> ?? {})};
        delete params.campaign;
        return invoke(method, params);
      }]),
  ));
}
