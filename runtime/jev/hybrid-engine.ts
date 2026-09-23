/**
 * The product side of `PI_COC_LOOP_ENGINE=hybrid-v1`: the policy and the ports Pi's RunDriver (vendored
 * agent-core, ADR-0006) drives each player input with. Pi knows nothing of what is here. Contract §135.
 *
 * - policy: `createStepPolicy` over the prototype's `next` (runtime/jev/step-policy.ts); its Jev budget is the
 *   prescreen allowance (`readJevPreselectAllowanceMs`), which is now the run's;
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
 *   receipts and the kernel row each came from), the operation the Keeper is asked to complete, or the batch step
 *   that returned to it;
 * - record: every run/step event as a `lane: "run"` telemetry row of the campaign.
 */
import type { RunDriverPorts, RunEvent } from '@earendil-works/pi-agent-core';
import type { SessionRunDriver } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { createDecisionAdapter } from './decision-adapter.ts';
import type { DecisionPort as JevDecisionPort } from './decision-port.ts';
import { ContractError, type DecisionBatch, type IntentBinding, type Json, type ObservationPacket, type OperationProposal, type ReadSet, type ScopeBinding } from './contracts.ts';
import { TaskLease } from './task-context.ts';
import { JEV_MODEL } from './question-packing.ts';
import { preparationProviderBudget } from './preparation-budget.ts';
import { prepareCheckPreflight } from './check-preflight.ts';
import { bindingOf, CLERK_TYPE, type ContextBinding } from '../../extensions/table/context-policy.ts';
import { prepareKeeperSupport, prescreenEnabled } from '../../extensions/table/prescreen.ts';
import { readJevApiKey, readJevPreselectAllowanceMs } from '../../extensions/jev/agent/config.js';
import type { HostOperationContext, OperationIdentity } from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import { buildCandidates, keeperCall } from './candidates.ts';
import {
  CLERK_AUTHORITY, createStepPolicy, DEFAULT_CONFIDENCE_GATE, interpretRoute, ROUTE_FAMILY,
  type Candidate, type Material, type RunView, type StepArtifact, type StepPolicyState, type TurnContext,
} from './step-policy.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The kernel extension's bus payload (`coc:kernel-bridge`, contract §12.8). */
export interface KernelBridge {
  campaign?: string;
  call?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  record?: (row: Record<string, unknown>) => void;
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
}

/** The Keeper verbs whose committed result is the turn's delivery (contract: real `narrate` / `ask` only). */
const DELIVERY_VERBS: Readonly<Record<string, 'accepted' | 'awaiting_player'>> = Object.freeze({narrate: 'accepted', ask: 'awaiting_player'});
/** Verbs whose success changes the table, so the run re-reads its state after them. */
const WRITE_VERBS = new Set(['apply', 'resolve']);
/** The prescreen packet's byte ceiling (the same cap the context hook's own prescreen used). */
const PRESCREEN_BYTES = 16 * 1024;

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

/** One clerk step of this turn, as the Keeper's projection lists it. */
interface ClerkStep {step: string; operation: string; label: string; clerk?: string; call_id: string | null; status: string; receipts: string[]; basis?: Json; result?: Json}

/** Per-run state the ports share; the policy's own state stays in the driver. */
interface RunState {
  runId: string;
  rawInput: string;
  inputRevision: string;
  session?: Row;
  startedAt: number;
  allowanceDeadline: number;
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
}

/**
 * Build the engine: the session run driver Pi is given, plus the inline extension that hands it the kernel
 * bridge and the operation gateway (both go onto the bus at session_start, after the driver was created).
 */
export function createHybridEngine(options: HybridEngineOptions): {runDriver: SessionRunDriver; extension: (pi: any) => void; bridge: () => KernelBridge | undefined} {
  let bridge: KernelBridge | undefined, gateway: OperationGateway | undefined, api: any;
  const jev = options.decision === null ? undefined
    : options.decision ?? (readJevApiKey(options.env) ? createDecisionAdapter({env: options.env, maxConcurrency: 4}) : undefined);
  const record = (row: Record<string, unknown>) => {
    try { (options.record ?? bridge?.record)?.(row); } catch { /* Telemetry never steers the run. */ }
  };
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    if (!bridge?.call || !bridge.campaign) throw new Error('kernel_bridge_unavailable');
    return object(await bridge.call(method, {campaign: bridge.campaign, ...params}));
  };
  const quiet = async (method: string) => {
    try { return await call(method); } catch (error) { record({lane: 'run', event: 'read_failed', method, error: String((error as Error).message).slice(0, 200)}); return {}; }
  };

  /** The kernel reads a step needs and the candidates they issue. Read-only. */
  async function tableReads(run: RunState): Promise<{capsule: Row; status: Row; table: ReturnType<typeof readTable>; candidates: () => Candidate[]}> {
    const [capsule, status, applyOptions, resolveOptions] = await Promise.all([call('table.capsule'), call('table.status'), quiet('table.apply.options'), quiet('table.resolve.options')]);
    const table = readTable(capsule, status);
    run.fight = object(object(resolveOptions.context).session ?? object(capsule.where).session);
    // The pending choice this input answers is the one open when the run began (§135.2); one opened later is the Keeper's.
    run.answering ??= [text(object(object(resolveOptions.context).pending_choice).name), text(object(object(capsule.turn).pending_choice).name)].filter(Boolean);
    return {capsule, status, table,
      candidates: () => buildCandidates({capsule, applyOptions, resolveOptions, located: run.located, answering: run.answering}, run.rawInput)};
  }
  const freshOf = (run: RunState) => tableReads(run).then(read => ({context: read.table.context, candidates: read.candidates()}), () => undefined);

  function makePorts(run: RunState): RunDriverPorts {
    return {
      clock: {now: () => Date.now()},
      record: {record: (event: RunEvent) => record({lane: 'run', ...event})},
      read: {
        async read(_proposal, invocation) {
          const began = Date.now();
          const {capsule, table, candidates} = await tableReads(run);
          let bindingArtifact: Extract<StepArtifact, {kind: 'read'}>['binding'];
          if (table.scope && table.readSet && table.binding) {
            run.turn ??= table.turn; run.scope ??= table.scope; run.readSet ??= table.readSet;
            run.intent ??= {id: `${run.runId}:intent`, scope: table.scope, turn: table.binding.turn, inputRevision: run.inputRevision, limits: ['single_loop_clerk'],
              rawInput: {version: 1, scope: table.scope, resource: `turn:${table.binding.campaign}:${table.binding.turn}`, revision: digest(run.rawInput),
                sourceType: 'turn', selector: {kind: 'utf16', start: 0, end: run.rawInput.length}}};
            bindingArtifact = {scope: run.scope, readSet: run.readSet, intent: run.intent};
          }
          // The product prescreen, inside the run: the first read and the read after a scene change. Its allowance is
          // the run's Jev budget (§135.6), so a re-read gets what the earlier steps left.
          let materials: Material[] = [], calls = 0, prescreen: Row = {status: 'not_run'};
          const remaining = run.allowanceDeadline - Date.now();
          if (jev && prescreenEnabled(options.env as NodeJS.ProcessEnv) && table.binding && remaining > 0 && bridge?.call && bridge.campaign) {
            const events: Row[] = [];
            const message = await prepareKeeperSupport({call: (method, params) => bridge!.call!(method, params), campaign: bridge.campaign,
              binding: table.binding, capsule, signal: invocation.signal, decision: jev, env: options.env as NodeJS.ProcessEnv,
              record: event => { events.push(event); record({...event, run: run.runId, step: invocation.stepId}); },
              byteBudget: PRESCREEN_BYTES, deadlineAt: run.allowanceDeadline, providerBudget: run.providerBudget});
            const prepared = events.find(event => event.event === 'prepared');
            calls = Number(prepared?.jev_calls ?? 0);
            const found = packetMaterials(message ? object(message) : undefined);
            materials = found.materials;
            if (found.located.length) run.located = found.located;
            // What the read did, as the route question sees it under "done this turn": the prototype's read summary
            // (runs 11-13 decided the declared move with it), including the locate's own judgment of what is relevant.
            prescreen = {status: message ? 'prepared' : text(events.find(event => event.event === 'fallback' || event.event === 'skipped')?.event) || 'none',
              jev_calls: calls, ms: Date.now() - began, materials: materials.length, supplied: prepared?.supplied ?? null,
              stop_reason: prepared?.stop_reason ?? null, locate: prepared?.locate ?? null, located: found.located.length,
              fallback: events.find(event => event.event === 'fallback')?.reason ?? null};
            if (message) api?.events?.emit?.('coc:run-prescreen', {campaign: bridge.campaign, turn: table.binding.turn, run: run.runId, message});
          }
          // Candidates are built after the locate, so a located clue or handout is among them.
          const fresh = {context: table.context, candidates: candidates()};
          const ms = Date.now() - began;
          record({lane: 'run', event: 'read', run: run.runId, stepId: invocation.stepId, ms, scene: table.context.scene,
            candidates: fresh.candidates.map(candidate => candidate.key), prescreen});
          const artifact: StepArtifact = {kind: 'read',
            read: {materials, summary: prescreen as Json,
              calls, ms: prescreen.status === 'not_run' ? 0 : ms},
            fresh, ...(bindingArtifact ? {binding: bindingArtifact} : {})};
          return {status: 'ok', artifact};
        },
      },
      operations: {
        async execute(proposal, invocation) {
          if (proposal.origin === 'model' && invocation.executeModelTool) return modelStep(run, proposal, invocation.executeModelTool);
          if (proposal.operation === 'llm_proposal') return {status: 'ok', artifact: {kind: 'execute', executed: {ok: true, summary: {slot: 'llm_proposal'}}}};
          if (proposal.operation === 'execute') return clerkStep(run, object(proposal.params), invocation);
          return {status: 'refused', reason: 'unknown_policy_operation', artifact: {kind: 'execute', executed: {ok: false, summary: {refused: 'unknown_policy_operation'}}}};
        },
      },
      projection: {project: ({view, step, stepId}) => projection(run, view as RunView<StepPolicyState> & {policyState: StepPolicyState}, step, stepId)},
      ...(jev ? {decision: {decide: request => decide(run, request)}} : {}),
    };
  }

  /** One Keeper call of the batch its response made. A step that fails sends the rest of the batch back unrun. */
  async function modelStep(run: RunState, proposal: {operation: string; assistantMessage?: unknown; toolCall?: {id: string}}, execute: () => Promise<any>) {
    if (run.batch?.message !== proposal.assistantMessage) run.batch = {message: proposal.assistantMessage};
    const batch = run.batch!;
    if (batch.fell) {
      const reason = `batch_step_fell: ${batch.fell}`;
      return {status: 'refused' as const, reason, artifact: {kind: 'execute', executed: {ok: false, summary: {tool: proposal.operation, skipped: true, after: batch.fellAt ?? null}}, skipped: true}};
    }
    const toolResult = await execute();
    const delivery = !toolResult.isError ? DELIVERY_VERBS[proposal.operation] : undefined;
    const fell = toolResult.isError ? `${proposal.operation}_refused` : proposal.operation === 'resolve' && failedCheck(toolResult.details) ? 'check_failed' : undefined;
    if (fell) { batch.fell = fell; batch.fellAt = proposal.toolCall?.id; }
    const fresh = !toolResult.isError && WRITE_VERBS.has(proposal.operation) ? await freshOf(run) : undefined;
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
      origin: {origin: 'policy', run: run.runId, step: invocation.stepId, clerk: candidate.clerk, ...(candidate.basis !== undefined ? {basis: candidate.basis} : {})},
    };
    const packet = await dispatcher.dispatch(operation, context);
    const ok = packet.status === 'succeeded', callId = run.identities.get(operation.id)?.callId ?? null;
    const result = object(packet.result);
    const refusal = ok ? undefined : object(result.coc_error).code ?? result.code ?? packet.status;
    const {goal: _goal, method: _method, ...shown} = object(tool === 'resolve' ? args.action : {}) as Row;
    run.clerkDid.push({step: invocation.stepId, operation: tool, label: candidate.label, clerk: candidate.clerk, call_id: callId, status: packet.status,
      receipts: packet.receipts, ...(candidate.basis !== undefined ? {basis: candidate.basis} : {}),
      result: (tool === 'resolve' ? {action: shown, outcome: result.outcome ?? null} : {effects: args.effects}) as Json});
    const read = await freshOf(run);
    return {status: ok ? 'ok' as const : 'refused' as const, ...(ok ? {} : {reason: String(refusal)}),
      artifact: {kind: 'execute', executed: {ok, summary: {origin: 'policy', tool, call_id: callId, status: packet.status, receipts: packet.receipts,
        clerk: candidate.clerk ?? null, basis: candidate.basis ?? null, ...(ok ? {} : {refusal: String(refusal)})} as Json}, ...(read ? {fresh: read} : {})}};
  }

  /** Jev's decisions: route and closed bind through the DecisionPort, the ordinary check through its binder. */
  async function decide(run: RunState, request: {runId: string; stepId: string; purpose: string; question: unknown; signal: AbortSignal}) {
    const question = object(request.question);
    if (request.purpose === 'locate') return {status: 'ok' as const, artifact: {kind: 'locate', calls: 0, ms: 0, summary: {folded_into: 'read'}} as StepArtifact};
    if (request.purpose === 'bind-ordinary') {
      const candidate = question.candidate as Candidate | undefined;
      if (!candidate || !run.scope || !run.readSet || run.turn === undefined || !bridge?.campaign || !bridge.call)
        return {status: 'unavailable' as const, artifact: {kind: 'bind-ordinary', bound: {disposition: 'unavailable', unresolved: ['binder_unavailable'], calls: 0, ms: 0}} as StepArtifact};
      const began = Date.now();
      const lease = new TaskLease({owner: 'ordinary-resolve', goal: run.rawInput.trim() || 'ordinary check', scope: run.scope, capabilities: ['decision'],
        readSet: run.readSet, signal: request.signal,
        budget: {deadlineAt: Math.max(Date.now() + 1_000, Math.min(run.allowanceDeadline, Date.now() + 15_000)), remainingInputTokens: 400_000,
          remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
      try {
        const result = await prepareCheckPreflight({campaign: bridge.campaign, turn: run.turn, rawInput: run.rawInput, goal: run.rawInput, scope: run.scope,
          readSet: run.readSet, publicContext: [{role: 'player', text: run.rawInput}], call: (method, params) => bridge!.call!(method, params), decision: jev!, lease});
        const bound = {disposition: result.advice.disposition, ...(result.advice.action ? {action: result.advice.action as unknown as Record<string, Json>} : {}),
          unresolved: result.advice.unresolved, calls: result.decisionCalls, ms: Date.now() - began};
        record({lane: 'route', purpose: 'bind-ordinary', run: run.runId, step: request.stepId, candidate: candidate.key, disposition: bound.disposition,
          unresolved: bound.unresolved, ms: bound.ms, jev_calls: bound.calls});
        return {status: 'ok' as const, artifact: {kind: 'bind-ordinary', bound} as StepArtifact};
      } finally { lease.close(); }
    }
    const batch = question.batch as DecisionBatch | undefined;
    if (!batch || (request.purpose !== 'route' && request.purpose !== 'bind'))
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
      const routed = request.purpose === 'route' ? interpretRoute({located: question.located === true} as RunView, offered, result, Number(question.gate) || DEFAULT_CONFIDENCE_GATE) : undefined;
      record({lane: 'route', purpose: request.purpose, run: run.runId, step: request.stepId, status: result.status, ms: Date.now() - began,
        ...(request.purpose === 'route' ? {offered: offered.map(candidate => candidate.key), selected: routed?.selected ?? [], exit: routed?.exit ?? null, reason: routed?.reason ?? null}
          : {candidate: question.candidate ?? null}),
        answers});
      return {status: result.status === 'complete' ? 'ok' as const : 'unavailable' as const, artifact: {kind: request.purpose, result} as StepArtifact};
    } finally { lease.close(); }
  }

  /** The run's note to the Keeper before a model step. Nothing new to say: no message. */
  function projection(run: RunState, view: {policyState: StepPolicyState}, step: {purpose: string; reason: string; request?: unknown}, stepId: string) {
    const content: Row = {kind: 'single_loop_step', purpose: step.purpose, reason: step.reason};
    const fresh = run.clerkDid.slice(run.projected);
    run.projected = run.clerkDid.length;
    if (fresh.length) Object.assign(content, {clerk_did: fresh,
      note: 'The host (the clerk) settled these this turn before asking you, from the kernel\'s own options. They are committed, not pending: '
        + 'narrate what happened, do not redo them, and undo one only with a real operation of your own (its own receipt and time cost).'});
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
    const plan = view.policyState?.view?.plan;
    if (step.reason === 'batch_fallen' && plan) Object.assign(content, {batch: plan.steps,
      batch_note: 'Your last batch stopped where a step failed; the steps after it were not executed. Decide what that failure means.'});
    if (Object.keys(content).length <= 3 && !fresh.length) return undefined;
    return [{role: 'custom', customType: CLERK_TYPE, content: JSON.stringify(content), display: false,
      details: {coc_host: true, run: run.runId, step: stepId, ...(run.turn !== undefined ? {turn: run.turn} : {})}, timestamp: Date.now()}] as any;
  }

  const runDriver: SessionRunDriver = {
    engine: 'hybrid-v1',
    // The Jev scope comes from the run's own read step (a read artifact carries the binding), never from a read
    // outside a step; until a read has bound it, a route question carries no batch and degrades to the Keeper.
    prepare: context => {
      const allowance = readJevPreselectAllowanceMs(options.env as NodeJS.ProcessEnv), startedAt = Date.now();
      const run: RunState = {runId: context.runId, rawInput: context.rawInput, inputRevision: context.inputRevision, session: context.session as unknown as Row,
        startedAt, allowanceDeadline: startedAt + allowance, providerBudget: preparationProviderBudget(), located: [], clerkDid: [], projected: 0,
        identities: new Map()};
      return {policy: createStepPolicy({context: emptyTurnContext(), budget: {maxJevMs: allowance}}), ports: makePorts(run), maxSteps: options.maxSteps ?? 48};
    },
  };

  const extension = (pi: any) => {
    api = pi;
    pi.events.on('coc:kernel-bridge', (data: KernelBridge) => { bridge = data?.call ? data : undefined; });
    pi.events.on('coc:operation-dispatcher', (data: OperationGateway) => { gateway = data && typeof data.dispatch === 'function' ? data : undefined; });
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
    pi.on('before_agent_start', async () => { withoutPlanTool(); });
  };
  return {runDriver, extension, bridge: () => bridge};
}
