import { join } from "node:path";
import type { KernelContext } from "./context.js";
import { RpcError } from "./errors.js";
import type { JsonObject, ReadonlyJson } from "./json.js";
import { withExclusiveLock } from "./locks.js";

export type KernelResult = { readonly [key: string]: ReadonlyJson };
export type KernelHandler = (params: JsonObject) => KernelResult | Promise<KernelResult>;
export type HandlerGroup = Readonly<Record<string, KernelHandler>>;

/** The current Python public method vocabulary, including unmigrated methods. */
export const KNOWN_METHODS = Object.freeze([
  "kernel.hello", "campaign.list", "campaign.create",
  "table.open", "table.status", "table.capsule", "table.player_input", "table.look",
  "table.view", "table.lookup", "table.recall", "table.resolve", "table.apply", "table.ask",
  "table.narrate", "table.warn", "memory.job", "memory.submit", "memory.fail",
  "setup.steps", "setup.occupations", "setup.investigator", "setup.complete", "setup.prologue",
  "setup.draft", "setup.previewed", "setup.confirm",
  "module.source.bind", "module.read.request", "module.read.claim", "module.read.finish",
  "module.list", "module.status", "module.register", "module.opening.choose", "module.asset",
  "investigator.list", "investigator.get", "investigator.save", "investigator.load",
  "mods.list", "mods.configure", "mods.order", "mods.document.view", "mods.document.apply",
  "mods.install", "mods.defaults", "mods.context", "mods.job", "mods.accept",
] as const);

async function guardCampaign(context: KernelContext, params: JsonObject, handler: KernelHandler): Promise<KernelResult> {
  const campaign = params.campaign;
  if (typeof campaign !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(campaign) ||
    !await context.snapshots.isFile(join(context.campaignsRoot, campaign, "campaign.json"))) return handler(params);
  return withExclusiveLock(context.locks, join(context.stateRoot, "locks", `${campaign}.lock`), async () => handler(params), {
    timeoutMs: context.campaignLockTimeoutMs,
    // A refusal that names the campaign and the reason is the difference between "retry when the
    // turn holding it ends" and an internal error the caller can only shrug at.
    timeout: () => new RpcError("internal", `another process is holding campaign ${JSON.stringify(campaign)}`, {
      fix: "wait for the turn that holds this campaign to finish, or close the other window on it",
      details: { reason: "campaign_locked", campaign },
    }),
  });
}

/** Assemble once at startup; there is no runtime registration or mutable registry. */
export function assembleHandlers(context: KernelContext, ...groups: readonly HandlerGroup[]): HandlerGroup {
  const selected = Object.create(null) as Record<string, KernelHandler>;
  for (const group of groups) {
    for (const [name, handler] of Object.entries(group)) {
      if (!KNOWN_METHODS.includes(name as typeof KNOWN_METHODS[number])) throw new TypeError(`undeclared kernel method ${name}`);
      if (Object.hasOwn(selected, name)) throw new TypeError(`duplicate kernel method ${name}`);
      if (typeof handler !== "function") throw new TypeError(`kernel method ${name} must be a function`);
      selected[name] = params => guardCampaign(context, params, handler);
    }
  }
  for (const name of KNOWN_METHODS) {
    if (!Object.hasOwn(selected, name)) {
      selected[name] = () => { throw new RpcError("not_implemented", `method ${name} is not implemented in the TypeScript kernel`); };
    }
  }
  return Object.freeze(selected);
}
