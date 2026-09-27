/**
 * The NPC's act, written before anything is bound to it (contract §143.2; docs/specs/npc-acts-first.md D2, ticket 02).
 *
 * The owner's ruling of 2026-09-26: a model first writes what this person does right now, one sentence in the table's
 * play language, from the situation the kernel assembles for them (`npc.situation`, §143.1); only then does the host bind
 * that sentence to something it can settle (§143.3). This module is the first half and nothing else. It writes an act,
 * never a parameter (§135.28 stands), and it does not decide when it runs (§143.3) or whether the act repeats one
 * already made (§143.4).
 *
 * Shape: one zero-tool completion through the session's model registry (`runLane`), the shape of the admission lane
 * (§32) and the voice check (§40), on the lane's own model variable `PI_COC_NPC_ACT_MODEL`, then the fast-model setting,
 * then the table (`resolveLaneModel`). The system prompt is the authored instruction `content/setup/npc-act.md`, whole;
 * no wording about what a person should do lives in code. The input is the situation packet, whole, beside the play
 * language: the packet is already the kernel's bounded projection, so there is no second whitelist here to drop a field
 * the kernel added.
 *
 * The answer is checked for structure only -- `{act, produces?}`: `act` a non-empty string on one line of at most 200
 * characters; `produces` (§143.19, spec D10) the one thing the act brings out that no one knew this person had, a
 * non-empty string on one line of at most 60 characters, taken only when the packet's stakes die allowed a surprise
 * (`stakes.surprise === true`) -- otherwise it is dropped, said on the row (`produces_dropped`), and never retried.
 * Whether it is one sentence, in the play language, and something a person would do belongs to the instruction and the
 * model (Agents.md: no prose classifiers). A structurally bad answer is asked for once more, with the reason; then the
 * generation is unavailable. One deadline (`npc_act.timeout_ms`, `host-budgets.json`) covers both attempts.
 *
 * `generate` never throws. Every outcome is `{act}` or `{unavailable: reason}` from a closed set, and every call writes
 * exactly one `lane: "npc-act"` telemetry row through the shared lane writer (plus the lane-call rows of §12.8.1).
 */
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runLane} from '../../extensions/lanes/subsession.ts';
import {createLaneTelemetry} from '../../extensions/lanes/telemetry.ts';
import {extensionContentRoot} from '../../extensions/ui/words.ts';
import {npcActBudget} from './host-budgets.ts';
import type {ProviderUsage, TaskProviderBudget} from './provider-budget.ts';

/** The lane's name on every row it writes, and in its outage notice. */
export const NPC_ACT_LANE = 'npc-act';
/** The operator's variable naming this lane's model (then the fast-model setting, then the table). */
export const NPC_ACT_MODEL_ENV = 'PI_COC_NPC_ACT_MODEL';
/** The act's bound, in characters (code points), as the instruction states it. */
export const NPC_ACT_MAX_CHARS = 200;
/** §143.19: the bound of `produces`, the thing an act brings out, in characters (code points). */
export const NPC_PRODUCES_MAX_CHARS = 60;
/** Two attempts is one retry, and only for an answer of the wrong shape. */
const MAX_ATTEMPTS = 2;

/**
 * Why no act came back. Closed: `runLane`'s four failures, `cancelled` when the caller's own signal ended the
 * generation, and `lane_error` for the host's side (the instruction could not be read, the input could not be built).
 */
export type NpcActUnavailable = 'model_unavailable' | 'model_error' | 'bad_output' | 'timeout' | 'cancelled' | 'lane_error';

/**
 * The situation packet of §143.1 (`npc.situation {campaign, name}`), as ticket 01 returns it. The generation sends it
 * whole; this type names only what the host itself reads (`npc`, for the telemetry row) and documents the rest.
 */
export interface NpcSituation {
  npc: {handle: string; name: string};
  /** A subset of `npcPerspective.view`, shapes unchanged. */
  who: {personality?: unknown; goals?: unknown; fears?: unknown; commitments?: unknown; relationships?: unknown};
  /** Short code-composed sentences: what was done or said to this person this turn and the last. */
  happened: string[];
  state: {hp: number | null; hp_max: number | null; conditions: string[]; stance: string | null; in_session: boolean; my_turn: boolean};
  /**
   * §143.29: `brought_out`, present only when there is something, is what an earlier act of theirs brought out that they
   * still hold -- the name `holdings` gives it, the turn it came out, and that act's row `ref` and `status` when the act
   * named one.
   */
  at_hand: {holdings: string[]; objects: string[]; exits: string[]; present: string[];
    brought_out?: Array<{name: string; turn: number | null; ref?: string; status?: string}>};
  /** `intentsView(entry)`, newest first. */
  done: Array<Record<string, unknown>>;
  recent_speech: string[];
  constraints: string[];
  truncated: string[];
  /** §143.8 / §143.19: this turn's stakes die for them, or null. `surprise` lets the act bring out one unknown thing. */
  stakes?: {rung: string | null; outcome: string | null; line: string | null; surprise?: boolean; surprise_line?: string | null} | null;
  [extra: string]: unknown;
}

/**
 * §143.19: whether this situation lets the act bring out something no one knew this person had -- the stakes die of
 * §143.8 said `surprise` for them this turn. Structure only; absent stakes is no surprise. The one gate of `produces`,
 * shared by the lane (which drops it and says so on its row) and the act step (which binds nothing the gate refused, so
 * a port that answers verbatim, like the fixture, is held to it too).
 */
export function mayProduce(packet: unknown): boolean {
  const stakes = (packet as {stakes?: unknown} | null | undefined)?.stakes;
  return !!stakes && typeof stakes === 'object' && (stakes as {surprise?: unknown}).surprise === true;
}

export interface NpcActInput {
  packet: NpcSituation;
  /** The campaign's play language tag, by shape only; the act is written in it. */
  play_language: string;
  /** The run's provider budget, when the caller has one: the completion reserves and settles against it (§20). */
  providerBudget?: TaskProviderBudget;
}

/** What the product lane adds to an outcome; a fixture answers the bare `{act}` / `{unavailable}`. */
export interface NpcActMeta {
  ms?: number;
  model?: string;
  attempts?: number;
  /** The answered attempt's provider usage, for the run's budget summary. */
  usage?: ProviderUsage;
  detail?: string;
  /** §143.19: the answer named something it brings out without a surprise to allow it, and it was dropped. */
  producesDropped?: boolean;
}

export type NpcActResult = ({act: string; produces?: string} | {unavailable: NpcActUnavailable}) & NpcActMeta;

export interface NpcActPort {
  generate(input: NpcActInput, signal: AbortSignal): Promise<NpcActResult>;
}

export type CheckedAct = {ok: true; act: string; produces?: string; producesDropped?: boolean} | {ok: false; why: string};

/** One line of at most `limit` characters (code points), non-empty after trimming; the reason when it is not. */
function oneLine(field: string, raw: string, limit: number): {ok: true; value: string} | {ok: false; why: string} {
  const value = raw.trim();
  if (!value) return {ok: false, why: `"${field}" is empty`};
  // Line-break characters, not a reading of the text.
  if (/[\r\n\u2028\u2029]/.test(value)) return {ok: false, why: `"${field}" spans more than one line`};
  const length = [...value].length;
  if (length > limit) return {ok: false, why: `"${field}" is ${length} characters; the limit is ${limit}`};
  return {ok: true, value};
}

/**
 * Structure only: an object whose `act` is a non-empty string, on one line, of at most 200 characters; and `produces`
 * (§143.19), when the answer names one and a surprise allows it (`mayProduce`), a non-empty string on one line of at
 * most 60 characters. `produces` absent, null or blank is no `produces`. Present without a surprise to allow it, it is
 * dropped whatever its shape (`producesDropped`): the act stands, nothing is asked again.
 */
export function checkAct(parsed: unknown, allowProduces = false): CheckedAct {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {ok: false, why: 'the answer is not a JSON object'};
  const raw = (parsed as {act?: unknown}).act;
  if (typeof raw !== 'string') return {ok: false, why: 'the object has no string "act"'};
  const act = oneLine('act', raw, NPC_ACT_MAX_CHARS);
  if (!act.ok) return act;
  const named = (parsed as {produces?: unknown}).produces;
  if (named === undefined || named === null || typeof named === 'string' && !named.trim()) return {ok: true, act: act.value};
  if (!allowProduces) return {ok: true, act: act.value, producesDropped: true};
  if (typeof named !== 'string') return {ok: false, why: '"produces" is not a string'};
  const produces = oneLine('produces', named, NPC_PRODUCES_MAX_CHARS);
  return produces.ok ? {ok: true, act: act.value, produces: produces.value} : produces;
}

const instructions = new Map<string, Promise<string>>();

/** The authored instruction, read once per content root; a failed read is not cached. */
export function npcActInstruction(contentRoot?: string): Promise<string> {
  const path = join(contentRoot ?? extensionContentRoot(), 'setup', 'npc-act.md');
  let pending = instructions.get(path);
  if (!pending) {
    pending = readFile(path, 'utf8');
    instructions.set(path, pending);
    pending.catch(() => { instructions.delete(path); });
  }
  return pending;
}

export interface NpcActLaneOptions {
  /** The session context, read at every call: a session may be replaced, and a stale context throws. */
  ctx: () => ExtensionContext | undefined;
  /** The campaign the rows belong to, read at every call. With none, the call still runs and writes no row. */
  campaign: () => string | undefined;
  /** Overrides `npc_act.timeout_ms`. Tests only. */
  timeoutMs?: number;
  /** Overrides the content root the instruction and the budget are read from. Tests only. */
  contentRoot?: string;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

/**
 * §143.21 (ticket 22): the play language's English name, beside its tag in the lane's input. The runtime names it
 * (`Intl.DisplayNames`, the one source of language names Agents.md allows -- no table, no branch on a tag); a tag the
 * runtime cannot name, or names only by repeating it, adds nothing. Why: the situation is the host's English, so a packet
 * with no player words in it (the opening; a person the declaration was not said to) gave the model nothing but a bare
 * tag to write in -- live table B's opening act came back in English at a zh-Hans table.
 */
export function playLanguageName(tag: string): string | undefined {
  try {
    const name = new Intl.DisplayNames(['en'], {type: 'language'}).of(tag);
    return name && name !== tag ? name : undefined;
  } catch {
    return undefined;
  }
}

/** The lane's input: the play language (tag, and its name when the runtime has one) and the packet, whole (§143.2). */
export function npcActLaneInput(input: Pick<NpcActInput, 'packet' | 'play_language'>): string {
  const name = typeof input.play_language === 'string' ? playLanguageName(input.play_language) : undefined;
  return JSON.stringify({play_language: input.play_language, ...(name ? {play_language_name: name} : {}), situation: input.packet});
}

/** The product port: one zero-tool completion per attempt, through the session's model registry. */
export function createNpcActLane(pi: ExtensionAPI, options: NpcActLaneOptions): NpcActPort {
  const safeCtx = (): ExtensionContext | undefined => {
    try { return options.ctx(); } catch { return undefined; }
  };
  const telemetry = createLaneTelemetry(pi, {lane: NPC_ACT_LANE, modelEnv: NPC_ACT_MODEL_ENV, cwd: () => safeCtx()?.cwd});

  return {
    async generate(input: NpcActInput, signal: AbortSignal): Promise<NpcActResult> {
      const began = Date.now();
      let campaign: string | undefined;
      try { campaign = text(options.campaign()); } catch { campaign = undefined; }
      const npc = text(input?.packet?.npc?.handle) ?? text(input?.packet?.npc?.name) ?? null;
      const record = async (row: Record<string, unknown>): Promise<void> => {
        if (!campaign) return;
        try { await telemetry.record(campaign, row); } catch { /* telemetry never breaks the generation */ }
      };
      // One outcome row per call, whatever the outcome.
      const finish = async (result: NpcActResult): Promise<NpcActResult> => {
        const unavailable = 'unavailable' in result ? result.unavailable : undefined;
        const produced = 'act' in result && result.produces !== undefined ? {produces: result.produces} : {};
        await record({npc, ok: !unavailable, ms: result.ms, model: result.model ?? null, attempts: result.attempts ?? 0,
          ...(unavailable ? {reason: unavailable} : {act: (result as {act: string}).act, ...produced}),
          ...(result.producesDropped ? {produces_dropped: true} : {}),
          ...(result.detail ? {detail: result.detail.slice(0, 200)} : {}),
          ...(result.usage ? {usage: result.usage} : {})});
        return result;
      };
      const failed = (reason: NpcActUnavailable, detail: string, extra: NpcActMeta = {}): Promise<NpcActResult> =>
        finish({unavailable: signal?.aborted ? 'cancelled' : reason, ms: Date.now() - began, detail, ...extra});
      try {
        if (signal?.aborted) return await failed('cancelled', 'the caller cancelled before the generation began');
        const ctx = safeCtx();
        if (!ctx) return await failed('model_unavailable', 'no session context to run the lane in');
        let systemPrompt: string, situation: string;
        try {
          if (!input.packet || typeof input.packet !== 'object') throw new Error('there is no situation packet');
          systemPrompt = await npcActInstruction(options.contentRoot);
          situation = npcActLaneInput(input);
        } catch (error) {
          return await failed('lane_error', `the generation could not be prepared: ${error instanceof Error ? error.message : String(error)}`);
        }
        const total = options.timeoutMs ?? (await npcActBudget(options.contentRoot)).timeoutMs;
        const allowProduces = mayProduce(input.packet);
        const deadline = began + total;
        let refusal: string | undefined, why: string | undefined, model: string | undefined;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const left = deadline - Date.now();
          if (left <= 0) return await failed('timeout', `no act within the ${total} ms deadline: none was left for another attempt`, {attempts: attempt - 1, ...(model ? {model} : {})});
          why = undefined;
          const lane = await runLane<{act: string; produces?: string; producesDropped?: boolean}>({
            ctx, envName: NPC_ACT_MODEL_ENV, lane: NPC_ACT_LANE, record, signal, timeoutMs: left,
            ...(input.providerBudget ? {providerBudget: input.providerBudget} : {}),
            systemPrompt,
            input: refusal ? `${situation}\n\nYour previous answer was refused: ${refusal}. Answer again with the JSON object only.` : situation,
            shape: parsed => {
              const checked = checkAct(parsed, allowProduces);
              if (checked.ok) return {act: checked.act, ...(checked.produces !== undefined ? {produces: checked.produces} : {}),
                ...(checked.producesDropped ? {producesDropped: true} : {})};
              why = checked.why;
              return undefined;
            },
          });
          model = lane.model ?? model;
          if (lane.ok) return await finish({act: lane.value.act, ...(lane.value.produces !== undefined ? {produces: lane.value.produces} : {}),
            ...(lane.value.producesDropped ? {producesDropped: true} : {}), ms: Date.now() - began, model: lane.model, attempts: attempt,
            ...(lane.usage ? {usage: lane.usage} : {})});
          // The deadline is read off this call's own clock, not off the lane's reason: `runLane`'s own budget lease ends
          // at the same moment as its timer, and a round that lease cut comes back as `model_error`, not `timeout`.
          const expired = !signal?.aborted && Date.now() >= deadline;
          const reason = lane.reason === 'timeout' || expired ? 'timeout' : lane.reason;
          const detail = reason === 'timeout' ? `no act within the ${total} ms deadline: ${lane.detail}` : why ? `${lane.detail}: ${why}` : lane.detail;
          if (reason !== 'bad_output' || attempt === MAX_ATTEMPTS)
            return await failed(reason, detail, {attempts: attempt, ...(model ? {model} : {})});
          refusal = detail;
        }
        return await failed('bad_output', 'no attempt answered', {attempts: MAX_ATTEMPTS});
      } catch (error) {
        return failed('lane_error', error instanceof Error ? error.message : String(error));
      }
    },
  };
}

/** A fixture answer: the act alone, the act with what it brings out (§143.19), or an unavailable reason. */
export type NpcActFixtureAnswer = string | {act: string; produces?: string} | {unavailable: NpcActUnavailable};

export interface NpcActFixture extends NpcActPort {
  /** Every input the fixture was asked with, in order: what a re-ask added to the packet is read here. */
  readonly calls: ReadonlyArray<NpcActInput>;
}

/**
 * The test double the loop tests drive (the spec's acceptance section: the generator is a fixture port in contract tests). The table is keyed
 * by the packet's `npc.handle`, then `npc.name`, then `"*"`. A list answers that key's successive calls in order and
 * repeats its last entry. The act comes back verbatim, `produces` too, whatever the stakes: the fixture stands for the
 * model, not for the lane's shape check (the act step holds its answer to `mayProduce` all the same).
 * No entry answers `model_unavailable`, naming the person; an aborted signal answers `cancelled`.
 */
export function createFixtureNpcActPort(table: Readonly<Record<string, NpcActFixtureAnswer | readonly NpcActFixtureAnswer[]>>): NpcActFixture {
  const calls: NpcActInput[] = [];
  const served = new Map<string, number>();
  return {
    calls,
    async generate(input: NpcActInput, signal: AbortSignal): Promise<NpcActResult> {
      calls.push(input);
      if (signal?.aborted) return {unavailable: 'cancelled'};
      const handle = input?.packet?.npc?.handle, name = input?.packet?.npc?.name;
      const key = [handle, name, '*'].find((candidate): candidate is string => typeof candidate === 'string' && Object.hasOwn(table, candidate));
      if (!key) return {unavailable: 'model_unavailable', detail: `the fixture has no answer for ${handle ?? name ?? 'this person'}`};
      const entry = table[key]!;
      const count = served.get(key) ?? 0;
      served.set(key, count + 1);
      const answer = Array.isArray(entry) ? entry[Math.min(count, entry.length - 1)] : entry as NpcActFixtureAnswer;
      if (answer === undefined) return {unavailable: 'model_unavailable', detail: `the fixture's list for ${key} is empty`};
      if (typeof answer === 'string') return {act: answer};
      return 'unavailable' in answer ? {unavailable: answer.unavailable} : {act: answer.act, ...(answer.produces !== undefined ? {produces: answer.produces} : {})};
    },
  };
}
