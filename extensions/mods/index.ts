/** A host adapter for portable Mod Agent tasks; it adds no Keeper tools. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { runReader } from "../module/reader.ts";
import { KernelError } from "../kernel/client.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
type Call = (method: string, params: Record<string, unknown>) => Promise<any>;
export interface ModBridge {
  prepare(method: string, payload: Record<string, any>, signal?: AbortSignal): Promise<void>;
}

export default function modsExtension(pi: ExtensionAPI): void {
  let call: Call | undefined;
  let context: ExtensionContext | undefined;
  pi.events.on("coc:kernel-bridge", (data) => { call = (data as any)?.call; });
  pi.on("session_start", async (_event, ctx) => { context = ctx; });
  pi.on("before_agent_start", async (_event, ctx) => { context = ctx; });

  async function task(campaign: string, role: "create" | "audit", input: unknown, signal?: AbortSignal): Promise<any> {
    if (!call) throw new KernelError({code:"needs",message:"Mod kernel bridge is unavailable"});
    const job = await call("mods.job", {campaign, role, input});
    if (!job.enabled) return null;
    if (job.accepted) return call("mods.accept", {campaign, job:job.job});
    const model = context?.model;
    const modelName = process.env.PI_COC_MOD_MODEL?.trim() || (model ? `${model.provider}/${model.id}` : undefined);
    const checker = `PYTHONPATH='${ROOT.replaceAll("'", "'\\''")}/kernel' uv run --project '${ROOT.replaceAll("'", "'\\''")}' --frozen python -m coc.mods.check result.json`;
    const base = `Read request.json and follow the task in your system prompt. Write result.json. ${role === "create" ? `Validate it with: ${checker}` : "Use tools to inspect the actual draft and registered objects."}`;
    let repair = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const outcome = await runReader({cwd:job.cwd, systemPrompt:job.system_prompt, model:modelName,
        thinking:context?.thinkingLevel, signal, timeoutMs:Number(process.env.PI_COC_MOD_TIMEOUT_MS) || 180000,
        eventLog:join(job.cwd, `agent-${attempt}.jsonl`), brief:base + repair});
      await writeFile(join(job.cwd, `run-${attempt}.json`), JSON.stringify(outcome, null, 2));
      if (!outcome.ok) throw new KernelError({code:"needs", message:"The Mod agent did not finish its task",
        fix:"Retry the same request to resume the retained job", details:{reason:"mod_agent_failed", timed_out:outcome.timedOut}});
      try { return await call("mods.accept", {campaign, job:job.job}); }
      catch (error) {
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
