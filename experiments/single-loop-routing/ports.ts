/**
 * The real ports of the prototype: Jev through the product's DecisionPort, the product's own
 * prescreen (semantic locate + reads) as the read step, the product's ordinary-check preflight as the
 * closed binder, and the kernel RPC on a disposable workspace copy for every execution. No LLM.
 */
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import {prepareCheckPreflight} from '../../runtime/jev/check-preflight.ts';
import {prepareKeeperSupport} from '../../extensions/table/prescreen.ts';
import {bindingOf} from '../../extensions/table/context-policy.ts';
import type {DecisionBatch, DecisionResult, ReadSet, ScopeBinding} from '../../runtime/jev/contracts.ts';
import {buildCandidates, kernelCall, type Candidate, type Json} from './candidates.ts';
import {ROUTE_FAMILY, doneThisTurn, jsonBytes, type LoopPorts, type Material, type RunView, type StepRequest, type TurnContext} from './loop.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';

export interface RealPortsInput {
  call: (method: string, params: Record<string, unknown>) => Promise<any>;
  campaign: string;
  env: NodeJS.ProcessEnv;
  rawInput: string;
  log: (row: Record<string, unknown>) => void;
}

/** Everything the loop needs from the opened turn: the ports, the first context and the first candidates. */
export async function createRealPorts(input: RealPortsInput): Promise<{ports: LoopPorts; context: TurnContext; candidates: Candidate[]; turn: number; mint: () => string}> {
  const {call, campaign} = input;
  const decision = createDecisionAdapter({env: input.env, maxConcurrency: 4});
  let capsule: Row = object(await call('table.capsule', {campaign}));
  const binding = bindingOf(capsule._context);
  if (!binding) throw new Error('the capsule carries no context binding (is the turn open?)');
  const turn = binding.turn;
  const scope: ScopeBinding = {owner: `campaign:${campaign}`, campaign, worldline: binding.worldline, loop: binding.loop, audience: 'keeper'};
  const readSet = (): ReadSet => [
    {kind: 'source', resource: campaign, revision: String(binding.source_revision)},
    {kind: 'model', resource: 'decision', revision: JEV_MODEL},
    {kind: 'family', resource: ROUTE_FAMILY, revision: '1'},
  ];
  let ordinal = 0;
  const mint = () => `t${turn}-c${++ordinal}`;
  const lease = (owner: string, goal: string, ms: number) => new TaskLease({owner, goal, scope, capabilities: ['decision'], readSet: readSet(),
    budget: {deadlineAt: Date.now() + ms, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
  const providerBudget = () => ({actions: 40, inputTokens: 400_000, outputTokens: 40_000, costUsd: 2});
  let located: Array<{handle: string; label: string; kind: string}> = [];

  async function reads(consumed: ReadonlySet<string>): Promise<{context: TurnContext; candidates: Candidate[]}> {
    const quiet = async (method: string) => { try { return await call(method, {campaign}); } catch (error) { input.log({event: 'read_failed', method, error: String((error as Error).message)}); return {}; } };
    const [cap, status, applyOptions, resolveOptions] = await Promise.all([call('table.capsule', {campaign}), call('table.status', {campaign}), quiet('table.apply.options'), quiet('table.resolve.options')]);
    capsule = object(cap);
    const where = object(capsule.where);
    const context: TurnContext = {scene: text(where.scene), clock: (where.clock ?? null) as Json,
      present: array(capsule.present).map(person => text(object(object(person).called).name) || text(object(person).name)).filter(Boolean),
      receipts: array(object(status).receipts).map(receipt => text(object(receipt).id) || JSON.stringify(receipt))};
    const candidates = buildCandidates({capsule, applyOptions: object(applyOptions), resolveOptions: object(resolveOptions), located}, input.rawInput, consumed);
    return {context, candidates};
  }

  const first = await reads(new Set());
  const ports: LoopPorts = {
    scope,
    readSet,
    now: () => Date.now(),
    record: row => input.log({lane: 'loop', ...row}),
    async decide(batch: DecisionBatch): Promise<DecisionResult> {
      const owner = lease(batch.family, input.rawInput, 15_000);
      try { return await decision.decide(batch, owner); }
      finally { owner.close(); }
    },
    // The product's prescreen folds locate + read into one call; the loop's read step does both.
    async locate() { return {calls: 0, ms: 0, summary: {folded_into: 'read'}}; },
    async read(view: RunView) {
      const events: Row[] = [], began = Date.now();
      const message = object(await prepareKeeperSupport({call, campaign, binding, capsule, signal: AbortSignal.timeout(25_000),
        record: event => { events.push(event); input.log({lane: 'prescreen', ...event}); }, decision, byteBudget: 60_000, deadlineAt: Date.now() + 20_000,
        providerBudget: providerBudget(), env: input.env}));
      const prepared = events.find(event => event.event === 'prepared');
      let packet: Row = {};
      try { packet = object(JSON.parse(String(message.content ?? ''))); } catch { packet = {}; }
      const rawMaterials = array(packet.materials).map(object);
      const materials: Material[] = rawMaterials.map((material, index) => ({
        key: text(material.key) || text(material.locator) || text(material.id) || `${text(material.kind)}:${text(material.label) || text(material.name) || index}`,
        label: text(material.label) || text(material.name) || text(material.kind),
        kind: text(material.kind) || 'material',
        preview: typeof material.text === 'string' ? material.text : JSON.stringify(material.body ?? material.summary ?? material).slice(0, 2_000),
      }));
      located = rawMaterials.filter(material => text(material.kind) === 'graph_entity' && text(material.handle))
        .map(material => ({handle: text(material.handle), label: text(material.label) || text(material.name) || text(material.handle), kind: text(object(material.entity).kind) || text(material.entity_kind) || 'entity'}));
      const summary = {jev_calls: Number(prepared?.jev_calls ?? 0), ms: Date.now() - began, materials: materials.length, supplied: prepared?.supplied ?? null,
        stop_reason: prepared?.stop_reason ?? null, locate: prepared?.locate ?? null, packet_keys: Object.keys(packet), first_material_keys: rawMaterials[0] ? Object.keys(rawMaterials[0]) : [],
        located: located.length, fallback: events.find(event => event.event === 'fallback')?.reason ?? null} as Json;
      return {materials, located, summary, calls: Number(prepared?.jev_calls ?? 0), ms: Date.now() - began} as any;
    },
    async bindOrdinary(view: RunView, candidate: Candidate) {
      const began = Date.now(), owner = lease('ordinary-resolve', view.rawInput, 15_000);
      try {
        const result = await prepareCheckPreflight({campaign, turn, rawInput: view.rawInput, goal: view.rawInput, scope, readSet: readSet(),
          publicContext: [{role: 'player', text: view.rawInput}], call, decision, lease: owner});
        return {disposition: result.advice.disposition, action: result.advice.action as unknown as Record<string, Json> | undefined,
          unresolved: result.advice.unresolved, calls: result.decisionCalls, ms: Date.now() - began};
      } finally { owner.close(); }
    },
    async execute(candidate: Candidate, extra: Record<string, Json> | undefined) {
      const {method, params} = kernelCall(candidate, extra ?? {});
      const callId = mint();
      try {
        const result = object(await call(method, {campaign, call_id: callId, ...params}));
        const receipts = array(result.receipts).map(receipt => typeof receipt === 'string' ? receipt : text(object(receipt).id) || JSON.stringify(receipt));
        return {ok: true, summary: {method, call_id: callId, receipts, ...(result.roll !== undefined ? {roll: result.roll} : {}), ...(result.outcome !== undefined ? {outcome: result.outcome} : {})} as Json};
      } catch (error) {
        return {ok: false, summary: {method, call_id: callId, error: String((error as Error).message).slice(0, 400)} as Json};
      }
    },
    async refresh(view: RunView) { return reads(new Set(view.consumed)); },
    projectionBytes(view: RunView, request: Extract<StepRequest, {kind: 'infer'}>) {
      return jsonBytes({purpose: request.purpose, player_input: view.rawInput, context: view.context, materials: view.materials, done: doneThisTurn(view)});
    },
  };
  return {ports, context: first.context, candidates: first.candidates, turn, mint};
}
