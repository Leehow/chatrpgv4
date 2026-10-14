import type {PrescreenSourceRuntime} from './prescreen-source-provider.ts';
import {readCarriedViews,carriedSection} from './carried-views.ts';
import {withSourceQuestion} from './source-answer-pages.ts';
import {historyEnabled,HISTORY_OFFER,HISTORY_UNAVAILABLE} from '../historical-reference.ts';
// @ts-expect-error -- the shared native-search adapter is a runtime JavaScript module.
import {nativeSearchCapability} from '../native-search.js';
/** One native RunDriver; the Keeper owns decisions and prose, and the host owns tool execution. */
import type { RunDriverPorts } from '@earendil-works/pi-agent-core';
import type { SessionRunDriver } from '@earendil-works/pi-coding-agent';
import { createHash, randomUUID } from 'node:crypto';
import type { DecisionPort as JevDecisionPort } from './decision-port.ts';
import { ContractError, type IntentBinding, type Json, type ObservationPacket, type OperationProposal, type ReadSet, type ScopeBinding } from './contracts.ts';
import { type TaskClock } from './task-context.ts';
import { JEV_MODEL } from './question-packing.ts';
import { type InteractionScope } from './interaction-scope.ts';
import { bindingOf, customMessage, PRESCREEN_TYPE, CLERK_TYPE, type ContextBinding } from '../../extensions/table/context-policy.ts';
import {createCanonicalOperationDispatcher,type HostOperationContext} from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import {createDecisionAdapter} from './decision-adapter.ts';
import {createMemoryReadDomain,MEMORY_READ_POLICY_VERSION} from './memory-read-domain.ts';
import {createMemoryReadOwner,presentMemoryEvidence} from './memory-read-owner.ts';
import {TaskRuntime,type TaskRecord} from './task-runtime.ts';
import {PREPARATION_DECISION_BUDGET} from './preparation-budget.ts';
import {issueSourceRef} from './source-ref.ts';
import { NPC_REACTION_DECISION, type ConsequenceClass } from './candidates.ts';
import { type GuardedDestination } from './route-compile.ts';
import { type ConsequenceRow } from './consequence-route.ts';
import { firstStepThinkingBudget } from './host-budgets.ts';
import { type NpcActPort } from './npc-act.ts';
import { issuedSection, type CandidateBodies } from './candidate-bodies.ts';
import { IMPROVISATION_GUIDANCE, CARRIED_VIEW_BYTES, fitView, scenePassages, type PassageSource } from './carried-views.ts';
import { DEFAULT_TURN_BUDGET_MS, ROUTE_FAMILY, type BindRecord, type Candidate, type TurnContext } from './step-policy.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
/** The canonical dispatcher shares this lease with action admission. If a provider rejects an output-limit field,
 * its lane reserves the declared maxTokens; keep the existing 40k run allowance plus Flapcode GPT-6's 128k bound. */
const CLERK_PROVIDER_OUTPUT_BUDGET = 168_000;

/**
 * §135.11.2 (SL-50 stage 2): the head line of the run's first `coc-clerk` note -- writes are silent, stated once per run
 * where the model reads it beside the carried views right before its step. The capsule's own sentence stays (§135.11.1).
 * §135.5 addendum (SL-88, "what needs no result does not wait"): names which calls are blocking and which are not, so a
 * non-blocking apply goes out with its narrate in one call instead of costing a whole extra model step. Keeper-only,
 * system language.
 */
export const CLERK_NOTE_HEAD = IMPROVISATION_GUIDANCE+' Use apply move with establish:{summary} and via for a new place, apply clue with establish:{summary} and how for new evidence, and apply npc walk_on for a newcomer. On compose steps, prepare selected story materials from supplied source and committed receipts; narrate with handoff:true submits the final plan to the host expression phase. OOC replies remain direct. Do not repeat supplied lookups, restage recorded people, or add optional bookkeeping just to fill fields. Genuine unresolved requirements retain their ordinary operations. '
  + 'Check selection belongs to Jev and the host. Never call resolve or choose a check, including after an unavailable decision, ambiguous binding, refused operation or spent budget. '
  + 'A check the host left without a roll (decided_under_uncertainty) is narrated by your own judgement; never stage it as pending or ask the player to repeat it. '
  + 'Writes are silent: write no prose beside apply, resolve or lookup calls (it is dropped and never shown). '
  + 'An apply whose landing is fixed by its own arguments is non-blocking: you may put it and final narrate handoff in the same response, '
  + 'writes first, narrate handoff last; resolve, look, lookup and recall are blocking -- the prose needs a result you do not have yet -- so '
  + 'wait for their result before the handoff. narrate without handoff only checks privately. The host streams the author after handoff; do not call output or add prose afterward.';
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
  take(at?: {scene?: string; run?: string; scope?: {worldline?: string; loop?: number}}): {pending: Array<{focus: string; question: string; since_turn: number; purpose?: string; scene?: string; person?: string}>;
    landed: Array<{focus: string; question: string; since_turn: number; answer?: Row; unavailable?: string; cached?: boolean}>;
    /** §135.20.1: the answers held at `scene` that this run's request does not hold yet, newest first. */
    held?: Array<{focus: string; question: string; since_turn: number; answer: Row; cached?: boolean}>;
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
  settle?(input: {scene: string; turn: number; elapsed_ms: number; scope?: {worldline?: string; loop?: number}}): Promise<{foci: string[]; waited_ms: number; bound_ms: number; landed: number; pending: number}>;
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
const DELIVERY_VERBS: Readonly<Record<string, 'accepted' | 'awaiting_player'>> = Object.freeze({output: 'accepted', ask: 'awaiting_player'});
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

export function emptyTurnContext(): TurnContext {
  return {scene: '', clock: null, present: [], receipts: []};
}

/**
 * The table context and the Jev scope binding from two read-only kernel reads. §143.23: the status's `last_exchange`, when
 * the kernel gives one, rides on the context as it is (the compile's state carries it); nothing here reads what was said.
 */
export function readTable(capsule: Row, status: Row): {context: TurnContext; scope?: ScopeBinding; readSet?: ReadSet; turn?: number; binding?: ContextBinding} {
  const where = object(capsule.where), exchange = status.last_exchange;
  const outcomes=array(status.receipts).slice(-12).map(receipt=>Object.fromEntries(
    ['kind','name','minutes','clock_before','clock_after','outcome','passed','success','from','to','why'].filter(key=>object(receipt)[key]!==undefined).map(key=>[key,object(receipt)[key]]))).filter(value=>Object.keys(value).length);
  const context: TurnContext = {scene: text(where.scene), clock: (where.clock ?? null) as TurnContext['clock'],
    present: array(capsule.present).map(person => text(object(object(person).called).name) || text(object(person).name)).filter(Boolean),
    receipts: array(status.receipts).map(receipt => text(object(receipt).id) || JSON.stringify(receipt)),
    ...(where.temporal?{temporal:{scene:where.temporal,people:array(capsule.present).filter(person=>object(person).activity).map(person=>({name:object(person).name,activity:object(person).activity}))} as Json}:{}),
    ...(outcomes.length?{outcomes:outcomes as Json[]}:{}),
    ...(exchange && typeof exchange === 'object' && !Array.isArray(exchange) ? {lastExchange: exchange as Json} : {})};
  const binding = bindingOf(capsule._context);
  if (!binding) return {context};
  return {context, turn: binding.turn, binding,
    scope: {owner: `campaign:${binding.campaign}`, campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop, audience: 'keeper'},
    readSet: [{kind: 'source', resource: binding.campaign, revision: String(binding.source_revision)},
      {kind: 'model', resource: 'decision', revision: JEV_MODEL}, {kind: 'family', resource: ROUTE_FAMILY, revision: '1'}]};
}

/**
 * §135.11.2.1: commerce is open when the capsule shows a quote not yet settled or cancelled (`known.cash_quotes`) or a price
 * paid on this turn or the one before (`known.prices_paid`, a covered service's completion or a bargain over it). Kernel
 * state only; nothing reads the player's words.
 */
export function commerceOpen(capsule: Row, turn: number | undefined): boolean {
  const known = object(capsule.known);
  if (array(known.cash_quotes).length > 0) return true;
  return typeof turn === 'number' && array(known.prices_paid).some(row => typeof object(row).turn === 'number' && object(row).turn >= turn - 1);
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
/** §218.8: the clerk's declared time charged a stated length the player gave for one of several declared activities. */
const statedPart = (records: BindRecord[]): BindRecord | undefined => records.find(entry => entry.name === 'minutes' && entry.scope === 'one_part');

/**
 * Build the engine: the session run driver Pi is given, plus the inline extension that hands it the kernel
 * bridge and the operation gateway (both go onto the bus at session_start, after the driver was created).
 */
export function createHybridEngine(options: HybridEngineOptions): {runDriver: SessionRunDriver; extension: (pi: any) => void; bridge: () => KernelBridge | undefined;
  keeperCallCapMs: number | (() => Promise<number>); onKeeperCallCap: (phase:'first_byte'|'streaming',capMs:number)=>void} {
  let bridge:KernelBridge|undefined,closer:TurnClosePort|undefined,consultations:SourceAnswersPort|undefined,api:any,gateway:OperationGateway|undefined;
  let current:{runId:string;inputRevision:string;rawInput:string}|undefined, model:any;
  let acceptedCapsule:Row|undefined;
  let runSignal:AbortSignal|undefined,closed=false;
  const queries=new Set<AbortController>();
  let steer:Row|undefined;
  const record=(row:Row)=>{try{(options.record??bridge?.record)?.(row);}catch{/* Telemetry is observational. */}};
  const decision=options.decision===undefined?(readJevApiKey(options.env)?createDecisionAdapter({env:options.env}):undefined):options.decision??undefined;
  const bindMemorySearch=()=>{
    for(const query of queries)query.abort('memory_query_owner_closed');
    const bound=bridge,owner=gateway;
    api?.events.emit('coc:typed-memory-search',!closed&&decision&&bound?.call&&bound.campaign
      ?async(request:{campaign:string;toolCallId:string;query:string;filters:Record<string,Json>},signal?:AbortSignal)=>{
        const active=current,controller=new AbortController();
        if(closed||!active||request.campaign!==bound.campaign||bound!==bridge||owner!==gateway)
          throw new KernelError({code:'needs',message:'The memory query owner is unavailable for this run',details:{reason:'memory_query_scope_stale'}});
        queries.add(controller);
        const combined=AbortSignal.any([controller.signal,...(signal?[signal]:[]),...(runSignal?[runSignal]:[])]);
        const inputResource=`input:${active.runId}`;
        const currentRead=async(intent?:IntentBinding)=>{
          if(closed||active!==current||bound!==bridge||owner!==gateway||combined.aborted)throw new ContractError('memory_query_scope_stale');
          const capsule=object(await bound.call!('table.capsule',{campaign:bound.campaign,_context_read:true})),context=object(capsule._context);
          if(closed||active!==current||bound!==bridge||owner!==gateway||combined.aborted
            ||context.campaign!==bound.campaign||!Number.isSafeInteger(context.turn)||typeof context.source_revision!=='string'||typeof context.world_revision!=='string'
            ||intent&&(context.worldline!==intent.scope.worldline||context.loop!==intent.scope.loop||context.turn!==intent.turn))
            throw new ContractError('memory_query_scope_stale');
          const readSet:ReadSet=[{kind:'world',resource:bound.campaign!,revision:text(context.task_world_revision)||context.world_revision},
            {kind:'source',resource:bound.campaign!,revision:text(context.task_source_revision)||context.source_revision},
            {kind:'draft',resource:inputResource,revision:active.inputRevision},
            {kind:'family',resource:'memory-read',revision:MEMORY_READ_POLICY_VERSION}];
          return {context,readSet};
        };
        let leaf:ReturnType<typeof createMemoryReadOwner>|undefined,runtime:TaskRuntime|undefined;
        try{
          const {context,readSet}=await currentRead(),scope:ScopeBinding={owner:`keeper-run:${active.runId}`,campaign:bound.campaign,
            audience:'keeper',worldline:context.worldline,loop:context.loop};
          const rawInput=issueSourceRef({scope,resource:inputResource,revision:active.inputRevision,sourceType:'turn',text:active.rawInput},
            {kind:'utf16',start:0,end:active.rawInput.length});
          const intent:IntentBinding={id:randomUUID(),rawInput,scope,turn:context.turn,inputRevision:active.inputRevision,limits:['read_only']};
          const records=new Map<string,TaskRecord>();
          const operations=createCanonicalOperationDispatcher();
          runtime=new TaskRuntime({decision,domains:[createMemoryReadDomain()],...(options.clock?{clock:options.clock}:{}),
            store:{load:async id=>structuredClone(records.get(id)),save:async value=>{records.set(value.checkpoint.context.id,structuredClone(value));}},
            operations:{validate:async()=> (await currentRead(intent)).readSet,
              dispatch:(proposal,task,journal)=>operations.dispatch(proposal,{task,journal,validateCurrent:async()=>{
                if(task.revalidate((await currentRead(intent)).readSet).status!=='current')throw new ContractError('task_read_set_stale');
              },recover:async()=>{throw new ContractError('memory_query_has_no_world_settlement');},
                trace:event=>record({lane:'memory_query',...event})})}});
          leaf=createMemoryReadOwner({registerOwned:(name,value)=>operations.registerOwned(name,value),runtime:()=>runtime!,
            call:async(method,params)=>object(await bound.call!(method,params))});
          const budget=PREPARATION_DECISION_BUDGET;
          const result=await leaf.search({query:request.query,filters:request.filters},{operationId:request.toolCallId,intent,
            lease:{owner:'memory-read',goal:request.query,scope,capabilities:['recall'],readSet,signal:combined,
              budget:{deadlineAt:(options.clock?.now()??Date.now())+turnBudgetMs(options.env),remainingActions:budget.actions,
                remainingInputTokens:budget.inputTokens,remainingOutputTokens:budget.outputTokens,remainingCostUsd:budget.costUsd}}});
          if(result.status!=='succeeded')throw new KernelError({code:'needs',message:'The memory query did not produce current evidence',
            details:{reason:text(object(result.result).code)||'memory_query_unavailable'}});
          return presentMemoryEvidence(result.result) as Row;
        }finally{leaf?.close();await runtime?.shutdown();queries.delete(controller);}
      }:undefined);
  };
  const runDriver:SessionRunDriver={engine:'hybrid-v1',prepare:context=>{
    for(const query of queries)query.abort('new_keeper_input');
    runSignal=undefined;
    current={runId:context.runId,inputRevision:context.inputRevision,rawInput:context.rawInput};
    steer=undefined;
    api?.events.emit('coc:keeper-run',current);
    const policy={name:'single-keeper',version:'1',initial:()=>null,reduce:()=>null,next:(view:any):any=>{
      if(view.pendingProposals.length)return{kind:'operate',proposals:view.pendingProposals,reason:'keeper_tools'};
      if(view.delivery==='accepted'||view.delivery==='awaiting_player')return{kind:'finish',outcome:view.delivery==='accepted'?'delivered':'awaiting_player',reason:'delivery_accepted'};
      const last=view.lastObservation;
      if(last?.kind==='infer'){
        if(last.status!=='ok')return{kind:'finish',outcome:'failed',reason:'keeper_failed'};
        return{kind:'operate',proposals:[{origin:'policy',operation:'turn_close'}],reason:'publish_keeper_result'};
      }
      if(last?.outcomes?.some((outcome:any)=>outcome.artifact?.kind==='turn_close')&&!steer)
        return{kind:'finish',outcome:'undelivered',reason:'no_delivery'};
      return{kind:'infer',purpose:'adjudicate',reason:'keeper'};
    }};
    const ports:RunDriverPorts={
      record:{record:event=>record({lane:'run',...event})},
      clock:options.clock?{now:()=>options.clock!.now()}:{now:options.now??Date.now},
      operations:{execute:async(proposal,invocation)=>{
        if(proposal.origin==='model'&&invocation.executeModelTool){
          api?.events.emit('coc:model-step',{run:context.runId,step:invocation.stepId,toolCallId:proposal.toolCall?.id,purpose:'adjudicate'});
          const toolResult=await invocation.executeModelTool();
          const details=object(toolResult.details);
          return{status:toolResult.isError?'refused':'ok',toolResult,
            ...(!toolResult.isError&&details.state==='asked'?{delivery:'awaiting_player' as const}:{})};
        }
        if(proposal.operation!=='turn_close')return{status:'refused',reason:'unknown_operation'};
        const verdict=object(await closer?.verdict());
        if(verdict.status==='steer')steer=object(verdict.message);
        return{status:'ok',...(verdict.status==='delivered'?{delivery:verdict.delivery==='awaiting_player'?'awaiting_player' as const:'accepted' as const}:{}),
          artifact:{kind:'turn_close',verdict}};
      }},
      projection:{project:async({stepId,signal})=>{
        const active=current,accepted=acceptedCapsule,bound=bridge;
        runSignal=signal;
        api?.events.emit('coc:keeper-run',{...current,signal});
        api?.events.emit('coc:model-infer',{run:context.runId,step:stepId});
        const messages:Row[]=[];
        let turn:number|undefined;
        if(steer){messages.push({role:'custom',...steer,timestamp:Date.now()});steer=undefined;}
        if(bridge?.call&&bridge.campaign){
          const capsule=object(await bridge.call('table.capsule',{campaign:bridge.campaign,_context_read:true}));
          const scope=object(capsule._context),acceptedScope=object(accepted?.context);
          if(active===current&&active?.runId===context.runId&&bound===bridge&&accepted===acceptedCapsule&&!signal.aborted
            &&accepted?.campaign===bridge.campaign&&typeof accepted.epoch==='string'
            &&['campaign','worldline','loop','turn'].every(key=>scope[key]===acceptedScope[key])){
            const refreshed={...capsule};
            for(const key of ['skills','delivery_recovery'])if(!Object.hasOwn(refreshed,key)&&Object.hasOwn(object(accepted.capsule),key))refreshed[key]=accepted.capsule[key];
            api?.events.emit('coc:capsule',{...accepted,capsule:refreshed,context:scope});
          }
          const enabled=historyEnabled(capsule),allowed=enabled&&!!nativeSearchCapability(model);
          api?.events.emit('coc:native-search-policy',{enabled,allowed,campaign:bridge.campaign,
            worldline:object(capsule._context).worldline,loop:object(capsule._context).loop,
            run:context.runId,step:stepId,...(model?{model:`${model.provider}/${model.id}`}:{})});
          const people=await Promise.all(array(capsule.present).map(async person=>{
            try{const full=object(await bridge!.call!('table.look',{campaign:bridge!.campaign,focus:'npc',name:person.name,_context_read:true}));
              const voice=array(capsule.voices).find(voice=>voice.name===person.name)??{};
              return Object.fromEntries(Object.entries(full).filter(([key,value])=>key==='name'
                ||full.name!==person.name||![person,voice].some(supplied=>Object.hasOwn(supplied,key)&&JSON.stringify(supplied[key])===JSON.stringify(value))));}
            catch{return{name:person.name,coverage:'unavailable; use look if needed'};}
          }));
          turn=scope.turn;
          let taken:ReturnType<SourceAnswersPort['take']>|undefined;
          try{if(consultations&&(!consultations.campaign||consultations.campaign===bridge.campaign))
            taken=consultations.take({scene:object(capsule.where).scene,run:context.runId,scope:{worldline:scope.worldline,loop:scope.loop}});
          }catch(error){record({lane:'run',event:'source_context_unavailable',run:context.runId,reason:String(error)});}
          const carried=taken?await readCarriedViews({call:(method,params)=>bridge!.call!(method,{...params,campaign:bridge!.campaign,_context_read:true}),people:[],
            answers:taken.landed.map(entry=>({name:entry.focus,view:entry.answer?withSourceQuestion(entry.question,entry.answer):{status:'unavailable',reason:entry.unavailable}})),
            held:(taken.held??[]).map(entry=>({name:entry.focus,view:withSourceQuestion(entry.question,entry.answer)})),
            pending:taken.pending,sceneTexts:taken.texts,
            sceneRecords:(taken.records??[]).map(entry=>({...entry,view:{status:entry.unavailable?'unavailable':'landed',note:'Use the named scene or person view for its full current record.'}}))}):undefined;
          if(carried){
            const passages=carriedPassages(carried.views,taken?.texts);
            if(passages.length)api?.events.emit('coc:carried-text',{campaign:bridge.campaign,turn:scope.turn,run:context.runId,passages});
          }
          messages.push({role:'custom',customType:CLERK_TYPE,display:false,timestamp:Date.now(),
            content:JSON.stringify({authority:'Keeper-only current state and actor perspectives; no disclosure grant',people,
              ...(enabled?{historical_reference:allowed?HISTORY_OFFER:HISTORY_UNAVAILABLE}:{}),
              ...(allowed?{native_search_scope:{run:context.runId,step:stepId}}:{}),
              ...(carried?{sources:carriedSection(carried)}:{})}),details:{coc_host:true,campaign:bridge.campaign,turn:scope.turn}});
        }
        messages.push({role:'custom',customType:'coc-host',display:false,timestamp:Date.now(),details:{coc_host:true,scope:'turn',campaign:bridge?.campaign,turn},content:
          'You are the sole Keeper and author. Use current state, actual dialogue, relevant evidence and each character\'s own knowledge. Choose and execute necessary rules through resolve/apply; never invent a roll or replace the player\'s action. Read missing material when needed. Ordinary speech needs no attempted task. Continue playable conversation through minor discrepancies; clarify naturally later. '
          +'look and lookup read evidence; they never move people. Party travel needs an apply move effect; NPC movement needs an npc effect. Wait for the result before describing arrival. Compare location, clock, ownership and settled receipts with prior prose; reconcile only an earlier missed action the player actually chose, once through existing effects. Never execute unchosen actions, infer state changes from prose, repeat settled effects or charge journey time twice. '
          +'Read missing evidence and resolve rule uncertainty first. For ordinary actual changes or event parameters already known, prefer one bare JSON object in version, record, text order: version is 1; record.effects and record.event use the offered apply schemas, with either optional; text is your complete public prose string. The host applies the private record before dependent public text. No code fences, invented changes or required event for unchanged conversation. Already settled effects are not repeated. Unchanged or already settled replies use {{public}}; pure OOC uses {{reference}} without state changes. Future intentions use planned; ordinary speech is not an attempted task. No second author, output tool, material handoff or coverage checklist. Never put public markers or story text beside tool calls. '
          +'Use the play language and {{say:Public Name}}...{{/say}} for NPC speech. Do not repeat the player\'s question merely to fill space. Public text contains no private plans, unrevealed facts or backstage explanation; NPCs do not know everything you know.'});
        record({lane:'run',event:'keeper_context',run:context.runId,step:stepId});
        return messages as any;
      }},
    };
    return{policy,ports,maxSteps:options.maxSteps??48};
  }};
  const extension=(pi:any)=>{
    api=pi;
    pi.events.on('coc:capsule',(value:Row)=>{if(typeof value?.epoch==='string'&&value.capsule)acceptedCapsule=value;});
    pi.events.on('coc:kernel-bridge',(value:KernelBridge)=>{bridge=value?.call?value:undefined;bindMemorySearch();});
    pi.events.on('coc:operation-dispatcher',(value:OperationGateway|undefined)=>{gateway=value;bindMemorySearch();});
    pi.events.on('coc:turn-close',(value:TurnClosePort)=>{closer=value;});
    pi.events.on('coc:source-answers',(value:SourceAnswersPort)=>{consultations=value;});
    const announce=()=>pi.events.emit('coc:loop-engine',{engine:'hybrid-v1',prescreen:'run',singleKeeper:true});
    const refresh=(_event:any,ctx:any)=>{model=ctx?.model;announce();};
    announce();pi.on('session_start',refresh);pi.on('before_agent_start',refresh);
    pi.on('session_shutdown',()=>{closed=true;bindMemorySearch();});
  };
  return{runDriver,extension,bridge:()=>bridge,keeperCallCapMs:async()=>{
    const ordinary=keeperCallCapMs(options.env),level=api?.getThinkingLevel?.();
    return level&&level!=='off'?Math.max(ordinary,(await firstStepThinkingBudget()).callCapMs):ordinary;
  },onKeeperCallCap:(phase,capMs)=>record({lane:'run',event:'keeper_call_cap',run:current?.runId,phase,cap_ms:capMs})};
}
