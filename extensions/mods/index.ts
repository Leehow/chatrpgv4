/** A host adapter for portable Mod Agent tasks; it adds no Keeper tools. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { KernelError, isKernelError } from "../kernel/client.ts";
import { emitToPanel } from "../../pipicoc/host-bridge.ts";
import type { HostRuntime } from "../../runtime/host.ts";

type Call = (method: string, params: Record<string, unknown>) => Promise<any>;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 400);

/**
 * Every `define` in one apply is an independent Mod agent child, so a batch used to cost the sum of
 * all of them: seven ordinary belongings took three minutes inside a single tool call. They share
 * nothing but the campaign snapshot they read, so they run together under one bounded pool.
 *
 * The opening sets the width, because it registers a whole starting inventory in one batch: the
 * openings on record carried five, seven and eight unregistered rows. A pool narrower than that
 * splits one opening into two waves, and the short second wave pays the slowest child again for
 * nothing — four workers turned seven belongings into 57s of wall clock where a single wave costs
 * the 38s of its slowest member. Widening it does not unbound the fan-out: `materialize` never
 * starts more workers than the batch has distinct jobs.
 */
const MOD_POOL_DEFAULT = 8;
function modPoolSize(): number {
  const configured = Number(process.env.PI_COC_MOD_CONCURRENCY);
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : MOD_POOL_DEFAULT;
}
export interface ModBridge {
  prepare(method: string, payload: Record<string, any>, signal?: AbortSignal): Promise<void>;
}

export default function modsExtension(pi: ExtensionAPI): void {
  let call: Call | undefined;
  let runtime: HostRuntime | undefined;
  let mintCallId: (() => string | undefined) | undefined;
  let context: ExtensionContext | undefined;
  pi.events.on("coc:kernel-bridge", (data) => { call = (data as any)?.call; runtime = (data as any)?.runtime; mintCallId = (data as any)?.mintCallId; });
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
      const began = Date.now();
      let outcome: Awaited<ReturnType<HostRuntime["runTask"]>>;
      // An aborted or throwing run used to leave no trace at all next to the child's own output, so a
      // batch that died mid-flight could not be told from one that timed out. The attempt is recorded
      // either way, and then the original failure continues on its way.
      try {
        outcome = await owner.runTask({kind:"mod", request:{cwd:job.cwd, systemPrompt:job.system_prompt, model:modelName,
          thinking:context?.thinkingLevel,
          eventLog:join(job.cwd, `agent-${attempt}.jsonl`), brief:base + repair}}, signal);
      }
      catch (error) {
        await writeFile(join(job.cwd, `run-${attempt}.json`), JSON.stringify({ok:false, raised:errorText(error), ms:Date.now() - began}, null, 2)).catch(() => undefined);
        throw error;
      }
      await writeFile(join(job.cwd, `run-${attempt}.json`), JSON.stringify(outcome, null, 2));
      if (!outcome.ok) throw new KernelError({code:"needs", message:"The Mod agent did not finish its task",
        fix:"Retry the same request to resume the retained job",
        details:{reason:"mod_agent_failed", timed_out:outcome.timedOut, ms:outcome.ms, exit:outcome.code ?? null, signal:outcome.signal ?? null}});
      try {
        if (role === "create") {
          const check = await owner.check({kind:"mod-definition", draft:join(job.cwd,"result.json")}, signal);
          if (!check.ok) throw new Error(JSON.stringify(check.fix ? {error: check.error, fix: check.fix} : check.error ?? check));
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

  /**
   * The whole batch runs before apply writes anything, and it is the slowest thing a turn does, so
   * the app is told how far along it is: a tool call that emits nothing for minutes is indistinguishable
   * from a wedged one. A view that cannot be reached never fails a turn (`emitToPanel` swallows).
   */
  function announce(campaign: string, done: number, total: number): void {
    void emitToPanel("coc-keeper", "mods-progress", {campaign, done, total});
  }

  /**
   * Materialize every `define` of one batch. Failures do not cancel the siblings still in flight:
   * each definition that lands is retained as an accepted job, so the retry the Keeper is told to
   * make resumes from what is already done instead of paying for it twice.
   */
  async function materialize(campaign: string, defines: Record<string, any>[], signal?: AbortSignal): Promise<void> {
    // The kernel keys a job by its request, so two identical defines in one batch are one job directory.
    // Serially the second used to find the first already accepted; together they would race over the same
    // `result.json`, so they are folded here and share the one run.
    const inputs = defines.map(effect => ({name:effect.name, category:effect.category, description:effect.description, template:effect.template}));
    const owners = inputs.map(input => inputs.findIndex(other => JSON.stringify(other) === JSON.stringify(input)));
    const jobs = owners.filter((owner, index) => owner === index);
    const total = jobs.length, results: any[] = new Array(defines.length), failures: unknown[] = new Array(defines.length);
    let done = 0, next = 0;
    announce(campaign, done, total);
    const worker = async (): Promise<void> => {
      for (let slot = next++; slot < total; slot = next++) {
        const index = jobs[slot];
        try { results[index] = await task(campaign, "create", inputs[index], signal); }
        catch (error) { failures[index] = error; }
        announce(campaign, ++done, total);
      }
    };
    await Promise.all(Array.from({length: Math.min(modPoolSize(), total)}, worker));
    for (const [index, owner] of owners.entries()) {
      if (owner === index) continue;
      results[index] = results[owner];
      failures[index] = failures[owner];
    }
    // Batch order, not completion order: the Keeper is told about the first define that failed. Nothing
    // is attached until every one of them is in hand, so a half-materialized batch never reaches apply.
    for (const [index, failure] of failures.entries()) {
      if (failure !== undefined) throw failure;
      if (!results[index]) throw new KernelError({code:"needs", message:"Enable a definition-generating Mod before creating new definitions"});
    }
    for (const [index, effect] of defines.entries()) {
      effect._definition = results[index].definition;
      effect._provenance = results[index].provenance;
    }
  }


  /**
   * A batch of nothing but definitions and adoptions is bookkeeping: adoption enriches gear the
   * investigator already carries, may not name a giver, and the Mod contract forbids it advancing time
   * or moving anything. Every expensive opening batch on record has exactly this shape, and every batch
   * that belongs to the moment being narrated carries clues, cash, handouts or time beside it.
   */
  const bookkeeping = (effect: Record<string, any>): boolean =>
    effect?.kind === "define" || (effect?.kind === "object" && typeof effect?.adopt === "string" && !effect?.from);
  const registrationOnly = (effects: Record<string, any>[]): boolean =>
    effects.length > 0 && effects.every(bookkeeping) && effects.some(effect => effect?.kind === "define")
    // The adoption has to be visible in the same batch. A batch of bare definitions could just as well be
    // about to place its object in the scene, and a definition queued behind that placement would leave the
    // Keeper holding a name the kernel cannot find yet.
    && effects.some(effect => effect?.kind === "object" && typeof effect?.adopt === "string");

  let outstanding: Promise<void> | undefined;

  /**
   * Hand the batch to the kernel as markers so the turn is delivered without waiting, then generate the
   * parameters beside it. Nothing is invented on the Keeper's behalf: the kernel writes real receipts
   * saying the registration is queued, and the audit that reads this turn's receipts is told the truth.
   */
  async function defer(campaign: string, defines: Record<string, any>[], signal?: AbortSignal): Promise<boolean> {
    if (!call) return false;
    const current = call;
    const inputs = defines.map(effect => ({name:effect.name, category:effect.category, description:effect.description, template:effect.template}));
    const handles: {index: number; job: any}[] = [];
    for (const [index, input] of inputs.entries()) {
      const job = await current("mods.job", {campaign, role:"create", input});
      if (!job?.enabled || typeof job.mod !== "string") return false;
      handles.push({index, job});
    }
    for (const {index, job} of handles) {
      defines[index]._queued = job.job;
      defines[index]._provenance = {mod: job.mod, digest: job.digest};
    }
    const work = inputs.map(input => ({...input}));
    const prior = outstanding;
    outstanding = (async () => {
      if (prior) await prior.catch(() => undefined);
      // The signal belongs to the tool call that is about to return, so this work does not take it: a
      // failure here is not lost, it is what `mods.queued` reports as unfinished on the next turn.
      await materialize(campaign, work.map(input => ({kind:"define", ...input})), undefined).catch(() => undefined);
    })();
    return true;
  }

  /**
   * Complete deferred registrations at the top of the next turn, while it is open, through an ordinary
   * apply. One turn late is late; silently unregistered forever is a hole, so an entry whose parameters
   * never arrived is generated here rather than left behind a marker that hides its row from the audit.
   */
  async function resume(campaign: string, signal?: AbortSignal): Promise<void> {
    if (!call) return;
    const current = call;
    if (outstanding) { const pending = outstanding; outstanding = undefined; await pending.catch(() => undefined); }
    let queued = await current("mods.queued", {campaign});
    const unfinished: any[] = Array.isArray(queued?.unfinished) ? queued.unfinished : [];
    if (unfinished.length) {
      for (const input of unfinished) await task(campaign, "create", input, signal).catch(() => undefined);
      queued = await current("mods.queued", {campaign});
    }
    const effects: any[] = Array.isArray(queued?.effects) ? queued.effects : [];
    if (!effects.length) return;
    // The kernel extension owns the call ordinal, so the id is minted there. Inventing one here failed
    // every write verb for the rest of the session, because this runs ahead of all of them.
    const callId = mintCallId?.();
    if (!callId) throw new KernelError({code:"needs", message:"The table cannot mint a call id for deferred registration"});
    try { await current("table.apply", {campaign, call_id: callId, effects}); }
    catch (error) {
      // Bookkeeping must never cost the player their turn. The markers go, the gear reads as unregistered
      // again, and the Keeper registers it the ordinary blocking way on the turn after this one.
      await current("mods.queued", {campaign, discard: true}).catch(() => undefined);
      void emitToPanel("coc-keeper", "mods-progress", {campaign, done: 0, total: 0, deferred_failed: errorText(error)});
    }
  }

  const bridge: ModBridge = {
    async prepare(method, payload, signal) {
      if (["apply", "resolve", "narrate", "ask"].includes(method) && typeof payload.campaign === "string")
        await resume(payload.campaign, signal);
      if (method === "apply") {
        const effects: Record<string, any>[] = payload.effects ?? [];
        const defines = effects.filter((effect: Record<string, any>) => effect?.kind === "define");
        if (defines.length && !(registrationOnly(effects) && await defer(payload.campaign, defines, signal)))
          await materialize(payload.campaign, defines, signal);
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
