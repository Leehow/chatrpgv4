import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  asObject,
  collectLeafExecution,
  McpJsonlClient,
  nonEmpty,
  readPrivateHandshake,
  runCoordinatorLifecycle,
  spawnPiChild,
  validateCoordinatorTask,
  type JsonObject,
} from "../lib/runtime.ts";

const handshake = readPrivateHandshake();
const coordinatorTask = validateCoordinatorTask(handshake.task);

const parameters = { type: "object", properties: {}, additionalProperties: false } as const;

export default function coordinatorExtension(pi: ExtensionAPI) {
  let used = false;
  let mcp: McpJsonlClient | null = null;
  const leaves = new Set<ReturnType<typeof spawnPiChild>>();
  pi.registerTool({
    name: "coc_run_source_coordinator",
    label: "Run exact COC source lifecycle",
    description: "Claim once, run the exact repository-produced Pi leaf tasks, and exact-fulfill once.",
    parameters,
    async execute(_id: string, _params: JsonObject, signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
      if (used) throw new Error("coordinator lifecycle tool is single-use");
      used = true;
      mcp = new McpJsonlClient(ctx.cwd, ctx.sessionManager.getSessionId());
      const model = ctx.model;
      if (!model) throw new Error("coordinator parent model is unavailable");
      const result = await runCoordinatorLifecycle(coordinatorTask, {
        signal,
        call: (name, args, callSignal) => mcp!.callTool(name, args, callSignal),
        spawnLeaf: async (task, leafSignal) => {
          const run = spawnPiChild({
            role: "leaf",
            task,
            cwd: ctx.cwd,
            provider: nonEmpty(model.provider, "model.provider"),
            modelId: nonEmpty(model.id, "model.id"),
            thinking: pi.getThinkingLevel(),
            signal: leafSignal,
          });
          return collectLeafExecution(run, leaves, task);
        },
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.on("session_start", () => pi.setActiveTools(["coc_run_source_coordinator"]));
  pi.on("session_shutdown", async () => {
    await Promise.allSettled([...leaves].map((run) => run.terminate()));
    leaves.clear();
    await mcp?.close();
    mcp = null;
  });
}

export const __private_test = { coordinatorTask, handshakeNonce: asObject(handshake, "handshake").nonce };
