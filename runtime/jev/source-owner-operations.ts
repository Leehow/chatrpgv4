/** Source owner bindings for the canonical dispatcher; graph publication remains with ReadingService. */
import { ContractError, isPlainRecord, type Json, type ObservationPacket, type SourceProof } from './contracts.ts';
import { issueSourceRef, resolveSourceRef } from './source-ref.ts';
import { nativeSourceState, nativeConsultationSelection, SOURCE_CONSULT_CAPABILITY } from './native-source-domain.ts';
import type { NativeTextBundle } from './native-source-catalog.ts';
import type { OwnedOperation } from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import type { TaskRuntime, TaskView } from './task-runtime.ts';

export interface SourceOwnerPort {
  registerOwned(name: string, definition: OwnedOperation): () => void;
  runtime(): TaskRuntime;
  moduleId(): string;
  call(method: string, params: Record<string, unknown>): Promise<Record<string, any>>;
  sourceInfo(pdf: string, signal: AbortSignal): Promise<{file_sha256: string; page_count: number}>;
  sourceText(pdf: string, pages: number[], expectedSha: string, signal: AbortSignal): Promise<NativeTextBundle>;
  visual(moduleId: string, question: string, signal: AbortSignal, taskId: string): Promise<Record<string, any>>;
}
function args(value: Record<string, Json>, keys: string[]): Record<string, Json> {
  if (!isPlainRecord(value) || Object.keys(value).some(key => !keys.includes(key))) throw new ContractError('invalid_source_arguments');
  return value;
}
export function registerSourceOperations(port: SourceOwnerPort): () => void {
  const dispose: Array<() => void> = [];
  const cache = new Map<string, ObservationPacket>();
  const register = (name: string, keys: string[], execute: OwnedOperation['execute']) => dispose.push(port.registerOwned(name, {
    kind: 'read', capability: SOURCE_CONSULT_CAPABILITY, validate: value => args(value, keys), execute,
  }));
  const view = (taskId: string): TaskView => {
    const record = port.runtime().snapshot(taskId);
    return { intent: record.intent, plan: record.plan!, context: port.runtime().lease(taskId).context,
      observations: record.observations, decisions: record.decisions, remainingNeeds: record.remainingNeeds, replans: record.replans };
  };
  const packet = (id: string, context: Parameters<OwnedOperation['execute']>[1], result: Json, proof?: SourceProof): ObservationPacket => ({
    operationId: id, status: 'succeeded', result, refs: proof?.refs ?? [], receipts: [], readSet: context.task.context.readSet,
    coverage: proof && 'coverage' in proof ? proof.coverage : {used: [], omitted: [], unknown: []},
  });
  const cacheKey = (view: TaskView, question: string) => JSON.stringify([nativeSourceState(view)?.binding.revision, question, view.context.scope,
    view.context.readSet.filter(binding => binding.kind !== 'draft'), 'source-consultation:1', 'jev-1.13.0']);
  const checkedVisual = (id: string, context: Parameters<OwnedOperation['execute']>[1], peek: Record<string, any>) => {
    if (peek.cached !== true || peek.source_answer?.supported !== true || peek.source_answer.prepared !== false || !isPlainRecord(peek.evidence)) return undefined;
    const evidence = peek.evidence;
    if (typeof evidence.resource !== 'string' || typeof evidence.revision !== 'string' || typeof evidence.accepted_revision !== 'string'
      || !isPlainRecord(evidence.record) || typeof evidence.record.answer !== 'string') throw new ContractError('invalid_source_evidence');
    const ref = issueSourceRef({scope: context.task.context.scope, resource: evidence.resource, revision: evidence.revision, sourceType: 'record',
      record: evidence.record as Json, allowedFields: [['answer']]}, {kind: 'field', path: ['answer']});
    const proof: SourceProof = {kind: 'reviewed_source', refs: [ref], acceptedRevision: evidence.accepted_revision};
    return packet(id, context, {source_answer: peek.source_answer as Json}, proof);
  };
  register('source.binding', [], async (proposal, context) => {
    const binding = await port.call('module.source.snapshot', { module_id: port.moduleId(), campaign: context.task.context.scope.campaign });
    const actual = await port.sourceInfo(binding.pdf, context.task.signal);
    if (actual.file_sha256 !== binding.file_sha256 || actual.page_count !== binding.page_count) throw new ContractError('source_binding_stale');
    return packet(proposal.id, context, binding as Json);
  });
  register('source.text', ['pages'], async (proposal, context) => {
    const state = nativeSourceState(view(context.task.context.id));
    if (!state || !Array.isArray(proposal.args.pages) || proposal.args.pages.some(page => !Number.isSafeInteger(page))) throw new ContractError('invalid_source_arguments');
    const source = await port.sourceText(state.binding.pdf, proposal.args.pages as number[], state.binding.file_sha256, context.task.signal);
    return packet(proposal.id, context, source as unknown as Json);
  });
  register('source.cache', ['question'], async (proposal, context) => {
    if (typeof proposal.args.question !== 'string') throw new ContractError('invalid_source_arguments');
    const current = view(context.task.context.id), retained = cache.get(cacheKey(current, proposal.args.question));
    if (retained) return {...structuredClone(retained), operationId: proposal.id, readSet: context.task.context.readSet,
      result: {...retained.result as Record<string, Json>, cached: true}};
    const peek = await port.call('module.source.answer.peek', {module_id: port.moduleId(), campaign: context.task.context.scope.campaign,
      focus: 'Authored source consultation', question: proposal.args.question});
    const result = checkedVisual(proposal.id, context, peek);
    return result ? {...result, result: {...result.result as Record<string, Json>, cached: true}} : packet(proposal.id, context, {cached: false});
  });
  register('source.excerpts', ['aliases', 'question'], async (proposal, context) => {
    const currentView = view(context.task.context.id), state = nativeSourceState(currentView);
    if (!state?.catalog || !Array.isArray(proposal.args.aliases) || !proposal.args.aliases.length
      || new Set(proposal.args.aliases).size !== proposal.args.aliases.length) throw new ContractError('invalid_source_arguments');
    const eligible = nativeConsultationSelection(currentView);
    if (!eligible || proposal.args.question !== currentView.plan.goal
      || JSON.stringify(proposal.args.aliases) !== JSON.stringify(eligible.map(part => part.alias))) throw new ContractError('native_consultation_not_supported');
    const selected = proposal.args.aliases.map(alias => {
      const part = state.parts.find(part => part.alias === alias);
      if (!part) throw new ContractError('unknown_source_alias'); return part;
    });
    const current = await port.call('module.source.snapshot', { module_id: port.moduleId(), campaign: context.task.context.scope.campaign });
    if (current.revision !== state.binding.revision) throw new ContractError('source_binding_stale');
    const actual = await port.sourceInfo(current.pdf, context.task.signal);
    if (actual.file_sha256 !== state.binding.file_sha256) throw new ContractError('source_binding_stale');
    const snapshots = new Map(state.catalog.snapshots.map(snapshot => [snapshot.resource, snapshot]));
    const excerpts = selected.map(part => ({ alias: part.alias, page: part.page, text: resolveSourceRef(part.ref, {
      scope: context.task.context.scope, mode: 'active', read: resource => snapshots.get(resource),
      currentRevision: resource => snapshots.get(resource)?.revision,
    }) }));
    const proof: SourceProof = { kind: 'native_consultation', refs: selected.map(part => part.ref),
      coverage: { used: selected.map(part => part.alias), omitted: state.catalog.coverage.omittedPages.map(page => `page:${page}`),
        unknown: [...state.catalog.coverage.emptyPages, ...state.catalog.coverage.errorPages].map(page => `page:${page}`) } };
    const result = packet(proposal.id, context, { source_answer: { status: 'answered', authority: proof.kind, prepared: false,
      source_layer: 'authored_pdf', excerpts, source_refs: selected.map(part => ({source_id: `pdf:${port.moduleId()}`, pdf_index: part.page - 1})),
      limitations: ['Exact authored native excerpts; no image/layout proof, playable material, world change, or claim of scanned absence.'],
    } } as Json, proof);
    cache.set(cacheKey(currentView, currentView.plan.goal), structuredClone(result));
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    return result;
  });
  register('source.visual', ['question'], async (proposal, context) => {
    if (typeof proposal.args.question !== 'string' || !proposal.args.question) throw new ContractError('invalid_source_arguments');
    const result = await port.visual(port.moduleId(), proposal.args.question, context.task.signal, context.task.context.id);
    if (result.source_answer?.supported === true) {
      const peek = await port.call('module.source.answer.peek', {module_id: port.moduleId(), campaign: context.task.context.scope.campaign,
        focus: 'Authored source consultation', question: proposal.args.question});
      const checked = checkedVisual(proposal.id, context, peek);
      if (!checked) throw new ContractError('source_answer_integrity');
      return checked;
    }
    return packet(proposal.id, context, result as Json);
  });
  register('source.consult', ['question'], async (proposal, context) => {
    if (typeof proposal.args.question !== 'string' || !proposal.args.question) throw new ContractError('invalid_source_arguments');
    const runtime = port.runtime(), parent = runtime.snapshot(context.task.context.id), task = context.task.context;
    const id = await runtime.begin({ parentId: task.id, domain: 'source-consultation', intent: parent.intent, lease: {
      owner: 'source', goal: proposal.args.question, scope: task.scope, capabilities: [SOURCE_CONSULT_CAPABILITY], budget: task.budget,
      readSet: task.readSet, signal: context.task.signal,
    } });
    const result = await runtime.submit(id, { goal: proposal.args.question, subgoals: [], constraints: ['Read the bound authored source only. Do not prepare or execute game material.'],
      evidenceRequired: [proposal.args.question], completion: ['Return exact supported source evidence or an explicit source limitation.'],
      capabilities: [SOURCE_CONSULT_CAPABILITY], replanWhen: [], returnWhen: [] });
    const record = runtime.snapshot(id), delivered = record.observations.findLast(row => ['source.excerpts', 'source.visual', 'source.cache'].includes(row.proposal.operation)
      && isPlainRecord(row.packet.result) && row.packet.result.source_answer);
    return { operationId: proposal.id, status: result.status === 'cancelled' || result.status === 'stale' ? result.status : result.status === 'pending' ? 'pending' : 'succeeded',
      result: delivered?.packet.result ?? { source_answer: { status: 'unresolved', prepared: false, supported: false, limitations: result.remainingNeeds } },
      refs: result.refs, receipts: [], readSet: context.task.context.readSet, coverage: delivered?.packet.coverage ?? result.coverage };
  });
  return () => { cache.clear(); for (const release of dispose.splice(0).reverse()) release(); };
}
