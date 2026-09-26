/**
 * The fast model: the one quick model every lane that has to be quick runs on (contract §37.10,
 * §37.10.1, §37.11, §109.3).
 *
 * Product owner's ruling, 2026-09-23: there is no "review model"; this is the fast model, and
 * everything that has to be fast uses it. The storage keys keep their old names (`ext.coc-keeper.laneModel` /
 * `ext.coc-keeper.laneThinking`) so every settings document already written keeps its choice.
 *
 * This module is the one reader of that choice. It is read at the moment a lane runs, never frozen
 * into a spawn environment (§37.10: on 2026-09-14 a setting changed at 06:42 was ignored by a child
 * launched at 06:43 because the session's environment had baked in the 06:30 value). Every lane
 * resolves its model the same way, highest first:
 *
 *   1. the lane's own environment variable -- the operator's override (`PI_COC_MOD_MODEL`,
 *      `PI_COC_VERIFIER_MODEL`, `PI_COC_ADAPTATION_MODEL`, ...);
 *   2. the fast-model setting;
 *   3. the table's own model ("Follow the table", the unchosen row).
 *
 * Its reasoning effort is the operator's variable, then the setting, then `LANE_THINKING_DEFAULT` --
 * never the table's (§37.11).
 *
 * The store is the host's own settings document under the agent home; there is no second copy of
 * the choice to drift from it. Every failure to read it -- no file, half-written JSON, another
 * product's shape, a deployment with no such host (the CLI table) -- is one source fewer and never an
 * error: the lane then runs on what the caller asked for, the behaviour that predates the setting.
 *
 * Plain file reads and no other imports, so any host process can take it: the runtime's task runner,
 * the zero-tool lanes, the kernel extension's own lane calls and the onboarding worker.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The host's settings document, in the agent home. */
export const FAST_MODEL_SETTINGS_FILE = "pipiui-settings.json";
/** Where the host files the COC Keeper extension's settings inside that document. */
const FAST_MODEL_EXTENSION = "coc-keeper";
/** The stored keys. Named before the 2026-09-23 rename and kept, so existing choices survive. */
export const FAST_MODEL_KEY = "ext.coc-keeper.laneModel";
export const FAST_THINKING_KEY = "ext.coc-keeper.laneThinking";

/**
 * The reasoning effort a `mod` child runs at when nobody has chosen one (contract §37.11), and the
 * literal a zero-tool `runLane` lane falls back to only once its own table has nothing to say either
 * (SL-81, contract §12.8.1 addendum, 2026-09-26: `resolveFastThinking`'s `table` argument).
 *
 * Not the table's, for a `mod` child. The table's reasoning effort is a Keeper-quality choice with no
 * relation to a background lane. Before §110 the reviewer had a 40 s wall-clock allowance, so `high` could spend
 * the entire allowance inside one unfinished thinking stream; two campaigns died of exactly this on
 * 2026-09-14 (§37.11). §110 removed that interactive deadline in favour of an hour-scale process safety
 * ceiling, but the efforts remain separate: changing Keeper quality must not silently change lane
 * latency and cost.
 *
 * `low` rather than `off` or `minimal`, on the authorized lane models' own thinking maps rather
 * than on taste: `grok-build/grok-4.6` maps `off` to null, so pi's `clampThinkingLevel` moves a
 * requested `off` *up* to `minimal`; the DeepSeek family maps `minimal` to null and moves that up
 * to `low`. `low` is the one level both support as written, so it is the only one whose meaning
 * does not change when the lane model does -- and a default that means different things on
 * different models is the same wrong coupling in another costume. It is also what the second
 * campaign was recovered with: set to `low`, the next turn settled in 40 s with `narrate` in 20.6 s.
 */
export const LANE_THINKING_DEFAULT = "low";

export interface FastModelChoice {
  /** `provider/model`, as the panel stored it. */
  model?: string;
  thinking?: string;
}

/** The choice held in a parsed host settings document, or nothing for any shape that is not one. */
export function fastModelChoiceOf(document: unknown): FastModelChoice {
  const slot = (document as { extensions?: Record<string, { settings?: unknown }> } | undefined)?.extensions?.[FAST_MODEL_EXTENSION];
  const stored = slot && typeof slot === "object" ? slot.settings : undefined;
  const pick = (key: string, field: string): string | undefined => {
    const value = (stored as Record<string, unknown> | undefined)?.[key] as Record<string, unknown> | undefined;
    const chosen = value && typeof value === "object" ? value[field] : undefined;
    return typeof chosen === "string" && chosen.trim() ? chosen.trim() : undefined;
  };
  const model = pick(FAST_MODEL_KEY, "model");
  const thinking = pick(FAST_THINKING_KEY, "level");
  return { ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}

/** The choice standing right now in `agentHome`, read from disk at the moment of asking. */
export async function readFastModelChoice(agentHome: string): Promise<FastModelChoice> {
  let document: unknown;
  try { document = JSON.parse(await readFile(join(agentHome, FAST_MODEL_SETTINGS_FILE), "utf8")); }
  catch { /* no host settings document, or an unreadable one: the caller's own choice stands */ }
  return fastModelChoiceOf(document);
}

/** The same read, for a caller that has no await to spare (a lane resolving before it starts). */
export function readFastModelChoiceSync(agentHome: string): FastModelChoice {
  let document: unknown;
  try { document = JSON.parse(readFileSync(join(agentHome, FAST_MODEL_SETTINGS_FILE), "utf8")); }
  catch { /* as above */ }
  return fastModelChoiceOf(document);
}

/** Which of the three sources a lane's model came from. `operator` is never outranked downstream. */
export type FastModelSource = "operator" | "setting" | "table";

/**
 * The model a fast lane runs on: the operator's variable, then the setting, then the table's.
 *
 * `override` is the value of the lane's own environment variable, already read by the caller from
 * whichever environment is authoritative for it (the captured runtime context, or the process).
 */
export function resolveFastModel(input: { override?: string; choice: FastModelChoice; table?: string }): { model?: string; source: FastModelSource } {
  const override = input.override?.trim();
  if (override) return { model: override, source: "operator" };
  if (input.choice.model) return { model: input.choice.model, source: "setting" };
  const table = input.table?.trim();
  return { ...(table ? { model: table } : {}), source: "table" };
}

/**
 * The effort a fast lane runs at: the operator's variable, then the setting, then -- for a caller
 * that has one to give -- the table's own level, then the lane's own literal default.
 *
 * `table` is new as of SL-81 (contract §12.8.1 addendum, 2026-09-26) and optional: a `mod` child's
 * effort never inherits the table's by design (§37.11 -- its wall-clock budget has no relation to a
 * Keeper-quality choice), so `runtime/tasks.ts`'s `mod` task and `presentationLaneChoice` still call
 * this with no `table`, and their resolution is unchanged bit for bit. A `runLane` zero-tool lane
 * (`extensions/lanes/subsession.ts`'s `laneThinkingLevel`) does have a table to ask -- the session's
 * own `ctx.thinkingLevel`, read fresh at the moment the lane runs -- and passes it here rather than
 * falling straight to the literal default the way it used to: long gate #13 ran the admission lane
 * at the literal `"low"` on a table sitting at `off` for 100 calls straight, because nothing between
 * the lane and `LANE_THINKING_DEFAULT` ever looked at the table at all.
 */
export function resolveFastThinking(input: { override?: string; choice: FastModelChoice; table?: string }): string {
  return input.override?.trim() || input.choice.thinking || input.table?.trim() || LANE_THINKING_DEFAULT;
}
