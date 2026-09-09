import { join } from "node:path";
import type { KernelContext } from "./context.js";
import { pythonTypeName } from "./errors.js";
import type { HandlerGroup, KernelResult } from "./handlers.js";
import { isJsonObject, type JsonValue, type ReadonlyJson } from "./json.js";

export const KERNEL_VERSION = "2.0.0a0";

function dictionary(value: ReadonlyJson): Readonly<Record<string, ReadonlyJson>> {
  if (isJsonObject(value)) return value;
  const error = new Error(`'${pythonTypeName(value as JsonValue)}' object has no attribute 'get'`);
  error.name = "AttributeError";
  throw error;
}

export function foundationHandlers(context: KernelContext): HandlerGroup {
  const reads = context.snapshots;
  return Object.freeze({
    "kernel.hello": async (): Promise<KernelResult> => ({
      kernel_version: KERNEL_VERSION,
      content: {
        rulesets: await reads.sortedChildNames(join(context.content, "rulesets"), reads.isDirectory),
        modules: await reads.sortedChildNames(join(context.content, "starters"), path => reads.pathExists(join(path, "module-graph.json"))),
      },
    }),
    "campaign.list": async (): Promise<KernelResult> => {
      const names = await reads.sortedChildNames(context.campaignsRoot, path => reads.pathExists(join(path, "campaign.json")));
      const campaigns: ReadonlyJson[] = [];
      for (const name of names) {
        const root = join(context.campaignsRoot, name);
        const meta = dictionary(await reads.readJson(join(root, "campaign.json")));
        const turnPath = join(root, "turn.json");
        const turn = await reads.pathExists(turnPath) ? dictionary(await reads.readJson(turnPath)) : { turn: 0 };
        campaigns.push({
          id: Object.hasOwn(meta, "id") ? meta.id : name,
          title: Object.hasOwn(meta, "title") ? meta.title : null,
          module_id: Object.hasOwn(meta, "module_id") ? meta.module_id : null,
          status: Object.hasOwn(meta, "status") ? meta.status : null,
          turn: Object.hasOwn(turn, "turn") ? turn.turn : 0,
        });
      }
      return { campaigns };
    },
  });
}
