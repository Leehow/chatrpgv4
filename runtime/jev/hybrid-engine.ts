import type {PrescreenSourceRuntime} from './prescreen-source-provider.ts';
import {attackPreparationNeeds} from './attack-preparation.ts';
import {historyConfigured, historyEnabled, historyNeedQuestion, historyNeed, isSavedHistoryRead, historyFinalAnswerPayload, HISTORY_OFFER, HISTORY_LOCAL_OFFER, HISTORY_CLOSED} from '../historical-reference.ts';
/**
 * The product side of `PI_COC_LOOP_ENGINE=hybrid-v1`: the policy and the ports Pi's RunDriver (vendored
 * agent-core, ADR-0006) drives each player input with. Pi knows nothing of what is here. Contract §135.
 *
 * - policy: `createStepPolicy` over the prototype's `next` (runtime/jev/step-policy.ts); its Jev budget is for the
 *   run's decisions (24 calls and the allowance's milliseconds). The prescreen has its own per-input allowance
 *   (`readJevPreselectAllowanceMs`) and spends none of the decision budget (§135.6, SL-22 addendum);
 * - read: the run's first step and the step after every scene change. Read-only kernel reads (`table.capsule`,
 *   `table.status`, `table.apply.options`, `table.resolve.options`), the product prescreen
 *   (`prepareKeeperSupport`: semantic locate + bounded reads) run as a policy-origin read inside the run, and the
 *   host-issued candidates built from those reads (`runtime/jev/candidates.ts`). It publishes nothing; the packet
 *   it prepared reaches the Keeper's request through the context hook (`coc:run-prescreen`), which on this engine
 *   runs no prescreen of its own;
 * - decision: the product's Jev `DecisionPort` for route and closed-bind questions, the ordinary-check binder
 *   (`prepareCheckPreflight`) for the ordinary check, under leases bound to the run's signal; every answer's
 *   distribution is a `lane: "route"` telemetry row. Without a Jev key there is no decision port and every decide
 *   degrades to the Keeper inside the same engine;
 * - operations: the model's own tool calls through Pi's tool pipeline, run as the Keeper's batch (in order;
 *   a step that fails returns the rest of the batch to the Keeper); a policy-origin write (the clerk's) through the
 *   kernel extension's canonical operation gateway (`coc:operation-dispatcher`): the same Keeper verb, the same
 *   `tool_call` gates, action admission, Mod hooks, kernel call and `tool_result` hooks, with the call id minted by
 *   the kernel extension's one ordinal. Only a candidate with clerk authority is run; a committed `narrate`/`ask`
 *   is the delivery, and the clerk never writes one;
 * - projection: before each model step, one `coc-clerk` message: what the clerk did this turn (committed, with
 *   receipts, the kernel row each came from and any rules default it took, §135.28), the operation the clerk could not
 *   bind and left to the Keeper (`left_to_you`), or the batch step that returned to it, and what the run has read that
 *   the Keeper would otherwise `look` for (§135.31: the scene it moved into, the people its steps name, the session);
 * - record: every run/step event as a `lane: "run"` telemetry row of the campaign;
 * - turn close (§135.11): before a run with no delivery evidence finishes, the policy's `turn_close` operation asks the
 *   kernel extension's turn-close port (`coc:turn-close`) what the turn close did. A delivery this run committed (the
 *   implicit narrate of a prose-only reply) is the run's evidence; a steer legacy's `agent_end` would send is prepended
 *   to one more model step of the same run, as the same `coc-host` message.
 */
import type { RunDriverPorts, RunEvent } from '@earendil-works/pi-agent-core';
import type { SessionRunDriver } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { createDecisionAdapter, jevFailureTelemetry } from './decision-adapter.ts';
import type { DecisionPort as JevDecisionPort } from './decision-port.ts';
import { ContractError, type DecisionBatch, type DecisionResult, type IntentBinding, type Json, type ObservationPacket, type OperationProposal, type ReadSet, type ScopeBinding } from './contracts.ts';
import { TaskLease, type TaskClock } from './task-context.ts';
import { JEV_MODEL } from './question-packing.ts';
import { preparationProviderBudget } from './preparation-budget.ts';
import { prepareCheckPreflight } from './check-preflight.ts';
import {checkAttemptIdentity, selectCheck, validateCheckOptions, withinCheckLease, type CheckSelection} from './resolve-selection.ts';
import {interactionScopeBatch, interpretInteractionScope, permitsReferenceOperation, REFERENCE_SCOPE_NOTE, type InteractionScope} from './interaction-scope.ts';
import {DECIDED_UNDER_UNCERTAINTY_NOTE, forcedResolution, type ForcedResolution} from './forced-resolution.ts';
import { bindingOf, CLERK_TYPE, customMessage, PRESCREEN_TYPE, type ContextBinding } from '../../extensions/table/context-policy.ts';
import { prepareKeeperSupport, prescreenEnabled } from '../../extensions/table/prescreen.ts';
import { readJevApiKey, readJevPreselectAllowanceMs } from '../../extensions/jev/agent/config.js';
import type { HostOperationContext, OperationIdentity } from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import { buildCandidates, buildConsequenceCandidates, keeperCall, NPC_REACTION_DECISION, type BandReads, type ConsequenceCandidate, type ConsequenceClass } from './candidates.ts';
import { compileRows } from './compile-rows.ts';
import { actGated, interpretCompile, interpretReask, unlockedRow, type FeatureRows, type GuardedDestination, type ReaskInput } from './route-compile.ts';
import { candidateWithConsequenceBasis, CONSEQUENCE_FAMILY, consequenceBatch, interpretConsequenceResult, type ConsequenceExistsRow, type ConsequenceRow, type ConsequenceView } from './consequence-route.ts';
import { firstStepThinkingBudget, jevStepsBudget, narratorOnlyBudget, npcActBudget, thresholdsForClass } from './host-budgets.ts';
import { catalogRefusal, NARRATOR_NOTE, narratorOnlySetting, offeredForPropose, offeredView, PROPOSE_NOTE, PROPOSE_PENDING_REFUSAL, PROPOSE_TOOL, PROPOSE_VERB,
  proposedCandidate, proposeQueuedText, proposeRefusal, stepCatalog, type NarratorOnlySetting, type StepCatalog } from './narrator-catalog.ts';
import { firstStepCallCapMs, firstStepThinkingEnabled } from '../../extensions/kernel/first-step-thinking.ts';
import { createNpcActLane, type NpcActPort } from './npc-act.ts';
import { isNpcAct, runNpcAct, runNpcScan, struckReceipts, type NpcActDeps, type NpcActOutcome } from './npc-act-step.ts';
import { SHADOW_FIELDS, type DamageBandRow, type TimeBandRow } from './band-shadow-domain.ts';
import { readBandRows } from '../../extensions/kernel/band-shadow.ts';
import { bandMinConfidence } from '../../extensions/kernel/band-recovery.ts';
import { obligationClerkLine, obligationCrossing } from './obligation-candidates.ts';
import { issuedSection, readCandidateBodies, type CandidateBodies } from './candidate-bodies.ts';
import { IMPROVISATION_GUIDANCE, CARRIED_VIEW_BYTES, carriedSection, fitView, namedPeople, readCarriedViews, scenePassages, type PassageSource } from './carried-views.ts';
import {
  CLERK_AUTHORITY, createStepPolicy, DEFAULT_CONFIDENCE_GATE, DEFAULT_TURN_BUDGET_MS, exhausted, interpretRoute, missedUnlocks, npcScanDue, overRun, PROPOSED_REASON, ROUTE_FAMILY,
  type BindRecord, type Budget, type Candidate, type DeferredStep, type Material, type RunView, type StepArtifact, type StepPolicyState, type TurnContext,
} from './step-policy.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

/**
 * §135.11.2 (SL-50 stage 2): the head line of the run's first `coc-clerk` note -- writes are silent, stated once per run
 * where the model reads it beside the carried views right before its step. The capsule's own sentence stays (§135.11.1).
 * §135.5 addendum (SL-88, "what needs no result does not wait"): names which calls are blocking and which are not, so a
 * non-blocking apply goes out with its narrate in one call instead of costing a whole extra model step. Keeper-only,
 * system language.
 */
export const CLERK_NOTE_HEAD = IMPROVISATION_GUIDANCE+' Use apply move with establish:{summary} and via for a new place, apply clue with establish:{summary} and how for new evidence, and apply npc walk_on for a newcomer. On compose steps, write the final response from supplied source and committed receipts. Do not repeat supplied lookups, restage recorded people, or add optional bookkeeping just to fill fields. Genuine unresolved requirements retain their ordinary operations. '
  + 'Check selection belongs to Jev and the host. Never call resolve or choose a check, including after an unavailable decision, ambiguous binding, refused operation or spent budget. '
  + 'A check the host left without a roll (decided_under_uncertainty) is narrated by your own judgement; never stage it as pending or ask the player to repeat it. '
  + 'Writes are silent: write no prose beside apply, resolve or lookup calls (it is dropped and never shown). '
  + 'An apply whose landing is fixed by its own arguments is non-blocking: put it and the narrate that follows in the same response, '
  + 'writes first, narrate last; resolve, look, lookup and recall are blocking -- the prose needs a result you do not have yet -- so '
  + 'wait for their result before you narrate.';
/**
 * §135.30.6 (SL-40): what the Keeper is told with a held destination. The guard is a pacing condition: the place and its
 * entrance exist (the guard's `exists`), so the Keeper narrates the entrance as the book has it and what is missing, never
 * the place or the way as absent. Keeper-only, system language.
 */
export const GUARDED_NOTE = 'The player\'s declaration goes to this place. The book\'s own condition (guard) holds the way now, so nothing '
  + 'was executed for it. The guard is a pacing condition, not a wall: the place and its entrance exist (guard.exists, from the scene '
  + 'it names). Narrate the entrance as the book has it (entrance.passages, where given) and what is missing -- the guard\'s unlock '
  + 'and where the book puts it -- and never the place or its way as absent (no blank wall, no missing stairs). Play toward the '
  + 'unlock, or open the way with your own write when the fiction does.';
/**
 * §135.30.6 (SL-40): a held destination with what this run's prescreen located about it (§135.31.1's passages for its
 * handle: the book's passages of a read made there, its own entity and every entity naming its handle, such as the scene
 * whose edge leads there), fitted to one carried view's ceiling; unchanged where nothing was located. Nothing is read.
 */
export function withEntrance(entry: GuardedDestination, passages: readonly PassageSource[]): GuardedDestination {
  const view = scenePassages(passages, entry.to);
  if (!view) return entry;
  const fitted = fitView(view, CARRIED_VIEW_BYTES);
  return {...entry, entrance: {passages: fitted.view, ...(fitted.truncated ? {truncated: true, omitted_fields: fitted.omitted_fields ?? []} : {})} as Json};
}

/**
 * §11.5.4 (SL-51): the source text among carried views, as `{scene, page, label, text}` rows: every page of a `scene_text`
 * view that went (its key names the page; the text is what went, cut or whole), and every entry of a `source` view with a
 * string `content` (§135.31.1's book passages; its graph-entity units are the graph's own words). Structure only.
 */
export function carriedPassages(views: ReadonlyArray<{focus: string; name?: string; view: Row}>,
  sceneTexts: ReadonlyArray<{scene: string; person?: string; pages: Array<{page: number; pdf_label?: string; text: string}>}> = []): Row[] {
  const out: Row[] = [];
  for (const entry of views) {
    // §22.4.7.1 (SL-56): a person's text is carried text too; its rows keep the focus the reading reads as their scene.
    if (entry.focus === 'scene_text' || entry.focus === 'person_text') {
      const text = entry.focus === 'person_text' ? sceneTexts.find(value => value.person === entry.name) : sceneTexts.find(value => !value.person && value.scene === entry.name);
      for (const page of text?.pages ?? []) {
        const key = `page ${page.page}${page.pdf_label ? ` (${page.pdf_label})` : ''}`;
        if (typeof entry.view[key] === 'string') out.push({scene: entry.focus === 'person_text' ? null : entry.name ?? null, page: page.page, label: page.pdf_label ?? null, text: entry.view[key]});
      }
    } else if (entry.focus === 'source') {
      for (const [label, value] of Object.entries(entry.view)) {
        const content = object(value).content;
        if (typeof content !== 'string' || !content.trim()) continue;
        const page = object(object(value).provenance).page;
        out.push({scene: entry.name ?? null, page: Number.isSafeInteger(page) ? page : null, label, text: content});
      }
    }
  }
  return out;
}

/** The kernel extension's bus payload (`coc:kernel-bridge`, contract §12.8). */
export interface KernelBridge {
  moduleId?: string;
  runtime?: PrescreenSourceRuntime;
  campaign?: string;
  call?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  record?: (row: Record<string, unknown>) => void;
}
/** The kernel extension's turn-close port (`coc:turn-close`, contract §135.11). */
export interface TurnClosePort {
  campaign?: string;
  verdict(): Record<string, unknown> | Promise<Record<string, unknown>>;
}
/** The kernel extension's consultation port (`coc:source-answers`, contract §135.31.2): what went pending, what landed since. */
export interface SourceAnswersPort {
  campaign?: string;
  /** §135.20.1 (SL-102): `scene` is where the run is (held answers of another scene are dropped), `run` the run taking. */
  take(at?: {scene?: string; run?: string}): {pending: Array<{focus: string; question: string; since_turn: number; purpose?: string; scene?: string; person?: string}>;
    landed: Array<{focus: string; question: string; since_turn: number; answer?: Row; unavailable?: string}>;
    /** §135.20.1: the answers held at `scene` that this run's request does not hold yet, newest first. */
    held?: Array<{focus: string; question: string; since_turn: number; answer: Row}>;
    /** §135.20.1: landed answers not carried because the Keeper's own lookup returned them in this run. */
    handed?: Array<{focus: string; since_turn: number}>;
    /** §22.4.7 / §22.4.7.1: the book's text of a scene or person landed on it, once. */
    texts?: Array<{scene: string; person?: string; pages: Array<{page: number; pdf_label?: string; text: string}>}>;
    /** §22.4.7 / §22.4.7.1 / §22.3.3: a scene's or person's record that settled, once. */
    records?: Array<{scene: string; since_turn: number; person?: string; unavailable?: string; unusable?: string}>};
  /**
   * §135.20.1 (SL-102): at the run's first model step, wait for the consultations asked at `scene` on an earlier turn that are
   * still being read, for what is left of one allowance after `elapsed_ms` (the run's time so far).
   */
  settle?(input: {scene: string; turn: number; elapsed_ms: number}): Promise<{foci: string[]; waited_ms: number; bound_ms: number; landed: number; pending: number}>;
}
/** The kernel extension's canonical operation gateway (`coc:operation-dispatcher`). */
export interface OperationGateway {
  dispatch(proposal: OperationProposal, context: HostOperationContext): Promise<ObservationPacket>;
}

export interface HybridEngineOptions {
  /** A trusted caller can supply an already determined input scope; the ordinary launcher never does. */
  interactionScope?: InteractionScope;
  env: Readonly<NodeJS.ProcessEnv>;
  /** Jev's decision port; defaults to the product adapter when a Jev key is configured, none otherwise. */
  decision?: JevDecisionPort | null;
  /** Telemetry sink for run events; defaults to the kernel bridge's campaign telemetry. */
  record?: (row: Record<string, unknown>) => void;
  maxSteps?: number;
  /** The run's clock (§135.25); tests pass a stub. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * SL-87: the clock of the run's steps and its Jev work -- the step timings the decision budget sums, each read's
   * prescreen allowance (its deadline, timeouts and leases) and the decision leases -- for a test whose subject is that
   * wall-clock budget. `now` defaults to it. Absent: the host's real clock and timers, exactly as before. The clerk's
   * operation lease stays on the real clock (the kernel gateway reads it).
   */
  clock?: TaskClock;
  /** §135.30: the typed-feature compile before a route that has an uncompiled reachable candidate (default true). `false` is the SL-12 policy: the replays' control arm, and tests whose subject is the route. */
  compile?: boolean;
  /**
   * §143.3: the generation of a person's act (§143.2). Defaults to the product lane (`createNpcActLane` on the session's
   * model registry); tests pass `createFixtureNpcActPort`; `null` generates nothing (every act is `model_unavailable`).
   */
  npcAct?: NpcActPort | null;
}

/** `PI_COC_TURN_BUDGET_MS` (contract §135.25), read per run: a positive number of milliseconds, else the default. */
export function turnBudgetMs(env: Readonly<NodeJS.ProcessEnv>): number {
  const value = Number(env.PI_COC_TURN_BUDGET_MS?.trim() || NaN);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TURN_BUDGET_MS;
}

/** §135.29's SL-69 addendum: the Keeper's own provider call is capped past `PI_COC_KEEPER_CALL_CAP_FLOOR_MS`
 * (named default 20 s) or half the table's turn budget, whichever is larger -- never below the floor, so a
 * short turn budget never turns the cap into something a fast, healthy call could still trip. */
export const DEFAULT_KEEPER_CALL_CAP_FLOOR_MS = 20_000;
export function keeperCallCapFloorMs(env: Readonly<NodeJS.ProcessEnv>): number {
  const value = Number(env.PI_COC_KEEPER_CALL_CAP_FLOOR_MS?.trim() || NaN);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_KEEPER_CALL_CAP_FLOOR_MS;
}
export function keeperCallCapMs(env: Readonly<NodeJS.ProcessEnv>): number {
  return Math.max(keeperCallCapFloorMs(env), Math.floor(turnBudgetMs(env) / 2));
}

/** The Keeper verbs whose committed result is the turn's delivery (contract: real `narrate` / `ask` only). */
const DELIVERY_VERBS: Readonly<Record<string, 'accepted' | 'awaiting_player'>> = Object.freeze({narrate: 'accepted', ask: 'awaiting_player'});
/** Verbs whose success changes the table, so the run re-reads its state after them. */
const WRITE_VERBS = new Set(['apply', 'resolve']);
/** The prescreen packet's byte ceiling (the same cap the context hook's own prescreen used). */
const PRESCREEN_BYTES = 16 * 1024;
/**
 * SL-78: the Keeper's own tool calls the `residual` telemetry row counts (design D3/D4, "the Keeper's free tool
 * calls become the residual"). `narrate`/`ask`/`say` are the Keeper's words, never bookkeeping, and are not here.
 */
const KEEPER_RESIDUAL_KEYS = ['apply', 'resolve', 'look', 'lookup', 'recall'] as const;
type KeeperResidualKey = typeof KEEPER_RESIDUAL_KEYS[number];
const isKeeperResidualKey = (value: string): value is KeeperResidualKey => (KEEPER_RESIDUAL_KEYS as readonly string[]).includes(value);
/**
 * SL-78: a defensive circuit breaker on `routeConsequencesAfterWrite`'s own recursion (through `clerkStep`'s tail
 * calling back into it). Never hit on a real table: each round only offers keys `run.consequenceExecuted` has not
 * already taken, and a scene has finitely many clues, so the chain ends on its own long before this.
 */
const CONSEQUENCE_INLINE_ROUNDS_CAP = 12;

/**
 * SL-76 (§135.32, §135.3.1): `COC_JEV_STEPS`, read once per process like every other engine env switch here.
 * §151.1: when the switch is absent the host budget data's `jev_steps.shadow` decides (`false` = `on`).
 * `shadow` routes and pairs but never executes; `on` (SL-78's acceptance) additionally executes a
 * cleared candidate through `clerkStep`; `off` builds none of the three classes at all. Any other value is
 * `shadow`: this is a schedule switch, not an open-ended classification, so a fixed default is not the
 * hard-coded-semantic-list the project bans -- there is no text here for it to classify.
 */
export function jevStepsMode(env: Readonly<NodeJS.ProcessEnv>, dataDefault: 'on' | 'shadow' = 'shadow'): 'shadow' | 'on' | 'off' {
  const raw = String(env.COC_JEV_STEPS ?? '').trim();
  if (raw === 'on' || raw === 'off') return raw;
  // §151.1: an explicit but unrecognized value is still the safe default; only an absent switch defers to the data.
  return raw ? 'shadow' : dataDefault;
}
/** §151.1: where the effective consequence-step mode came from, recorded beside the rows it shapes. */
export function jevStepsModeSource(env: Readonly<NodeJS.ProcessEnv>): 'env' | 'data' {
  return String(env.COC_JEV_STEPS ?? '').trim() ? 'env' : 'data';
}
/** One receipt's own words, for the consequence route's `settled_this_run` state (labels, never ids; D2.3). */
export function receiptLabel(receipt: Row): string {
  const kind = text(receipt.kind);
  if (kind === 'clue') return `clue ${text(receipt.clue)}: ${text(receipt.label) || text(receipt.summary)}`.trim();
  if (kind === 'time') return `${Number.isFinite(receipt.minutes) ? receipt.minutes : '?'} minutes: ${text(receipt.why)}`.trim();
  if (kind === 'roll' && text(receipt.decision) === NPC_REACTION_DECISION) return `first impression: ${text(receipt.actor_label) || text(receipt.actor)} on ${text(receipt.npc)}`;
  // §151.1 addendum: a settled check says what was attempted and whether it succeeded -- a bare "roll" let the consequence
  // route file a clue behind a failed Persuade or Locksmith check (10 of 49 executed clue steps on gates #18-#25).
  if (kind === 'roll') {
    const attempt = text(receipt.skill_label) || text(receipt.skill) || text(receipt.decision) || text(receipt.roll_kind) || 'check';
    const level = text(receipt.level) || text(object(receipt.check).level);
    const passed = typeof receipt.passed === 'boolean' ? receipt.passed : object(receipt.check).passed;
    return `${attempt} check: ${level || 'unknown level'}${passed === true ? ', succeeded' : passed === false ? ', failed' : ''}`;
  }
  return text(receipt.decision) || kind;
}
/**
 * SL-76's turn-close pairing (D4): what the Keeper did this turn, read off the turn's own receipts -- never off a
 * model-origin call's arguments, which this engine does not otherwise retain. `true`: the same entity, the same
 * kind of consequence; `other`: the same kind of consequence landed on a different entity this turn (npc_reaction,
 * clue_follow_up only -- `time_cost` has no second entity to distinguish); `false`: neither.
 *
 * SL-83: `npc_reaction` compares handles. The candidate's `target` is the person's graph handle
 * (`consequence-candidates.ts`, off the capsule row's `handle`), and the first-impression `roll` receipt's `npc` is
 * the same handle. A `target` that is not a handle but the person's display name (a capsule row from a kernel
 * older than SL-83 carries only that) is resolved through the turn's own `person` receipts, whose `name` is that
 * display name and whose `who` is the handle -- the turn's own data, never a list -- before the comparison; when
 * no receipt this turn names it, it cannot be paired and reads as `other`/`false` exactly as a stranger would.
 */
export function keeperDidFor(entry: {consequenceClass: ConsequenceClass; target?: string; clue?: string}, receipts: readonly Row[]): true | false | 'other' {
  if (entry.consequenceClass === 'npc_reaction') {
    const rolls = receipts.filter(receipt => text(receipt.kind) === 'roll' && text(receipt.decision) === NPC_REACTION_DECISION);
    const handles = new Set([entry.target ?? '']);
    for (const receipt of receipts) if (text(receipt.kind) === 'person' && text(receipt.name) === entry.target && text(receipt.who)) handles.add(text(receipt.who));
    if (rolls.some(receipt => handles.has(text(receipt.npc)))) return true;
    return rolls.length ? 'other' : false;
  }
  if (entry.consequenceClass === 'clue_follow_up') {
    const clues = receipts.filter(receipt => text(receipt.kind) === 'clue');
    if (clues.some(receipt => text(receipt.clue) === entry.clue)) return true;
    return clues.length ? 'other' : false;
  }
  return receipts.some(receipt => text(receipt.kind) === 'time');
}
/**
 * SL-76/SL-78 (D4; §135.32 addendum 2): the pure gate over whether shadow ever executes, and (SL-78) over which
 * *class* `on` executes. `shadow` and `off` always return no keys, whatever `rows` clears -- this is the whole
 * of "shadow never executes", pulled out of `routeConsequences` so it can be proven by a table of inputs rather
 * than by reading the engine's control flow. `on` returns the cleared rows' keys whose class is in
 * `executeClasses` (`jevStepsBudget().execute`, data, never a literal), once each -- a key already in `executed`
 * is skipped (SL-78's "once per key", not this ticket's re-route loop) and a cleared row of an unlisted class is
 * left exactly as `shadow` leaves it: routed and paired, never executed.
 */
export function consequenceKeysToExecute(mode: 'shadow' | 'on' | 'off', rows: readonly ConsequenceRow[], executed: ReadonlySet<string>,
  executeClasses: readonly string[] = []): string[] {
  if (mode !== 'on') return [];
  return rows.filter(row => row.cleared && !executed.has(row.key) && executeClasses.includes(row.class)).map(row => row.key);
}

/** §138.10: the kernel's roll inside a band, as the clerk's note says it: minutes inside the row, or a total on the dice. */
function rollText(roll: Row): string {
  return roll.min !== undefined && roll.max !== undefined ? `${roll.total} minutes inside ${roll.min}-${roll.max}` : `${roll.total} on ${text(roll.expression) || 'the rung\'s dice'}`;
}
/**
 * §138.10: the kernel's roll inside the band the clerk named, read back from the turn's receipts onto the bind record:
 * the time receipt's `band_roll`, the damage roll receipt's expression and total. A record whose roll no receipt shows
 * keeps its band without one.
 */
export function bandRolls(bindings: BindRecord[], receiptIds: readonly string[], receipts: readonly Row[]): BindRecord[] {
  const minted = receipts.filter(receipt => receiptIds.includes(text(receipt.id)));
  return bindings.map(entry => {
    if (entry.path !== 'banded' || entry.value === null) return entry;
    const receipt = minted.find(row => text(row.band) === String(entry.value) && (row.band_roll || row.kind === 'roll'));
    const roll = receipt?.band_roll ? object(receipt.band_roll) : receipt?.kind === 'roll' ? {expression: receipt.expression ?? null, total: receipt.total ?? null} : undefined;
    return roll ? {...entry, roll: roll as Json} : entry;
  });
}
/** The Keeper's line for a clerk write that landed a band (§138.10), or none. */
function bandedLine(candidate: Candidate, bindings: BindRecord[]): string | undefined {
  const lines = bindings.filter(entry => entry.path === 'banded' && entry.value !== null).map(entry =>
    `band: ${entry.name} ${String(entry.value)} (${entry.table ?? 'band'}, confidence ${Number(entry.confidence ?? 0).toFixed(2)})`
    + (entry.roll ? `, the kernel rolled ${rollText(object(entry.roll))}` : '')
    + (candidate.clerk === 'stated_hazard' ? '; the host read the stated harm\'s severity as this rung.' : '; the host read the player\'s declared action as this row.')
    + ' To rule otherwise, settle it with your own operation.');
  return lines.join(' ') || undefined;
}

export function emptyTurnContext(): TurnContext {
  return {scene: '', clock: null, present: [], receipts: []};
}

/**
 * The table context and the Jev scope binding from two read-only kernel reads. §143.23: the status's `last_exchange`, when
 * the kernel gives one, rides on the context as it is (the compile's state carries it); nothing here reads what was said.
 */
export function readTable(capsule: Row, status: Row): {context: TurnContext; scope?: ScopeBinding; readSet?: ReadSet; turn?: number; binding?: ContextBinding} {
  const where = object(capsule.where), exchange = status.last_exchange;
  const context: TurnContext = {scene: text(where.scene), clock: (where.clock ?? null) as TurnContext['clock'],
    present: array(capsule.present).map(person => text(object(object(person).called).name) || text(object(person).name)).filter(Boolean),
    receipts: array(status.receipts).map(receipt => text(object(receipt).id) || JSON.stringify(receipt)),
    ...(exchange && typeof exchange === 'object' && !Array.isArray(exchange) ? {lastExchange: exchange as Json} : {})};
  const binding = bindingOf(capsule._context);
  if (!binding) return {context};
  return {context, turn: binding.turn, binding,
    scope: {owner: `campaign:${binding.campaign}`, campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop, audience: 'keeper'},
    readSet: [{kind: 'source', resource: binding.campaign, revision: String(binding.source_revision)},
      {kind: 'model', resource: 'decision', revision: JEV_MODEL}, {kind: 'family', resource: ROUTE_FAMILY, revision: '1'}]};
}

/** A resolve whose check the kernel reports failed: the failure branch of a Keeper batch step (closed field `outcome.success`). */
function failedCheck(details: unknown): boolean {
  return object(object(details).outcome).success === false;
}

/**
 * §135.11 addendum (SL-20): whether a clerk resolve's check passed, from the kernel's closed outcome fields (`passed`, and
 * §135.5's `success`); absent when the result carries neither.
 */
function checkOf(tool: string, result: Row): {check?: 'passed' | 'failed'} {
  if (tool !== 'resolve') return {};
  const outcome = object(result.outcome);
  if (outcome.passed === false || outcome.success === false) return {check: 'failed'};
  return outcome.passed === true || outcome.success === true ? {check: 'passed'} : {};
}

/** The prescreen packet as the route reads it: the materials and the entities the locate found. */
function packetMaterials(message: Row | undefined): {materials: Material[]; located: Array<{handle: string; label: string; kind: string}>} {
  let packet: Row = {};
  try { packet = object(JSON.parse(String(message?.content ?? ''))); } catch { packet = {}; }
  const rows = array(packet.materials).map(object);
  const materials: Material[] = rows.map((material, index) => ({
    key: text(material.key) || text(material.locator) || text(material.id) || `${text(material.kind)}:${text(material.label) || text(material.name) || index}`,
    label: text(material.label) || text(material.name) || text(material.kind),
    kind: text(material.kind) || 'material',
    // The prototype's preview, unchanged: the whole public material row when it has no body or summary of its own.
    preview: typeof material.text === 'string' ? material.text : JSON.stringify(material.body ?? material.summary ?? material).slice(0, 2_000),
  }));
  const located = rows.filter(material => text(material.kind) === 'graph_entity' && text(material.handle))
    .map(material => ({handle: text(material.handle), label: text(material.label) || text(material.name) || text(material.handle),
      kind: text(object(material.entity).kind) || text(material.entity_kind) || 'entity'}));
  return {materials, located};
}

/**
 * The run's packet with the issued candidates' bodies (§135.20): added to the prescreen's packet as `issued`, or a
 * packet of their own in the same slot when no prescreen packet was prepared. Nothing to add: the packet unchanged.
 */
export function withIssuedBodies(packet: Row | undefined, issued: CandidateBodies | undefined): Row | undefined {
  const section = issued ? issuedSection(issued) : undefined;
  if (!section) return packet;
  if (!packet) return customMessage(PRESCREEN_TYPE, {kind: 'issued_bodies', issued: section});
  let content: Row;
  try { content = object(JSON.parse(String(packet.content))); } catch { return packet; }
  return {...packet, content: JSON.stringify({...content, issued: section})};
}

/** One clerk step of this turn, as the Keeper's projection lists it. */
interface ClerkStep {step: string; operation: string; label: string; clerk?: string; call_id: string | null; status: string; receipts: string[]; basis?: Json; result?: Json;
  /** §135.26: the obligation step this was, with its receipt and page, in one line. */
  obligation?: string;
  /** §135.26 (owner ruling Q5): the open obligation whose guard this step crossed, in one line. */
  obligation_open?: string;
  /** §135.28: the parameters the clerk took by the rules default, in one line (the Keeper may settle it otherwise). */
  binding?: string}

/**
 * §135.28: how each parameter of a clerk write got its value. The bind step's records (`jev`, `rule-default`) come with
 * the step; every other bound parameter is the candidate's own: `composed` when the builder composed it, else `stated`
 * (read from the kernel row the candidate came from). The effect kind is structure, not a parameter.
 */
export function bindRecords(candidate: Candidate, extra: Record<string, Json>, settled: BindRecord[]): BindRecord[] {
  const decided = new Set(settled.map(entry => entry.name)), composed = new Set(candidate.composed ?? []);
  // §135.30: a closed parameter the compile settled (the attack's target) is Jev's, with the compile answer's distribution.
  const compiled = object(object(object(candidate.basis).compile).bound);
  const shape: BindRecord[] = Object.entries(candidate.bound).filter(([name]) => name !== 'kind' && !decided.has(name) && !Object.hasOwn(extra, name))
    .map(([name, value]) => Object.hasOwn(compiled, name)
      ? {name, path: 'jev' as const, value, confidence: object(compiled[name]).confidence ?? null, distribution: object(compiled[name]).distribution ?? null}
      : {name, path: composed.has(name) ? 'composed' as const : 'stated' as const, value});
  return [...shape, ...settled];
}
/**
 * §32.12: the bind records as admission reads them -- each parameter's name and path, and every parameter the call carries
 * from the bind step (`extra`) with no record listed with `path: null`, so the compile's evidence is refused for it.
 */
export function admissionBindings(records: BindRecord[], extra: Record<string, Json>): Array<{name: string; path: string | null; cleared?: boolean}> {
  const named = new Set(records.map(entry => entry.name));
  // §135.30.3: a Jev answer the binder executed under the gates says so, and admission reviews the call.
  return [...records.map(entry => ({name: entry.name, path: entry.path, ...(entry.cleared === false ? {cleared: false} : {})})),
    ...Object.keys(extra).filter(name => !named.has(name)).map(name => ({name, path: null}))];
}
/** §135.30.3: the act the compile read for the ordinary check it selected, which settles roll-or-not and the intent. */
function compiledCheck(candidate: Candidate): {intent: 'investigate' | 'social'} | undefined {
  const compile = object(object(candidate.basis).compile), intent = object(object(compile.bound).intent).value;
  return compile.predicate === 'ordinary_check' && (intent === 'investigate' || intent === 'social') ? {intent} : undefined;
}
/** The Keeper's line for a clerk write that took a rules default (§135.28), or none. */
function defaultLine(candidate: Candidate): string | undefined {
  const basis = object(candidate.basis), defaults = object(basis.rule_default);
  if (basis.binding !== 'rule-default' || !Object.keys(defaults).length) return undefined;
  const rules: Record<string, string> = {jev_lead: 'Jev\'s leading reading of the player\'s words, under the confidence gate',
    highest_offered_skill: 'the investigator\'s highest of the offered skills', no_modifier: 'no modifier',
    regular_difficulty: 'a regular difficulty; nothing stated makes it harder',
    card_disposition: 'the combat tactic their card states, through the combat disposition table'};
  // The card's word stands in for a person's own parameters, not for the player's words (§11.5.3 amendment).
  const card = Object.values(defaults).every(value => text(object(value).rule) === 'card_disposition');
  return `rules default: ${Object.entries(defaults).map(([name, value]) => `${name} ${String(object(value).value)} (${rules[text(object(value).rule)] ?? text(object(value).rule)})`).join(', ')}; `
    + (card ? 'their own parameters did not settle it.' : 'the player\'s words did not settle it.') + ' If the fiction calls for another choice, settle it with your own operation.';
}

/** Per-run state the ports share; the policy's own state stays in the driver. */
/** §158.4: the kernel extension's port for the previous delivery's post review still running (`coc:owed-review`). */
interface OwedReviewPort {campaign: string; settle(elapsedMs: number): Promise<{in_flight: boolean; waited_ms: number; landed: boolean; turn?: number}>}
interface RunState {
  interactionScope?: InteractionScope;
  history?: {enabled: boolean; allowed: boolean; asked: boolean; scene: string; context: Json; closed?: boolean;
    closedReason?: 'budget_exhausted' | 'turn_budget_exhausted'};
  unresolvedAttack?: boolean;
  /** §163: the run's forced resolutions in first-seen order, which are recorded (one telemetry row each), and which the Keeper was shown. */
  forced: ForcedResolution[];
  forcedRecorded: Set<string>;
  forcedShown: Set<string>;
  runId: string;
  /** §158.4: this run's first read already waited for the previous delivery's review (it waits once). */
  owedWaited?: boolean;
  /** §135.11.2: the note's head (`CLERK_NOTE_HEAD`) was sent in this run's first note. */
  headShown?: boolean;
  rawInput: string;
  inputRevision: string;
  session?: Row;
  startedAt: number;
  /**
   * §135.6.1 (SL-44): the prescreen's own allowance, given whole to every read that runs one (`readJevPreselectAllowanceMs`,
   * default `PRESELECT_ALLOWANCE_DEFAULT_MS`). Never the turn's remainder: gate #4's t19 read got 138 ms that way.
   */
  prescreenAllowanceMs: number;
  providerBudget: ReturnType<typeof preparationProviderBudget>;
  turn?: number;
  scope?: ScopeBinding;
  readSet?: ReadSet;
  intent?: IntentBinding;
  answering?: string[];
  located: Array<{handle: string; label: string; kind: string}>;
  /** The kernel's session view from the latest read (§11.9), for the Keeper's note on an NPC's held or fled turn. */
  fight?: Row;
  clerkDid: ClerkStep[];
  projected: number;
  /** `proposed` (§151.5): an accepted `propose` of this response holds the rest of it until the proposed step has run. */
  batch?: {message: unknown; fell?: string; fellAt?: string; proposed?: true};
  identities: Map<string, OperationIdentity>;
  lease?: TaskLease;
  /** The NPC turn whose held or fled standing the Keeper was last told (`<npc>:r<round>`). */
  noted?: string;
  /** §135.25: the run's time budget, the start of its latest model step, and the clerk steps the budget deferred. */
  budgetMs: number;
  lastInferAt?: number;
  deferred: DeferredStep[];
  /** §135.11: the turn-close steer the next model step carries (the kernel extension's own `coc-host` message). */
  steer?: Row;
  /**
   * §135.6 (SL-22 addendum): the run's previous read, by scene, with the prescreen outcome it ran or reused (absent when it
   * ran none): reuse requires the same scene, source evidence and player need; read_more refreshes it. The packet excludes issued bodies.
   */
  lastRead?: {scene: string; key: string; outcome?: {step: string; materials: Material[]; message?: Row}};
  /** §135.6 (SL-22 addendum): what the run's prescreens spent, reported in the budget summary (never the decision budget's). */
  prescreenSpent: {reads: number; jev_calls: number; ms: number};
  /** §135.25 (SL-22 addendum): the policy's decision budget as of its latest step, for the budget summary. */
  decision?: Budget;
  /**
   * §135.31: the scene the run's first read found and the latest fresh read's; the fresh read's session view (`'read'`
   * when `table.resolve.options` failed while the capsule shows a session); the investigators, who are not people here.
   */
  firstScene?: string;
  scene?: string;
  sessionView?: Row | 'read';
  investigators: string[];
  /** §135.31: the people the candidates this run's clerk executed named, in order; the latest fresh read's issued candidates. */
  named: string[];
  issued?: Candidate[];
  /** §135.31: what the Keeper was already shown this run: scenes, people (names and card ids), the last session view's digest;
   *  §135.31.1: the scenes whose source passages were carried. */
  shown: {scenes: Set<string>; people: Set<string>; session?: string; passages: Set<string>; pending: Set<string>};
  /** §135.20.1 (SL-102): whether this run's first model step already asked the port to wait out this scene's consultations. */
  settleAsked?: true;
  /** §135.31.1 (SL-27): every material this run's prescreens prepared or reused, with the scene of the read. */
  passages: PassageSource[];
  /** §135.31.1: whether the module has an original document -- the capsule carries `reading` (§22) only then. */
  document?: boolean;
  /** §135.30.4: the cleared destinations the kernel held back, with their guards; the Keeper is told each once. */
  guarded: GuardedDestination[];
  guardedShown: number;
  /** §107.1: the maps this turn presented because they were published after the arrival (the capsule's `turn.map_arrived`). */
  mapArrived?: Row[];
  mapArrivedShown?: boolean;
  /**
   * SL-76 (§135.32, §135.3.1): the shadow route's accumulated per-candidate rows, keyed by candidate key so a
   * later read's answer over the same key replaces an earlier one. `target`/`clue` are read off the candidate's
   * own `bound` when it is stored, for the turn-close pairing (`keeperDidFor`); never sent to Jev or the model.
   */
  consequenceRows: Map<string, ConsequenceRow & {label: string; target?: string; clue?: string}>;
  /** SL-76: the `exists` row per class, the same accumulate-by-key rule. */
  consequenceExists: Map<ConsequenceClass, ConsequenceExistsRow>;
  /** SL-76: `COC_JEV_STEPS=on` executes a cleared candidate once; this is the "once" (never twice for the same key in one run). */
  consequenceExecuted: Set<string>;
  /** SL-76: the run's own added Jev time for the shadow route, reported in the budget summary. */
  consequenceMs: number;
  /** SL-76: every receipt this turn's reads have seen (`table.status.receipts`), deduped by id, for the turn-close pairing. */
  turnReceipts: Row[];
  pendingCheckPreparations?: Array<{candidate: string; needs: string[]}>;
  pendingAttackPreparation?: boolean;
  /** SL-76: the latest read's D1 candidates and scene context, held for the turn-close route (never asked mid-read: see `routeConsequences`'s call site). */
  consequenceCandidates: ConsequenceCandidate[];
  consequenceContext?: TurnContext;
  /** §143.4: the people present in the latest read (the capsule's order), whom an `npc_act` scan asks about. */
  present: string[];
  /**
   * §143.21: the people present at the run's first read -- when the declaration was put. A person the scan runs who was
   * not among them, after a move landed this turn, heard the declaration nowhere (`declared_before_move`).
   */
  firstPresent?: string[];
  /** §143.4: who already acted (or was skipped) this run, and how many acted outside a fight (the per-turn cap). */
  npcSeen: Set<string>;
  npcCount: {acted: number};
  /** §143.4: an NPC's turn of the fight the table's act did not settle (the Keeper is told once, in the next note). */
  npcTurnLeft?: {key: string; npc: string; status: string; reason: string | null; act: string | null};
  /** §143.4: a scan the time budget skipped was recorded (`skipped_budget`), once per run. */
  npcBudgetSkipped?: boolean;
  /**
   * §143.28 (NAF-29): the fight hold the latest scan put (§143.25) -- the handles it held back, and the ids of this turn's
   * receipts on the table when it was put. While it stands, every fresh read asks whether a blow has struck one of them since
   * (`struckHeld`); the first that has ends it.
   */
  npcHeld?: {names: string[]; before: string[]};
  /** SL-78: `routeConsequencesAfterWrite`'s own recursion counter (`CONSEQUENCE_INLINE_ROUNDS_CAP`'s circuit breaker). */
  consequenceInlineRounds?: number;
  /** SL-78: how many of this run's clerk steps (`clerkDid`) were consequence-class executions, for the `residual` row. */
  consequenceCalls?: number;
  /** SL-78 (§135.32 addendum 2, the `residual` row): the Keeper's own tool calls this turn, by verb. */
  keeperCalls: Record<KeeperResidualKey, number>;
  /** SL-78: how many `purpose: "compile"` Jev decisions this run asked, for the `residual` row. */
  compileCalls: number;
  /**
   * SL-85 (§135.32 addendum 2's own "once per turn" ruling): whether `closeConsequences` -- the one place that
   * writes the `route`/`consequence` pairing rows and the `residual` row -- has already run for this run. A run
   * can reach the point a turn closes more than once (a `turn_close` proposal that comes back `steer`, then a
   * later one that actually closes) or not through `turnCloseStep` at all (the Keeper's own `narrate`/`ask`
   * delivers directly, `modelStep`'s own path): this flag is the single choke point that makes either shape
   * write exactly once, at whichever call is the true final one (a steer's own call never sets it).
   */
  residualWritten?: true;
  /**
   * SL-85: the receipt ids `packet.receipts` returned for a specific executed consequence candidate's own clerk
   * write (`clerkStep`, keyed by the candidate's key) -- so the turn-close pairing can tell "the Keeper also
   * filed this independently" from "this is the clerk's own receipt, read back off `run.turnReceipts`".
   */
  consequenceExecutedReceiptIds: Map<string, string[]>;
  /** §151.5: the narrator-only setting as this run resolved it (set by the first model step's note while it is on). */
  narrator?: NarratorOnlySetting;
  /** §151.5: the catalog the current model step admits (the latest note's), and the offered keys `propose` names on it. */
  stepCatalog?: StepCatalog;
  offered: Candidate[];
  /** §151.5: the keys this run's `propose` calls queued (never proposed twice, never executed again by the consequence route). */
  proposedKeys: Set<string>;
  /** §151.5: every `propose` call the Keeper made this run, queued or refused, for the `residual` row. */
  proposeCalls: number;
}

/**
 * Build the engine: the session run driver Pi is given, plus the inline extension that hands it the kernel
 * bridge and the operation gateway (both go onto the bus at session_start, after the driver was created).
 */
export function createHybridEngine(options: HybridEngineOptions): {runDriver: SessionRunDriver; extension: (pi: any) => void; bridge: () => KernelBridge | undefined;
  /** §135.29's SL-69 addendum: the per-call cap Pi's session should enforce on every Keeper provider call, and
   * the callback told when it fires. §135.29 addendum 2 (SL-82): with `COC_FIRST_STEP_THINKING=1` this is a
   * per-call function instead of a fixed number, so the turn's first call can size its own cap (vendored patch
   * `0004` resolves either shape fresh per attempt); the flag off returns the plain ordinary number, exactly
   * as before this addendum. */
  keeperCallCapMs: number | (() => Promise<number>); onKeeperCallCap: (phase: 'first_byte' | 'streaming', capMs: number) => void} {
  let bridge: KernelBridge | undefined, gateway: OperationGateway | undefined, closer: TurnClosePort | undefined, api: any;
  /** §143.3: the product's npc-act lane, made when the extension loads, on the session context the latest event gave. */
  let npcActLane: NpcActPort | undefined, sessionCtx: any;
  const NO_ACT: NpcActPort = {generate: async () => ({unavailable: 'model_unavailable', detail: 'no npc-act generation on this engine'})};
  const npcActPort = (): NpcActPort => options.npcAct === null ? NO_ACT : options.npcAct ?? npcActLane ?? NO_ACT;
  let consultations: SourceAnswersPort | undefined;
  let owedReview: OwedReviewPort | undefined;
  let historyFinalAnswer: {run: string; step: string; reason?: string} | undefined;
  // §151.1: the consequence-step mode's data default, read once (cached) and awaited by every run's first read.
  let stepsDataDefault: 'on' | 'shadow' = 'shadow';
  const stepsReady = jevStepsBudget().then(budget => { stepsDataDefault = budget.shadow ? 'shadow' : 'on'; });
  const stepsMode = () => jevStepsMode(options.env as NodeJS.ProcessEnv, stepsDataDefault);
  const stepsModeFields = () => ({steps_mode: stepsMode(), steps_mode_source: jevStepsModeSource(options.env as NodeJS.ProcessEnv)});
  // SL-87: `clock`, when given, is the run's steps' and its Jev work's clock (the read's prescreen allowance, the decision
  // leases); without it every one of them reads the host's real clock and timers, as before. `now` alone stays the policy's.
  const clock = options.clock, stepNow = clock ? () => clock.now() : () => Date.now(), leaseClock = clock ? {clock} : {};
  const now = options.now ?? stepNow;
  /** §135.25: the clerk steps the last run's budget deferred, for the next run's first note to the Keeper (session memory). */
  let carried: {campaign?: string; run: string; turn?: number; deferred: DeferredStep[]} | undefined;
  const record = (row: Record<string, unknown>) => {
    try { (options.record ?? bridge?.record)?.(row); } catch { /* Telemetry never steers the run. */ }
  };
  /**
   * §151.5: the narrator-only setting (env over data), resolved once per engine like every other engine switch here; the
   * `propose` verb's per-turn count (`${campaign}:${turn}`, so a second run of the same turn shares it); the outcome each
   * accepted or refused `propose` call hands the registered tool to return (by tool call id); whether the tool is on the surface.
   */
  let narratorResolved: Promise<NarratorOnlySetting> | undefined;
  const narratorSetting = (): Promise<NarratorOnlySetting> =>
    narratorResolved ??= narratorOnlyBudget().then(budget => narratorOnlySetting(options.env as Record<string, string | undefined>, budget));
  let proposeTurn: {id: string; used: number} | undefined;
  const proposeOutcomes = new Map<string, {ok: boolean; text: string; details?: Row}>();
  let proposeRegistered = false;
  // SL-84 (contract §122 "Jev attempt/batch failure telemetry" addendum): the adapter's own AdapterTrace, which
  // otherwise went nowhere, now writes the `attempt_failed`/`batch_failed` rows.
  const jev = options.decision === null ? undefined
    : options.decision ?? (readJevApiKey(options.env) ? createDecisionAdapter({env: options.env, maxConcurrency: 4, trace: jevFailureTelemetry(record)}) : undefined);
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    if (!bridge?.call || !bridge.campaign) throw new Error('kernel_bridge_unavailable');
    return object(await bridge.call(method, {campaign: bridge.campaign, ...params}));
  };
  const quiet = async (method: string, params: Record<string, unknown> = {}) => {
    try { return await call(method, params); } catch (error) { record({lane: 'run', event: 'read_failed', method, error: String((error as Error).message).slice(0, 200)}); return {}; }
  };
  /**
   * §138.10: the two band tables' rows, read once per engine from `rules.bands` (they are the rules', not the campaign's);
   * a read that failed or came back unusable is not kept, so the next read tries again. The gates ride beside them.
   */
  const bandRows: {time?: TimeBandRow[]; damage?: DamageBandRow[]} = {};
  async function bandReads(): Promise<BandReads> {
    for (const kind of ['time', 'damage'] as const) {
      if (bandRows[kind]) continue;
      const read = readBandRows(kind, await quiet('rules.bands', {field: SHADOW_FIELDS[kind]}));
      if (read?.kind === 'time') bandRows.time = read.rows; else if (read?.kind === 'damage') bandRows.damage = read.rows;
    }
    return {...bandRows, gates: {time: bandMinConfidence(options.env as NodeJS.ProcessEnv, 'time'), damage: bandMinConfidence(options.env as NodeJS.ProcessEnv, 'damage')}};
  }

  const rememberReceipts = (run: RunState, status: Row) => {
    for (const receipt of array(status.receipts).map(object)) {
      const id = text(receipt.id);
      if (id && !run.turnReceipts.some(seen => text(seen.id) === id)) run.turnReceipts.push(receipt);
    }
  };
  /**
   * §163: a forced resolution is one `lane: "forced-resolution"` row when the run first sees it (from the policy's view or
   * the engine's own projection), and joins the run's list the Keeper's next note shows once.
   */
  const recordForced = (run: RunState, entries: readonly ForcedResolution[] | undefined, step?: string) => {
    for (const entry of entries ?? []) {
      if (run.forcedRecorded.has(entry.key)) continue;
      run.forcedRecorded.add(entry.key);
      run.forced.push(entry);
      record({lane: 'forced-resolution', run: run.runId, ...(step ? {step} : {}), ...(run.turn !== undefined ? {turn: run.turn} : {}),
        family: entry.family, subject: entry.subject, uncertain: entry.uncertain, chosen: entry.chosen, why: entry.why});
    }
  };
  /** §163 (amends §159.10): a preparation still pending when the turn is delivered was narrated by judgement: a forced no-roll. */
  const recordUnpreparedChecks = (run: RunState) => recordForced(run, (run.pendingCheckPreparations ?? []).map(entry =>
    forcedResolution({family: 'check-preparation', subject: entry.candidate, uncertain: entry.needs, chosen: {outcome: 'no_roll'}, why: 'preparation_incomplete'})));
  /** The kernel reads a step needs and the candidates they issue. Read-only. */
  async function tableReads(run: RunState): Promise<{capsule: Row; status: Row; table: ReturnType<typeof readTable>; candidates: () => Candidate[]; rows: () => FeatureRows;
    consequences: () => ConsequenceCandidate[]}> {
    await stepsReady;
    const [capsule, status, applyOptions, resolveOptions, bands] = await Promise.all([call('table.capsule'), call('table.status'), quiet('table.apply.options'), quiet('table.resolve.options'), bandReads()]);
    const table = readTable(capsule, status);
    const historyScene = text(object(capsule.where).scene);
    if (!run.history || run.history.scene !== historyScene) run.history = {enabled: false, allowed: false, asked: false,
      ...(run.history?.closed ? {closed: true, closedReason: run.history.closedReason} : {}),
      scene: historyScene, context: {where: capsule.where ?? null, period: object(capsule.campaign).era ?? null} as Json};
    run.history.enabled = historyEnabled(capsule);
    if (!run.history.enabled) run.history.allowed = false;
    // SL-76 (D2.3, D4): every receipt this turn's reads have seen, deduped by id -- the consequence route's
    // "settled this run" state and the turn-close pairing both read this, never the model-origin call's own args.
    rememberReceipts(run, status);
    run.fight = object(object(resolveOptions.context).session ?? object(capsule.where).session);
    // §135.31: what the projection carries is this read's: the scene, the session view `look focus=session` would return
    // (the resolve options' context holds the same two values), and who the investigators are.
    const context = object(resolveOptions.context), active = (value: unknown) => Object.keys(object(value)).length > 0;
    run.firstScene ??= table.context.scene;
    run.document = Object.hasOwn(capsule, 'reading');
    run.mapArrived = array(object(capsule.turn).map_arrived).map(object);
    run.scene = table.context.scene;
    run.sessionView = Object.hasOwn(context, 'session') ? (active(context.session) ? {session: context.session, pending_choice: context.pending_choice ?? null} : undefined)
      : active(object(capsule.where).session) ? 'read' : undefined;
    // §143.4: who is present, in the capsule's order (an `npc_act` scan reads each of them).
    run.present = array(capsule.present).map(person => text(object(person).name)).filter(Boolean);
    run.firstPresent ??= [...run.present];
    const party = object(capsule.known).investigator;
    run.investigators = (Array.isArray(party) ? party : [party]).flatMap(value => [text(object(value).id), text(object(value).name)])
      .concat(array(run.fight.participants).filter(value => object(value).side === 'investigator').map(value => text(object(value).name))).filter(Boolean);
    // §11.5.3: an NPC's turn without a standing action reads that NPC's card, which says whether a disposition is
    // still to be inferred and carries what it is inferred from. Nothing else reads a card here.
    const fight = run.fight, npcTurn = fight.kind === 'combat' && fight.status === 'active' && !fight.pending_defense && text(fight.turn_of)
      && array(fight.participants).some(value => object(value).name === fight.turn_of && object(value).side !== 'investigator') && !fight.standing_action;
    const fighter = npcTurn ? await call('table.look', {focus: 'npc', name: text(fight.turn_of)}).catch(() => ({})) : undefined;
    // The pending choice this input answers is the one open when the run began (§135.2); one opened later is the Keeper's.
    run.answering ??= [text(object(object(resolveOptions.context).pending_choice).name), text(object(object(capsule.turn).pending_choice).name)].filter(Boolean);
    return {capsule, status, table,
      candidates: () => buildCandidates({capsule, applyOptions, resolveOptions, located: run.located, answering: run.answering, bands, ...(fighter ? {fighter} : {})}, run.rawInput),
      // §135.30: the compile's feature rows, from the same reads.
      rows: () => compileRows({capsule, applyOptions, resolveOptions}),
      // SL-76: the three consequence classes, from the same reads (never merged into `candidates()`'s own list).
      consequences: () => stepsMode() === 'off' ? [] : buildConsequenceCandidates({capsule, applyOptions, resolveOptions}, run.rawInput)};
  }
  /** The fresh read after a write: what the policy folds in (`fresh`), and the turn's receipts as rows (§138.10). */
  const freshOf = (run: RunState, stepId?: string) => tableReads(run).then(async read => {
    const candidates = read.candidates();
    run.issued = candidates;
    // §143.28: a blow that struck a person the fight hold held back rides on the fresh read (the policy owes them the scan).
    const struck = await struckHeld(run, stepId);
    // SL-78: `consequences` rides on every fresh read (never called unless something reads it) so the execute-mode
    // inline route (`routeConsequencesAfterWrite`, below) can build D1 candidates off the same reads `freshOf`
    // already made, with no extra kernel round trip. `shadow`/`off` never call it, so their own use of `freshOf`
    // (unpacking only `context`/`candidates`/`rows`) is exactly what it was before this addition.
    // §138.10: the turn's receipts ride beside the fresh read, so a band the clerk named reads the kernel's roll back.
    return {fresh: {context: read.table.context, candidates, rows: read.rows(), consequences: read.consequences, ...(struck.length ? {struck} : {})},
      receipts: array(read.status.receipts) as Row[]};
  }, () => undefined);

  /**
   * §143.28 (NAF-29, live table D2 turns 5, 10, 12, 13): while the fight hold holds someone back (§143.25), the receipts of
   * this turn that struck them since it was put -- done to them by the kernel's own reading (`npc.act.options`' `acted_on`)
   * and a blow (a fight wrote it, or they lost hit points: `struckReceipts`). The Keeper settled the punch the clerk did not
   * (its own resolve or damage, or the pending defence the kernel forced after it): the first such receipt ends the hold
   * for the run, and the fresh read carries them so the policy owes the scan before the Keeper's next turn-writing model
   * step. One `npc.act.options` read per held person after each write, only while someone is held; a read that fails
   * reads as not struck.
   */
  async function struckHeld(run: RunState, stepId?: string): Promise<string[]> {
    const hold = run.npcHeld;
    if (!hold?.names.length) return [];
    const struck: string[] = [];
    for (const name of hold.names) {
      let options: Row;
      try { options = await call('npc.act.options', {name}); } catch { continue; }
      for (const id of struckReceipts(options.acted_on, run.turnReceipts, hold.before)) if (!struck.includes(id)) struck.push(id);
    }
    if (!struck.length) return [];
    run.npcHeld = undefined;
    record({lane: 'run', event: 'npc_released', run: run.runId, ...(stepId ? {step: stepId} : {}), npc: [...hold.names], reason: 'struck', receipts: struck});
    return struck;
  }

  /**
   * SL-76 (§135.32, §135.3.1, D1-D4): the shadow route, over the run's latest read's D1 candidates (`run.consequenceCandidates`,
   * set by the read port, never asked there). Called once, from `turnCloseStep`, deliberately after the run's own
   * route/compile/bind Jev calls are all finished: a mid-read call was found to make `single-loop-compile.test.mjs`'s
   * "the compile is the run's first Jev question" false and to spend a Jev call on a `read_more` that §135.6 says must
   * spend none. Pure orchestration over `consequence-route.ts`'s pure functions: builds the batch, asks Jev under a
   * short lease (like the ordinary binder's, never the policy's own decision budget), folds the answer, and
   * accumulates into `run.consequenceRows`/`run.consequenceExists` for `pairConsequences` to write. `off`, or no
   * candidates, returns at once. `on` additionally executes a cleared candidate once, through `clerkStep` -- the same
   * gateway any other clerk candidate uses (§135.4) -- gated entirely behind the flag, so the default (`shadow`)
   * path this function otherwise takes is unchanged by that branch existing.
   */
  async function routeConsequences(run: RunState, candidates: ConsequenceCandidate[], context: TurnContext, signal: AbortSignal, stepId: string): Promise<void> {
    if (run.interactionScope && run.interactionScope.mode !== 'world') return;
    const mode = stepsMode();
    if (mode === 'off' || !candidates.length || !jev || !run.scope || !run.readSet) return;
    const view: ConsequenceView = {runId: run.runId, rawInput: run.rawInput, context, observations: [],
      candidates, settled: run.turnReceipts.map(receiptLabel), present: context.present.map(label => ({label, met: true}))};
    const built = consequenceBatch(view, run.scope, run.readSet);
    if (!built) return;
    const thresholds = await jevStepsBudget();
    const began = stepNow();
    const lease = new TaskLease({owner: CONSEQUENCE_FAMILY, goal: `run ${run.runId} consequence`, scope: run.scope, capabilities: ['decision'],
      readSet: run.readSet, signal, ...leaseClock, budget: {deadlineAt: stepNow() + 15_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
    let result: DecisionResult | undefined;
    try { result = await jev.decide(built.batch, lease); } catch { result = undefined; } finally { lease.close(); }
    const ms = stepNow() - began;
    run.consequenceMs += ms;
    // SL-86 (§135.32 addendum 3): each class offered this batch gets its own gate (`thresholdsForClass`), falling
    // back to the shared `thresholds` for a class `content/rulesets/coc7/host-budgets.json`'s `jev_steps.classes`
    // does not name.
    const classThresholds = Object.fromEntries([...new Set(candidates.map(candidate => candidate.consequenceClass))]
      .map(cls => [cls, thresholdsForClass(thresholds, cls)]));
    const outcome = interpretConsequenceResult(candidates, result, thresholds, classThresholds);
    for (const row of outcome.rows) {
      const candidate = candidates.find(value => value.key === row.key);
      run.consequenceRows.set(row.key, {...row, label: candidate?.label ?? row.key,
        ...(candidate?.consequenceClass === 'npc_reaction' ? {target: text(candidate.bound.target)} : {}),
        ...(candidate?.consequenceClass === 'clue_follow_up' ? {clue: text(candidate.bound.clue)} : {})});
    }
    for (const row of outcome.exists) run.consequenceExists.set(row.class, row);
    // Recorded now only when Jev could not answer (D2.7: an outage degrades to no D1 rows plus this reason); a
    // complete answer's own telemetry is the turn-close pairing row below, carrying `keeper_did`.
    if (result?.status !== 'complete') record({lane: 'route', purpose: 'consequence', shadow: mode !== 'on', run: run.runId, step: stepId,
      status: result?.status ?? 'unavailable', reason: outcome.reason,
      // SL-84: the last attempt's HTTP status or network/timeout code, so a `jev_service_error` reason is legible.
      ...(result?.failure?.status !== undefined ? {jev_status: result.failure.status} : {}), ms, offered: candidates.length});
    // SL-78 (§135.32 addendum 2): only the classes `content/rulesets/coc7/host-budgets.json`'s `jev_steps.execute`
    // names are ever executed here; a cleared row of any other class is left for the shadow pairing exactly as before.
    // §151.5: a key the Keeper's `propose` queued is the policy's to run; the route never executes it a second time.
    for (const key of consequenceKeysToExecute(mode, outcome.rows, new Set([...run.consequenceExecuted, ...run.proposedKeys]), thresholds.execute)) {
      run.consequenceExecuted.add(key);
      const candidate = candidates.find(value => value.key === key);
      const row = outcome.rows.find(value => value.key === key);
      if (!candidate || !row) continue;
      run.consequenceCalls = (run.consequenceCalls ?? 0) + 1;
      // SL-90 (§32.12 addendum, §135.32 addendum 5): the executed candidate carries the route's own evidence
      // (`basis.consequence`) into the gateway, so admission can admit it on this evidence -- `path: "consequence"`,
      // no lane round -- exactly as a compile selection carries `basis.compile` into the same seam.
      const executed = candidateWithConsequenceBasis(candidate, row, classThresholds[candidate.consequenceClass]);
      await clerkStep(run, {candidate: executed}, {runId: run.runId, stepId, operationId: `consequence:${candidate.key}`, signal}).catch(() => undefined);
    }
  }

  /**
   * SL-78 (§135.32 addendum 2; design D3/D4): with `COC_JEV_STEPS=on`, the point in the run where a listed D1
   * class's cleared candidate can still be filed and reach the Keeper's own narration this turn -- after a settled
   * write (the compile's own clerk step, a consequence step's own write, or the Keeper's own apply/resolve) and
   * before the run's next step, which for a settled declaration is the compose (§135.11 addendum, "the exit leans
   * to finish"). Routes only the classes `jevStepsBudget().execute` names (never the unlisted ones early: those
   * keep the single turn-close route `shadow` always took, byte for byte); a cleared one executes through
   * `routeConsequences`'s own `clerkStep` call, which -- because that function's own tail calls back in here --
   * is this ticket's re-route: each round only offers keys `run.consequenceExecuted` has not already taken, and a
   * scene has finitely many clues, so the recursion ends on its own. `CONSEQUENCE_INLINE_ROUNDS_CAP` is a circuit
   * breaker only, never hit on a real table. `shadow`/`off` return at once: `run.consequenceCandidates` (the turn
   * close's own, unconditional, unchanged call) is untouched by this function when it does.
   */
  async function routeConsequencesAfterWrite(run: RunState, fresh: {context: TurnContext; consequences: () => ConsequenceCandidate[]} | undefined,
    signal: AbortSignal, stepId: string): Promise<void> {
    if (!fresh || stepsMode() !== 'on') return;
    if ((run.consequenceInlineRounds ?? 0) >= CONSEQUENCE_INLINE_ROUNDS_CAP) return;
    const all = fresh.consequences();
    // Kept for the turn close's own call, which still runs unconditionally (§135.11.2-style belt and suspenders):
    // with `on`, that call now sees the latest state a write left, not only the last scene-changing read's.
    run.consequenceCandidates = all;
    run.consequenceContext = fresh.context;
    const {execute: executeClasses} = await jevStepsBudget();
    const early = all.filter(candidate => executeClasses.includes(candidate.consequenceClass));
    if (!early.length) return;
    run.consequenceInlineRounds = (run.consequenceInlineRounds ?? 0) + 1;
    await routeConsequences(run, early, fresh.context, signal, stepId);
  }

  function makePorts(run: RunState): RunDriverPorts {
    return {
      clock: {now: stepNow},
      record: {record: (event: RunEvent) => { record({lane: 'run', ...event}); if (event.type === 'run_end') budgetSummary(run); }},
      read: {
        async read(_proposal, invocation) {
          const began = stepNow();
          let current=await tableReads(run);
          let {capsule, table, candidates, rows, consequences}=current;
          // §158.4: the run's first read waits beside its prescreen for the previous delivery's review still running, which
          // may name what the ledger owes; a review that lands in time is read before any candidate is built.
          const owedPort = !run.owedWaited && owedReview && bridge?.campaign === owedReview.campaign ? owedReview : undefined;
          run.owedWaited = true;
          const owedWait = owedPort?.settle(Math.max(0, now() - run.startedAt)).catch(() => undefined);
          let bindingArtifact: Extract<StepArtifact, {kind: 'read'}>['binding'];
          if (table.scope && table.readSet && table.binding) {
            run.turn ??= table.turn; run.scope ??= table.scope; run.readSet ??= table.readSet;
            run.intent ??= {id: `${run.runId}:intent`, scope: table.scope, turn: table.binding.turn, inputRevision: run.inputRevision, limits: ['single_loop_clerk'],
              rawInput: {version: 1, scope: table.scope, resource: `turn:${table.binding.campaign}:${table.binding.turn}`, revision: digest(run.rawInput),
                sourceType: 'turn', selector: {kind: 'utf16', start: 0, end: run.rawInput.length}}};
            bindingArtifact = {scope: run.scope, readSet: run.readSet, intent: run.intent};
          }
          // The product prescreen, inside the run: the first read and the read after a scene change. It has its own allowance,
          // which no decision spends (§135.6, SL-22 addendum), and every read that runs one gets it whole from its own start
          // (§135.6.1, SL-44); only the provider budget is per input. A read reuses unchanged evidence unless the policy explicitly requests more.
          const allowance = run.prescreenAllowanceMs, scene = table.context.scene;
          const sourceStamp=bridge?.moduleId&&bridge.runtime?.sourceText?await quiet('module.source.materials.snapshot',{module_id:bridge.moduleId,answer_limit:1}):undefined;
          const readKey=sourceReadReuseKey(scene,sourceStamp?.revision?[sourceStamp.revision,sourceStamp.answers_revision]:table.binding?.source_revision,run.rawInput);
          const reuse = !_proposal.params?.refresh && run.lastRead?.key === readKey ? run.lastRead.outcome : undefined;
          // Why a read ran without it (§135.6, 2026-09-24): live gate #4's rows said only `not_run`, and the cause -- the
          // preselect setting off in its launch -- had to be found by reading the launcher.
          const skipped = run.interactionScope?.mode !== undefined && run.interactionScope.mode !== 'world' ? 'reference_scope'
            : !jev ? 'no_jev' : !prescreenEnabled(options.env as NodeJS.ProcessEnv) && !_proposal.params?.refresh ? 'preselect_off' : !table.binding ? 'no_binding'
            : run.providerBudget.actions <= 0 ? 'allowance_spent' : !(bridge?.call && bridge.campaign) ? 'no_bridge' : undefined;
          let materials: Material[] = [], calls = 0, prescreen: Row = {status: 'not_run', reason: skipped ?? null}, packet: Row | undefined;
          let outcome: {step: string; materials: Material[]; message?: Row} | undefined;
          if (reuse) {
            // The same evidence binding as the previous read: its outcome again, at no Jev call and no time (a fallback's
            // outcome is no material; a re-run would only spend the remainder again).
            materials = reuse.materials; packet = reuse.message; outcome = reuse;
            prescreen = {status: 'reused', from: reuse.step, jev_calls: 0, ms: 0, materials: materials.length};
          } else if (!skipped && jev && bridge?.call && bridge.campaign && table.binding) {
            const events: Row[] = [], prescreenBegan = stepNow();
            const message = await prepareKeeperSupport({call: (method, params) => bridge!.call!(method, params), campaign: bridge.campaign,
              binding: table.binding, capsule, signal: invocation.signal, decision: jev,
              ...(bridge.moduleId&&bridge.runtime?.sourceInfo&&bridge.runtime?.sourceText?{source:{moduleId:bridge.moduleId,runtime:bridge.runtime}}:{}),env: options.env as NodeJS.ProcessEnv,
              record: event => { events.push(event); record({...event, run: run.runId, step: invocation.stepId}); },
              byteBudget: PRESCREEN_BYTES, deadlineAt: stepNow() + allowance, providerBudget: run.providerBudget, ...leaseClock});
            const prepared = events.find(event => event.event === 'prepared'), fallback = events.find(event => event.event === 'fallback');
            // A prescreen that fell back still spent its calls (§124.11): gate #5's read said 0 while 12 had run.
            calls = Number((prepared ?? fallback)?.jev_calls ?? 0);
            const found = packetMaterials(message ? object(message) : undefined);
            materials = found.materials;
            if (found.located.length) run.located = found.located;
            // What the read did, as the route question sees it under "done this turn": the prototype's read summary
            // (runs 11-13 decided the declared move with it), including the locate's own judgment of what is relevant.
            const prescreenMs = stepNow() - prescreenBegan;
            prescreen = {status: message ? 'prepared' : text(events.find(event => event.event === 'fallback' || event.event === 'skipped')?.event) || 'none',
              jev_calls: calls, ms: prescreenMs, allowance_ms: allowance, materials: materials.length, supplied: prepared?.supplied ?? null,
              stop_reason: prepared?.stop_reason ?? null, locate: prepared?.locate ?? null, located: found.located.length,
              fallback: fallback?.reason ?? null, ...(fallback?.key ? {key: fallback.key} : {}),
              ...(prepared?.binding_refresh ? {binding_refresh: prepared.binding_refresh} : {})};
            packet = message ? object(message) : undefined;
            outcome = {step: invocation.stepId, materials, ...(packet ? {message: packet} : {})};
            run.prescreenSpent.reads++; run.prescreenSpent.jev_calls += calls; run.prescreenSpent.ms += prescreenMs;
          }
          run.lastRead = {scene,key:readKey, ...(outcome ? {outcome} : {})};
          // §135.31.1: the scene's source passages are read off the prescreen's own materials (the packet before the issued bodies).
          if (outcome?.message) {
            let content: Row = {};
            try { content = object(JSON.parse(String(outcome.message.content ?? ''))); } catch { content = {}; }
            for (const material of array(content.materials).map(object)) run.passages.push({scene, material});
          }
          const waited = owedWait ? await owedWait : undefined;
          if (waited?.in_flight) {
            record({lane: 'run', event: 'owed_wait', run: run.runId, stepId: invocation.stepId, waited_ms: waited.waited_ms, landed: waited.landed, turn: waited.turn ?? null});
            if (waited.landed) { current = await tableReads(run); ({capsule, table, candidates, rows, consequences} = current); }
          }
          // Candidates are built after the locate, so a located clue or handout is among them.
          const fresh = {context: table.context, candidates: candidates(), rows: rows()};
          run.issued = fresh.candidates;
          // §135.20: the bodies of the issued candidates, which the Keeper would otherwise look or lookup, ride on the read
          // artifact and reach the Keeper in the run's packet (a packet of their own when the prescreen did not run).
          const issued = await readCandidateBodies({candidates: fresh.candidates, capsule, call}).catch(() => undefined);
          packet = withIssuedBodies(packet, issued);
          // §135.31: a person whose card went to the Keeper as an issued body is not carried again this run.
          for (const entry of issued?.bodies ?? []) if (entry.family === 'person') for (const name of [entry.name, text(entry.body.id)]) if (name) run.shown.people.add(name);
          if (packet && table.binding && bridge?.campaign)
            api?.events?.emit?.('coc:run-prescreen', {campaign: bridge.campaign, turn: table.binding.turn, run: run.runId, message: packet});
          const ms = stepNow() - began;
          record({lane: 'run', event: 'read', run: run.runId, stepId: invocation.stepId, ms, scene: table.context.scene,
            candidates: fresh.candidates.map(candidate => candidate.key), prescreen,
            ...(issued ? {bodies: {count: issued.bodies.length, bytes: issued.bytes, reads: issued.reads, ms: issued.ms,
              truncated: issued.bodies.filter(entry => entry.truncated).length, omitted: issued.omitted.map(entry => `${entry.key}:${entry.reason}`)}} : {})});
          // SL-76 (§135.32, §135.3.1): this read's D1 candidates are kept for the turn-close route, never asked
          // here. A read is not a decision (§135.6, SL-22), and the run's own route/compile/bind Jev calls stay
          // exactly what they were before SL-76 -- a mid-read consequence call was found, live-gate style, to move
          // `single-loop-compile.test.mjs`'s "the compile is the run's first Jev question" off true, and to make a
          // `read` reusing unchanged evidence spend one.
          run.consequenceCandidates = consequences();
          run.consequenceContext = table.context;
          // `calls`/`ms` are the prescreen's own, reported; the policy charges no read to the decision budget (§135.6, SL-22).
          const artifact: StepArtifact = {kind: 'read',
            read: {materials, summary: prescreen as Json, bodies: issued?.bodies ?? [],
              calls, ms: Number(prescreen.ms ?? 0)},
            fresh, ...(bindingArtifact ? {binding: bindingArtifact} : {})};
          return {status: 'ok', artifact};
        },
      },
      operations: {
        async execute(proposal, invocation) {
          if (proposal.origin === 'model' && invocation.executeModelTool) return modelStep(run, proposal, invocation.executeModelTool, invocation.stepId, invocation.signal);
          if (proposal.operation === 'llm_proposal') return {status: 'ok', artifact: {kind: 'execute', executed: {ok: true, summary: {slot: 'llm_proposal'}}}};
          if (proposal.operation === 'execute') return clerkStep(run, object(proposal.params), invocation);
          if (proposal.operation === 'turn_close') return turnCloseStep(run, invocation);
          return {status: 'refused', reason: 'unknown_policy_operation', artifact: {kind: 'execute', executed: {ok: false, summary: {refused: 'unknown_policy_operation'}}}};
        },
      },
      projection: {project: ({view, step, stepId}) => projection(run, view as unknown as {policyState: StepPolicyState}, step, stepId)},
      decision: {decide: request => decide(run, request)},
    };
  }

  /** One Keeper call of the batch its response made. A step that fails sends the rest of the batch back unrun. */
  async function modelStep(run: RunState, proposal: {operation: string; params?: unknown; assistantMessage?: unknown; toolCall?: {id: string}}, execute: () => Promise<any>,
    stepId: string, signal: AbortSignal) {
    if (run.batch?.message !== proposal.assistantMessage) run.batch = {message: proposal.assistantMessage};
    const batch = run.batch!;
    if (batch.fell) {
      const reason = `batch_step_fell: ${batch.fell}`;
      return {status: 'refused' as const, reason, artifact: {kind: 'execute', executed: {ok: false, summary: {tool: proposal.operation, skipped: true, after: batch.fellAt ?? null}}, skipped: true}};
    }
    if (proposal.operation === 'lookup' && object(proposal.params).kind === 'historical_reference'
      && run.history?.enabled && !run.history.closed && now() - run.startedAt >= run.budgetMs) {
      run.history.closed = true;
      run.history.closedReason = 'turn_budget_exhausted';
      record({lane: 'historical-reference', event: 'closed_received', run: run.runId, step: stepId, turn: run.turn,
        reason: run.history.closedReason});
    }
    // §151.5: what this step's catalog does not admit is refused before it runs -- on a narrowed compose, a verb outside
    // narrate/ask/propose; after an accepted `propose` in the same response, every other call (the proposed step has not
    // run yet). The kernel extension's tool gate honours the refusal this announcement carries.
    const catalog = run.stepCatalog, narrowed = catalog?.narrowed;
    const presumedHit = proposal.operation === 'apply' && run.unresolvedAttack === true
      && array(object(proposal.params).effects).some(effect => object(effect).kind === 'damage');
    const outsideScope = run.interactionScope?.mode !== undefined && run.interactionScope.mode !== 'world'
      && !permitsReferenceOperation(proposal.operation, proposal.params);
    const refuse = outsideScope ? {code: 'interaction_scope', text: 'This request does not authorize fictional progression. Only reference reads and an out-of-fiction answer are permitted. No world operation was executed.'}
      : presumedHit ? {code: 'check_outcome_unresolved', text: 'The declared attack has not been settled by the host. Damage cannot stand in for its missing check. '
      + 'Nothing in this apply was executed. Narrate the attempt by your own judgement without inflicting damage this turn.'}
      : proposal.operation === 'resolve' ? {code: 'check_selection_owned', text: 'Jev and the host own check selection. This model-origin resolve was not executed. '
      + 'Narrate committed receipts, and narrate any attempt the host left without a roll by your own judgement; do not choose a replacement check.'}
      : proposal.operation === PROPOSE_VERB ? undefined
      : batch.proposed ? {code: 'propose_pending', text: PROPOSE_PENDING_REFUSAL}
        : narrowed && !narrowed.includes(proposal.operation)
          && !(proposal.operation === 'lookup' && run.history?.enabled && (isSavedHistoryRead(proposal.params)
            || object(proposal.params).kind === 'historical_reference' && (run.history.allowed || run.history.closed)))
          ? {code: 'narrator_catalog', text: catalogRefusal(proposal.operation, run.offered)} : undefined;
    // §135.31: the kernel extension's tool row names the step a model call came from (announced before it runs).
    if (proposal.toolCall?.id) api?.events?.emit?.('coc:model-step', {toolCallId: proposal.toolCall.id, run: run.runId, step: stepId, operation: proposal.operation,
      ...(run.pendingAttackPreparation && proposal.operation === 'apply' && array(object(proposal.params).effects).some(value => {
        const effect = object(value);
        return ['define','object','usage'].includes(effect.kind) || effect.kind === 'npc' && effect.archetype !== undefined;
      }) ? {hold_embedded_narration:true} : {}),
      ...(run.history && run.scope ? {historical_reference: {...run.history, allowed: run.history.allowed && !run.history.closed,
        ...(run.history.closed ? {retrieval: {state: 'closed', reason: run.history.closedReason ?? 'budget_exhausted'}} : {}),
        scope: run.scope, turn: run.turn}} : {}),
      ...(refuse ? {refuse: refuse.text, refuse_code: refuse.code} : {})});
    if (refuse) record({lane: 'run', event: 'catalog_refused', run: run.runId, step: stepId, operation: proposal.operation, reason: refuse.code});
    // SL-78 (§135.32 addendum 2, the `residual` row): every Keeper tool call among the five bookkeeping verbs is
    // counted here, attempt or not -- a refused free-text call is exactly the residual SL-78 measures.
    if (isKeeperResidualKey(proposal.operation)) run.keeperCalls[proposal.operation]++;
    // §151.5: a `propose` is settled here, before the registered tool returns what was settled: queued or refused.
    const queued = proposal.operation === PROPOSE_VERB && proposal.toolCall?.id && proposeRegistered
      ? await proposeStep(run, proposal.toolCall.id, object(proposal.params).key, stepId) : undefined;
    const toolResult = await execute();
    if (!toolResult.isError && proposal.operation === 'lookup' && object(proposal.params).kind === 'historical_reference'
      && object(object(toolResult.details).retrieval).state === 'closed' && run.history && !run.history.closed) {
      run.history.closed = true;
      run.history.closedReason = object(object(toolResult.details).retrieval).reason === 'turn_budget_exhausted'
        ? 'turn_budget_exhausted' : 'budget_exhausted';
      record({lane: 'historical-reference', event: 'closed_received', run: run.runId, step: stepId, turn: run.turn,
        reason: object(object(toolResult.details).retrieval).reason});
    }
    // SL-92: an apply whose embedded narrate landed closed the turn exactly as an explicit narrate would (the
    // kernel extension ran the same table.narrate call, on a synthetic call of its own); `DELIVERY_VERBS` only
    // ever named the two real delivery verbs, so this apply's own `narrate_in_apply` flag is read beside it.
    const delivery = !toolResult.isError
      ? DELIVERY_VERBS[proposal.operation]
        ?? (proposal.operation === 'apply' && (toolResult.details as {narrate_in_apply?: unknown} | undefined)?.narrate_in_apply === true ? 'accepted' : undefined)
      : undefined;
    const fell = toolResult.isError ? refuse?.code ?? `${proposal.operation}_refused` : proposal.operation === 'resolve' && failedCheck(toolResult.details) ? 'check_failed' : undefined;
    if (fell) { batch.fell = fell; batch.fellAt = proposal.toolCall?.id; }
    // §151.5: an accepted `propose` holds the rest of its response until the proposed step has run.
    if (queued && !toolResult.isError) batch.proposed = true;
    // An accepted delivery is terminal. Collect its final receipts without issuing another action space.
    if (delivery) rememberReceipts(run, await quiet('table.status'));
    const fresh = !delivery && !toolResult.isError && WRITE_VERBS.has(proposal.operation) ? (await freshOf(run, stepId))?.fresh : undefined;
    // SL-78: the Keeper's own settled write (never merely proposed) is a point a listed D1 class can newly clear
    // from, the same as a clerk write. `off`/`shadow` return at once inside `routeConsequencesAfterWrite`.
    if (fresh) await routeConsequencesAfterWrite(run, fresh, signal, stepId).catch(() => undefined);
    // SL-85: a real `narrate`/`ask` delivery is the turn's true close exactly as much as a `turn_close` proposal's
    // `delivered` verdict is (§135.11: `turn_close` is proposed only for "a run with no delivery evidence" --
    // a Keeper that delivers here is never proposed one at all). Without this, a turn delivered this way wrote no
    // pairing/residual row at all (SL-85's evidence: turns 1, 11, 12, 14, 17, 19). `closeConsequences` is the same
    // once-per-run guard `turnCloseStep` uses, so a run that somehow reaches both paths still writes once. It
    // spends no extra Jev call here (unlike `turnCloseStep`'s own `routeConsequences`): it only writes telemetry
    // over whatever `run.consequenceRows`/`consequenceExists` already hold from this run's own writes (each
    // `apply`/`resolve` already routed itself through `routeConsequencesAfterWrite`), never asking Jev again for a
    // turn that is closing by a Keeper delivery instead of a `turn_close` proposal.
    if (delivery) {
      recordUnpreparedChecks(run);
      closeConsequences(run);
    }
    return {status: toolResult.isError ? 'refused' as const : 'ok' as const, toolResult, ...(delivery ? {delivery} : {}),
      artifact: {kind: 'execute', executed: {ok: !toolResult.isError, summary: {tool: proposal.operation, ...(queued ? {proposed: queued.key} : {})}},
        ...(fresh ? {fresh} : {}), ...(fell ? {fell} : {}), ...(narrowed ? {narrator: true} : {}), ...(queued && !toolResult.isError ? {proposed: queued} : {})}};
  }

  /**
   * §151.5: one `propose {key}` of the Keeper's. Admitted on a step whose catalog has it (a compose or an adjudicate step
   * while the setting is on), for a key of the step's offered set that this run has not proposed, within the per-turn cap
   * (data). An accepted key is queued: the policy runs it as one more clerk step (its own bind, the gateway, admission)
   * before the Keeper's next step. Either way the outcome waits here for the registered tool to return it.
   */
  async function proposeStep(run: RunState, toolCallId: string, key: unknown, stepId: string): Promise<Candidate | undefined> {
    run.proposeCalls++;
    const setting = await narratorSetting();
    const turnId = `${bridge?.campaign ?? ''}:${run.turn ?? ''}`, used = proposeTurn?.id === turnId ? proposeTurn.used : 0;
    const refusal = run.stepCatalog?.propose !== true
      ? {code: 'not_in_catalog', text: `propose is not in this ${run.stepCatalog?.purpose ?? 'model'} step's catalog: call the verb the note names; nothing was carried out.`}
      : proposeRefusal({key, offered: run.offered, proposed: run.proposedKeys, used, cap: setting.proposePerTurn});
    if (refusal) {
      proposeOutcomes.set(toolCallId, {ok: false, text: refusal.text});
      record({lane: 'run', event: 'propose', run: run.runId, step: stepId, key: typeof key === 'string' ? key.slice(0, 200) : null, status: 'refused', reason: refusal.code});
      return undefined;
    }
    const candidate = run.offered.find(value => value.key === key)!;
    proposeTurn = {id: turnId, used: used + 1};
    run.proposedKeys.add(candidate.key);
    proposeOutcomes.set(toolCallId, {ok: true, text: proposeQueuedText(candidate), details: {proposed: candidate.key}});
    record({lane: 'run', event: 'propose', run: run.runId, step: stepId, key: candidate.key, family: candidate.family, clerk: candidate.clerk ?? null, status: 'queued'});
    return proposedCandidate(candidate, {run: run.runId, step: stepId});
  }

  /**
   * One policy-origin write through the kernel extension's canonical gateway, under the run's clerk lease: the same Keeper
   * verb, the `tool_call` gates, admission (reading `bindings` off the host origin), Mod hooks, kernel and `tool_result`
   * hooks. `unavailable` when there is no gateway to run it through.
   */
  async function dispatchClerk(run: RunState, write: {tool: 'apply' | 'resolve'; args: Row; clerk: string; basis?: Json; bindings: Json},
    invocation: {stepId: string; operationId: string; signal: AbortSignal}): Promise<{unavailable: true} | {unavailable?: false; packet: ObservationPacket; callId: string | null; staleCheck: boolean}> {
    const session = run.session, dispatcher = gateway;
    if (!session || !dispatcher || !bridge?.campaign || !run.scope || run.turn === undefined) return {unavailable: true};
    const {tool, args} = write;
    const readSet: ReadSet = [{kind: 'world', resource: run.scope.campaign!, revision: digest([run.turn, run.inputRevision])}];
    run.lease ??= new TaskLease({owner: 'single-loop-clerk', goal: run.rawInput.trim() || 'single-loop clerk step', scope: run.scope, capabilities: ['apply', 'resolve'],
      readSet, signal: invocation.signal,
      budget: {deadlineAt: Date.now() + 300_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
    const lease = run.lease, task = lease.context;
    const operation: OperationProposal = {id: `clerk:${invocation.operationId}`, taskId: task.id, operation: tool, args: args as Record<string, Json>,
      capability: tool, scope: task.scope, readSet: task.readSet, basis: []};
    const campaign = bridge.campaign, kernel = bridge.call!;
    let staleCheck = false;
    const context: HostOperationContext = {
      session: session as any, task: lease,
      journal: {load: async id => run.identities.get(id), save: async identity => { run.identities.set(identity.operationId, structuredClone(identity)); }},
      // The run's input is still the table's: same turn, still open. A new input ends the run through its signal.
      validateCurrent: async () => {
        const status = object(await kernel('table.status', {campaign}));
        const snapshot = object(object(write.basis).selection_snapshot);
        if (tool === 'resolve' && typeof snapshot.revision === 'string' && typeof snapshot.worldRevision === 'string') {
          const current = object(await kernel('table.resolve.options', {campaign}));
          if (current.revision !== snapshot.revision || current.world_revision !== snapshot.worldRevision) {
            staleCheck = true;
            record({lane: 'check-selection', event: 'execution_stale', run: run.runId, step: invocation.stepId,
              expected: snapshot, actual: {revision: current.revision ?? null, worldRevision: current.world_revision ?? null},
              context: current.context ?? null});
            throw new ContractError('check_selection_stale');
          }
        }
        if (status.turn !== run.turn || !['open', 'acting'].includes(String(status.state))) throw new ContractError('run_input_stale');
      },
      recover: async identity => {
        if (!identity.request) return {status: 'absent', activeTurn: Number(object(await kernel('table.status', {campaign})).turn)};
        const result = object(await kernel('table.call_status', {campaign, call_id: identity.callId, request: identity.request,
          scope: {worldline: run.scope!.worldline, loop: run.scope!.loop}}));
        if (result.status === 'settled') return {status: 'settled', result: result.result as Record<string, Json>};
        if (result.status !== 'absent') throw new ContractError('operation_recovery_invalid');
        return {status: 'absent', activeTurn: result.active_turn as number};
      },
      trace: row => record({lane: 'run', event: 'operation_stage', run: run.runId, step: invocation.stepId, ...row}),
      origin: {origin: 'policy', run: run.runId, step: invocation.stepId, clerk: write.clerk, ...(write.basis !== undefined ? {basis: write.basis} : {}),
        bindings: write.bindings},
    };
    const packet = await dispatcher.dispatch(operation, context);
    return {packet, callId: run.identities.get(operation.id)?.callId ?? null, staleCheck};
  }

  /**
   * A clerk (policy-origin) write: the candidate's Keeper verb through the kernel extension's canonical gateway, so
   * the `tool_call` gates, admission, Mod hooks, the kernel and the `tool_result` hooks run exactly as for the model.
   */
  async function clerkStep(run: RunState, params: Row, invocation: {runId: string; stepId: string; operationId: string; signal: AbortSignal}) {
    const candidate = params.candidate as Candidate | undefined, extra = object(params.extra) as Record<string, Json>;
    const refuse = (reason: string) => ({status: 'refused' as const, reason, artifact: {kind: 'execute', executed: {ok: false, summary: {origin: 'policy', refused: reason}}}});
    if (run.interactionScope && run.interactionScope.mode !== 'world') return refuse('interaction_scope');
    if (!candidate) return refuse('no_candidate');
    // The IntentBinding is required: no policy-origin write before a read has bound the run to this player input.
    if (!run.intent || !run.scope || run.turn === undefined) return refuse('intent_unbound');
    if (!candidate.clerk || !(CLERK_AUTHORITY as readonly string[]).includes(candidate.clerk)) return refuse('not_clerk_authority');
    const unavailable = {status: 'unavailable' as const, reason: 'operation_gateway_unavailable',
      artifact: {kind: 'execute', executed: {ok: false, summary: {origin: 'policy', refused: 'operation_gateway_unavailable'}}}};
    if (!run.session || !gateway || !bridge?.campaign) return unavailable;
    // §143.3/§143.4: a person's own act is its own step: generated, bound, then written through this same gateway.
    if (isNpcAct(candidate)) return npcActStep(run, candidate, invocation);
    const {tool, args} = keeperCall(candidate, extra);
    if (candidate.clerk === 'first_blow') {
      const latest = await call('table.resolve.options'), first = object(object(latest.context).first_blow);
      const needs = attackPreparationNeeds(first, object(args.action) as Record<string, Json>);
      if (needs.length) {
        const preparation = {decision:'combat:attack', needs};
        record({lane:'check-preparation', run:run.runId, step:invocation.stepId, ...preparation});
        const fresh = (await freshOf(run, invocation.stepId))?.fresh;
        return {status:'refused' as const, artifact:{kind:'execute', executed:{ok:false, summary:{refusal:'check_preparation', preparation,
          action:object(args.action), bindings:array(params.bindings)}}, ...(fresh ? {fresh} : {})}};
      }
    }
    // §135.28: how every parameter of this write got its value (jev, rule-default, stated, composed); none was a model call.
    // Computed before the dispatch (§32.12): admission reads it off the host origin to admit a compile selection.
    const savedBindings = array(object(candidate.basis).preparation_bindings);
    const bindings = bindRecords(candidate, extra, (savedBindings.length ? savedBindings : array(params.bindings)) as BindRecord[]);
    const dispatched = await dispatchClerk(run, {tool, args, clerk: candidate.clerk, ...(candidate.basis !== undefined ? {basis: candidate.basis} : {}),
      bindings: admissionBindings(bindings, extra) as Json}, invocation);
    if (dispatched.unavailable) return unavailable;
    const {packet, callId} = dispatched;
    const ok = packet.status === 'succeeded';
    const result = object(packet.result);
    const refusal = ok ? undefined : dispatched.staleCheck ? 'check_selection_stale' : object(result.coc_error).code ?? result.code ?? packet.status;
    const {goal: _goal, method: _method, ...shown} = object(tool === 'resolve' ? args.action : {}) as Row;
    const obligation = obligationClerkLine(candidate, ok, result, packet.receipts), crossed = ok ? obligationCrossing(candidate, result, packet.receipts) : undefined;
    // §138.6: a `needs` the host answered inside this write (a tier pinned, a profile read) is said beside the defaults.
    const recovery = object(result.band_recovery), bandLine = text(recovery.band)
      ? `band: ${text(recovery.name)} ${recovery.field === 'archetype' ? 'pinned as' : 'read as the profile'} ${text(recovery.band)} (${text(recovery.table)}, confidence ${Number(recovery.confidence ?? 0).toFixed(2)}); the host answered the kernel's needs before this write. To rule otherwise, settle it with your own operation.`
      : undefined;
    const read = await freshOf(run, invocation.stepId);
    // §138.10: a band the clerk named carries the kernel's roll on its record, read back from the turn's receipts.
    const rolled = bandRolls(bindings, ok ? packet.receipts : [], read?.receipts ?? []);
    // A refused write landed no band: its line would tell the Keeper to rule otherwise on nothing.
    const binding = [defaultLine(candidate), bandLine, ok ? bandedLine(candidate, rolled) : undefined].filter((line): line is string => !!line).join(' ') || undefined;
    // §135.28: how every parameter of this write got its value (jev, rule-default, stated, composed, banded); none was a model call.
    record({lane: 'run', event: 'bind', run: run.runId, step: invocation.stepId, candidate: candidate.key, clerk: candidate.clerk, call_id: callId, status: packet.status, bindings: rolled});
    // §135.31: the people an executed clerk step names are carried to the Keeper before its next model step.
    if (ok) for (const name of namedPeople(candidate)) if (!run.named.includes(name)) run.named.push(name);
    run.clerkDid.push({step: invocation.stepId, operation: tool, label: candidate.label, clerk: candidate.clerk, call_id: callId, status: packet.status,
      receipts: packet.receipts, ...(candidate.basis !== undefined ? {basis: candidate.basis} : {}),
      result: (tool === 'resolve' ? {action: shown, outcome: result.outcome ?? null, ...(result.obligation ? {obligation: result.obligation} : {})} : {effects: args.effects}) as Json,
      ...(obligation ? {obligation} : {}), ...(crossed ? {obligation_open: crossed} : {}), ...(binding ? {binding} : {})});
    // SL-85: an executed consequence candidate's own receipt ids, so the turn-close pairing (`pairConsequences`)
    // can exclude them and ask "did the Keeper *also* file this, independently" -- never "does the clerk's own
    // write pair with itself". `packet.receipts` is already an array of receipt id strings (the canonical
    // operation dispatcher's own shape, `canonical-operation-dispatcher.ts`), the same ids `table.status.receipts[].id`
    // carries -- never an array of receipt objects.
    if (ok && (candidate as Partial<ConsequenceCandidate>).consequenceClass)
      run.consequenceExecutedReceiptIds.set(candidate.key, array(packet.receipts).filter((value): value is string => typeof value === 'string'));
    // SL-78 (§135.32 addendum 2): a settled clerk write -- the compile's own declared step, or (recursively) an
    // executed consequence step itself -- is a point a listed D1 class can newly clear from; this is the loop's
    // re-route, run here, before the run's next step. A refused write settles nothing and re-routes nothing.
    if (ok && read) await routeConsequencesAfterWrite(run, read.fresh, invocation.signal, invocation.stepId).catch(() => undefined);
    return {status: ok ? 'ok' as const : 'refused' as const, ...(ok ? {} : {reason: String(refusal)}),
      artifact: {kind: 'execute', executed: {ok, summary: {origin: 'policy', tool, call_id: callId, status: packet.status, receipts: packet.receipts,
        clerk: candidate.clerk ?? null, basis: candidate.basis ?? null, ...(ok ? checkOf(tool, result) : {}), ...(ok ? {} : {refusal: String(refusal)})} as Json},
      ...(read ? {fresh: read.fresh} : {})}};
  }

  /**
   * §143.3/§143.4: a person's own act (`npc_act`) -- on their turn of a fight (`trigger: turn`), or for every person
   * present the declaration acted on (`trigger: acted_on`, `runNpcScan`, at most `npc_act.max_per_turn` a turn). Each
   * act is generated (the npc-act lane), bound by one closed Jev batch under its own lease (never the policy's decision
   * budget: §135.28's clerk bind exception), and written through the same gateway as every clerk step with authority
   * `npc_act`. The step always succeeds for the policy: an unavailable generation, an unbound act or a refused write is
   * the act's outcome (a `lane: run`, `event: npc_act` row), and the turn goes on to the Keeper.
   */
  async function npcActStep(run: RunState, candidate: Candidate, invocation: {runId: string; stepId: string; operationId: string; signal: AbortSignal}) {
    const trigger = candidate.bound.trigger === 'acted_on' ? 'acted_on' as const : 'turn' as const;
    const budget = await npcActBudget();
    let writes = 0;
    const deps: NpcActDeps = {
      call: (method, params) => call(method, params),
      generate: (input, signal) => npcActPort().generate(input, signal),
      ...(jev ? {decide: async (batch: DecisionBatch) => {
        const lease = new TaskLease({owner: batch.family, goal: `run ${run.runId} npc act`, scope: batch.scope, capabilities: ['decision'], readSet: batch.readSet,
          signal: invocation.signal, budget: {deadlineAt: Date.now() + 15_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
        try { return await jev.decide(batch, lease); } finally { lease.close(); }
      }} : {}),
      write: async (planned, basis) => {
        const dispatched = await dispatchClerk(run, {tool: planned.tool, args: planned.args, clerk: 'npc_act', basis, bindings: [] as Json},
          {stepId: invocation.stepId, operationId: `${invocation.operationId}/w${++writes}`, signal: invocation.signal});
        if (dispatched.unavailable) return {ok: false, callId: null, receipts: [], status: 'unavailable', refusal: 'operation_gateway_unavailable'};
        const {packet, callId} = dispatched, ok = packet.status === 'succeeded', result = object(packet.result);
        return {ok, callId, receipts: [...packet.receipts], status: packet.status, result,
          ...(ok ? {} : {refusal: String(object(result.coc_error).code ?? result.code ?? packet.status)})};
      },
      record, ...(run.scope ? {scope: run.scope} : {}), ...(run.readSet ? {readSet: run.readSet} : {}),
      runId: run.runId, stepId: invocation.stepId, turn: run.turn ?? 0, gate: DEFAULT_CONFIDENCE_GATE, budget, signal: invocation.signal,
    };
    let outcomes: NpcActOutcome[];
    // §143.25: the people a pending fight action held back from this scan (never an npc_act row: they did not act).
    const held: Json[] = [];
    if (trigger === 'turn') {
      const npc = text(candidate.bound.npc);
      run.npcSeen.add(npc);
      outcomes = [await runNpcAct(deps, npc, 'turn')];
      // An NPC's turn the act did not pass is the Keeper's; the next note says so once (§143.4).
      const [outcome] = outcomes, round = object(object(candidate.basis).row).round;
      if (outcome.passedTurn !== true) run.npcTurnLeft = {key: `${npc}:r${String(round ?? '')}`, npc, status: outcome.status, reason: outcome.reason ?? null, act: outcome.act ?? null};
    } else {
      const pending = object(candidate.bound.fight_pending);
      outcomes = await runNpcScan(deps, {present: run.present, addressees: array(candidate.bound.addressees).map(text).filter(Boolean), seen: run.npcSeen, count: run.npcCount,
        // §143.21: a move this turn (the declaration precedes every write of its turn) and who was here when it was put.
        firstPresent: run.firstPresent ?? [], moved: run.turnReceipts.some(receipt => receipt.kind === 'move'),
        // §143.25: a declared fight action no clerk step has settled yet.
        ...(Object.hasOwn(object(candidate.bound), 'fight_pending') ? {fightPending: {named: array(pending.named).map(text).filter(Boolean)}} : {}), held: held as Row[]});
    }
    // What the table's acts did this turn reaches the Keeper beside the clerk's other steps (§135.11's clerk_did).
    for (const outcome of outcomes) if (outcome.status !== 'failed')
      run.clerkDid.push({step: invocation.stepId, operation: 'npc_act', label: `${outcome.handle ?? outcome.npc}: ${outcome.act ?? '(no act)'}`, clerk: 'npc_act',
        call_id: outcome.calls[0]?.call_id ?? null, status: outcome.status, receipts: outcome.receipts, ...(candidate.basis !== undefined ? {basis: candidate.basis} : {}),
        result: {npc: outcome.handle ?? outcome.npc, trigger: outcome.trigger, act: outcome.act ?? null, way: outcome.way ?? null, params: (outcome.params ?? {}) as Json,
          ref: outcome.ref ?? null, continued: outcome.continued ?? null, abandoned: outcome.abandoned ?? null, reason: outcome.reason ?? null} as Json});
    // §143.20: a scan that ran nobody wrote nothing (the scan now runs every turn), so there is nothing to read again.
    const read = outcomes.length ? await freshOf(run, invocation.stepId) : undefined;
    // §143.28: the hold this scan put is the run's hold now (a scan that held no one ends any earlier one), with the receipts
    // already on the table: a blow after it -- whoever settles the punch the clerk did not -- lets them act once.
    if (trigger !== 'turn') run.npcHeld = held.length
      ? {names: held.map(value => text(object(value).npc)).filter(Boolean), before: run.turnReceipts.map(receipt => text(receipt.id)).filter(Boolean)} : undefined;
    return {status: 'ok' as const, artifact: {kind: 'execute', executed: {ok: true, summary: {origin: 'policy', clerk: 'npc_act', trigger,
      acts: outcomes.map(outcome => ({npc: outcome.handle ?? outcome.npc, status: outcome.status, way: outcome.way ?? null, receipts: outcome.receipts})),
      ...(held.length ? {held} : {})} as Json},
    ...(read ? {fresh: read.fresh} : {})}};
  }

  /**
   * §135.11: what the turn close did. The kernel extension's verdict is the evidence of a delivery this run committed
   * (the implicit narrate of a prose-only reply), or the steer the Keeper is owed, or why nothing is owed.
   */
  /**
   * SL-76 (D4): the shadow route's paired telemetry, written once, at turn close, over everything `routeConsequences`
   * accumulated this run -- never during the read itself, so `keeper_did` (read off `run.turnReceipts`, which by
   * then holds the whole turn's receipts) is always known when the row is written.
   */
  function pairConsequences(run: RunState) {
    if (!run.consequenceRows.size && !run.consequenceExists.size) return;
    const mode = stepsMode();
    for (const [key, row] of run.consequenceRows) {
      // SL-85 (§135.32 addendum 2's "clerk did" line, this ticket's own ruling): an executed candidate's row
      // pairs against the Keeper's writes *other than the clerk's own receipt* -- excluded here by id, never by
      // re-deriving "was this the clerk's" from the receipt's shape -- and carries `executed: true`. A row whose
      // class was never executed this turn (unlisted in `jev_steps.execute`, or listed but not cleared) reads
      // exactly as the shadow path always did: `shadow: true`, even under `COC_JEV_STEPS=on`.
      const executed = run.consequenceExecuted.has(key);
      const ownReceiptIds = executed ? new Set(run.consequenceExecutedReceiptIds.get(key) ?? []) : undefined;
      const receiptsForPairing = ownReceiptIds ? run.turnReceipts.filter(receipt => !ownReceiptIds.has(text(receipt.id))) : run.turnReceipts;
      record({lane: 'route', purpose: 'consequence', shadow: mode !== 'on' || !executed, run: run.runId, class: row.class, key,
        cleared: row.cleared, confidence: row.confidence, distribution: row.distribution, ...(row.direct ? {direct: true} : {}),
        ...(executed ? {executed: true} : {}),
        keeper_did: keeperDidFor({consequenceClass: row.class, target: row.target, clue: row.clue}, receiptsForPairing)});
    }
    for (const [cls, row] of run.consequenceExists) record({lane: 'route', purpose: 'consequence', shadow: mode !== 'on', run: run.runId, class: cls, exists: true,
      cleared: row.cleared, confidence: row.confidence, distribution: row.distribution});
    if (run.consequenceMs) record({lane: 'run', event: 'consequence_budget', run: run.runId, ms: run.consequenceMs, rows: run.consequenceRows.size, ...stepsModeFields()});
  }

  /**
   * SL-78 (§135.32 addendum 2; design D4 "Residual telemetry per turn"): one `lane: "residual"` row per turn,
   * `COC_JEV_STEPS=on` only -- `off`/`shadow` write none of this, so they stay byte for byte what they were
   * before this ticket. `keeper_calls` is the Keeper's own tool calls (`modelStep`'s counter); `compile_calls`
   * every `purpose: "compile"` decision this run asked (`decide`'s counter); `clerk_calls` every policy-origin
   * write the gateway saw this run (`run.clerkDid.length`, unconditional on success: a refused clerk write still
   * used the gateway); `consequence_calls` the subset of those whose `clerk` was `consequence_bookkeeping` (SL-78's
   * own executions, never the compile-selected `declared_bookkeeping`/`declared_check`/… ones).
   */
  function recordResidual(run: RunState): void {
    if (stepsMode() !== 'on') return;
    record({lane: 'residual', run: run.runId, turn: run.turn ?? null, keeper_calls: {...run.keeperCalls}, compile_calls: run.compileCalls,
      clerk_calls: run.clerkDid.length, consequence_calls: run.consequenceCalls ?? 0, ...stepsModeFields(),
      // §151.5: with the narrator-only setting on, the Keeper's `propose` calls this turn (queued or refused), D6 3's count.
      ...(run.narrator?.on ? {propose_calls: run.proposeCalls} : {})});
  }

  /**
   * SL-85 (§135.32 addendum 2's own "once per turn" ruling, which the code did not yet keep): the single choke
   * point for the pairing rows and the `residual` row, called from every path that can be the turn's *true* close
   * -- `turnCloseStep`'s non-`steer` verdicts, and `modelStep`'s own `narrate`/`ask` delivery (§135.11's "a run
   * with no delivery evidence" is exactly the case `turnCloseStep` is proposed for; a Keeper that delivers on its
   * own is never proposed one at all, so nothing downstream of this ticket's fix would otherwise write these rows
   * for that turn). `run.residualWritten` makes either shape idempotent: a `turn_close` proposal that comes back
   * `steer` calls `routeConsequences` (unchanged: it still needs the latest D1 state for the Keeper's next note)
   * but never this function, so the *next*, truly final call is the one and only writer -- "last writer wins"
   * falls out of writing once, at the end, rather than writing every time and picking a winner afterward.
   */
  function closeConsequences(run: RunState): void {
    if (run.residualWritten) return;
    run.residualWritten = true;
    pairConsequences(run);
    recordResidual(run);
  }

  async function turnCloseStep(run: RunState, invocation: {stepId: string; signal: AbortSignal}) {
    // SL-76: the shadow route's one Jev call per run, made here -- after the run's own route/compile/bind calls are
    // long done, so it can never be mistaken for the run's first decision, and a `read_more` that must spend no
    // Jev call (§135.6's same-scene reuse) still spends none. A `turn_close` proposal that comes back `steer` (the
    // Keeper is nudged, then asked again) calls this a second time in the same run; only the pairing/residual
    // rows below are guarded against that (`closeConsequences`) -- this call itself still refreshes the D1 state
    // for whichever note comes next.
    await routeConsequences(run, run.consequenceCandidates, run.consequenceContext ?? emptyTurnContext(), invocation.signal, invocation.stepId);
    const done = (status: 'ok' | 'unavailable', verdict: Row, delivery?: 'accepted' | 'awaiting_player') =>
      ({status, ...(delivery ? {delivery} : {}), ...(status === 'unavailable' ? {reason: 'turn_close_unavailable'} : {}),
        artifact: {kind: 'turn_close', verdict} as StepArtifact});
    if (!closer) { closeConsequences(run); return done('unavailable', {status: 'unavailable', reason: 'no_turn_close_port'}); }
    let verdict: Row;
    try { verdict = object(await closer.verdict()); } catch (error) {
      closeConsequences(run);
      return done('unavailable', {status: 'unavailable', reason: String((error as Error)?.message ?? error).slice(0, 200)});
    }
    if (verdict.status === 'delivered') {
      const delivery = verdict.delivery === 'awaiting_player' ? 'awaiting_player' as const : 'accepted' as const;
      recordUnpreparedChecks(run);
      closeConsequences(run);
      return done('ok', {status: 'delivered', delivery, implicit: verdict.implicit === true, call_id: verdict.call_id ?? null, turn: verdict.turn ?? null}, delivery);
    }
    if (verdict.status === 'steer' && verdict.message && typeof verdict.message === 'object') {
      // Not a close: the run continues (the Keeper is nudged, then this operation is proposed again). Writing
      // here is exactly SL-85's duplicate -- the pairing/residual rows wait for the call that actually closes.
      run.steer = object(verdict.message);
      return done('ok', {status: 'steer', kind: text(verdict.kind) || 'steer'});
    }
    closeConsequences(run);
    return done('ok', {status: 'none', reason: text(verdict.reason) || 'nothing_owed'});
  }

  /** Jev's decisions: route and closed bind through the DecisionPort, the ordinary check through its binder. */
  async function decide(run: RunState, request: {runId: string; stepId: string; purpose: string; question: unknown; signal: AbortSignal}) {
    const question = object(request.question);
    if (request.purpose === 'interaction-scope') {
      let scope = interpretInteractionScope(undefined, 0);
      if (jev && bridge?.campaign) {
        const lease = new TaskLease({owner: 'interaction-scope', goal: 'Read whether this user authorizes fictional action',
          scope: {owner: run.runId, campaign: bridge.campaign, audience: 'keeper'}, readSet: [], capabilities: ['decision'], signal: request.signal,
          budget: {deadlineAt: Date.now() + 15_000, remainingInputTokens: 30_000, remainingOutputTokens: 3000, remainingCostUsd: 1, remainingActions: 1}});
        try {
          const status = await withinCheckLease(lease, () => call('table.status'));
          run.turn = Number(status.turn);
          const batch = interactionScopeBatch(run.rawInput, status.last_interaction ?? status.last_exchange ?? null, lease.context.scope);
          const answer = await withinCheckLease(lease, () => jev.decide(batch, lease));
          scope = interpretInteractionScope(answer);
          record({lane: 'interaction-scope', run: run.runId, ...scope, state: batch.state, questions: batch.questions, answers: answer.answers});
        } catch (error) { scope = {...scope, reason: error instanceof Error ? error.message : 'scope_unavailable'}; }
        finally { lease.close(); }
      }
      run.interactionScope = scope;
      return {status: 'ok' as const, artifact: {kind: 'interaction-scope', scope} as StepArtifact};
    }
    // Local packing refusals are policy observations even when no provider is configured.
    if (question.offline) return {status: 'unavailable' as const, artifact: {reason: `offline_${text(question.offline)}`}};
    if (!jev) return {status: 'unavailable' as const, reason: 'jev_unavailable'};
    // SL-78 (the `residual` row): every compile decision this run asked, whatever it answers -- counted here,
    // at the one place every `purpose: "compile"` request passes, rather than duplicated at each call site.
    if (request.purpose === 'compile') run.compileCalls++;
    if (request.purpose === 'locate') return {status: 'ok' as const, artifact: {kind: 'locate', calls: 0, ms: 0, summary: {folded_into: 'read'}} as StepArtifact};
    if (request.purpose === 'check-selection') {
      const candidate = question.candidate as Candidate | undefined;
      const missing = (reason: string, calls = 0): CheckSelection => ({status: 'unresolved', needs: [reason], calls});
      let selection = missing('check_selection_unavailable');
      if (jev && run.scope && run.readSet && run.turn !== undefined && bridge?.campaign && bridge.call) {
        const lease = new TaskLease({owner: 'check-selection', goal: run.rawInput.trim() || 'select required checks', scope: run.scope, capabilities: ['decision'],
          readSet: run.readSet, signal: request.signal, ...leaseClock,
          // Like the existing ordinary binder, this decision owns its lease; prescreen time is separate.
          budget: {deadlineAt: stepNow() + 15_000, remainingInputTokens: 400_000,
            remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
        try {
          const [options, capsule] = await withinCheckLease(lease, () => Promise.all([call('table.resolve.options'), call('table.capsule')]));
          const context = object(options.context), binding = object(context._binding), catalog = object(options.selection);
          const checks = catalog.owner === 'jev' && catalog.version === 1 ? validateCheckOptions(catalog.options) : undefined;
          if (!candidate || typeof candidate.bound.decision !== 'string') selection = missing('check_request_unbound');
          else if (!checks || binding.campaign !== bridge.campaign || binding.turn !== run.turn || binding.worldline !== run.scope.worldline
            || binding.loop !== run.scope.loop || context.declared_action !== run.rawInput) selection = missing('check_catalog_binding_changed');
          else if (catalog.session_owned === true) selection = missing('check_session_owner');
          else {
            const {_binding, ...visibleContext} = context;
            selection = await selectCheck({options: checks, declaration: run.rawInput,
              request: {decision: candidate.bound.decision as string, bound: candidate.bound},
              context: {...visibleContext, rules: object(candidate.detail).rule_guidance ?? [], situation: catalog.situation ?? null,
                scene_holds: {where: capsule.where ?? null, clues: object(capsule.known).clues_here ?? [], obligations: capsule.obligations ?? []}} as Json,
              scope: run.scope, readSet: run.readSet, lease, decision: jev,
              // §163.8: the kernel's party, whose declared acts' choices are the player's.
              investigators: array(context.conditions).map(row => text(object(row).actor)).filter(Boolean),
              maxCalls: Number.isSafeInteger(question.remainingCalls) ? question.remainingCalls : 24,
              record: row => record({lane: 'check-selection', run: run.runId, step: request.stepId, ...row})});
            // A decision from a stale snapshot is never executable, even if its arguments still look plausible.
            const fresh = await withinCheckLease(lease, () => call('table.resolve.options'));
            if (options.revision !== fresh.revision || options.world_revision !== fresh.world_revision || digest(context) !== digest(fresh.context))
              selection = missing('check_selection_stale', selection.calls);
            else if (selection.status === 'selected' && selection.action) {
              const scene = text(context.scene), identity = checkAttemptIdentity(selection.action, scene);
              const repeated = run.clerkDid.some(entry => entry.operation === 'resolve' && entry.status === 'succeeded'
                && text(object(object(entry.basis).selection_snapshot).scene) === scene
                && checkAttemptIdentity(object(object(entry.result).action) as Record<string, Json>, scene) === identity);
              selection = repeated ? missing('distinct_attempt_binding_required', selection.calls)
                : {...selection, snapshot: {scene, revision: text(options.revision), worldRevision: text(options.world_revision)}};
            }
          }
        } catch (error) { selection = missing(error instanceof Error ? error.message : 'check_selection_unavailable', selection.calls); }
        finally { lease.close(); }
      }
      record({lane: 'check-selection', run: run.runId, step: request.stepId, status: selection.status,
        option: selection.option?.label ?? null, needs: selection.needs, calls: selection.calls});
      return {status: 'ok' as const, artifact: {kind: 'check-selection', selection} as StepArtifact};
    }
    if (request.purpose === 'bind-ordinary') {
      const candidate = question.candidate as Candidate | undefined;
      if (!candidate || !run.scope || !run.readSet || run.turn === undefined || !bridge?.campaign || !bridge.call)
        return {status: 'unavailable' as const, artifact: {kind: 'bind-ordinary', bound: {disposition: 'unavailable', unresolved: ['binder_unavailable'], calls: 0, ms: 0}} as StepArtifact};
      const began = stepNow();
      const lease = new TaskLease({owner: 'ordinary-resolve', goal: run.rawInput.trim() || 'ordinary check', scope: run.scope, capabilities: ['decision'],
        readSet: run.readSet, signal: request.signal, ...leaseClock,
        // A decision's own lease, like the route's (§135.6, SL-22 addendum): never the prescreen allowance's remainder.
        budget: {deadlineAt: stepNow() + 15_000, remainingInputTokens: 400_000,
          remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
      try {
        const result = await prepareCheckPreflight({campaign: bridge.campaign, turn: run.turn, rawInput: run.rawInput, goal: run.rawInput, scope: run.scope,
          readSet: run.readSet, publicContext: [{role: 'player', text: run.rawInput}], call: (method, params) => bridge!.call!(method, params), decision: jev!, lease, ...leaseClock,
          // §135.30.3 (owner ruling 2026-09-24): the compile's cleared act settled roll-or-not; the binder's own answer is recorded.
          ...(compiledCheck(candidate) ? {compiled: compiledCheck(candidate)} : {}),
          // SL-31 (§135.28): the clerk's binder takes the difficulty and the dice from Jev only past the policy's gate, else
          // their rules defaults; a single issued investigator is the actor.
          defaults: {gate: Number(question.gate) || DEFAULT_CONFIDENCE_GATE}});
        // §135.30.3 (SL-26): the profile answer behind the skill rides with the action, so the bind record says whether it cleared.
        const skill = result.evidence?.profile;
        const bound = {disposition: result.advice.disposition, ...(result.advice.action ? {action: result.advice.action as unknown as Record<string, Json>} : {}),
          unresolved: result.advice.unresolved, calls: result.decisionCalls, ms: stepNow() - began, ...(skill ? {skill} : {}),
          ...(result.evidence?.route ? {route: result.evidence.route} : {}), ...(result.evidence?.paths ? {paths: result.evidence.paths} : {})};
        record({lane: 'route', purpose: 'bind-ordinary', run: run.runId, step: request.stepId, candidate: candidate.key, disposition: bound.disposition,
          unresolved: bound.unresolved, ms: bound.ms, jev_calls: bound.calls,
          ...(skill ? {skill: {value: skill.choice, confidence: skill.confidence, distribution: skill.probabilities,
            ...(typeof skill.held === 'boolean' ? {held: skill.held} : {}), ...(skill.named ? {named: true} : {})}} : {}),
          ...(result.evidence?.named ? {named: result.evidence.named} : {}),
          ...(result.evidence?.route ? {route: result.evidence.route} : {}), ...(result.evidence?.consent ? {consent: result.evidence.consent} : {}),
          ...(result.evidence?.parameters ? {parameters: result.evidence.parameters} : {}),
          ...(result.evidence?.paths ? {paths: result.evidence.paths} : {})});
        return {status: 'ok' as const, artifact: {kind: 'bind-ordinary', bound} as StepArtifact};
      } finally { lease.close(); }
    }
    let batch = question.batch as DecisionBatch | undefined;
    if (!batch || (request.purpose !== 'route' && request.purpose !== 'bind' && request.purpose !== 'compile' && request.purpose !== 'reask'))
      return {status: 'unavailable' as const, artifact: {reason: batch ? `no_${request.purpose}_decider` : 'no_scope_binding'}};
    const askHistory = run.history?.enabled && historyConfigured(options.env as NodeJS.ProcessEnv)
      && !run.history.closed && !run.history.asked && ['compile', 'route'].includes(request.purpose);
    if (askHistory) batch = {...batch, id: digest([batch.id, 'historical-reference']), questions: [...batch.questions, historyNeedQuestion()]};
    const began = stepNow();
    const lease = new TaskLease({owner: batch.family, goal: `run ${request.runId} ${request.purpose}`, scope: batch.scope, capabilities: ['decision'],
      readSet: batch.readSet, signal: request.signal, ...leaseClock,
      budget: {deadlineAt: stepNow() + 15_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
    try {
      const result = await jev!.decide(batch, lease);
      if (askHistory && run.history) {
        run.history.asked = true; run.history.allowed = historyNeed(result);
        record({lane: 'historical-reference', event: 'need', run: run.runId, turn: run.turn, allowed: run.history.allowed,
          answer: result.answers.historical_reference_needed ?? null, status: result.status});
      }
      const answers = result.status === 'complete' ? Object.fromEntries(Object.entries(result.answers ?? {}).map(([key, value]) => [key,
        value.status === 'answered' && value.type === 'choice' ? {choice: value.choice, confidence: value.confidence ?? null, probabilities: value.probabilities ?? null} : {status: value.status}])) : null;
      // Every answer's distribution is retained (spec user story 28): the gates can be re-read from a live table.
      const offered = array(question.offered) as Candidate[];
      const settled = array(question.settled).map(String);
      // §143.16 (NAF-17): the acts the run's compiles cleared, so the row's `selected` is the policy's (a gated fight step selects nothing).
      const declaredActs = array(question.declaredActs).map(String);
      const routed = request.purpose === 'route' ? interpretRoute({located: question.located === true, settled, declaredActs} as RunView, offered, result, Number(question.gate) || DEFAULT_CONFIDENCE_GATE) : undefined;
      const actGatedKeys = request.purpose === 'route' ? offered.filter(candidate => actGated(candidate, declaredActs)).map(candidate => candidate.key) : [];
      // §135.30: the compile row carries each feature's distribution and which predicates fired, as the policy will read them.
      // §135.30.8 (SL-43): with the run's settled acts, so the row's `decided` is the policy's.
      const actsSettled = array(question.actsSettled).map(String);
      const compiled = request.purpose === 'compile'
        ? interpretCompile({candidates: array(question.candidates) as Candidate[], rows: (question.rows ?? undefined) as FeatureRows | undefined, actsSettled},
          result, Number(question.gate) || DEFAULT_CONFIDENCE_GATE)
        : undefined;
      // §135.30.9.2 (SL-52 stage 2): the re-ask row names the settling steps, each clue's answer and what it filed.
      if (request.purpose === 'reask') {
        const input = object(question.input) as unknown as ReaskInput;
        const reasked = interpretReask({candidates: array(question.candidates) as Candidate[]}, input, result, Number(question.gate) || DEFAULT_CONFIDENCE_GATE);
        record({lane: 'route', purpose: 'reask', run: run.runId, step: request.stepId, status: result.status, ms: stepNow() - began,
          // SL-84: the last attempt's HTTP status or network/timeout code, so a `jev_service_error` reason is legible.
          ...(result.failure?.status !== undefined ? {jev_status: result.failure.status} : {}),
          settled_by: array(input.settled).map(entry => object(entry).key), answers: reasked.answers, filed: reasked.filed.map(candidate => candidate.key), reason: reasked.reason});
        return {status: result.status === 'complete' ? 'ok' as const : 'unavailable' as const, artifact: {kind: 'reask', result} as StepArtifact};
      }
      record({lane: 'route', purpose: request.purpose, run: run.runId, step: request.stepId, status: result.status, ms: stepNow() - began,
        // SL-84: the last attempt's HTTP status or network/timeout code, so a `jev_service_error` reason is legible.
        ...(result.failure?.status !== undefined ? {jev_status: result.failure.status} : {}),
        ...(request.purpose === 'route' ? {offered: offered.map(candidate => candidate.key), selected: routed?.selected ?? [], exit: routed?.exit ?? null, reason: routed?.reason ?? null,
          ...(settled.length ? {settled} : {}), ...(actGatedKeys.length ? {act_gated: actGatedKeys} : {})}
          : compiled ? {features: compiled.features, fired: compiled.selected.map(entry => ({predicate: entry.predicate, candidate: entry.candidate.key, features: entry.features})),
            selected: compiled.selected.map(entry => entry.candidate.key), decided: compiled.decided, fell_through: compiled.fellThrough, reason: compiled.reason,
            // §135.30.9 (SL-52): the sought `ask` rows, in row order.
            ...(compiled.askCleared ? {ask_cleared: compiled.askCleared} : {}),
            ...(actsSettled.length || compiled.actsSettled?.length ? {acts_settled: [...new Set([...actsSettled, ...(compiled.actsSettled ?? [])])]} : {}),
            ...(compiled.guarded ? {guarded: compiled.guarded} : {}), ...(compiled.unlocked ? {unlocked: compiled.unlocked.map(unlockedRow)} : {})}
            : {candidate: question.candidate ?? null}),
        ...(compiled ? {} : {answers})});
      // §135.30.4: a cleared destination the kernel holds back goes to the Keeper with its guard, once, in the next note.
      if (compiled?.guarded) run.guarded.push(...compiled.guarded.filter(entry => !run.guarded.some(seen => seen.to === entry.to)));
      return {status: result.status === 'complete' ? 'ok' as const : 'unavailable' as const, artifact: {kind: request.purpose, result} as StepArtifact};
    } finally { lease.close(); }
  }

  /** §135.25: one `budget` summary row per run, and the deferred clerk steps carried to the next run's note. */
  function budgetSummary(run: RunState) {
    const elapsed = now() - run.startedAt;
    const decision = run.decision;
    record({lane: 'run', event: 'budget', decision: 'summary', run: run.runId, budget_ms: run.budgetMs, elapsed_ms: elapsed,
      elapsed_at_compose: run.lastInferAt ?? null, over_budget: elapsed >= run.budgetMs, deferred_by_budget: run.deferred,
      // §135.25 (SL-22 addendum): the decisions' Jev budget and, beside it, what the prescreens spent of their own allowance.
      decision_budget: decision ? {jev_calls: decision.jevCalls, jev_ms: decision.jevMs, max_jev_calls: decision.maxJevCalls, max_jev_ms: decision.maxJevMs,
        spent: exhausted(decision)} : null,
      prescreen: run.prescreenSpent});
    carried = run.deferred.length ? {campaign: bridge?.campaign, run: run.runId, ...(run.turn !== undefined ? {turn: run.turn} : {}), deferred: run.deferred} : undefined;
  }

  /**
   * §135.31: the views due before this model step -- the scene the run moved into, the people its candidates name, the
   * session when it changed -- read and bounded (runtime/jev/carried-views.ts); one `lane: "run"`, `event: "carried"` row.
   */
  async function carriedFor(run: RunState, view: {policyState: StepPolicyState}, request: Row, stepId: string): Promise<Json | undefined> {
    if (!bridge?.call || !bridge.campaign) return undefined;
    const state = view.policyState?.view;
    // Pending: what the latest fresh read issued (a candidate the route left to the Keeper is still the Keeper's to do) and
    // the policy's pending items.
    const issued = [...(run.issued ?? []), ...array(state?.pending).map(item => object(item).candidate).filter(Boolean)] as Candidate[];
    // The operation this step hands the Keeper (`left_to_you`, `complete`), by its key, else as the request shows it.
    const operation = object(request.operation);
    const handed = request.candidate ? issued.find(candidate => candidate.key === request.candidate) ?? {family: text(operation.family), bound: object(operation.bound)} : undefined;
    const investigators = new Set(run.investigators);
    const people = [...run.named, ...[...issued, ...(handed ? [handed] : [])].flatMap(candidate => namedPeople(candidate as Candidate))]
      .filter((name, index, all) => all.indexOf(name) === index && !investigators.has(name) && !run.shown.people.has(name));
    const scene = run.scene && run.firstScene !== undefined && run.scene !== run.firstScene && !run.shown.scenes.has(run.scene) ? run.scene : undefined;
    const sessionView = run.sessionView, session = sessionView === 'read' ? 'read' as const
      : sessionView && digest(sessionView) !== run.shown.session ? sessionView : undefined;
    // §135.31.1: the passages of the run's current scene, on the run's first model step at it (once per scene per run).
    const at = run.scene && !run.shown.passages.has(run.scene) ? run.scene : undefined;
    const passageView = at ? scenePassages(run.passages, at) : undefined, passages = at && passageView ? {scene: at, view: passageView} : undefined;
    // §135.31.2: consultations that landed since the last step, once each (taking them marks them carried), and the ones still
    // reading, once per run each.
    let taken: ReturnType<SourceAnswersPort['take']> = {pending: [], landed: []};
    const port = consultations && (!consultations.campaign || consultations.campaign === bridge.campaign) ? consultations : undefined;
    // §135.20.1 (SL-102): the run's first model step first waits, for what is left of one allowance, on a consultation asked
    // at this scene on an earlier turn that is still being read -- on long gate #24 each such answer landed 0.25-5 s into the
    // step whose note had just said pending, and the Keeper spent a model step asking for it again.
    if (port?.settle && !run.settleAsked && run.scene && run.turn !== undefined) {
      run.settleAsked = true;
      try {
        const waited = await port.settle({scene: run.scene, turn: run.turn, elapsed_ms: Math.max(0, now() - run.startedAt)});
        if (waited.foci.length) record({lane: 'run', event: 'held_wait', run: run.runId, step: stepId, scene: run.scene, foci: waited.foci,
          waited_ms: waited.waited_ms, bound_ms: waited.bound_ms, landed: waited.landed, pending: waited.pending});
      } catch { /* the port never steers the run */ }
    }
    run.settleAsked = true;
    if (port) {
      try { taken = port.take({...(run.scene ? {scene: run.scene} : {}), run: run.runId}); } catch { /* the port never steers the run */ }
    }
    const answers = taken.landed.map(entry => ({name: entry.focus, view: entry.answer ? {question: entry.question, ...entry.answer}
      : {question: entry.question, status: 'unavailable', reason: entry.unavailable ?? 'reading_failed'}}));
    // §135.20.1: what the Keeper was already handed at this scene and this run's request does not hold yet, newest first.
    const held = (taken.held ?? []).map(entry => ({name: entry.focus, view: {question: entry.question, ...entry.answer}}));
    const pending = taken.pending.filter(entry => !run.shown.pending.has(JSON.stringify([entry.focus, entry.question])));
    // §22.4.7 (SL-47): the book's text of a scene a move landed on, once; a scene record that settled, once -- the scene view
    // itself when the party is still there, else a row saying it landed (or could not be read).
    const sceneTexts = taken.texts ?? [];
    const records = taken.records ?? [];
    const here = records.find(entry => !entry.unavailable && !entry.unusable && !entry.person && entry.scene === run.scene);
    // §22.4.7.1 (SL-56): a person's record is a row naming them; §22.3.3 (SL-57): a settled focus says so, once.
    const sceneRecords = records.filter(entry => entry !== here).map(entry => ({scene: entry.scene, ...(entry.person ? {person: entry.person} : {}),
      view: entry.unusable ? {status: 'unusable', reason: entry.unusable} : entry.unavailable ? {status: 'unavailable', reason: entry.unavailable}
        : {status: 'landed', note: entry.person ? 'look focus=npc shows it' : 'look focus=scene there shows it'}}));
    const sceneDue = scene ?? (here ? here.scene : undefined);
    if (!sceneDue && !people.length && !session && !passages && !answers.length && !pending.length && !sceneTexts.length && !sceneRecords.length && !held.length) {
      if (taken.handed?.length) record({lane: 'run', event: 'carried', run: run.runId, step: stepId, views: [], omitted: [], handed: taken.handed, bytes: 0, reads: 0, ms: 0});
      return undefined;
    }
    const carried = await readCarriedViews({call, ...(sceneDue ? {scene: sceneDue} : {}), people, skip: run.shown.people, ...(session ? {session} : {}),
      ...(passages ? {passages} : {}), ...(answers.length ? {answers} : {}), ...(pending.length ? {pending} : {}),
      ...(sceneTexts.length ? {sceneTexts} : {}), ...(sceneRecords.length ? {sceneRecords} : {}), ...(held.length ? {held} : {})}).catch(() => undefined);
    if (!carried) return undefined;
    const ids = new Set(carried.views.flatMap(entry => entry.id ? [entry.id] : []));
    for (const entry of carried.views) {
      if (entry.focus === 'scene' && entry.name) run.shown.scenes.add(entry.name);
      if (entry.focus === 'session') run.shown.session = digest(entry.read ? {session: entry.view.session ?? null, pending_choice: entry.view.pending_choice ?? null} : sessionView);
      if (entry.focus === 'npc' && entry.id) run.shown.people.add(entry.id);
      if (entry.focus === 'source' && entry.name) run.shown.passages.add(entry.name);
    }
    for (const entry of carried.pending ?? []) run.shown.pending.add(JSON.stringify([entry.focus, entry.question]));
    // §11.5.4 (SL-51): the source text this note carried -- a scene_text view's pages as they went, a source view's book
    // passages -- is the turn's carried text, which a write about a person the book names is checked against.
    const carriedRows = carriedPassages(carried.views, sceneTexts);
    if (carriedRows.length && run.turn !== undefined) api?.events?.emit?.('coc:carried-text', {campaign: bridge.campaign, turn: run.turn, run: run.runId, passages: carriedRows});
    // A name is settled once its card went (now or earlier under another name), or once `look` does not resolve it.
    for (const {name, id} of carried.resolved) if (ids.has(id) || run.shown.people.has(id)) run.shown.people.add(name);
    for (const entry of carried.omitted) if (entry.focus === 'npc' && entry.reason === 'not_found' && entry.name) run.shown.people.add(entry.name);
    record({lane: 'run', event: 'carried', run: run.runId, step: stepId,
      views: carried.views.map(entry => ({focus: entry.focus, ...(entry.name ? {name: entry.name} : {}), bytes: bytes(entry.view),
        ...(entry.focus === 'source_answer' || entry.focus === 'scene_record' || entry.focus === 'person_record' ? {status: entry.view.status ?? null} : {}),
        ...(entry.held ? {held: true} : {}),
        ...(entry.truncated ? {truncated: true, omitted_fields: entry.omitted_fields ?? []} : {})})),
      omitted: carried.omitted, ...(taken.handed?.length ? {handed: taken.handed} : {}), ...(carried.pending?.length ? {pending: carried.pending.map(entry => ({focus: entry.focus, since_turn: entry.since_turn, purpose: entry.purpose ?? null,
        ...(typeof entry.scene === 'string' ? {scene: entry.scene} : {}), ...(typeof entry.person === 'string' ? {person: entry.person} : {})}))} : {}),
      ...(here ? {scene_record: here.scene} : {}),
      bytes: carried.bytes, reads: carried.reads, ms: carried.ms});
    return carriedSection(carried, {...(run.document === undefined ? {} : {document: run.document}), ...(here ? {record: true} : {})});
  }

  /** The run's note to the Keeper before a model step. Nothing new to say: no message. */
  async function projection(run: RunState, view: {policyState: StepPolicyState}, step: {purpose: string; reason: string; request?: unknown}, stepId: string) {
    // §135.11.2 (SL-50 stage 2): the run's first note opens with the head line (right after `kind`), once per run.
    const head = !run.headShown;
    const content: Row = {kind: 'single_loop_step', ...(head ? {head: CLERK_NOTE_HEAD} : {}), purpose: step.purpose, reason: step.reason};
    run.interactionScope = view.policyState.view.interactionScope ?? run.interactionScope;
    if (run.interactionScope && bridge?.campaign && run.turn !== undefined) {
      api?.events?.emit?.('coc:interaction-scope', {campaign: bridge.campaign, turn: run.turn, run: run.runId,
        player_text: run.rawInput, mode: run.interactionScope.mode});
      if (run.interactionScope.mode === 'reference') Object.assign(content, {interaction_scope: 'reference', interaction_scope_note: REFERENCE_SCOPE_NOTE});
    }
    run.unresolvedAttack = view.policyState?.view?.fightDeclared === true && view.policyState?.view?.fightLanded !== true;
    const policyView = view.policyState?.view;
    // §163: what the policy forced (scope, selection, binding, a refused check) and what this step forces: the checks a
    // Jev-less step leaves unjudged (no answer, packing refusal, spent budget) and a check whose binding settled nothing.
    recordForced(run, policyView?.forced, stepId);
    if ((!run.interactionScope || run.interactionScope.mode === 'world') && step.reason.startsWith('jev_') && ['compose', 'adjudicate'].includes(step.purpose)) {
      const unjudged = (policyView?.candidates ?? []).filter(candidate => candidate.checkOwner === 'jev' && !policyView!.consumed.includes(candidate.key));
      if (unjudged.length) recordForced(run, [forcedResolution({family: 'check-selection', subject: 'checks not judged this turn',
        uncertain: [`which of the ${unjudged.length} offered check families the declaration needs`], chosen: {outcome: 'no_roll'}, why: step.reason})], stepId);
    }
    if (step.reason === 'check_unresolved') {
      const left = object(object(step.request).check_unresolved), operation = object(object(step.request).operation);
      recordForced(run, [forcedResolution({family: 'check-binding', subject: text(operation.label) || 'check',
        uncertain: array(left.withheld ?? left.unresolved).map(value => String(value)), chosen: {outcome: 'no_roll'}, why: text(left.cause) || 'unknown_binding'},
      text(object(step.request).candidate) || null)], stepId);
    }
    const unseen = run.forced.filter(entry => !run.forcedShown.has(entry.key));
    for (const entry of unseen) run.forcedShown.add(entry.key);
    if (unseen.length) Object.assign(content, {decided_under_uncertainty: unseen.map(({key: _key, ...entry}) => entry) as unknown as Json,
      decided_under_uncertainty_note: DECIDED_UNDER_UNCERTAINTY_NOTE});
    const preparations = (policyView?.unresolvedChecks ?? []).filter(entry => entry.preparation);
    run.pendingCheckPreparations = preparations.map(({candidate, needs}) => ({candidate, needs}));
    run.pendingAttackPreparation = !!view.policyState.view.preparingAttacks?.length;
    if (preparations.length) content.check_preparation = {
      needs: preparations.flatMap(entry => entry.preparation ? [entry.preparation] : []),
      instruction: 'These are missing host arguments, not uncertainty about what the player wants. Prepare the observed participants and their profiles through the existing scene/source preparation tools, then register their actual presence with apply npc when needed. '
        + 'Source answer excerpts alone do not register participants. Use source_mode=prepare for missing playable entities. Do not invent numeric profiles, make model-origin resolve calls, or narrate an adjudicated result while preparing. '
        + 'After an accepted preparation write, the host refreshes its catalog and Jev can examine a ready check again. If preparation cannot complete this turn, narrate the attempt by your own judgement without a roll; '
        + 'the host records it as decided under uncertainty, and later facts are reconciled forward.'
        + (run.pendingAttackPreparation ? ' This is the already chosen first attack. Prepare only its named target and physical method. Pin a missing NPC combat archetype through apply npc. For the chosen ordinary item, use apply usage with a natural use name and the actual declaration; the host joins a pending base definition in this turn. Do not copy it into a weapon or defer it because look says parameters are pending. Return the preparation results without closing the attack in suspense or asking the player to repeat it: the host resumes the retained attack when ready.' : '')};
    const base = Object.keys(content).length;
    run.lastInferAt = now() - run.startedAt;
    if (run.history?.enabled && !run.history.closed && step.purpose === 'compose' && now() - run.startedAt >= run.budgetMs) {
      run.history.closed = true;
      run.history.closedReason = 'turn_budget_exhausted';
      record({lane: 'historical-reference', event: 'closed_received', run: run.runId, step: stepId, turn: run.turn,
        reason: run.history.closedReason});
    }
    historyFinalAnswer = run.history?.closed && run.interactionScope?.mode === 'reference' && step.purpose === 'compose'
      ? {run: run.runId, step: stepId, reason: run.history.closedReason} : undefined;
    // §135.11.1 (SL-50): the model step the Keeper's next message answers, for the kernel extension's drop row.
    api?.events?.emit?.('coc:model-infer', {run: run.runId, step: stepId});
    // §135.25: the compose the budget chose lists the clerk steps it left undone; the next run's first note says so once.
    const budget = object(object(step.request).budget);
    if (step.reason === 'run_budget') {
      run.deferred = Array.isArray(budget.deferred_by_budget) ? budget.deferred_by_budget as DeferredStep[] : [];
      Object.assign(content, {budget: {budget_ms: budget.budget_ms ?? run.budgetMs, elapsed_ms: budget.elapsed_ms ?? null},
        budget_note: 'The turn\'s time budget is spent: close the turn now with the prose (narrate, or ask for a pending choice) and leave '
          + 'further bookkeeping for the next turn.',
        ...(run.deferred.length ? {deferred_by_budget: run.deferred,
          deferred_note: 'The clerk did not carry out these declared steps; nothing was executed for them. Narrate only what landed.'} : {})});
    }
    if (carried && carried.run !== run.runId && (!carried.campaign || carried.campaign === bridge?.campaign)) {
      Object.assign(content, {deferred_last_turn: carried.deferred,
        deferred_note: 'On the last turn the time budget ran out before the clerk carried out these declared steps; they were never executed. '
          + 'Settle one now only if the fiction still calls for it.'});
      record({lane: 'run', event: 'budget_carried', run: run.runId, step: stepId, from_run: carried.run, deferred_by_budget: carried.deferred});
      carried = undefined;
    }
    // §135.25 (SL-22 addendum): the one compose for a spent decision budget says so; the Keeper's own calls carry the rest.
    if (step.reason === 'jev_budget' && step.purpose === 'compose') {
      const spent = view.policyState?.view?.budget;
      Object.assign(content, {decision_budget: {jev_calls: spent?.jevCalls ?? null, jev_ms: spent?.jevMs ?? null, max_jev_calls: spent?.maxJevCalls ?? null,
        max_jev_ms: spent?.maxJevMs ?? null},
      decision_budget_note: 'The host\'s decision budget for this turn is spent: no further step is routed from the player\'s words this turn '
        + '(a step the kernel forces still runs). Checks not yet judged take no roll this turn (decided_under_uncertainty): narrate the declared action and committed results by your own judgement.'});
    }
    // §135.11 addendum (SL-20): the compose after the clerk settled the declaration says why it is the compose.
    if (step.reason === 'settled') content.settled_note = 'The clerk settled the player\'s declared step this turn (see clerk_did). Narrate its result '
      + 'and close the turn; a further check or step can wait for the player\'s next input unless the fiction cannot go on without it.';
    // §151.5: the compose after the steps the Keeper proposed.
    if (step.reason === PROPOSED_REASON) content.proposed_note = 'The clerk ran the steps you proposed (clerk_did lists each with its receipts or its refusal). '
      + 'Narrate what landed.';
    // §151.5 (SL-79 behind a setting): this step's catalog and, where `propose` is admitted, the offered keys it names. Off: nothing.
    const setting = await narratorSetting().catch(() => undefined);
    run.stepCatalog = setting ? stepCatalog(setting, step, !!jev) : undefined;
    if (setting?.on && run.stepCatalog) {
      run.narrator = setting;
      const policy = view.policyState?.view as {candidates?: unknown} | undefined;
      const issued = Array.isArray(policy?.candidates) ? policy!.candidates as Candidate[] : run.issued ?? [];
      run.offered = run.stepCatalog.propose ? offeredForPropose(issued, run.consequenceCandidates, new Set([...run.consequenceExecuted, ...run.proposedKeys])) : [];
      if (run.stepCatalog.narrowed) Object.assign(content, {catalog: [...run.stepCatalog.narrowed], catalog_note: NARRATOR_NOTE});
      else if (run.stepCatalog.propose) content.propose_note = PROPOSE_NOTE;
      if (run.stepCatalog.propose) content.offered = offeredView(run.offered) as unknown as Json;
      record({lane: 'run', event: 'catalog', run: run.runId, step: stepId, purpose: step.purpose, reason: step.reason,
        catalog: run.stepCatalog.narrowed ? [...run.stepCatalog.narrowed] : null, propose: run.stepCatalog.propose, offered: run.offered.map(value => value.key),
        source: setting.source});
    }
    if (run.history?.enabled) content.historical_reference = run.history.closed ? HISTORY_CLOSED : run.history.allowed ? HISTORY_OFFER : HISTORY_LOCAL_OFFER;
    if (run.history?.closed) content.historical_reference_status = {state: 'closed', reason: run.history.closedReason ?? 'budget_exhausted'};
    const fresh = run.clerkDid.slice(run.projected);
    run.projected = run.clerkDid.length;
    if (fresh.length) Object.assign(content, {clerk_did: fresh,
      note: 'The host (the clerk) settled these this turn before asking you, from the kernel\'s own options. They are committed, not pending: '
        + 'narrate what happened, do not redo them, and undo one only with a real operation of your own (its own receipt and time cost).'});
    // §135.30.5 (SL-38): a move the batch staged after its unlocking step that did not happen is reported as guarded.
    for (const entry of missedUnlocks(view.policyState?.view ?? {consumed: []}))
      if (!run.guarded.some(seen => seen.to === entry.to)) run.guarded.push(entry);
    // §135.30.4: the place the player declared that the kernel holds back, with the book's own guard, once each; §135.30.6
    // (SL-40): with what this run's prescreen located about the place (its entrance as the book has it), where it did.
    const guarded = run.guarded.slice(run.guardedShown).map(entry => withEntrance(entry, run.passages));
    run.guardedShown = run.guarded.length;
    if (guarded.length) Object.assign(content, {guarded, guarded_note: GUARDED_NOTE});
    // §107.1: a map published after the arrival rides this turn's delivery; the note says so once per run.
    if (!run.mapArrivedShown && run.mapArrived?.length) {
      run.mapArrivedShown = true;
      Object.assign(content, {map_arrived: run.mapArrived,
        map_arrived_note: 'The floor plan of this place was published after the investigators arrived; it is committed and is delivered '
          + 'beside this turn\'s prose as supplementary material. Do not mention a map in the story: describe the place itself.'});
    }
    // §135.26 (owner ruling Q5): a clerk step that crossed an open obligation's guard, one line each, beside "clerk did".
    const crossings = fresh.map(value => value.obligation_open).filter((value): value is string => !!value);
    if (crossings.length) content.obligation_open = crossings;
    // §143.4: an NPC's turn of the fight whose own act the table did not settle (no act was generated, it was not bound,
    // or a write was refused) is the Keeper's; the note says so once per NPC turn, with the standing the kernel issues
    // (a fact about the person, §11.5.3) and what the table recorded.
    const fight = object(run.fight), turnKey = `${text(fight.turn_of)}:r${String(fight.round ?? '')}`, left = run.npcTurnLeft;
    if (fight.status === 'active' && left?.key === turnKey && run.noted !== turnKey) {
      run.noted = turnKey;
      const held = object(fight.standing_action);
      Object.assign(content, {npc_turn: {npc: text(fight.turn_of), round: fight.round ?? null, ...(Object.keys(held).length ? {standing_action: held} : {}),
        act: {status: left.status, reason: left.reason, text: left.act}},
        npc_turn_note: 'It is this NPC\'s turn and the table did not settle an act for them (npc_turn.act says what it recorded): the turn is '
          + 'yours -- resolve what they do, or spend their turn with apply npc and spend_turn on what they set out to do.'});
    }
    const request = object(step.request), operation = request.operation;
    // The operation Jev chose and the LLM is asked to complete keeps its kernel row on record beside the model's call.
    if (step.purpose === 'bind' && request.candidate)
      record({lane: 'run', event: 'llm_bound', run: run.runId, step: stepId, candidate: request.candidate, basis: request.basis ?? null});
    if (step.purpose === 'bind' && operation) Object.assign(content, {complete: operation,
      instruction: 'The clerk chose this operation from the player\'s declared action. Call its verb once, with the bound values as given and '
        + 'the needed parameters filled in; decide nothing else in this response.'});
    // §135.28: a clerk candidate the clerk could not bind is the Keeper's turn, never a parameter-filling request.
    const unbound = object(request.clerk_unbound);
    if (step.reason === 'clerk_unbound' && operation) {
      record({lane: 'run', event: 'bind', run: run.runId, step: stepId, candidate: request.candidate ?? null, outcome: 'keeper', cause: unbound.cause ?? null,
        unresolved: unbound.unresolved ?? [], bindings: unbound.bindings ?? []});
      Object.assign(content, {left_to_you: {operation, unresolved: unbound.unresolved ?? [], cause: unbound.cause ?? null},
        left_note: 'The clerk chose this operation from the player\'s declared action but could not settle the parameters listed as unresolved '
          + 'from the kernel\'s options or a rules default, so nothing was executed for it. It is yours: do it, do something else, or narrate.'});
    }
    const plan = view.policyState?.view?.plan;
    if ((step.reason === 'batch_fallen' || budget.batch_fallen === true) && plan) Object.assign(content, {batch: plan.steps,
      batch_note: 'Your last batch stopped where a step failed; the steps after it were not executed. Decide what that failure means.'});
    const shown = await carriedFor(run, view, request, stepId);
    if (shown) content.carried = shown;
    const messages: Row[] = [];
    // Nothing new to say: no message (§135.8) -- except the run's first note, whose head is something to say (§135.11.2).
    if (head || unseen.length || preparations.length || Object.keys(content).length > base || fresh.length) {
      messages.push({role: 'custom', customType: CLERK_TYPE, content: JSON.stringify(content), display: false,
        details: {coc_host: true, run: run.runId, step: stepId, ...(run.turn !== undefined ? {turn: run.turn} : {})}, timestamp: Date.now()});
      run.headShown = true;
    }
    // §135.11: the turn-close steer, last, as the same `coc-host` message legacy's `agent_end` sends.
    if (run.steer && step.reason.startsWith('turn_close:')) { messages.push({role: 'custom', ...run.steer, timestamp: Date.now()}); run.steer = undefined; }
    return messages.length ? messages as any : undefined;
  }

  /**
   * §135.25: every step the policy picks past the run's time budget is a `lane: "run"` budget row. The policy stays
   * pure; this wrapper only reads the step it chose and the elapsed time the policy state already carries.
   */
  function budgetRows(run: RunState, policy: ReturnType<typeof createStepPolicy>): ReturnType<typeof createStepPolicy> {
    return {...policy, next(driver) {
      const request = policy.next(driver), budget = driver.policyState.view.budget;
      run.decision = {...budget};
      // §163: what the last folded step forced is recorded before the next step runs, whether or not a model step follows.
      recordForced(run, driver.policyState.view.forced, `${run.runId}:s${driver.steps}`);
      // §143.4: a person's own act the time budget left undone is recorded, never run past the budget.
      if (overRun(budget) && request.kind === 'infer') {
        const view = driver.policyState.view;
        for (const item of view.pending) if (item.candidate?.clerk === 'npc_act' && !run.npcSeen.has(text(item.candidate.bound.npc))) {
          run.npcSeen.add(text(item.candidate.bound.npc));
          record({lane: 'run', event: 'npc_act', run: run.runId, step: `${run.runId}:s${driver.steps + 1}`, npc: text(item.candidate.bound.npc) || null,
            trigger: text(item.candidate.bound.trigger) || 'turn', status: 'skipped_budget', budget_ms: budget.maxRunMs, elapsed_ms: budget.runMs});
        }
        if (npcScanDue(view) && !run.npcBudgetSkipped) {
          run.npcBudgetSkipped = true;
          record({lane: 'run', event: 'npc_act', run: run.runId, step: `${run.runId}:s${driver.steps + 1}`, npc: null, trigger: 'acted_on', status: 'skipped_budget',
            budget_ms: budget.maxRunMs, elapsed_ms: budget.runMs});
        }
      }
      if (overRun(budget) && request.kind !== 'finish') {
        const deferred = object(object(request.kind === 'infer' ? request.request : undefined).budget).deferred_by_budget;
        // compose: the budget chose it; compose_owed: a compose already pending (the turn close's steer, the route's finish);
        // model_batch: the Keeper's proposals run whole; turn_close: the §135.11 close; forced_step: the kernel's forced step.
        const decision = request.kind === 'infer' ? (request.reason === 'run_budget' ? 'compose' : 'compose_owed')
          : request.kind === 'operate' && request.proposals.every(proposal => proposal.origin === 'model') ? 'model_batch'
            : request.kind === 'operate' && request.proposals.some(proposal => proposal.operation === 'turn_close') ? 'turn_close' : 'forced_step';
        record({lane: 'run', event: 'budget', decision, run: run.runId, step: `${run.runId}:s${driver.steps + 1}`, budget_ms: budget.maxRunMs, elapsed_ms: budget.runMs,
          ...(Array.isArray(deferred) ? {deferred_by_budget: deferred} : {})});
      }
      return request;
    }};
  }

  /** §135.29's SL-69 addendum: which run is current, for the `keeper_call_cap` telemetry row a cap firing
   * writes -- `onKeeperCallCap` below has no run/step of its own to go on otherwise, since it is told by the
   * session's own provider-call wrapper, outside any one run's own event stream. */
  let currentRunId: string | undefined;
  /** §135.29 addendum 2 (SL-82): this engine's own turn-start counter -- the same reset/increment contract
   * `extensions/kernel/first-step-thinking.ts`'s `isFirstStepOfTurn` documents for the kernel extension's own
   * `table.roundTrips` (both react to the same Pi bus events, so they always agree), kept independently so
   * this engine never reaches into the kernel extension's private state for it. Read by `keeperCallCapMs`
   * below and recorded on every `keeper_call_cap` row so a cap firing says which call of the turn it was. */
  let step = 0;
  const onKeeperCallCap = (phase: 'first_byte' | 'streaming', capMs: number) => {
    record({lane: 'run', event: 'keeper_call_cap', run: currentRunId ?? null, step, phase, cap_ms: capMs});
  };
  /** The actual thinking level owns its existing allowance, including ordinary UI low-thinking play.
   * The experimental first-step flag is an additional allowance, not the only way a model can think. */
  const resolveKeeperCallCapMs = async (): Promise<number> => {
    const ordinary = keeperCallCapMs(options.env);
    const level=api?.getThinkingLevel?.(),thinking=typeof level==='string'&&level!=='off';
    let cap=ordinary;
    if(thinking||firstStepThinkingEnabled(options.env)){
      const {callCapMs: allowance}=await firstStepThinkingBudget();
      cap=thinking?Math.max(ordinary,allowance):firstStepCallCapMs(true,step,ordinary,allowance);
    }
    record({lane:'run',event:'keeper_call_allowance',run:currentRunId??null,step,thinking:level??null,cap_ms:cap});
    return cap;
  };

  const runDriver: SessionRunDriver = {
    engine: 'hybrid-v1',
    // The Jev scope comes from the run's own read step (a read artifact carries the binding), never from a read
    // outside a step; until a read has bound it, a route question carries no batch and degrades to the Keeper.
    prepare: context => {
      currentRunId = context.runId;
      historyFinalAnswer = undefined;
      const allowance = readJevPreselectAllowanceMs(options.env as NodeJS.ProcessEnv), startedAt = now(), budgetMs = turnBudgetMs(options.env);
      const run: RunState = {runId: context.runId, rawInput: context.rawInput, inputRevision: context.inputRevision, session: context.session as unknown as Row,
        startedAt, prescreenAllowanceMs: allowance, providerBudget: preparationProviderBudget(), located: [], clerkDid: [], projected: 0,
        identities: new Map(), budgetMs, deferred: [], investigators: [], named: [], shown: {scenes: new Set(), people: new Set(), passages: new Set(), pending: new Set()}, passages: [],
        guarded: [], guardedShown: 0,
        prescreenSpent: {reads: 0, jev_calls: 0, ms: 0},
        consequenceRows: new Map(), consequenceExists: new Map(), consequenceExecuted: new Set(), consequenceMs: 0, turnReceipts: [], consequenceCandidates: [],
        present: [], npcSeen: new Set(), npcCount: {acted: 0},
        keeperCalls: {apply: 0, resolve: 0, look: 0, lookup: 0, recall: 0}, compileCalls: 0, consequenceExecutedReceiptIds: new Map(),
        offered: [], proposedKeys: new Set(), proposeCalls: 0, forced: [], forcedRecorded: new Set(), forcedShown: new Set()};
      const policy = createStepPolicy({context: emptyTurnContext(), budget: {maxJevMs: allowance, maxRunMs: budgetMs}, clock: now, startedAt,
        requireInteractionScope: true,
        interactionScope: options.interactionScope ?? (!context.rawInput.trim() ? {mode: 'world', reason: 'host_opening', calls: 0} : undefined),
        ...(options.compile === false ? {compile: false} : {})});
      run.interactionScope = options.interactionScope ?? (!context.rawInput.trim() ? {mode: 'world', reason: 'host_opening', calls: 0} : undefined);
      return {policy: budgetRows(run, policy), ports: makePorts(run), maxSteps: options.maxSteps ?? 48};
    },
  };

  const extension = (pi: any) => {
    api = pi;
    pi.events.on('coc:kernel-bridge', (data: KernelBridge) => { bridge = data?.call ? data : undefined; });
    pi.events.on('coc:operation-dispatcher', (data: OperationGateway) => { gateway = data && typeof data.dispatch === 'function' ? data : undefined; });
    pi.events.on('coc:turn-close', (data: TurnClosePort) => { closer = data && typeof data.verdict === 'function' ? data : undefined; });
    pi.events.on('coc:source-answers', (data: SourceAnswersPort) => { consultations = data && typeof data.take === 'function' ? data : undefined; });
    pi.events.on('coc:owed-review', (data: OwedReviewPort) => { owedReview = data && typeof data.settle === 'function' ? data : undefined; });
    pi.on('before_provider_request', (event: {payload: unknown}, ctx: any) => {
      if (!historyFinalAnswer || historyFinalAnswer.run !== currentRunId) return;
      const payload = historyFinalAnswerPayload(ctx?.model?.api, event.payload);
      record({lane: 'historical-reference', event: 'final_answer_request', ...historyFinalAnswer,
        api: ctx?.model?.api ?? null, tools_disabled: !!payload});
      return payload;
    });
    pi.on('agent_end', () => {historyFinalAnswer = undefined;});
    // The run owns the prescreen on this engine (§135.6); the context hook injects what the run prepared.
    const announce = () => { pi.events.emit('coc:loop-engine', {engine: 'hybrid-v1', prescreen: 'run'}); };
    announce();
    // The plan is an artifact inside the run, never a second executor: no private plan tool on this engine (§135.5).
    const withoutPlanTool = () => {
      try {
        const active: string[] = typeof pi.getActiveTools === 'function' ? pi.getActiveTools() : [];
        if (active.includes('submit_plan_packet') || active.includes('resolve')) pi.setActiveTools(active.filter(name => name !== 'submit_plan_packet' && name !== 'resolve'));
      } catch { /* No tool surface yet. */ }
    };
    /**
     * §151.5: `propose` joins the Keeper's surface only while the narrator-only setting is on, and only on a play table (the
     * seven verbs are there; a setup session has none, §14.4). Registered once and kept active after the kernel extension's
     * table open set the surface; with the setting off nothing is registered, so the loadout is byte for byte as before.
     */
    const withPropose = async () => {
      const setting = await narratorSetting().catch(() => undefined);
      if (!setting?.on || typeof pi.registerTool !== 'function' || typeof pi.getActiveTools !== 'function') return;
      try {
        if (!(pi.getActiveTools() as string[]).includes('narrate')) return;
        if (!proposeRegistered) {
          pi.registerTool({...PROPOSE_TOOL, executionMode: 'sequential', execute: async (toolCallId: string) => {
            // What the run settled for this call (`proposeStep`); a call the run never saw carries nothing out.
            const outcome = proposeOutcomes.get(toolCallId);
            proposeOutcomes.delete(toolCallId);
            if (!outcome) throw new Error('propose runs only as a step of the table\'s own run; nothing was carried out.');
            if (!outcome.ok) throw new Error(outcome.text);
            return {content: [{type: 'text', text: outcome.text}], details: outcome.details ?? {}};
          }});
          proposeRegistered = true;
        }
        const active = pi.getActiveTools() as string[];
        if (!active.includes(PROPOSE_VERB)) pi.setActiveTools([...active, PROPOSE_VERB]);
      } catch { /* No tool surface yet. */ }
    };
    // §143.3: the npc-act lane runs on the session's own model registry; the context is the latest one an event gave.
    if (options.npcAct === undefined && typeof pi.on === 'function')
      npcActLane = createNpcActLane(pi, {ctx: () => sessionCtx, campaign: () => bridge?.campaign});
    pi.on('session_start', async (_event: unknown, ctx: unknown) => { sessionCtx = ctx ?? sessionCtx; announce(); withoutPlanTool(); await withPropose(); });
    // §135.29 addendum 2 (SL-82): `step`'s own reset/increment, exactly matching the kernel extension's
    // `table.roundTrips` contract (extensions/kernel/first-step-thinking.ts's isFirstStepOfTurn) so the two
    // independent counters always agree: 0 on new player input, +1 on every turn_start thereafter.
    pi.on('before_agent_start', async (_event: unknown, ctx: unknown) => { sessionCtx = ctx ?? sessionCtx; withoutPlanTool(); step = 0; await withPropose(); });
    pi.on('turn_start', async () => { step += 1; });
  };
  return {runDriver, extension, bridge: () => bridge,
    keeperCallCapMs: resolveKeeperCallCapMs,
    onKeeperCallCap};
}

/** Reuse only the same source revision and player need; explicit read-more bypasses it. */
export function sourceReadReuseKey(scene:string,revision:unknown,need:string):string{return digest([scene,revision??null,need]);}
