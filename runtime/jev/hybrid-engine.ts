/**
 * The product side of `PI_COC_LOOP_ENGINE=hybrid-v1` (SL-01): the policy and the ports Pi's RunDriver
 * (vendored agent-core, ADR-0006) drives each player input with. Pi knows nothing of what is here.
 *
 * - policy: `createStepPolicy` over the prototype's `next` (runtime/jev/step-policy.ts);
 * - decision: the product's Jev `DecisionPort` for route and closed-bind questions, under a lease bound to
 *   the run's signal, so an abort cancels the wait; without a Jev key there is no decision port and every
 *   decide degrades to the Keeper inside the same engine;
 * - read: read-only kernel reads (`table.capsule`, `table.status`) over the kernel extension's bridge --
 *   the policy-origin read that runs before the first model message; it publishes nothing;
 * - operations: the model's own tool calls through Pi's tool pipeline (the Keeper verbs with their
 *   admission and Mod hooks, unchanged), with a committed `narrate`/`ask` reported as the delivery; a
 *   policy-origin write is refused in SL-01 (host-issued writes and the one operation entry are SL-02/SL-03);
 * - record: every run/step event as a `lane: "run"` telemetry row of the campaign;
 * - projection: none yet (the capsule's "clerk did" section is SL-02).
 *
 * Host-issued candidates are empty in SL-01 (they are SL-02's), so a route question carries only its exit.
 */
import type { RunDriverPorts, RunEvent } from '@earendil-works/pi-agent-core';
import type { SessionRunDriver } from '@earendil-works/pi-coding-agent';
import { createDecisionAdapter } from './decision-adapter.ts';
import type { DecisionPort as JevDecisionPort } from './decision-port.ts';
import type { DecisionBatch, ReadSet, ScopeBinding } from './contracts.ts';
import { TaskLease } from './task-context.ts';
import { JEV_MODEL } from './question-packing.ts';
import { bindingOf } from '../../extensions/table/context-policy.ts';
import { readJevApiKey } from '../../extensions/jev/agent/config.js';
import { createStepPolicy, ROUTE_FAMILY, type StepArtifact, type TurnContext } from './step-policy.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** The kernel extension's bus payload (`coc:kernel-bridge`, contract §12.8). */
export interface KernelBridge {
  campaign?: string;
  call?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  record?: (row: Record<string, unknown>) => void;
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

export function emptyTurnContext(): TurnContext {
  return {scene: '', clock: null, present: [], receipts: []};
}

/** The table context and the Jev scope binding from two read-only kernel reads. */
export function readTable(capsule: Row, status: Row): {context: TurnContext; scope?: ScopeBinding; readSet?: ReadSet; turn?: number} {
  const where = object(capsule.where);
  const context: TurnContext = {scene: text(where.scene), clock: (where.clock ?? null) as TurnContext['clock'],
    present: array(capsule.present).map(person => text(object(object(person).called).name) || text(object(person).name)).filter(Boolean),
    receipts: array(status.receipts).map(receipt => text(object(receipt).id) || JSON.stringify(receipt))};
  const binding = bindingOf(capsule._context);
  if (!binding) return {context};
  return {context, turn: binding.turn,
    scope: {owner: `campaign:${binding.campaign}`, campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop, audience: 'keeper'},
    readSet: [{kind: 'source', resource: binding.campaign, revision: String(binding.source_revision)},
      {kind: 'model', resource: 'decision', revision: JEV_MODEL}, {kind: 'family', resource: ROUTE_FAMILY, revision: '1'}]};
}

/**
 * Build the engine: the session run driver Pi is given, plus the inline extension that hands it the
 * kernel bridge (the bridge goes onto the bus at session_start, after the driver was created).
 */
export function createHybridEngine(options: HybridEngineOptions): {runDriver: SessionRunDriver; extension: (pi: any) => void; bridge: () => KernelBridge | undefined} {
  let bridge: KernelBridge | undefined;
  const jev = options.decision === null ? undefined
    : options.decision ?? (readJevApiKey(options.env) ? createDecisionAdapter({env: options.env, maxConcurrency: 4}) : undefined);
  const record = (row: Record<string, unknown>) => {
    try { (options.record ?? bridge?.record)?.(row); } catch { /* Telemetry never steers the run. */ }
  };
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    if (!bridge?.call || !bridge.campaign) throw new Error('kernel_bridge_unavailable');
    return object(await bridge.call(method, {campaign: bridge.campaign, ...params}));
  };

  const ports: RunDriverPorts = {
    clock: {now: () => Date.now()},
    record: {record: (event: RunEvent) => record({lane: 'run', ...event})},
    read: {
      async read(_proposal, invocation) {
        const began = Date.now();
        const [capsule, status] = await Promise.all([call('table.capsule'), call('table.status')]);
        const table = readTable(capsule, status);
        const artifact: StepArtifact = {kind: 'read',
          read: {materials: [], summary: {methods: ['table.capsule', 'table.status'], scene: table.context.scene, present: table.context.present.length,
            turn: table.turn ?? null, run: invocation.runId}},
          fresh: {context: table.context, candidates: []},
          ...(table.scope && table.readSet ? {binding: {scope: table.scope, readSet: table.readSet}} : {})};
        record({lane: 'run', event: 'read', stepId: invocation.stepId, ms: Date.now() - began, scene: table.context.scene});
        return {status: 'ok', artifact};
      },
    },
    operations: {
      async execute(proposal, invocation) {
        if (proposal.origin === 'model' && invocation.executeModelTool) {
          const toolResult = await invocation.executeModelTool();
          const delivery = !toolResult.isError ? DELIVERY_VERBS[proposal.operation] : undefined;
          return {status: toolResult.isError ? 'refused' : 'ok', toolResult, ...(delivery ? {delivery} : {}),
            artifact: {kind: 'execute', executed: {ok: !toolResult.isError, summary: {tool: proposal.operation}}}};
        }
        if (proposal.operation === 'llm_proposal') return {status: 'ok', artifact: {kind: 'execute', executed: {ok: true, summary: {slot: 'llm_proposal'}}}};
        return {status: 'refused', reason: 'policy_write_not_in_sl01', artifact: {kind: 'execute', executed: {ok: false, summary: {refused: 'policy_write_not_in_sl01'}}}};
      },
    },
    ...(jev ? {decision: {
      async decide(request) {
        const question = object(request.question);
        const batch = question.batch as DecisionBatch | undefined;
        if (!batch || (request.purpose !== 'route' && request.purpose !== 'bind'))
          return {status: 'unavailable', artifact: {reason: batch ? `no_${request.purpose}_decider_in_sl01` : 'no_scope_binding'}};
        const lease = new TaskLease({owner: batch.family, goal: `run ${request.runId} ${request.purpose}`, scope: batch.scope, capabilities: ['decision'],
          readSet: batch.readSet, signal: request.signal,
          budget: {deadlineAt: Date.now() + 15_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
        try {
          const result = await jev.decide(batch, lease);
          return {status: result.status === 'complete' ? 'ok' : 'unavailable', artifact: {kind: request.purpose, result} as StepArtifact};
        } finally { lease.close(); }
      },
    }} : {}),
  };

  const runDriver: SessionRunDriver = {
    engine: 'hybrid-v1',
    // The Jev scope comes from the run's own read step (a read artifact carries the binding), never from a
    // read outside a step; until a read has bound it, a route question carries no batch and degrades to the Keeper.
    prepare: () => ({policy: createStepPolicy({context: emptyTurnContext()}), ports, maxSteps: options.maxSteps ?? 48}),
  };

  const extension = (pi: any) => {
    pi.events.on('coc:kernel-bridge', (data: KernelBridge) => { bridge = data?.call ? data : undefined; });
  };
  return {runDriver, extension, bridge: () => bridge};
}

