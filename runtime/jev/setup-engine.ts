/**
 * The driven setup run (contract §150.6, spec `jev-decides-llm-writes.md` D-E): a setup session's runs go through
 * Pi's RunDriver with the policy `coc-setup-v1` and these ports, never through the play policy.
 *
 * - **read**: the onboarding extension's setup state (`coc:setup-executor` `read()`): the step table, the kernel's
 *   catalog, the card on the table, the latest input.
 * - **decide**: `setup-input-route` v1, then (for a card-field move) `setup-card-fields` v1
 *   (`runtime/jev/setup-decisions.ts`), under a lease scoped to the campaign or, before one exists, the session.
 * - **operate**: a cleared move or a closed-field revision through the existing step executor (`execute`, the very
 *   function the `setup` tool calls), and every call the model makes.
 * - **infer**: `bind` (only `setup_card`, open keys only, the clerk's closed fields merged by the host), `compose`
 *   (no tool: the reply) and `adjudicate` (today's full `setup` tool: questions, invention, confirmation, and every
 *   fallback -- a Jev outage, a spent budget, a kernel refusal).
 *
 * `setup.confirm` is never an operation of this policy: it creates the world, so it stays the player's (the App's
 * button) or the Keeper's under the full tool.
 */
import {Type} from 'typebox';
import {getCurrentSystemMessage, getCurrentTools, getDeclaredTools, toToolDeclaration} from '@earendil-works/pi-ai';
import type {SessionRunDriver} from '@earendil-works/pi-coding-agent';
import type {ObservationView, OperationProposal, RunDriverPorts, RunPolicy, RunView, StepRequest} from '@earendil-works/pi-agent-core';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import {createDecisionAdapter, jevFailureTelemetry} from './decision-adapter.ts';
import type {DecisionPort} from './decision-port.ts';
import type {DecisionResult, ReadSet, ScopeBinding} from './contracts.ts';
import {TaskLease} from './task-context.ts';
import {packDecisionBatch} from './question-packing.ts';
import {SETUP_FIELDS_FAMILY, SETUP_INTEREST_FAMILY, SETUP_POLICY, SETUP_ROUTE_FAMILY, answerRows, cardPlan, fieldsBatch, interestBatches, interestCandidates, interestPointsLeft, moveGates,
  interpretFields, interpretInterest, interpretRoute, routeBatch, setupDrivenBudget, type BoundField, type CardPlan, type FieldsOutcome, type InterestOutcome, type OpenProfileKey,
  type RouteOutcome, type SetupDrivenBudget, type SetupRead} from './setup-decisions.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

/** What the onboarding extension puts on the bus (`coc:setup-executor`, contract §150.6 decision 2). */
export interface SetupExecutorPort {
  /** The full setup tool's name: the adjudicate catalog and the session's surface between runs. */
  tool: string;
  execute(raw: Record<string, unknown>, signal?: AbortSignal): Promise<Row>;
  read(): Promise<SetupRead>;
  move(move: string, target: Record<string, unknown>, signal: AbortSignal): Promise<Row>;
  copy(selection: unknown): Promise<string>;
}

export interface SetupEngineOptions {
  env: Readonly<NodeJS.ProcessEnv>;
  /** Test injection: the Jev port; `null` runs with no Jev at all (every run adjudicates). */
  decision?: DecisionPort | null;
  /** Test injection: the telemetry sink (default: the session's `coc-telemetry` entries). */
  record?: (row: Record<string, unknown>) => void;
  /** Test injection: the gates (default: `setup_driven` in host-budgets.json). */
  budget?: SetupDrivenBudget;
  maxSteps?: number;
}

/** The tool of the bind step: open profile keys only (§150.6 decision 3). */
export const SETUP_CARD_TOOL = 'setup_card';
/** A setup-step note the projection adds to the transcript, never shown to the player. */
export const SETUP_STEP_TYPE = 'coc-setup-step';
/** How many adjudicate model steps one run may take: the model-first loop's own shape, bounded. */
const MAX_ADJUDICATE_STEPS = 24;

type Purpose = 'bind' | 'compose' | 'adjudicate';
type Moved = {ok: boolean; outcome: Row};
interface SetupPolicyState {
  read?: SetupRead | null;
  readReason?: string;
  route?: RouteOutcome;
  fields?: FieldsOutcome | {unavailable: string};
  plan?: CardPlan;
  decisions: number;
  moved?: Moved;
  /** §150.6 decision 10: the brief's `stop` note `draft_now` recorded before the card-field path. */
  briefEnded?: Moved;
  bound?: Moved;
  /** §150.6 decision 9: what the interest fit chose, and its revise. */
  interest?: InterestOutcome;
  interestRevised?: Moved;
  infers: Record<Purpose, number>;
  lastInfer?: Purpose;
}

/** The step the policy asks for, with what the projection needs to write its note. */
function infer(purpose: Purpose, reason: string, request: Row = {}): StepRequest {
  return {kind: 'infer', purpose, reason, request: {purpose, reason, ...request}};
}

/**
 * `coc-setup-v1`: pure over the run view. read → route → (card fields) → direct | bind | compose | adjudicate. After an
 * LLM step only operate or finish follows (the driver's own guard); the bind step's call is followed by one compose, or
 * by adjudicate when the call was refused.
 */
export function createSetupPolicy(config: {jev: boolean; maxDecisions: number}): RunPolicy<SetupPolicyState> {
  /**
   * The card has been written (bind, a direct revise, or nothing to write): a delegated card first gets its interest
   * skills from `setup-interest-fit` and one direct revise (§150.6 decision 9), then the reply. An outage, a packing
   * refusal or a spent budget leaves the card as it is; the reply says the points remain. No model picks skills.
   */
  const afterCard = (s: SetupPolicyState, reason: string, extra: Row = {}): StepRequest => {
    if (s.plan && 'interest' in s.plan && s.plan.interest) {
      if (!s.interest) {
        if (!config.jev || s.decisions >= config.maxDecisions)
          return infer('compose', reason, {...extra, interest: {status: config.jev ? 'budget' : 'unavailable', skills: []}});
        return {kind: 'decide', purpose: 'interest', question: {family: SETUP_INTEREST_FAMILY}, reason: 'fit_interest_skills'};
      }
      if (s.interest.status === 'set' && !s.interestRevised)
        return {kind: 'operate', proposals: [{origin: 'policy', operation: 'setup.interest', params: {interest_skills: s.interest.list ?? s.interest.skills}}], reason: 'setup_revise_interest_skills'};
      // The reply is told exactly which skills were raised and to what (the kernel's revised card), so it cannot call one untouched.
      const skills = object(object(s.interestRevised?.outcome).card).skills, values = s.interestRevised?.ok && skills && typeof skills === 'object'
        ? Object.fromEntries(s.interest.skills.filter(name => Object.hasOwn(skills, name)).map(name => [name, (skills as Row)[name]])) : undefined;
      return infer('compose', reason, {...extra, interest: {...s.interest, ...(s.interestRevised ? {revised: s.interestRevised.ok} : {}), ...(values ? {values} : {})}});
    }
    return infer('compose', reason, extra);
  };
  return {name: SETUP_POLICY.name, version: SETUP_POLICY.version,
    initial: () => ({decisions: 0, infers: {bind: 0, compose: 0, adjudicate: 0}}),
    next(view: RunView<SetupPolicyState>): StepRequest {
      const s = view.policyState, last = view.lastObservation;
      if (view.pendingProposals.length) return {kind: 'operate', proposals: view.pendingProposals, reason: 'execute_model_calls'};
      if (last?.kind === 'infer') return {kind: 'finish', outcome: 'undelivered', reason: `setup_${last.purpose ?? 'infer'}_written`};
      // The bind step's call ran: its card goes to one compose; a refused call, or a response that made no card call,
      // goes to the full tool with what happened.
      if (s.lastInfer === 'bind') return s.bound?.ok ? afterCard(s, 'bound')
        : infer('adjudicate', s.bound ? 'bind_refused' : 'bind_without_card', s.bound ? {refusal: s.bound.outcome} : {});
      if (s.lastInfer === 'adjudicate') return s.infers.adjudicate >= MAX_ADJUDICATE_STEPS
        ? {kind: 'finish', outcome: 'undelivered', reason: 'setup_adjudicate_limit'} : infer('adjudicate', 'continue');
      if (s.lastInfer) return {kind: 'finish', outcome: 'undelivered', reason: `setup_${s.lastInfer}_closed`};
      if (s.read === undefined) return {kind: 'operate', proposals: [{origin: 'policy', operation: 'read', readOnly: true, params: {target: 'setup'}}], reason: 'setup_read'};
      if (s.read === null) return infer('adjudicate', s.readReason ?? 'read_unusable');
      if (!s.route) {
        if (!config.jev) return infer('adjudicate', 'jev_unavailable');
        if (s.decisions >= config.maxDecisions) return infer('adjudicate', 'jev_budget');
        return {kind: 'decide', purpose: 'route', question: {family: SETUP_ROUTE_FAMILY}, reason: 'route_setup_input'};
      }
      const move = s.route.move;
      if (!move) return infer('adjudicate', s.route.exit ?? s.route.reason);
      if (move === 'approve_card') return infer('adjudicate', 'approve_card');
      // §150.6 decision 10: the player ended the brief; the host records its `stop` note, then the card-field path runs.
      if (move === 'draft_now') {
        if (!s.briefEnded) return {kind: 'operate', proposals: [{origin: 'policy', operation: 'setup.move', params: {move, target: null}}], reason: 'setup_move_draft_now'};
        if (!s.briefEnded.ok) return infer('adjudicate', 'move_refused', {refusal: s.briefEnded.outcome});
      } else if (move !== 'card_fields') {
        if (!s.moved) return {kind: 'operate', proposals: [{origin: 'policy', operation: 'setup.move', params: {move, target: s.route.target ?? null}}], reason: `setup_move_${move}`};
        return s.moved.ok ? infer('compose', 'moved', {moved: s.moved.outcome}) : infer('adjudicate', 'move_refused', {refusal: s.moved.outcome});
      }
      if (!s.fields) {
        if (s.decisions >= config.maxDecisions) return infer('adjudicate', 'jev_budget');
        return {kind: 'decide', purpose: 'fields', question: {family: SETUP_FIELDS_FAMILY}, reason: 'bind_card_fields'};
      }
      if ('unavailable' in s.fields || !s.plan) return infer('adjudicate', 'unavailable' in s.fields ? s.fields.unavailable : 'no_plan');
      const plan = s.plan;
      if (plan.kind === 'direct') {
        if (!s.moved) return {kind: 'operate', proposals: [{origin: 'policy', operation: 'setup.revise', params: {profile: plan.profile}}], reason: 'setup_revise_closed_fields'};
        return s.moved.ok ? afterCard(s, 'revised', {moved: s.moved.outcome, plan}) : infer('adjudicate', 'revise_refused', {refusal: s.moved.outcome});
      }
      if (plan.kind === 'interest') return afterCard(s, 'interest');
      if (plan.kind === 'bind') return infer('bind', plan.first ? 'first_card' : 'open_fields', {plan});
      if (plan.kind === 'compose') return infer('compose', 'missing', {plan});
      return infer('adjudicate', plan.reason, {plan});
    },
    reduce(state: SetupPolicyState, observation: ObservationView): SetupPolicyState {
      const next: SetupPolicyState = {...state, infers: {...state.infers}};
      if (observation.kind === 'infer') {
        const purpose = observation.purpose as Purpose;
        if (purpose in next.infers) next.infers[purpose]++;
        next.lastInfer = purpose;
        next.bound = undefined;
        return next;
      }
      if (observation.kind === 'decide') {
        const artifact = object(observation.artifact);
        if (artifact.asked) next.decisions++;
        if (artifact.kind === 'route') next.route = artifact.route as RouteOutcome;
        if (artifact.kind === 'fields') { next.fields = artifact.fields; next.plan = artifact.plan; }
        if (artifact.kind === 'interest') next.interest = artifact.interest as InterestOutcome;
        return next;
      }
      if (observation.kind === 'operate') {
        for (const outcome of observation.outcomes ?? []) {
          const artifact = object(outcome.artifact);
          if (artifact.kind === 'setup_read') { next.read = artifact.read ?? null; next.readReason = artifact.reason; }
          if (artifact.kind === 'setup_move' && artifact.move === 'draft_now') next.briefEnded = {ok: artifact.ok === true, outcome: object(artifact.outcome)};
          else if (artifact.kind === 'setup_move' || artifact.kind === 'setup_revise') next.moved = {ok: artifact.ok === true, outcome: object(artifact.outcome)};
          if (artifact.kind === 'setup_card') next.bound = {ok: artifact.ok === true, outcome: object(artifact.outcome)};
          if (artifact.kind === 'setup_interest') next.interestRevised = {ok: artifact.ok === true, outcome: object(artifact.outcome)};
        }
        if (observation.origin === 'policy' && observation.status !== 'ok' && next.read === undefined) { next.read = null; next.readReason = 'read_unavailable'; }
      }
      return next;
    }};
}

/** The run's own bookkeeping, for the ports and the `run` telemetry row. */
interface SetupRun {
  runId: string;
  started: number;
  sessionId: string;
  read?: SetupRead;
  families: string[];
  move?: string | null;
  routeReason?: string;
  plan?: CardPlan;
  bound: BoundField[];
  written: string[];
  refusals: Row[];
  modelSteps: Record<Purpose, number>;
  fallback?: string;
  /** §150.6 decision 10: every legal-move condition that withheld a move at the read, structural names only. */
  withheld?: string[];
  /** The bind step in progress: what `setup_card` merges and which open keys it accepts. */
  bind?: {first: boolean; closed: Row; open: OpenProfileKey[]; required: OpenProfileKey[]; draftStep?: string};
}

export function createSetupEngine(options: SetupEngineOptions): {runDriver: SessionRunDriver; extension: (pi: any) => void; policy: typeof createSetupPolicy} {
  let api: any, executor: SetupExecutorPort | undefined, current: SetupRun | undefined;
  /** The step catalog of the request in flight (§150.6 decision 3); undefined outside a driven infer. */
  let stepCatalog: string[] | undefined;
  const record = (row: Record<string, unknown>) => {
    try {
      if (options.record) options.record(row);
      else api?.appendEntry?.('coc-telemetry', {...row, at: new Date().toISOString()});
    } catch { /* Telemetry never steers the run. */ }
  };
  const jev: DecisionPort | undefined = options.decision === null ? undefined
    : options.decision ?? (readJevApiKey(options.env) ? createDecisionAdapter({env: options.env, maxConcurrency: 2, trace: jevFailureTelemetry(record),
      retryPolicies: Object.fromEntries([SETUP_ROUTE_FAMILY, SETUP_FIELDS_FAMILY].map(family => [family, {maxRetries: 1, backoffInitialMs: 200, backoffMaxMs: 800}]))}) : undefined);
  const fullTool = () => executor?.tool ?? 'setup';
  const setTools = (names: string[]) => { try { api?.setActiveTools?.(names); } catch { /* No tool surface yet. */ } };

  function scopeOf(run: SetupRun, read: SetupRead): {scope: ScopeBinding; readSet: ReadSet} {
    // §150.6 Read: the campaign once it exists, else this setup session.
    const scope: ScopeBinding = read.created && read.campaign ? {owner: 'setup', campaign: read.campaign, audience: 'keeper'} : {owner: `setup-session:${run.sessionId}`, audience: 'keeper'};
    const readSet: ReadSet = read.card && read.campaign ? [{kind: 'draft', resource: `setup-draft:${read.campaign}`, revision: String(read.card.revision)}] : [];
    return {scope, readSet};
  }

  /**
   * `setup-interest-fit` v1 (§150.6 decision 9) on the card as it is now (a fresh read, after the bind step's words):
   * one fan-out, split only as packing needs. Nothing to spend or nothing to pick asks nothing.
   */
  async function decideInterest(run: SetupRun, budget: SetupDrivenBudget, request: {stepId: string; signal: AbortSignal}) {
    const answer = (interest: InterestOutcome, asked: boolean) => {
      // A fit that asked nothing still says why, so the table's record shows the family was due and what stopped it.
      if (!asked) record({lane: 'setup', event: 'decide', run: run.runId, step: request.stepId, family: SETUP_INTEREST_FAMILY, family_version: '1', status: 'not_asked', interest});
      return {status: interest.status === 'unavailable' ? 'unavailable' as const : 'ok' as const, artifact: {kind: 'interest', asked, interest}};
    };
    if (!jev || !executor) return answer({status: 'unavailable', skills: [], reason: 'jev_unavailable'}, false);
    let read: SetupRead;
    try { read = await executor.read(); } catch { return answer({status: 'unavailable', skills: [], reason: 'read_failed'}, false); }
    const left = interestPointsLeft(read);
    if (!read.card || !(left > 0)) return answer({status: 'no_points', skills: [], points_left: left}, false);
    const candidates = interestCandidates(read);
    if (!candidates.length) return answer({status: 'no_candidates', skills: [], points_left: left}, false);
    const {scope, readSet} = scopeOf(run, read);
    let batches;
    try { batches = interestBatches({read, scope, readSet}, packDecisionBatch); }
    catch (error) {
      record({lane: 'setup', event: 'decide', run: run.runId, step: request.stepId, family: SETUP_INTEREST_FAMILY, status: 'packing_refused', reason: String(error)});
      return answer({status: 'unavailable', skills: [], reason: 'packing_limit', points_left: left}, false);
    }
    const began = Date.now();
    const results: DecisionResult[] = await Promise.all(batches.map(async batch => {
      const lease = new TaskLease({owner: batch.family, goal: `setup run ${run.runId} interest`, scope, capabilities: ['decision'], readSet, signal: request.signal,
        budget: {deadlineAt: Date.now() + budget.decisionTimeoutMs, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.5, remainingActions: 4}});
      try { return await jev.decide(batch, lease); }
      catch { return {batchId: batch.id, status: 'unavailable', answers: {}, coverage: {required: [], answered: [], unknown: []}, issues: [], failure: {code: 'service_error', retryable: false}} as DecisionResult; }
      finally { lease.close(); }
    }));
    run.families.push(SETUP_INTEREST_FAMILY);
    const outcome = interpretInterest(read, results, budget);
    const own = Array.isArray(read.card.profile?.interest_skills) ? read.card.profile.interest_skills.map(String) : [];
    const interest: InterestOutcome = {...outcome, points_left: left, ...(outcome.status === 'set' ? {list: [...own, ...outcome.skills]} : {})};
    if (interest.status === 'set') run.bound.push({field: 'interest_skills', path: 'jev', value: interest.skills});
    const usage = results.reduce((sum, result) => ({inputTokens: sum.inputTokens + (result.usage?.inputTokens ?? 0), outputTokens: sum.outputTokens + (result.usage?.outputTokens ?? 0)}), {inputTokens: 0, outputTokens: 0});
    record({lane: 'setup', event: 'decide', run: run.runId, step: request.stepId, family: SETUP_INTEREST_FAMILY, family_version: '1',
      status: results.every(result => result.status === 'complete') ? 'complete' : 'unavailable', ms: Date.now() - began, batches: batches.length, candidates: candidates.length,
      usage, answers: Object.assign({}, ...results.map(answerRows)), interest});
    return answer(interest, true);
  }

  async function decide(run: SetupRun, budget: SetupDrivenBudget, request: {stepId: string; purpose: string; signal: AbortSignal}) {
    if (request.purpose === 'interest') return decideInterest(run, budget, request);
    const read = run.read;
    const route = request.purpose === 'route';
    const fail = (reason: string, asked = false) => ({status: 'unavailable' as const,
      artifact: route ? {kind: 'route', asked, route: {offered: [], move: null, exit: null, reason}} : {kind: 'fields', asked, fields: {unavailable: reason}}});
    if (!jev || !read) return fail('jev_unavailable');
    const {scope, readSet} = scopeOf(run, read);
    const batch = route ? routeBatch({read, scope, readSet}) : fieldsBatch({read, scope, readSet});
    if (!batch) {
      // Nothing to ask is itself a finding: the row names what withheld every move (§150.6 decision 10).
      record({lane: 'setup', event: 'decide', run: run.runId, step: request.stepId, family: route ? SETUP_ROUTE_FAMILY : SETUP_FIELDS_FAMILY, status: 'no_candidates',
        withheld: moveGates(read).withheld});
      return fail('no_candidates');
    }
    try { packDecisionBatch(batch); } catch (error) { record({lane: 'setup', event: 'decide', run: run.runId, step: request.stepId, family: batch.family, status: 'packing_refused', reason: String(error)}); return fail('packing_limit'); }
    const began = Date.now();
    const lease = new TaskLease({owner: batch.family, goal: `setup run ${run.runId} ${request.purpose}`, scope, capabilities: ['decision'], readSet, signal: request.signal,
      budget: {deadlineAt: Date.now() + budget.decisionTimeoutMs, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.5, remainingActions: 4}});
    let result: DecisionResult;
    try { result = await jev.decide(batch, lease); }
    catch (error) { record({lane: 'setup', event: 'decide', run: run.runId, step: request.stepId, family: batch.family, status: 'failed', error: String((error as Error)?.message ?? error)}); return fail('jev_failed', true); }
    finally { lease.close(); }
    run.families.push(batch.family);
    const row = {lane: 'setup', event: 'decide', run: run.runId, step: request.stepId, family: batch.family, family_version: batch.familyVersion, status: result.status,
      ms: Date.now() - began, ...(result.usage ? {usage: result.usage} : {}), ...(result.failure ? {failure: result.failure.code, ...(result.failure.status !== undefined ? {jev_status: result.failure.status} : {})} : {}),
      answers: answerRows(result)};
    if (route) {
      const outcome = interpretRoute(read, result, budget);
      run.move = outcome.move; run.routeReason = outcome.exit ?? outcome.reason;
      record({...row, offered: outcome.offered, move: outcome.move, exit: outcome.exit, reason: outcome.reason});
      return {status: result.status === 'complete' ? 'ok' as const : 'unavailable' as const, artifact: {kind: 'route', asked: true, route: outcome}};
    }
    const fields = interpretFields(read, result, budget);
    const plan = 'unavailable' in fields ? undefined : cardPlan(read, fields);
    if (plan) { run.plan = plan; run.bound.push(...plan.bound); }
    record({...row, ...('unavailable' in fields ? {reason: fields.unavailable} : {fields: {...fields, skills: fields.skills.map(skill => skill.name)}}), ...(plan ? {plan: plan.kind, ...(plan.kind === 'adjudicate' ? {plan_reason: plan.reason} : {})} : {})});
    return {status: result.status === 'complete' ? 'ok' as const : 'unavailable' as const, artifact: {kind: 'fields', asked: true, fields, ...(plan ? {plan} : {})}};
  }

  /** §150.6 decision 3: the note the step's request carries, and the step's catalog. */
  function project(run: SetupRun, step: {purpose: string; reason: string; request?: unknown}, stepId: string): unknown[] | undefined {
    const request = object(step.request), purpose = step.purpose as Purpose;
    run.modelSteps[purpose] = (run.modelSteps[purpose] ?? 0) + 1;
    // The run's fallback is why it first reached the full tool (an outage, a budget, an exit, a refusal).
    if (purpose === 'adjudicate') run.fallback ??= step.reason;
    const catalog = purpose === 'bind' ? [SETUP_CARD_TOOL] : purpose === 'compose' ? [] : [fullTool()];
    stepCatalog = catalog;
    setTools(catalog);
    const plan = request.plan as CardPlan | undefined;
    const bound = (plan?.bound ?? []).map(({field, path, value}) => ({field, path, ...(value !== undefined ? {value} : {})}));
    let content: Row | undefined;
    if (purpose === 'bind' && plan?.kind === 'bind') {
      run.bind = {first: plan.first, closed: plan.closed, open: plan.open, required: plan.required, draftStep: run.read?.steps.draft};
      content = {kind: 'setup_step', purpose, reason: step.reason, card: run.read?.card?.summary ?? null, bound, open_keys: plan.open,
        ...(plan.required.length ? {required_keys: plan.required} : {}),
        instruction: 'The clerk bound the fields listed under bound from the player\'s words; the host adds them and the kernel does every number. '
          + `Call ${SETUP_CARD_TOOL} once with only the open keys listed, in play_language: what the player stated, and your own proposal where the player asked you to decide`
          + (plan.required.length ? ' or the first card needs a value (required_keys)' : '') + '. '
          + 'name selects the player\'s words from the setup input source catalog, or proposes {generated} when the player gave none; '
          + 'occupation_stated selects the player\'s own words for the trade from that catalog, never retyped. Write nothing else in this response.'};
    } else if (purpose === 'compose') {
      const moved = object(request.moved), missing = plan?.kind === 'compose' ? plan.missing : [], interest = object(request.interest);
      content = {kind: 'setup_step', purpose, reason: step.reason, ...(bound.length ? {bound} : {}), ...(Object.keys(moved).length ? {did: moved} : {}),
        ...(missing.length ? {missing} : {}),
        ...(Object.keys(interest).length ? {interest: {status: interest.status, skills: interest.skills ?? [], ...(interest.revised !== undefined ? {revised: interest.revised} : {}),
          ...(interest.values ? {values: interest.values} : {}), ...(Array.isArray(interest.held) && interest.held.length ? {held: interest.held} : {}),
          ...(interest.points_left !== undefined ? {points_left: interest.points_left} : {})},
          interest_note: (interest.status === 'set' && interest.revised
            ? `The clerk gave the delegated card exactly these interest skills and the kernel raised them to the values shown (interest.values): ${(interest.skills ?? []).join(', ')}. Name them as raised; never say one of them was left untouched. `
            : 'The card\'s interest points are still unspent (the card shows them); tell the player and invite them to name skills for them. Do not name skills yourself as if they were on the card. ')
            + (Array.isArray(interest.held) && interest.held.length ? `The player asked to keep ${interest.held.join(', ')} at the starting value; they were not raised.` : '')} : {}),
        instruction: 'No setup tool is available in this step. Write your reply to the player now, in play_language: '
          + (missing.length ? 'nothing was written to the card yet; ask for what missing lists, and nothing else. '
            : 'the host has already done what did or the last tool result shows; describe what the card or the table now holds and invite the next change or confirmation. ')
          + 'Never claim a change the host did not make.'};
    } else if (purpose === 'adjudicate' && (request.refusal || step.reason === 'approve_card' || step.reason === 'stated_numbers' || step.reason === 'removal')) {
      content = {kind: 'setup_step', purpose, reason: step.reason, ...(request.refusal ? {refusal: request.refusal} : {}),
        note: step.reason === 'approve_card'
          ? 'The clerk read the player\'s input as approving the card on the table. Confirming creates the world and is yours to do with the setup tool, or not.'
          : request.refusal ? 'The host\'s last setup call was refused (refusal); nothing after it was executed. The full setup tool is yours for the rest of this turn.'
            : 'This change is yours to make with the full setup tool; the kernel checks every number.'};
    }
    if (!content) return undefined;
    return [{role: 'custom', customType: SETUP_STEP_TYPE, content: JSON.stringify(content), display: false,
      details: {coc_host: true, run: run.runId, step: stepId}, timestamp: Date.now()}];
  }

  async function executeCard(params: Row, signal?: AbortSignal): Promise<Row> {
    const run = current, bind = run?.bind;
    if (!run || !bind || !executor) return {ok: false, step: SETUP_CARD_TOOL, code: 'not_a_bind_step', message: `${SETUP_CARD_TOOL} runs only in the bind step of a setup run.`};
    const refuse = (code: string, message: string, extra: Row = {}) => {
      const refusal = {ok: false, step: SETUP_CARD_TOOL, code, message, open_keys: bind.open, bound: bind.closed, ...extra};
      run.refusals.push({step: SETUP_CARD_TOOL, code, ...extra});
      return refusal;
    };
    const topLevel = Object.keys(params).filter(key => key !== 'profile');
    const profile = object(params.profile);
    const given = Object.keys(profile);
    const closed = [...topLevel, ...given.filter(key => !(bind.open as string[]).includes(key))];
    if (closed.length) return refuse('closed_key', `Only the open keys are written here; ${closed.join(', ')} ${closed.length > 1 ? 'are' : 'is'} not. The clerk's bound values stand; nothing was executed.`, {refused: closed});
    const words: Row = {...profile};
    if (Object.hasOwn(words, 'occupation_stated')) {
      const selection = words.occupation_stated;
      if (!selection || typeof selection !== 'object' || Array.isArray(selection) || Object.hasOwn(selection, 'generated'))
        return refuse('not_a_selection', 'occupation_stated is the player\'s own words selected from the setup input source catalog, never retyped or generated.', {refused: ['occupation_stated']});
      try { words.occupation_stated = await executor.copy(selection); }
      catch (error) { return refuse('stale_selection', `occupation_stated could not be copied from the input: ${String((error as Error)?.message ?? error)}`, {refused: ['occupation_stated']}); }
      run.bound.push({field: 'occupation_stated', path: 'stated', value: words.occupation_stated});
    }
    if (words.name && typeof words.name === 'object' && !Object.hasOwn(words.name, 'generated')) run.bound.push({field: 'name', path: 'stated'});
    run.written.push(...given.filter(key => key !== 'occupation_stated' && !(key === 'name' && !Object.hasOwn(object(words.name), 'generated'))));
    const step = bind.first ? bind.draftStep ?? 'create-investigator' : 'revise';
    const result = await executor.execute({step, profile: {...bind.closed, ...words}}, signal);
    if (result.ok === false) run.refusals.push({step, code: result.code ?? null, message: result.message ?? result.rejected ?? null});
    return result;
  }

  const runDriver: SessionRunDriver = {
    engine: 'hybrid-v1',
    prepare: async context => {
      const budget = options.budget ?? await setupDrivenBudget();
      const session = object(context.session);
      const run: SetupRun = {runId: context.runId, started: Date.now(), sessionId: String(session.sessionId ?? 'session'), families: [], bound: [], written: [], refusals: [],
        modelSteps: {bind: 0, compose: 0, adjudicate: 0}};
      current = run;
      stepCatalog = undefined;
      setTools([fullTool()]);
      const policy = createSetupPolicy({jev: !!jev && !!executor, maxDecisions: budget.maxDecisions});
      const ports: RunDriverPorts = {
        read: {async read() {
          if (!executor) return {status: 'unavailable', artifact: {kind: 'setup_read', read: null, reason: 'no_setup_executor'}};
          try {
            const read = await executor.read();
            run.read = read;
            run.withheld = moveGates(read).withheld;
            const reason = !read.ready ? 'setup_table_unavailable' : read.blocked ? `blocked_${read.blocked.kind}` : read.complete ? 'setup_complete' : !read.input ? 'no_current_input' : undefined;
            return {status: 'ok', artifact: {kind: 'setup_read', read: reason ? null : read, ...(reason ? {reason} : {})}};
          } catch (error) {
            return {status: 'unavailable', artifact: {kind: 'setup_read', read: null, reason: 'read_failed'}, reason: String((error as Error)?.message ?? error)};
          }
        }},
        decision: {decide: request => decide(run, budget, request)},
        operations: {async execute(proposal: OperationProposal, invocation) {
          if (proposal.origin === 'model') {
            if (!invocation.executeModelTool) return {status: 'refused', reason: 'no_model_tool_executor'};
            const toolResult = await invocation.executeModelTool();
            const details = object((toolResult as Row).details);
            if (proposal.operation === SETUP_CARD_TOOL) return {status: 'ok', toolResult, artifact: {kind: 'setup_card', ok: details.ok !== false && !(toolResult as Row).isError, outcome: details}};
            if (details.ok === false) run.refusals.push({step: String(object(proposal.params).step ?? proposal.operation), code: details.code ?? null});
            return {status: 'ok', toolResult, artifact: {kind: 'setup_tool', tool: proposal.operation, ok: details.ok !== false}};
          }
          if (!executor) return {status: 'unavailable', reason: 'no_setup_executor'};
          const params = object(proposal.params);
          if (proposal.operation === 'setup.move') {
            const outcome = await executor.move(String(params.move), object(object(params.target).source ?? object(params.target).opening ?? object(params.target).entry), invocation.signal);
            if (outcome.ok !== true) run.refusals.push({step: String(params.move), code: outcome.code ?? null, message: outcome.message ?? outcome.rejected ?? null});
            return {status: 'ok', artifact: {kind: 'setup_move', move: String(params.move), ok: outcome.ok === true, outcome}};
          }
          if (proposal.operation === 'setup.interest') {
            // The kernel spreads the interest points (auto spread); no number comes from Jev or the model.
            const outcome = await executor.execute({step: 'revise', profile: {interest_skills: params.interest_skills}, auto_spread: true}, invocation.signal);
            if (outcome.ok !== true) run.refusals.push({step: 'revise', code: outcome.code ?? null, message: outcome.message ?? outcome.rejected ?? null});
            return {status: 'ok', artifact: {kind: 'setup_interest', ok: outcome.ok === true, outcome}};
          }
          if (proposal.operation === 'setup.revise') {
            const outcome = await executor.execute({step: 'revise', profile: object(params.profile)}, invocation.signal);
            if (outcome.ok !== true) run.refusals.push({step: 'revise', code: outcome.code ?? null, message: outcome.message ?? outcome.rejected ?? null});
            return {status: 'ok', artifact: {kind: 'setup_revise', ok: outcome.ok === true, outcome}};
          }
          return {status: 'refused', reason: `unknown setup operation ${proposal.operation}`};
        }},
        projection: {project: ({step, stepId}) => project(run, step, stepId) as any},
        record: {record(event) {
          if (event.type !== 'run_end') return;
          record({lane: 'setup', event: 'run', run: run.runId, engine: 'hybrid-v1', policy: SETUP_POLICY.name, policy_version: SETUP_POLICY.version,
            status: event.status, reason: event.reason, steps: event.steps, ms: Date.now() - run.started, families: run.families, move: run.move ?? null,
            route_reason: run.routeReason ?? null, plan: run.plan?.kind ?? null, bound: run.bound, written: [...new Set(run.written)],
            model_steps: run.modelSteps, refusals: run.refusals, fallback: run.fallback ?? null, withheld: run.withheld ?? null});
          // The session's surface between runs is the full tool (contract §14.4); the next run's first request declares it.
          stepCatalog = undefined;
          setTools([fullTool()]);
          if (current === run) current = undefined;
        }},
      };
      return {policy, ports, maxSteps: options.maxSteps ?? 64};
    },
  };

  const extension = (pi: any) => {
    api = pi;
    pi.events.on('coc:setup-executor', (port: SetupExecutorPort) => {
      executor = port && typeof port.execute === 'function' && typeof port.read === 'function' ? port : undefined;
    });
    pi.registerTool({
      name: SETUP_CARD_TOOL,
      label: 'Setup card',
      description: 'Write the open words of the investigator card in this setup step: only the profile keys the step lists as open (name, occupation_stated, age, sex, '
        + 'concept, own_language, backstory, key_connection, equipment, weapons, custom_skills). The clerk has already bound the closed fields (trade, skills, era, aptitude) '
        + 'and the kernel does every number; any other key is refused and nothing is executed. name and occupation_stated select issued input aliases '
        + '({source, range?}); name may instead propose {generated}.',
      promptSnippet: 'Write the open words of the investigator card when a setup step asks for them.',
      parameters: Type.Object({profile: Type.Object({}, {additionalProperties: true, description: 'Only the open keys this step lists.'})}, {additionalProperties: true}),
      executionMode: 'sequential',
      execute: async (_toolCallId: string, params: Row, signal?: AbortSignal) => {
        const result = await executeCard(object(params), signal);
        return {content: [{type: 'text', text: JSON.stringify(result)}], details: result};
      },
    });
    // §150.6 decision 3 (the §128.1 pattern): the request in flight declares the step's catalog, in Pi's forced-prompt shape.
    pi.on('context_with_system', (event: {messages: any[]}) => {
      const names = stepCatalog;
      if (!names) return undefined;
      const messages = event.messages;
      const declared = getCurrentTools(messages).map(tool => tool.name);
      if (declared.length === names.length && names.every(name => declared.includes(name))) return undefined;
      const known = new Map(getDeclaredTools(messages).map(tool => [tool.name, tool]));
      for (const info of typeof pi.getAllTools === 'function' ? pi.getAllTools() : [])
        if (!known.has(info.name)) known.set(info.name, toToolDeclaration({name: info.name, description: info.description, parameters: info.parameters} as any));
      const tools = names.map(name => known.get(name)).filter(Boolean);
      const {toolsAdded: _added, toolsRemoved: _removed, ...head} = (getCurrentSystemMessage(messages) ?? {role: 'system', content: '', timestamp: 0}) as Row;
      return {messages: [{...head, ...(tools.length ? {toolsAdded: tools} : {})}, ...messages.filter(message => message.role !== 'system')]};
    });
  };
  return {runDriver, extension, policy: createSetupPolicy};
}
