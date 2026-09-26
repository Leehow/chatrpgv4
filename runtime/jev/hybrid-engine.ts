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
import { TaskLease } from './task-context.ts';
import { JEV_MODEL } from './question-packing.ts';
import { preparationProviderBudget } from './preparation-budget.ts';
import { prepareCheckPreflight } from './check-preflight.ts';
import { bindingOf, CLERK_TYPE, customMessage, PRESCREEN_TYPE, type ContextBinding } from '../../extensions/table/context-policy.ts';
import { prepareKeeperSupport, prescreenEnabled } from '../../extensions/table/prescreen.ts';
import { readJevApiKey, readJevPreselectAllowanceMs } from '../../extensions/jev/agent/config.js';
import type { HostOperationContext, OperationIdentity } from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import { buildCandidates, buildConsequenceCandidates, keeperCall, NPC_REACTION_DECISION, type ConsequenceCandidate, type ConsequenceClass } from './candidates.ts';
import { compileRows } from './compile-rows.ts';
import { interpretCompile, interpretReask, unlockedRow, type FeatureRows, type GuardedDestination, type ReaskInput } from './route-compile.ts';
import { CONSEQUENCE_FAMILY, consequenceBatch, interpretConsequenceResult, type ConsequenceExistsRow, type ConsequenceRow, type ConsequenceView } from './consequence-route.ts';
import { firstStepThinkingBudget, jevStepsBudget, thresholdsForClass } from './host-budgets.ts';
import { firstStepCallCapMs, firstStepThinkingEnabled } from '../../extensions/kernel/first-step-thinking.ts';
import { obligationClerkLine, obligationCrossing } from './obligation-candidates.ts';
import { issuedSection, readCandidateBodies, type CandidateBodies } from './candidate-bodies.ts';
import { CARRIED_VIEW_BYTES, carriedSection, fitView, namedPeople, readCarriedViews, scenePassages, type PassageSource } from './carried-views.ts';
import {
  CLERK_AUTHORITY, createStepPolicy, DEFAULT_CONFIDENCE_GATE, DEFAULT_TURN_BUDGET_MS, exhausted, interpretRoute, missedUnlocks, overRun, ROUTE_FAMILY,
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
 * Keeper-only, system language.
 */
export const CLERK_NOTE_HEAD = 'Writes are silent: write no prose beside apply, resolve or lookup calls (it is dropped and never shown). The '
  + 'turn\'s prose goes through narrate, or is the text of your final step, in the same response as the writes whenever nothing among '
  + 'them needs a result first.';
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
  take(): {pending: Array<{focus: string; question: string; since_turn: number; purpose?: string; scene?: string; person?: string}>;
    landed: Array<{focus: string; question: string; since_turn: number; answer?: Row; unavailable?: string}>;
    /** §22.4.7 / §22.4.7.1: the book's text of a scene or person landed on it, once. */
    texts?: Array<{scene: string; person?: string; pages: Array<{page: number; pdf_label?: string; text: string}>}>;
    /** §22.4.7 / §22.4.7.1 / §22.3.3: a scene's or person's record that settled, once. */
    records?: Array<{scene: string; since_turn: number; person?: string; unavailable?: string; unusable?: string}>};
}
/** The kernel extension's canonical operation gateway (`coc:operation-dispatcher`). */
export interface OperationGateway {
  dispatch(proposal: OperationProposal, context: HostOperationContext): Promise<ObservationPacket>;
}

export interface HybridEngineOptions {
  env: Readonly<NodeJS.ProcessEnv>;
  /** Jev's decision port; defaults to the product adapter when a Jev key is configured, none otherwise. */
  decision?: JevDecisionPort | null;
  /** Telemetry sink for run events; defaults to the kernel bridge's campaign telemetry. */
  record?: (row: Record<string, unknown>) => void;
  maxSteps?: number;
  /** The run's clock (§135.25); tests pass a stub. Defaults to `Date.now`. */
  now?: () => number;
  /** §135.30: the typed-feature compile before a route that has an uncompiled reachable candidate (default true). `false` is the SL-12 policy: the replays' control arm, and tests whose subject is the route. */
  compile?: boolean;
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
 * `shadow` (the default) routes and pairs but never executes; `on` (SL-78's acceptance) additionally executes a
 * cleared candidate through `clerkStep`; `off` builds none of the three classes at all. Any other value is
 * `shadow`: this is a schedule switch, not an open-ended classification, so a fixed default is not the
 * hard-coded-semantic-list the project bans -- there is no text here for it to classify.
 */
export function jevStepsMode(env: Readonly<NodeJS.ProcessEnv>): 'shadow' | 'on' | 'off' {
  const raw = String(env.COC_JEV_STEPS ?? '').trim();
  return raw === 'on' || raw === 'off' ? raw : 'shadow';
}
/** One receipt's own words, for the consequence route's `settled_this_run` state (labels, never ids; D2.3). */
export function receiptLabel(receipt: Row): string {
  const kind = text(receipt.kind);
  if (kind === 'clue') return `clue ${text(receipt.clue)}: ${text(receipt.label) || text(receipt.summary)}`.trim();
  if (kind === 'time') return `${Number.isFinite(receipt.minutes) ? receipt.minutes : '?'} minutes: ${text(receipt.why)}`.trim();
  if (kind === 'roll' && text(receipt.decision) === NPC_REACTION_DECISION) return `first impression: ${text(receipt.actor_label) || text(receipt.actor)} on ${text(receipt.npc)}`;
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

export function emptyTurnContext(): TurnContext {
  return {scene: '', clock: null, present: [], receipts: []};
}

/** The table context and the Jev scope binding from two read-only kernel reads. */
export function readTable(capsule: Row, status: Row): {context: TurnContext; scope?: ScopeBinding; readSet?: ReadSet; turn?: number; binding?: ContextBinding} {
  const where = object(capsule.where);
  const context: TurnContext = {scene: text(where.scene), clock: (where.clock ?? null) as TurnContext['clock'],
    present: array(capsule.present).map(person => text(object(object(person).called).name) || text(object(person).name)).filter(Boolean),
    receipts: array(status.receipts).map(receipt => text(object(receipt).id) || JSON.stringify(receipt))};
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
interface RunState {
  runId: string;
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
  batch?: {message: unknown; fell?: string; fellAt?: string};
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
   * ran none): a read on the same scene reuses it. The prepared packet is kept without its issued bodies.
   */
  lastRead?: {scene: string; outcome?: {step: string; materials: Material[]; message?: Row}};
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
  /** SL-76: the latest read's D1 candidates and scene context, held for the turn-close route (never asked mid-read: see `routeConsequences`'s call site). */
  consequenceCandidates: ConsequenceCandidate[];
  consequenceContext?: TurnContext;
  /** SL-78: `routeConsequencesAfterWrite`'s own recursion counter (`CONSEQUENCE_INLINE_ROUNDS_CAP`'s circuit breaker). */
  consequenceInlineRounds?: number;
  /** SL-78: how many of this run's clerk steps (`clerkDid`) were consequence-class executions, for the `residual` row. */
  consequenceCalls?: number;
  /** SL-78 (§135.32 addendum 2, the `residual` row): the Keeper's own tool calls this turn, by verb. */
  keeperCalls: Record<KeeperResidualKey, number>;
  /** SL-78: how many `purpose: "compile"` Jev decisions this run asked, for the `residual` row. */
  compileCalls: number;
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
  let consultations: SourceAnswersPort | undefined;
  const now = options.now ?? (() => Date.now());
  /** §135.25: the clerk steps the last run's budget deferred, for the next run's first note to the Keeper (session memory). */
  let carried: {campaign?: string; run: string; turn?: number; deferred: DeferredStep[]} | undefined;
  const record = (row: Record<string, unknown>) => {
    try { (options.record ?? bridge?.record)?.(row); } catch { /* Telemetry never steers the run. */ }
  };
  // SL-84 (contract §122 "Jev attempt/batch failure telemetry" addendum): the adapter's own AdapterTrace, which
  // otherwise went nowhere, now writes the `attempt_failed`/`batch_failed` rows.
  const jev = options.decision === null ? undefined
    : options.decision ?? (readJevApiKey(options.env) ? createDecisionAdapter({env: options.env, maxConcurrency: 4, trace: jevFailureTelemetry(record)}) : undefined);
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    if (!bridge?.call || !bridge.campaign) throw new Error('kernel_bridge_unavailable');
    return object(await bridge.call(method, {campaign: bridge.campaign, ...params}));
  };
  const quiet = async (method: string) => {
    try { return await call(method); } catch (error) { record({lane: 'run', event: 'read_failed', method, error: String((error as Error).message).slice(0, 200)}); return {}; }
  };

  /** The kernel reads a step needs and the candidates they issue. Read-only. */
  async function tableReads(run: RunState): Promise<{capsule: Row; status: Row; table: ReturnType<typeof readTable>; candidates: () => Candidate[]; rows: () => FeatureRows;
    consequences: () => ConsequenceCandidate[]}> {
    const [capsule, status, applyOptions, resolveOptions] = await Promise.all([call('table.capsule'), call('table.status'), quiet('table.apply.options'), quiet('table.resolve.options')]);
    const table = readTable(capsule, status);
    // SL-76 (D2.3, D4): every receipt this turn's reads have seen, deduped by id -- the consequence route's
    // "settled this run" state and the turn-close pairing both read this, never the model-origin call's own args.
    for (const receipt of array(status.receipts).map(object)) {
      const id = text(receipt.id);
      if (id && !run.turnReceipts.some(seen => text(seen.id) === id)) run.turnReceipts.push(receipt);
    }
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
      candidates: () => buildCandidates({capsule, applyOptions, resolveOptions, located: run.located, answering: run.answering, ...(fighter ? {fighter} : {})}, run.rawInput),
      // §135.30: the compile's feature rows, from the same reads.
      rows: () => compileRows({capsule, applyOptions, resolveOptions}),
      // SL-76: the three consequence classes, from the same reads (never merged into `candidates()`'s own list).
      consequences: () => jevStepsMode(options.env as NodeJS.ProcessEnv) === 'off' ? [] : buildConsequenceCandidates({capsule, applyOptions, resolveOptions}, run.rawInput)};
  }
  const freshOf = (run: RunState) => tableReads(run).then(read => {
    const candidates = read.candidates();
    run.issued = candidates;
    // SL-78: `consequences` rides on every fresh read (never called unless something reads it) so the execute-mode
    // inline route (`routeConsequencesAfterWrite`, below) can build D1 candidates off the same reads `freshOf`
    // already made, with no extra kernel round trip. `shadow`/`off` never call it, so their own use of `freshOf`
    // (unpacking only `context`/`candidates`/`rows`) is exactly what it was before this addition.
    return {context: read.table.context, candidates, rows: read.rows(), consequences: read.consequences};
  }, () => undefined);

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
    const mode = jevStepsMode(options.env as NodeJS.ProcessEnv);
    if (mode === 'off' || !candidates.length || !jev || !run.scope || !run.readSet) return;
    const view: ConsequenceView = {runId: run.runId, rawInput: run.rawInput, context, observations: [],
      candidates, settled: run.turnReceipts.map(receiptLabel), present: context.present.map(label => ({label, met: true}))};
    const built = consequenceBatch(view, run.scope, run.readSet);
    if (!built) return;
    const thresholds = await jevStepsBudget();
    const began = Date.now();
    const lease = new TaskLease({owner: CONSEQUENCE_FAMILY, goal: `run ${run.runId} consequence`, scope: run.scope, capabilities: ['decision'],
      readSet: run.readSet, signal, budget: {deadlineAt: Date.now() + 15_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
    let result: DecisionResult | undefined;
    try { result = await jev.decide(built.batch, lease); } catch { result = undefined; } finally { lease.close(); }
    const ms = Date.now() - began;
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
    for (const key of consequenceKeysToExecute(mode, outcome.rows, run.consequenceExecuted, thresholds.execute)) {
      run.consequenceExecuted.add(key);
      const candidate = candidates.find(value => value.key === key);
      if (!candidate) continue;
      run.consequenceCalls = (run.consequenceCalls ?? 0) + 1;
      await clerkStep(run, {candidate}, {runId: run.runId, stepId, operationId: `consequence:${candidate.key}`, signal}).catch(() => undefined);
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
    if (!fresh || jevStepsMode(options.env as NodeJS.ProcessEnv) !== 'on') return;
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
      clock: {now: () => Date.now()},
      record: {record: (event: RunEvent) => { record({lane: 'run', ...event}); if (event.type === 'run_end') budgetSummary(run); }},
      read: {
        async read(_proposal, invocation) {
          const began = Date.now();
          const {capsule, table, candidates, rows, consequences} = await tableReads(run);
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
          // (§135.6.1, SL-44); only the provider budget is per input. A re-read on the same scene reuses the previous outcome.
          const allowance = run.prescreenAllowanceMs, scene = table.context.scene;
          const reuse = run.lastRead?.scene === scene ? run.lastRead.outcome : undefined;
          // Why a read ran without it (§135.6, 2026-09-24): live gate #4's rows said only `not_run`, and the cause -- the
          // preselect setting off in its launch -- had to be found by reading the launcher.
          const skipped = !jev ? 'no_jev' : !prescreenEnabled(options.env as NodeJS.ProcessEnv) ? 'preselect_off' : !table.binding ? 'no_binding'
            : run.providerBudget.actions <= 0 ? 'allowance_spent' : !(bridge?.call && bridge.campaign) ? 'no_bridge' : undefined;
          let materials: Material[] = [], calls = 0, prescreen: Row = {status: 'not_run', reason: skipped ?? null}, packet: Row | undefined;
          let outcome: {step: string; materials: Material[]; message?: Row} | undefined;
          if (reuse) {
            // The same scene as the run's previous read: its prescreen's outcome again, at no Jev call and no time (a fallback's
            // outcome is no material; a re-run would only spend the remainder again).
            materials = reuse.materials; packet = reuse.message; outcome = reuse;
            prescreen = {status: 'reused', from: reuse.step, jev_calls: 0, ms: 0, materials: materials.length};
          } else if (!skipped && jev && bridge?.call && bridge.campaign && table.binding) {
            const events: Row[] = [], prescreenBegan = Date.now();
            const message = await prepareKeeperSupport({call: (method, params) => bridge!.call!(method, params), campaign: bridge.campaign,
              binding: table.binding, capsule, signal: invocation.signal, decision: jev, env: options.env as NodeJS.ProcessEnv,
              record: event => { events.push(event); record({...event, run: run.runId, step: invocation.stepId}); },
              byteBudget: PRESCREEN_BYTES, deadlineAt: Date.now() + allowance, providerBudget: run.providerBudget});
            const prepared = events.find(event => event.event === 'prepared'), fallback = events.find(event => event.event === 'fallback');
            // A prescreen that fell back still spent its calls (§124.11): gate #5's read said 0 while 12 had run.
            calls = Number((prepared ?? fallback)?.jev_calls ?? 0);
            const found = packetMaterials(message ? object(message) : undefined);
            materials = found.materials;
            if (found.located.length) run.located = found.located;
            // What the read did, as the route question sees it under "done this turn": the prototype's read summary
            // (runs 11-13 decided the declared move with it), including the locate's own judgment of what is relevant.
            const prescreenMs = Date.now() - prescreenBegan;
            prescreen = {status: message ? 'prepared' : text(events.find(event => event.event === 'fallback' || event.event === 'skipped')?.event) || 'none',
              jev_calls: calls, ms: prescreenMs, allowance_ms: allowance, materials: materials.length, supplied: prepared?.supplied ?? null,
              stop_reason: prepared?.stop_reason ?? null, locate: prepared?.locate ?? null, located: found.located.length,
              fallback: fallback?.reason ?? null, ...(fallback?.key ? {key: fallback.key} : {}),
              ...(prepared?.binding_refresh ? {binding_refresh: prepared.binding_refresh} : {})};
            packet = message ? object(message) : undefined;
            outcome = {step: invocation.stepId, materials, ...(packet ? {message: packet} : {})};
            run.prescreenSpent.reads++; run.prescreenSpent.jev_calls += calls; run.prescreenSpent.ms += prescreenMs;
          }
          run.lastRead = {scene, ...(outcome ? {outcome} : {})};
          // §135.31.1: the scene's source passages are read off the prescreen's own materials (the packet before the issued bodies).
          if (outcome?.message) {
            let content: Row = {};
            try { content = object(JSON.parse(String(outcome.message.content ?? ''))); } catch { content = {}; }
            for (const material of array(content.materials).map(object)) run.passages.push({scene, material});
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
          const ms = Date.now() - began;
          record({lane: 'run', event: 'read', run: run.runId, stepId: invocation.stepId, ms, scene: table.context.scene,
            candidates: fresh.candidates.map(candidate => candidate.key), prescreen,
            ...(issued ? {bodies: {count: issued.bodies.length, bytes: issued.bytes, reads: issued.reads, ms: issued.ms,
              truncated: issued.bodies.filter(entry => entry.truncated).length, omitted: issued.omitted.map(entry => `${entry.key}:${entry.reason}`)}} : {})});
          // SL-76 (§135.32, §135.3.1): this read's D1 candidates are kept for the turn-close route, never asked
          // here. A read is not a decision (§135.6, SL-22), and the run's own route/compile/bind Jev calls stay
          // exactly what they were before SL-76 -- a mid-read consequence call was found, live-gate style, to move
          // `single-loop-compile.test.mjs`'s "the compile is the run's first Jev question" off true, and to make a
          // `read_more` on an unchanged scene (which must spend no Jev call at all, §135.6's reuse) spend one.
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
      ...(jev ? {decision: {decide: request => decide(run, request)}} : {}),
    };
  }

  /** One Keeper call of the batch its response made. A step that fails sends the rest of the batch back unrun. */
  async function modelStep(run: RunState, proposal: {operation: string; assistantMessage?: unknown; toolCall?: {id: string}}, execute: () => Promise<any>,
    stepId: string, signal: AbortSignal) {
    if (run.batch?.message !== proposal.assistantMessage) run.batch = {message: proposal.assistantMessage};
    const batch = run.batch!;
    if (batch.fell) {
      const reason = `batch_step_fell: ${batch.fell}`;
      return {status: 'refused' as const, reason, artifact: {kind: 'execute', executed: {ok: false, summary: {tool: proposal.operation, skipped: true, after: batch.fellAt ?? null}}, skipped: true}};
    }
    // §135.31: the kernel extension's tool row names the step a model call came from (announced before it runs).
    if (proposal.toolCall?.id) api?.events?.emit?.('coc:model-step', {toolCallId: proposal.toolCall.id, run: run.runId, step: stepId, operation: proposal.operation});
    // SL-78 (§135.32 addendum 2, the `residual` row): every Keeper tool call among the five bookkeeping verbs is
    // counted here, attempt or not -- a refused free-text call is exactly the residual SL-78 measures.
    if (isKeeperResidualKey(proposal.operation)) run.keeperCalls[proposal.operation]++;
    const toolResult = await execute();
    const delivery = !toolResult.isError ? DELIVERY_VERBS[proposal.operation] : undefined;
    const fell = toolResult.isError ? `${proposal.operation}_refused` : proposal.operation === 'resolve' && failedCheck(toolResult.details) ? 'check_failed' : undefined;
    if (fell) { batch.fell = fell; batch.fellAt = proposal.toolCall?.id; }
    const fresh = !toolResult.isError && WRITE_VERBS.has(proposal.operation) ? await freshOf(run) : undefined;
    // SL-78: the Keeper's own settled write (never merely proposed) is a point a listed D1 class can newly clear
    // from, the same as a clerk write. `off`/`shadow` return at once inside `routeConsequencesAfterWrite`.
    if (fresh) await routeConsequencesAfterWrite(run, fresh, signal, stepId).catch(() => undefined);
    return {status: toolResult.isError ? 'refused' as const : 'ok' as const, toolResult, ...(delivery ? {delivery} : {}),
      artifact: {kind: 'execute', executed: {ok: !toolResult.isError, summary: {tool: proposal.operation}}, ...(fresh ? {fresh} : {}), ...(fell ? {fell} : {})}};
  }

  /**
   * A clerk (policy-origin) write: the candidate's Keeper verb through the kernel extension's canonical gateway, so
   * the `tool_call` gates, admission, Mod hooks, the kernel and the `tool_result` hooks run exactly as for the model.
   */
  async function clerkStep(run: RunState, params: Row, invocation: {runId: string; stepId: string; operationId: string; signal: AbortSignal}) {
    const candidate = params.candidate as Candidate | undefined, extra = object(params.extra) as Record<string, Json>;
    const refuse = (reason: string) => ({status: 'refused' as const, reason, artifact: {kind: 'execute', executed: {ok: false, summary: {origin: 'policy', refused: reason}}}});
    if (!candidate) return refuse('no_candidate');
    // The IntentBinding is required: no policy-origin write before a read has bound the run to this player input.
    if (!run.intent || !run.scope || run.turn === undefined) return refuse('intent_unbound');
    if (!candidate.clerk || !(CLERK_AUTHORITY as readonly string[]).includes(candidate.clerk)) return refuse('not_clerk_authority');
    const session = run.session, dispatcher = gateway;
    if (!session || !dispatcher || !bridge?.campaign) return {status: 'unavailable' as const, reason: 'operation_gateway_unavailable',
      artifact: {kind: 'execute', executed: {ok: false, summary: {origin: 'policy', refused: 'operation_gateway_unavailable'}}}};
    const {tool, args} = keeperCall(candidate, extra);
    // §135.28: how every parameter of this write got its value (jev, rule-default, stated, composed); none was a model call.
    // Computed before the dispatch (§32.12): admission reads it off the host origin to admit a compile selection.
    const bindings = bindRecords(candidate, extra, array(params.bindings) as BindRecord[]);
    const readSet: ReadSet = [{kind: 'world', resource: run.scope.campaign!, revision: digest([run.turn, run.inputRevision])}];
    run.lease ??= new TaskLease({owner: 'single-loop-clerk', goal: run.rawInput.trim() || 'single-loop clerk step', scope: run.scope, capabilities: ['apply', 'resolve'],
      readSet, signal: invocation.signal,
      budget: {deadlineAt: Date.now() + 300_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
    const lease = run.lease, task = lease.context;
    const operation: OperationProposal = {id: `clerk:${invocation.operationId}`, taskId: task.id, operation: tool, args: args as Record<string, Json>,
      capability: tool, scope: task.scope, readSet: task.readSet, basis: []};
    const campaign = bridge.campaign, kernel = bridge.call!;
    const context: HostOperationContext = {
      session: session as any, task: lease,
      journal: {load: async id => run.identities.get(id), save: async identity => { run.identities.set(identity.operationId, structuredClone(identity)); }},
      // The run's input is still the table's: same turn, still open. A new input ends the run through its signal.
      validateCurrent: async () => {
        const status = object(await kernel('table.status', {campaign}));
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
      origin: {origin: 'policy', run: run.runId, step: invocation.stepId, clerk: candidate.clerk, ...(candidate.basis !== undefined ? {basis: candidate.basis} : {}),
        bindings: admissionBindings(bindings, extra) as Json},
    };
    const packet = await dispatcher.dispatch(operation, context);
    const ok = packet.status === 'succeeded', callId = run.identities.get(operation.id)?.callId ?? null;
    const result = object(packet.result);
    const refusal = ok ? undefined : object(result.coc_error).code ?? result.code ?? packet.status;
    const {goal: _goal, method: _method, ...shown} = object(tool === 'resolve' ? args.action : {}) as Row;
    const obligation = obligationClerkLine(candidate, ok, result, packet.receipts), crossed = ok ? obligationCrossing(candidate, result, packet.receipts) : undefined;
    const binding = defaultLine(candidate);
    record({lane: 'run', event: 'bind', run: run.runId, step: invocation.stepId, candidate: candidate.key, clerk: candidate.clerk, call_id: callId, status: packet.status,
      bindings});
    // §135.31: the people an executed clerk step names are carried to the Keeper before its next model step.
    if (ok) for (const name of namedPeople(candidate)) if (!run.named.includes(name)) run.named.push(name);
    run.clerkDid.push({step: invocation.stepId, operation: tool, label: candidate.label, clerk: candidate.clerk, call_id: callId, status: packet.status,
      receipts: packet.receipts, ...(candidate.basis !== undefined ? {basis: candidate.basis} : {}),
      result: (tool === 'resolve' ? {action: shown, outcome: result.outcome ?? null, ...(result.obligation ? {obligation: result.obligation} : {})} : {effects: args.effects}) as Json,
      ...(obligation ? {obligation} : {}), ...(crossed ? {obligation_open: crossed} : {}), ...(binding ? {binding} : {})});
    const read = await freshOf(run);
    // SL-78 (§135.32 addendum 2): a settled clerk write -- the compile's own declared step, or (recursively) an
    // executed consequence step itself -- is a point a listed D1 class can newly clear from; this is the loop's
    // re-route, run here, before the run's next step. A refused write settles nothing and re-routes nothing.
    if (ok && read) await routeConsequencesAfterWrite(run, read, invocation.signal, invocation.stepId).catch(() => undefined);
    return {status: ok ? 'ok' as const : 'refused' as const, ...(ok ? {} : {reason: String(refusal)}),
      artifact: {kind: 'execute', executed: {ok, summary: {origin: 'policy', tool, call_id: callId, status: packet.status, receipts: packet.receipts,
        clerk: candidate.clerk ?? null, basis: candidate.basis ?? null, ...(ok ? checkOf(tool, result) : {}), ...(ok ? {} : {refusal: String(refusal)})} as Json},
      ...(read ? {fresh: read} : {})}};
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
    const mode = jevStepsMode(options.env as NodeJS.ProcessEnv), shadow = mode !== 'on';
    for (const [key, row] of run.consequenceRows) record({lane: 'route', purpose: 'consequence', shadow, run: run.runId, class: row.class, key,
      cleared: row.cleared, confidence: row.confidence, distribution: row.distribution, ...(row.direct ? {direct: true} : {}),
      keeper_did: keeperDidFor({consequenceClass: row.class, target: row.target, clue: row.clue}, run.turnReceipts)});
    for (const [cls, row] of run.consequenceExists) record({lane: 'route', purpose: 'consequence', shadow, run: run.runId, class: cls, exists: true,
      cleared: row.cleared, confidence: row.confidence, distribution: row.distribution});
    if (run.consequenceMs) record({lane: 'run', event: 'consequence_budget', run: run.runId, ms: run.consequenceMs, rows: run.consequenceRows.size});
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
    if (jevStepsMode(options.env as NodeJS.ProcessEnv) !== 'on') return;
    record({lane: 'residual', run: run.runId, turn: run.turn ?? null, keeper_calls: {...run.keeperCalls}, compile_calls: run.compileCalls,
      clerk_calls: run.clerkDid.length, consequence_calls: run.consequenceCalls ?? 0});
  }

  async function turnCloseStep(run: RunState, invocation: {stepId: string; signal: AbortSignal}) {
    // SL-76: the shadow route's one Jev call per run, made here -- after the run's own route/compile/bind calls are
    // long done, so it can never be mistaken for the run's first decision, and a `read_more` that must spend no
    // Jev call (§135.6's same-scene reuse) still spends none. `routeConsequences` itself is the guard against
    // asking twice: nothing here dedupes by digest, because a run has exactly one turn close.
    await routeConsequences(run, run.consequenceCandidates, run.consequenceContext ?? emptyTurnContext(), invocation.signal, invocation.stepId);
    pairConsequences(run);
    recordResidual(run);
    const done = (status: 'ok' | 'unavailable', verdict: Row, delivery?: 'accepted' | 'awaiting_player') =>
      ({status, ...(delivery ? {delivery} : {}), ...(status === 'unavailable' ? {reason: 'turn_close_unavailable'} : {}),
        artifact: {kind: 'turn_close', verdict} as StepArtifact});
    if (!closer) return done('unavailable', {status: 'unavailable', reason: 'no_turn_close_port'});
    let verdict: Row;
    try { verdict = object(await closer.verdict()); } catch (error) {
      return done('unavailable', {status: 'unavailable', reason: String((error as Error)?.message ?? error).slice(0, 200)});
    }
    if (verdict.status === 'delivered') {
      const delivery = verdict.delivery === 'awaiting_player' ? 'awaiting_player' as const : 'accepted' as const;
      return done('ok', {status: 'delivered', delivery, implicit: verdict.implicit === true, call_id: verdict.call_id ?? null, turn: verdict.turn ?? null}, delivery);
    }
    if (verdict.status === 'steer' && verdict.message && typeof verdict.message === 'object') {
      run.steer = object(verdict.message);
      return done('ok', {status: 'steer', kind: text(verdict.kind) || 'steer'});
    }
    return done('ok', {status: 'none', reason: text(verdict.reason) || 'nothing_owed'});
  }

  /** Jev's decisions: route and closed bind through the DecisionPort, the ordinary check through its binder. */
  async function decide(run: RunState, request: {runId: string; stepId: string; purpose: string; question: unknown; signal: AbortSignal}) {
    const question = object(request.question);
    // SL-78 (the `residual` row): every compile decision this run asked, whatever it answers -- counted here,
    // at the one place every `purpose: "compile"` request passes, rather than duplicated at each call site.
    if (request.purpose === 'compile') run.compileCalls++;
    if (request.purpose === 'locate') return {status: 'ok' as const, artifact: {kind: 'locate', calls: 0, ms: 0, summary: {folded_into: 'read'}} as StepArtifact};
    // §135.28: a clerk bind the policy settles without Jev (its budget is spent) asks nothing here.
    if (question.offline) return {status: 'unavailable' as const, artifact: {reason: `offline_${text(question.offline)}`}};
    if (request.purpose === 'bind-ordinary') {
      const candidate = question.candidate as Candidate | undefined;
      if (!candidate || !run.scope || !run.readSet || run.turn === undefined || !bridge?.campaign || !bridge.call)
        return {status: 'unavailable' as const, artifact: {kind: 'bind-ordinary', bound: {disposition: 'unavailable', unresolved: ['binder_unavailable'], calls: 0, ms: 0}} as StepArtifact};
      const began = Date.now();
      const lease = new TaskLease({owner: 'ordinary-resolve', goal: run.rawInput.trim() || 'ordinary check', scope: run.scope, capabilities: ['decision'],
        readSet: run.readSet, signal: request.signal,
        // A decision's own lease, like the route's (§135.6, SL-22 addendum): never the prescreen allowance's remainder.
        budget: {deadlineAt: Date.now() + 15_000, remainingInputTokens: 400_000,
          remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
      try {
        const result = await prepareCheckPreflight({campaign: bridge.campaign, turn: run.turn, rawInput: run.rawInput, goal: run.rawInput, scope: run.scope,
          readSet: run.readSet, publicContext: [{role: 'player', text: run.rawInput}], call: (method, params) => bridge!.call!(method, params), decision: jev!, lease,
          // §135.30.3 (owner ruling 2026-09-24): the compile's cleared act settled roll-or-not; the binder's own answer is recorded.
          ...(compiledCheck(candidate) ? {compiled: compiledCheck(candidate)} : {}),
          // SL-31 (§135.28): the clerk's binder takes the difficulty and the dice from Jev only past the policy's gate, else
          // their rules defaults; a single issued investigator is the actor.
          defaults: {gate: Number(question.gate) || DEFAULT_CONFIDENCE_GATE}});
        // §135.30.3 (SL-26): the profile answer behind the skill rides with the action, so the bind record says whether it cleared.
        const skill = result.evidence?.profile;
        const bound = {disposition: result.advice.disposition, ...(result.advice.action ? {action: result.advice.action as unknown as Record<string, Json>} : {}),
          unresolved: result.advice.unresolved, calls: result.decisionCalls, ms: Date.now() - began, ...(skill ? {skill} : {}),
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
    const batch = question.batch as DecisionBatch | undefined;
    if (!batch || (request.purpose !== 'route' && request.purpose !== 'bind' && request.purpose !== 'compile' && request.purpose !== 'reask'))
      return {status: 'unavailable' as const, artifact: {reason: batch ? `no_${request.purpose}_decider` : 'no_scope_binding'}};
    const began = Date.now();
    const lease = new TaskLease({owner: batch.family, goal: `run ${request.runId} ${request.purpose}`, scope: batch.scope, capabilities: ['decision'],
      readSet: batch.readSet, signal: request.signal,
      budget: {deadlineAt: Date.now() + 15_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
    try {
      const result = await jev!.decide(batch, lease);
      const answers = result.status === 'complete' ? Object.fromEntries(Object.entries(result.answers ?? {}).map(([key, value]) => [key,
        value.status === 'answered' && value.type === 'choice' ? {choice: value.choice, confidence: value.confidence ?? null, probabilities: value.probabilities ?? null} : {status: value.status}])) : null;
      // Every answer's distribution is retained (spec user story 28): the gates can be re-read from a live table.
      const offered = array(question.offered) as Candidate[];
      const settled = array(question.settled).map(String);
      const routed = request.purpose === 'route' ? interpretRoute({located: question.located === true, settled} as RunView, offered, result, Number(question.gate) || DEFAULT_CONFIDENCE_GATE) : undefined;
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
        record({lane: 'route', purpose: 'reask', run: run.runId, step: request.stepId, status: result.status, ms: Date.now() - began,
          // SL-84: the last attempt's HTTP status or network/timeout code, so a `jev_service_error` reason is legible.
          ...(result.failure?.status !== undefined ? {jev_status: result.failure.status} : {}),
          settled_by: array(input.settled).map(entry => object(entry).key), answers: reasked.answers, filed: reasked.filed.map(candidate => candidate.key), reason: reasked.reason});
        return {status: result.status === 'complete' ? 'ok' as const : 'unavailable' as const, artifact: {kind: 'reask', result} as StepArtifact};
      }
      record({lane: 'route', purpose: request.purpose, run: run.runId, step: request.stepId, status: result.status, ms: Date.now() - began,
        // SL-84: the last attempt's HTTP status or network/timeout code, so a `jev_service_error` reason is legible.
        ...(result.failure?.status !== undefined ? {jev_status: result.failure.status} : {}),
        ...(request.purpose === 'route' ? {offered: offered.map(candidate => candidate.key), selected: routed?.selected ?? [], exit: routed?.exit ?? null, reason: routed?.reason ?? null,
          ...(settled.length ? {settled} : {})}
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
    if (consultations && (!consultations.campaign || consultations.campaign === bridge.campaign)) {
      try { taken = consultations.take(); } catch { /* the port never steers the run */ }
    }
    const answers = taken.landed.map(entry => ({name: entry.focus, view: entry.answer ? {question: entry.question, ...entry.answer}
      : {question: entry.question, status: 'unavailable', reason: entry.unavailable ?? 'reading_failed'}}));
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
    if (!sceneDue && !people.length && !session && !passages && !answers.length && !pending.length && !sceneTexts.length && !sceneRecords.length) return undefined;
    const carried = await readCarriedViews({call, ...(sceneDue ? {scene: sceneDue} : {}), people, skip: run.shown.people, ...(session ? {session} : {}),
      ...(passages ? {passages} : {}), ...(answers.length ? {answers} : {}), ...(pending.length ? {pending} : {}),
      ...(sceneTexts.length ? {sceneTexts} : {}), ...(sceneRecords.length ? {sceneRecords} : {})}).catch(() => undefined);
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
        ...(entry.truncated ? {truncated: true, omitted_fields: entry.omitted_fields ?? []} : {})})),
      omitted: carried.omitted, ...(carried.pending?.length ? {pending: carried.pending.map(entry => ({focus: entry.focus, since_turn: entry.since_turn, purpose: entry.purpose ?? null,
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
    const base = Object.keys(content).length;
    run.lastInferAt = now() - run.startedAt;
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
        + '(a step the kernel forces still runs). Your own tool calls carry the rest of the turn; then narrate.'});
    }
    // §135.11 addendum (SL-20): the compose after the clerk settled the declaration says why it is the compose.
    if (step.reason === 'settled') content.settled_note = 'The clerk settled the player\'s declared step this turn (see clerk_did). Narrate its result '
      + 'and close the turn; a further check or step can wait for the player\'s next input unless the fiction cannot go on without it.';
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
    // §11.5.3: an NPC whose standing action is `hold` or `flee` issued no step, so its turn is the Keeper's; the note
    // says so with the standing and its disposition, once per NPC turn (the kernel's own view, never re-worded).
    const fight = object(run.fight), held = object(fight.standing_action), turnKey = `${text(fight.turn_of)}:r${String(fight.round ?? '')}`;
    if (fight.status === 'active' && ['hold', 'flee'].includes(text(held.action)) && run.noted !== turnKey) {
      run.noted = turnKey;
      Object.assign(content, {npc_turn: {npc: text(fight.turn_of), round: fight.round ?? null, standing_action: held},
        npc_turn_note: 'It is this NPC\'s turn and its standing action is not an attack, so the clerk did not act for it: '
          + 'narrate the holding back, yielding or flight, or write apply npc action/disposition if the fiction says otherwise.'});
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
    if (head || Object.keys(content).length > base || fresh.length) {
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
  /** §135.29 addendum 2 (SL-82): the turn's first call's own cap, resolved fresh per attempt (the data-file
   * read is cached after the first, so this is cheap). Only ever installed when the flag is on -- see the
   * `keeperCallCapMs` return below -- so the flag-off path never reaches it and stays the plain ordinary
   * number SL-69 already shipped, byte for byte. */
  const resolveKeeperCallCapMs = async (): Promise<number> => {
    const ordinary = keeperCallCapMs(options.env);
    const {callCapMs: allowance} = await firstStepThinkingBudget();
    return firstStepCallCapMs(true, step, ordinary, allowance);
  };

  const runDriver: SessionRunDriver = {
    engine: 'hybrid-v1',
    // The Jev scope comes from the run's own read step (a read artifact carries the binding), never from a read
    // outside a step; until a read has bound it, a route question carries no batch and degrades to the Keeper.
    prepare: context => {
      currentRunId = context.runId;
      const allowance = readJevPreselectAllowanceMs(options.env as NodeJS.ProcessEnv), startedAt = now(), budgetMs = turnBudgetMs(options.env);
      const run: RunState = {runId: context.runId, rawInput: context.rawInput, inputRevision: context.inputRevision, session: context.session as unknown as Row,
        startedAt, prescreenAllowanceMs: allowance, providerBudget: preparationProviderBudget(), located: [], clerkDid: [], projected: 0,
        identities: new Map(), budgetMs, deferred: [], investigators: [], named: [], shown: {scenes: new Set(), people: new Set(), passages: new Set(), pending: new Set()}, passages: [],
        guarded: [], guardedShown: 0,
        prescreenSpent: {reads: 0, jev_calls: 0, ms: 0},
        consequenceRows: new Map(), consequenceExists: new Map(), consequenceExecuted: new Set(), consequenceMs: 0, turnReceipts: [], consequenceCandidates: [],
        keeperCalls: {apply: 0, resolve: 0, look: 0, lookup: 0, recall: 0}, compileCalls: 0};
      const policy = createStepPolicy({context: emptyTurnContext(), budget: {maxJevMs: allowance, maxRunMs: budgetMs}, clock: now, startedAt,
        ...(options.compile === false ? {compile: false} : {})});
      return {policy: budgetRows(run, policy), ports: makePorts(run), maxSteps: options.maxSteps ?? 48};
    },
  };

  const extension = (pi: any) => {
    api = pi;
    pi.events.on('coc:kernel-bridge', (data: KernelBridge) => { bridge = data?.call ? data : undefined; });
    pi.events.on('coc:operation-dispatcher', (data: OperationGateway) => { gateway = data && typeof data.dispatch === 'function' ? data : undefined; });
    pi.events.on('coc:turn-close', (data: TurnClosePort) => { closer = data && typeof data.verdict === 'function' ? data : undefined; });
    pi.events.on('coc:source-answers', (data: SourceAnswersPort) => { consultations = data && typeof data.take === 'function' ? data : undefined; });
    // The run owns the prescreen on this engine (§135.6); the context hook injects what the run prepared.
    const announce = () => { pi.events.emit('coc:loop-engine', {engine: 'hybrid-v1', prescreen: 'run'}); };
    announce();
    // The plan is an artifact inside the run, never a second executor: no private plan tool on this engine (§135.5).
    const withoutPlanTool = () => {
      try {
        const active: string[] = typeof pi.getActiveTools === 'function' ? pi.getActiveTools() : [];
        if (active.includes('submit_plan_packet')) pi.setActiveTools(active.filter(name => name !== 'submit_plan_packet'));
      } catch { /* No tool surface yet. */ }
    };
    pi.on('session_start', async () => { announce(); withoutPlanTool(); });
    // §135.29 addendum 2 (SL-82): `step`'s own reset/increment, exactly matching the kernel extension's
    // `table.roundTrips` contract (extensions/kernel/first-step-thinking.ts's isFirstStepOfTurn) so the two
    // independent counters always agree: 0 on new player input, +1 on every turn_start thereafter.
    pi.on('before_agent_start', async () => { withoutPlanTool(); step = 0; });
    pi.on('turn_start', async () => { step += 1; });
  };
  return {runDriver, extension, bridge: () => bridge,
    keeperCallCapMs: firstStepThinkingEnabled(options.env) ? resolveKeeperCallCapMs : keeperCallCapMs(options.env),
    onKeeperCallCap};
}
