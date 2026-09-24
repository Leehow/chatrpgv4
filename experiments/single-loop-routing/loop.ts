/**
 * Prototype driver of the single-loop step policy (design proposal §4.3/§5, owner ruling 2026-09-23).
 *
 * The policy itself -- `next`, `interpretRoute`, `routeBatch`, `bindBatch`, `interpretBind`, the gates,
 * the guards and the precedence -- moved into the product at SL-01 (`runtime/jev/step-policy.ts`) with
 * its exported names kept, and is re-exported here. What stays in the experiment is `runTurn`: the
 * prototype's own driver over injected replay ports. It folds every step in with the same pure
 * transitions Pi's RunDriver uses through `createStepPolicy`, so the replay and the product cannot drift.
 */
import type {DecisionBatch, DecisionResult, ReadSet, ScopeBinding} from '../../runtime/jev/contracts.ts';
import {compileBatch} from '../../runtime/jev/route-compile.ts';
import {
  DEFAULT_CONFIDENCE_GATE, bindBatch, doneThisTurn, next, routeBatch, settleBind, settleCompile, settleExecute, settleInfer, settleLlmProposal, settleLocate,
  settleOrdinaryBind, settleRead, settleRoute, startStep,
  type Candidate, type Json, type Material, type PendingItem, type RunView, type StepRequest, type TelemetryRow, type TurnContext,
} from '../../runtime/jev/step-policy.ts';

export * from '../../runtime/jev/step-policy.ts';

export interface LoopPorts {
  scope: ScopeBinding;
  readSet(view: RunView): ReadSet;
  /** One Jev decision through the shared DecisionPort (the port owns lease and accounting). */
  decide(batch: DecisionBatch): Promise<DecisionResult>;
  /** Semantic locate over the closed entity index: Jev noul batches. */
  locate(view: RunView): Promise<{calls: number; ms: number; summary: Json}>;
  /** The existing ordinary-check route/profile policy (two Jev decisions). */
  bindOrdinary(view: RunView, candidate: Candidate): Promise<{disposition: string; action?: Record<string, Json>; unresolved: string[]; calls: number; ms: number}>;
  /** Kernel execution on the disposable copy, with a host-minted call id. */
  execute(candidate: Candidate, extra: Record<string, Json> | undefined): Promise<{ok: boolean; summary: Json}>;
  /** Materialize the next page of located material. */
  read(view: RunView): Promise<{materials: Material[]; located: Array<{handle: string; label: string; kind: string}>; summary: Json}>;
  /** Fresh reads after a state change: context and host-issued candidates. */
  refresh(view: RunView): Promise<{context: TurnContext; candidates: Candidate[]}>;
  /** Bytes of what the LLM would receive for this infer. */
  projectionBytes(view: RunView, request: Extract<StepRequest, {kind: 'infer'}>): number;
  /**
   * The LLM step. Absent, an infer is only recorded and an open adjudication ends the run. Present, it
   * answers with the operations the model proposes (as raw calls, executed next by Guard 2) and/or a stop
   * (compose). The prototype's implementation replays the live Keeper's recorded tool calls.
   */
  llm?(view: RunView, request: Extract<StepRequest, {kind: 'infer'}>): Promise<{items: PendingItem[]; stop?: {reason: string; purpose: string}; detail?: Json} | undefined>;
  /** Execute a model-origin raw call on the same workspace, through the same kernel entry. */
  executeRaw?(call: NonNullable<PendingItem['call']>): Promise<{ok: boolean; summary: Json}>;
  now(): number;
  record?(row: TelemetryRow): void;
}

/** The driver: one loop, one owner of the view. */
export async function runTurn(ports: LoopPorts, initial: RunView, options: {gate?: number} = {}): Promise<{view: RunView; telemetry: TelemetryRow[]}> {
  const gate = options.gate ?? DEFAULT_CONFIDENCE_GATE, telemetry: TelemetryRow[] = [];
  const view: RunView = structuredClone(initial);
  const note = (row: TelemetryRow) => {telemetry.push(row); try {ports.record?.(row);} catch {/* Telemetry never steers the loop. */}};
  for (;;) {
    const request = next(view), began = ports.now();
    if (request.kind === 'finish') {
      view.stopped ??= {reason: request.reason};
      note({step: view.budget.steps + 1, kind: 'finish', purpose: 'finish', choice: null, confidence: null, ms: 0, jev_calls: 0, reason: request.reason});
      return {view, telemetry};
    }
    const step = startStep(view, request);
    if (request.kind === 'decide' && request.purpose === 'route') {
      const {batch, offered} = routeBatch(view, ports.scope, ports.readSet(view));
      const result = await ports.decide(batch), ms = ports.now() - began;
      note(settleRoute(view, step, batch, offered, result, ms, gate));
      continue;
    }
    if (request.kind === 'decide' && request.purpose === 'compile') {
      // §135.30: the typed-feature compile (asked only when the refresh port carries feature rows).
      const batch = compileBatch(view, ports.scope, ports.readSet(view), doneThisTurn(view));
      const result = await ports.decide(batch), ms = ports.now() - began;
      note(settleCompile(view, step, batch, result, ms, gate));
      continue;
    }
    if (request.kind === 'decide' && request.purpose === 'locate') {
      const located = await ports.locate(view), ms = ports.now() - began;
      note(settleLocate(view, step, located, ms));
      continue;
    }
    if (request.kind === 'decide') {
      const candidate = request.item.candidate!;
      // §135.28: a clerk bind past the Jev budget is settled without asking Jev (rules defaults, else the Keeper).
      const offline = request.purpose === 'bind' ? request.offline : undefined;
      if (candidate.unbound.some(value => value.required && value.binder === 'ordinary-resolve')) {
        const bound = offline ? {disposition: 'unavailable', unresolved: [offline], calls: 0, ms: 0} : await ports.bindOrdinary(view, candidate), ms = ports.now() - began;
        note(settleOrdinaryBind(view, step, candidate, bound, ms));
        continue;
      }
      const batch = bindBatch(view, candidate, ports.scope, ports.readSet(view));
      const result = offline ? {batchId: batch.id, status: 'unavailable', answers: {}, coverage: {required: [], answered: [], unknown: []}, issues: [],
        failure: {code: offline, retryable: false}} as unknown as DecisionResult : await ports.decide(batch), ms = ports.now() - began;
      note(settleBind(view, step, candidate, batch, result, ms, gate, !!offline));
      continue;
    }
    if (request.kind === 'infer') {
      const projection = ports.projectionBytes(view, request);
      const answered = ports.llm ? await ports.llm(view, request) : undefined;
      note(settleInfer(view, step, request, answered, projection, ports.now() - began));
      continue;
    }
    // direct
    const item = request.item;
    if (item.purpose === 'llm_proposal') { note(settleLlmProposal(view, step, item, ports.now() - began)); continue; }
    if (item.purpose === 'read') {
      const read = await ports.read(view) as Awaited<ReturnType<LoopPorts['read']>> & {calls?: number; ms?: number};
      const fresh = await ports.refresh(view);
      note(settleRead(view, step, read, fresh, ports.now() - began));
      continue;
    }
    const executed = item.call
      ? (ports.executeRaw ? await ports.executeRaw(item.call) : {ok: false, summary: {error: 'no executeRaw port'} as Json})
      : await ports.execute(item.candidate!, item.extra);
    const fresh = await ports.refresh(view);
    note(settleExecute(view, step, item, executed, fresh, ports.now() - began));
  }
}
