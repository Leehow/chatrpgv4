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
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { McpJsonlClient } from "../../lib/runtime.ts";
import {
  getOperationContract,
  loadOperationContracts,
} from "../../lib/operation-contracts.ts";
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

  /**
   * The step this session was last told to work on. Advancing to a new step
   * is what earns an automatic continuation; re-projecting the same step does
   * not, or a failing operation would retry itself forever.
   */
  let projectedStep: string | null = null;

  /** Publish the surface and the instruction for wherever we now stand. */
  const project = (ctx: ExtensionContext): void => {
    const s = state(ctx);
    const step = currentStep(s);
    const advanced = (step?.id ?? null) !== projectedStep;
    projectedStep = step?.id ?? null;
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
    // Steps that are the session's own work continue on their own. Only
    // `ask_player` genuinely needs the player to speak, and `external` waits
    // on something produced outside the table -- making the player type a
    // filler line to unblock work they were not asked for is the friction the
    // old path had in both directions.
    const selfDriven = step.action.kind !== "ask_player" && step.action.kind !== "external";
    // A step that names a method document carries the document, not the path.
    // The session has no `read` tool, so a path would point the Keeper at a
    // file it cannot open -- the same defect as naming a tool it does not have.
    let guide = "";
    if (step.guide !== undefined) {
      try {
        guide = `\n\n${readFileSync(join(s.root, step.guide), "utf8").trim()}`;
      } catch {
        // A missing method document must not pass silently as a step with no
        // method: say so, so the gap is visible instead of looking like
        // freedom the step never had.
        guide = `\n\n（方法文档 ${step.guide} 读不到；不要凭印象代替它，先把这一点告诉玩家。）`;
        audit({ status: "guide_unavailable", step: step.id, guide: step.guide });
      }
    }
    pi.sendMessage({
      customType: "coc-onboarding-step",
      content: `【引导 · ${step.id}】${step.say(s)}${guide}`,
      display: false,
    }, { triggerTurn: advanced && selfDriven });
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
    execute: async (_id: string, params: JsonObject) => {
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
      // `tool_execution_end` projects; doing it here as well would publish the
      // next step from inside the call that is still returning.
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, recorded: true }) }] };
    },
  });

  /**
   * The onboarding tool surface, one row per canonical operation.
   *
   * The outer `campaign` selector is never sent. Every setup operation is
   * `needs_campaign: false` and resolves its own target from `campaign_id`,
   * and sending it is actively wrong twice over: before `create-campaign` it
   * names a directory that does not exist yet, and around a campaign-serial
   * operation that already holds the session lock it deadlocks --
   * `setup.chargen_run` timed out twice under exactly that change.
   *
   * (The receipts these calls journal are handled where they are written, by
   * resolving the campaign the call names; see `_named_campaign_dir` in
   * `coc_toolbox.py`. Routing them through this selector was the wrong fix.)
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

  // Parameters come from the contract archive, the same file the canonical
  // runtime validates against. Neither a hand-copied schema nor an empty one:
  // the first invents a second place for the contract to live, and the second
  // advertises a tool with no parameters at all -- which is what shipped on
  // the first live run, so the model called setup.quick_start six times with
  // `{}` and got the same missing_param back every time.
  const contracts = loadOperationContracts();

  /**
   * The contract's schema minus the transport selector. Onboarding never sends
   * `campaign` -- every setup operation is `needs_campaign: false` and carries
   * its own `campaign_id` -- so offering the field would advertise a parameter
   * that silently does nothing.
   */
  const toolSchema = (operation: string): Record<string, unknown> => {
    const schema = getOperationContract(contracts, operation).inputSchema;
    const properties = schema.properties;
    if (properties === null || typeof properties !== "object") return schema;
    const { campaign: _selector, ...rest } = properties as Record<string, unknown>;
    return { ...schema, properties: rest };
  };

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
      parameters: row.operation === null
        ? { type: "object", additionalProperties: false, properties: {} }
        : toolSchema(row.operation),
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

}
