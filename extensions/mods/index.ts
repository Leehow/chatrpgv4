/** A host adapter for portable Mod Agent tasks; it adds no Keeper tools. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { KernelError, isKernelError } from "../kernel/client.ts";
import type { HostRuntime } from "../../runtime/host.ts";

type Call = (method: string, params: Record<string, unknown>) => Promise<any>;
export interface ModBridge {
  prepare(method: string, payload: Record<string, any>, signal?: AbortSignal): Promise<void>;
}

export default function modsExtension(pi: ExtensionAPI): void {
  let call: Call | undefined;
  let runtime: HostRuntime | undefined;
  let context: ExtensionContext | undefined;
  pi.events.on("coc:kernel-bridge", (data) => { call = (data as any)?.call; runtime = (data as any)?.runtime; });
  pi.on("session_start", async (_event, ctx) => { context = ctx; });
  pi.on("before_agent_start", async (_event, ctx) => { context = ctx; });

  async function task(campaign: string, role: "create" | "audit", input: unknown, signal?: AbortSignal): Promise<any> {
    if (!call) throw new KernelError({code:"needs",message:"Mod kernel bridge is unavailable"});
    const current = call, owner = runtime;
    const job = await current("mods.job", {campaign, role, input});
    if (!job.enabled) return null;
    if (job.accepted) return current("mods.accept", {campaign, job:job.job});
    if (!owner) throw new KernelError({code:"needs",message:"Mod runtime bridge is unavailable"});
    const model = context?.model;
    const modelName = model ? `${model.provider}/${model.id}` : undefined;
    const checker = "coc-read-check --kind mod-definition --draft result.json";
    const base = `Read request.json and follow the task in your system prompt. Write result.json. ${role === "create" ? `Validate it with: ${checker}` : "Use tools to inspect the actual draft and registered objects."}`;
    let repair = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const outcome = await owner.runTask({kind:"mod", request:{cwd:job.cwd, systemPrompt:job.system_prompt, model:modelName,
        thinking:context?.thinkingLevel,
        eventLog:join(job.cwd, `agent-${attempt}.jsonl`), brief:base + repair}}, signal);
      await writeFile(join(job.cwd, `run-${attempt}.json`), JSON.stringify(outcome, null, 2));
      if (!outcome.ok) throw new KernelError({code:"needs", message:"The Mod agent did not finish its task",
        fix:"Retry the same request to resume the retained job", details:{reason:"mod_agent_failed", timed_out:outcome.timedOut}});
      try {
        if (role === "create") {
          const check = await owner.check({kind:"mod-definition", draft:join(job.cwd,"result.json")}, signal);
          if (!check.ok) throw new Error(JSON.stringify(check.error ?? check));
        }
        return await current("mods.accept", {campaign, job:job.job});
      }
      catch (error) {
        if (isKernelError(error) && error.code === "not_implemented") throw error;
        if (attempt === 2) throw error;
        repair = `\nThe deterministic gate rejected the prior draft: ${error instanceof Error ? error.message : String(error)}. Read and repair result.json; preserve all established facts.`;
      }
    }
  }

  const bridge: ModBridge = {
    async prepare(method, payload, signal) {
      if (method === "apply") {
        for (const effect of payload.effects ?? []) {
          if (effect.kind !== "define") continue;
          const result = await task(payload.campaign, "create", {name:effect.name, category:effect.category,
            description:effect.description, template:effect.template}, signal);
          if (!result) throw new KernelError({code:"needs", message:"Enable a definition-generating Mod before creating new definitions"});
          effect._definition = result.definition;
          effect._provenance = result.provenance;
        }
      }
      if ((method === "narrate" || method === "ask") && payload.text) {
        const result = await task(payload.campaign, "audit", {text:payload.text}, signal);
        if (result?.missing?.length || result?.findings?.length) throw new KernelError({code:"needs", message:"A Mod found an incomplete consequence in the unpublished draft",
          fix:"Address the missing objects or narrative findings, then retry the narration without rerolling settled actions",
          details:{reason:"mod_narrative_repair", missing:result.missing, findings:result.findings}});
      }
    },
  };
  // Subscribe/announce during extension loading, before kernel session_start opens the table.
  pi.events.emit("coc:mods-bridge", bridge);
  pi.on("session_shutdown", async () => { pi.events.emit("coc:mods-bridge", undefined); });
}
