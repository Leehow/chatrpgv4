/**
 * Onboarding extension: evaluate the step table, and let nothing else through.
 *
 * This session exists to turn a player's choice into a campaign that is
 * `ready_for_table`, and then end. It is deliberately NOT the Keeper host: no
 * phase machine, no projection registry, no play surface. Its only coupling to
 * the play session is the campaign directory it leaves behind.
 *
 * Two rules carry the whole design:
 *
 * 1. Everything about sequencing is derived from `steps.ts` -- the active tool
 *    surface, the instruction, the refusal. On 2026-09-02 the old path failed
 *    six times in one evening; five were a card advertising actions the gate
 *    refused, or an instruction naming a tool the surface lacked.
 * 2. The receipt is not the source of truth; disk is. A tool returns the least
 *    it can, and position is recomputed by reading the campaign directory. A
 *    resumed session therefore lands in the same place.
 */
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { McpJsonlClient } from "../../lib/runtime.ts";
import { readState, type OnboardingState, type PlayerChoice } from "./state.ts";
import { currentStep, activeTools, refusal } from "./steps.ts";

const AUDIT = "coc-onboarding";

type JsonObject = Record<string, unknown>;

const objectOrNull = (value: unknown): JsonObject | null => (
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null
);

/**
 * The player's own answers. Disk cannot supply these before the campaign
 * exists, so they are the one piece of held state -- and they are only ever
 * written by the `onboarding_choose_source` tool, never inferred.
 */
function emptyChoice(): PlayerChoice {
  return {
    starterId: null,
    bundlePath: null,
    sourceTitle: null,
    scenarioId: null,
    playLanguage: "zh-Hans",
  };
}

export default function onboardingExtension(pi: ExtensionAPI, overrides: {
  createClient?: (ctx: ExtensionContext) => McpJsonlClient;
} = {}) {
  const campaignId = (process.env.PI_COC_CAMPAIGN_ID ?? "").trim();
  if (!campaignId) {
    throw new Error("onboarding requires PI_COC_CAMPAIGN_ID");
  }
  let choice = emptyChoice();
  let mcp: McpJsonlClient | null = null;
  const client = (ctx: ExtensionContext) => mcp ??= (
    overrides.createClient?.(ctx)
    ?? new McpJsonlClient(ctx.cwd, ctx.sessionManager.getSessionId(), ctx.mode === "tui")
  );

  const state = (ctx: ExtensionContext): OnboardingState =>
    readState(resolve(ctx.cwd), campaignId, choice);

  const audit = (data: JsonObject): void => {
    try { pi.appendEntry(AUDIT, { schema_version: 1, ...data }); }
    catch { /* audit is best effort */ }
  };

  /** Publish the surface and the instruction for wherever we now stand. */
  const project = (ctx: ExtensionContext): void => {
    const s = state(ctx);
    const step = currentStep(s);
    const tools = [...activeTools(s)];
    try { pi.setActiveTools([...tools, "onboarding_choose_source"]); }
    catch { /* older hosts ignore the surface hint */ }
    audit({
      status: step === null ? "complete" : "step",
      step: step?.id ?? null,
      tools,
      campaign_id: campaignId,
    });
    if (step === null) {
      pi.sendMessage({
        customType: "coc-onboarding-complete",
        content:
          `战役 ${campaignId} 已就绪并完成交接。引导到此结束——`
          + "游玩由另一个会话接手，不要在这里开场叙事。",
        display: true,
      }, { triggerTurn: false });
      return;
    }
    pi.sendMessage({
      customType: "coc-onboarding-step",
      content: `【引导 · ${step.id}】${step.say(s)}`,
      display: false,
    }, { triggerTurn: false });
  };

  /**
   * One tool the table cannot supply: the player's answer to step one.
   * It only records a choice; it writes nothing canonical.
   */
  pi.registerTool({
    name: "onboarding_choose_source",
    label: "Choose source",
    description:
      "Record the player's module choice. Either `starter_id` for the built-in "
      + "starter, or `bundle_path` plus `title` and `scenario_id` for a PDF "
      + "module whose source bundle already exists in the workspace.",
    parameters: {
      type: "object",
      properties: {
        starter_id: { type: "string" },
        bundle_path: { type: "string" },
        title: { type: "string" },
        scenario_id: { type: "string" },
        play_language: { type: "string" },
      },
      additionalProperties: false,
    },
    execute: async (_id: string, params: JsonObject, _a: unknown, _b: unknown, ctx: ExtensionContext) => {
      const starter = typeof params.starter_id === "string" ? params.starter_id.trim() : "";
      const bundle = typeof params.bundle_path === "string" ? params.bundle_path.trim() : "";
      if ((starter === "") === (bundle === "")) {
        return {
          content: [{
            type: "text",
            text: "exactly one of starter_id or bundle_path is required",
          }],
          isError: true,
        };
      }
      choice = {
        starterId: starter || null,
        bundlePath: bundle || null,
        sourceTitle: typeof params.title === "string" && params.title.trim()
          ? params.title.trim() : (starter || null),
        scenarioId: typeof params.scenario_id === "string" && params.scenario_id.trim()
          ? params.scenario_id.trim() : (starter || null),
        playLanguage: typeof params.play_language === "string" && params.play_language.trim()
          ? params.play_language.trim() : "zh-Hans",
      };
      audit({ status: "source_chosen", starter_id: choice.starterId, bundle_path: choice.bundlePath });
      project(ctx);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, recorded: true }) }] };
    },
  });

  /**
   * The onboarding tool surface, one row per canonical operation.
   *
   * Every setup operation is `needs_campaign: false` and carries its own
   * `campaign_id` in the payload, so the outer transport selector is never
   * sent: `create-campaign` runs before the campaign exists, and a selector
   * naming a directory that is not there fails the call before the operation
   * that would create it ever runs.
   *
   * Parameters are passed through unvalidated on purpose. The canonical
   * runtime owns the schema, and a second copy here would be a second place
   * for the contract to live -- which is the defect this rewrite exists to
   * remove. What the model gets back is the envelope's own error, verbatim.
   */
  const SURFACE: ReadonlyArray<{ tool: string; operation: string | null; hint: string }> = [
    { tool: "coc_setup_inspect", operation: "setup.inspect",
      hint: "Inspect campaigns, investigators and built-in starters." },
    { tool: "coc_setup_invoke", operation: "setup.invoke",
      hint: "Run one setup operation kind with its exact payload." },
    { tool: "coc_setup_quick_start", operation: "setup.quick_start",
      hint: "Create a built-in starter campaign." },
    { tool: "coc_setup_adopt_source_facts", operation: "setup.adopt_source_facts",
      hint: "Adopt the six reviewed opening facts." },
    { tool: "coc_setup_investigator_contract", operation: "setup.investigator_contract",
      hint: "Read the ruleset's investigator construction contract." },
    { tool: "coc_setup_chargen_run", operation: "setup.chargen_run",
      hint: "Build, link and render one investigator in one call." },
    { tool: "coc_setup_complete", operation: "setup.complete",
      hint: "Hand the finished campaign off to the play session." },
    { tool: "coc_capabilities", operation: null,
      hint: "Read host capabilities, including subagent task text." },
  ];

  const call = async (
    ctx: ExtensionContext,
    row: { tool: string; operation: string | null },
    args: JsonObject,
    signal: AbortSignal | undefined,
  ): Promise<JsonObject> => {
    const response = row.operation === null
      ? await client(ctx).callTool("coc_capabilities", args, signal)
      : await client(ctx).callTool("coc_invoke", {
          operation: row.operation,
          arguments: args,
        }, signal);
    const envelope = objectOrNull(response);
    if (envelope === null) {
      return { ok: false, tool: row.tool, error: { code: "no_envelope", message: "empty transport response" } };
    }
    return envelope;
  };

  for (const row of SURFACE) {
    pi.registerTool({
      name: row.tool,
      label: row.tool,
      description: `${row.hint} Canonical operation \`${row.operation ?? row.tool}\`; the result envelope is authoritative.`,
      parameters: { type: "object", additionalProperties: true, properties: {} },
      execute: async (
        _id: string,
        params: JsonObject,
        signal: AbortSignal | undefined,
        _update: unknown,
        ctx: ExtensionContext,
      ) => {
        const envelope = await call(ctx, row, params ?? {}, signal);
        // Position is recomputed from disk after every call, so a receipt the
        // model would have to remember is a receipt that can disagree with the
        // campaign directory.
        return {
          content: [{ type: "text", text: JSON.stringify(envelope) }],
          isError: envelope.ok !== true,
        };
      },
    });
  }

  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => { project(ctx); });

  // `tool_call` is the only hook that can block; `tool_execution_start` has no
  // result type and cannot refuse anything. The surface hint from
  // setActiveTools is advice to the model, not enforcement -- this is the gate.
  pi.on("tool_call", (event: unknown, ctx: ExtensionContext) => {
    const name = String(objectOrNull(event)?.toolName ?? "");
    if (name === "" || name === "onboarding_choose_source") return undefined;
    const s = state(ctx);
    if (new Set(activeTools(s)).has(name)) return undefined;
    // Refusal text comes from the table, so it cannot drift from the surface.
    audit({ status: "off_step", attempted: name, step: currentStep(s)?.id ?? null });
    return { block: true, reason: refusal(s, name) };
  });

  pi.on("tool_execution_end", (_event: unknown, ctx: ExtensionContext) => { project(ctx); });

  return { invoke, project, state };
}
