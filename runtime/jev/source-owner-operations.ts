/** Source owner bindings for the canonical dispatcher; graph publication remains with ReadingService. */
import { ContractError, isPlainRecord, type Json, type ObservationPacket, type SourceProof } from './contracts.ts';
import { issueSourceRef, resolveSourceRef } from './source-ref.ts';
import {nativeSourceState,nativeSourceParts,nativeConsultationApproval,SOURCE_CONSULT_CAPABILITY,
  type NativeConsultationApproval as NativeApproval,type SourceBinding} from './native-source-domain.ts';
import {nativeSourceCatalog,type NativeTextBundle,type NativeSourceCatalog} from './native-source-catalog.ts';
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
export interface NativeConsultationMaterializerPort {
  call(method:string,params:Record<string,unknown>):Promise<Record<string,any>>;
  sourceInfo(pdf:string,signal:AbortSignal):Promise<{file_sha256:string;page_count:number}>;
  sourceText(pdf:string,pages:number[],expectedSha:string,signal:AbortSignal):Promise<NativeTextBundle>;
}
export async function materializeNativeConsultation(input:{port:NativeConsultationMaterializerPort;moduleId:string;campaign?:string;
  scope:Parameters<typeof nativeSourceCatalog>[0];question:string;binding:SourceBinding;catalog:NativeSourceCatalog;
  approval:NativeApproval;signal:AbortSignal}):Promise<{sourceAnswer:Record<string,Json>;proof:Extract<SourceProof,{kind:'native_consultation'}>}> {
  const selected=input.approval.verdict.selected,ownerParts=nativeSourceParts(input.catalog),partsByAlias=new Map(ownerParts.map(part=>[part.alias,part]));
  if(!input.question||input.approval.question!==input.question||!selected.length||new Set(selected.map(part=>part.alias)).size!==selected.length)
    throw new ContractError('native_consultation_not_supported');
  if(JSON.stringify(input.approval.coverage)!==JSON.stringify(input.catalog.coverage)||selected.some(part=>JSON.stringify(partsByAlias.get(part.alias))!==JSON.stringify(part)))
    throw new ContractError('native_consultation_not_supported');
  const current=await input.port.call('module.source.snapshot',{module_id:input.moduleId,...(input.campaign?{campaign:input.campaign}:{})});
  if(current.revision!==input.binding.revision||current.file_sha256!==input.binding.file_sha256||current.page_count!==input.binding.page_count
    ||current.pdf!==input.binding.pdf)throw new ContractError('source_binding_stale');
  const actual=await input.port.sourceInfo(current.pdf,input.signal);
  input.signal.throwIfAborted();
  if(actual.file_sha256!==input.binding.file_sha256||actual.page_count!==input.binding.page_count)throw new ContractError('source_binding_stale');
  const pages=[...new Set(selected.map(part=>part.page))].sort((a,b)=>a-b);
  const bundle=await input.port.sourceText(current.pdf,pages,input.binding.file_sha256,input.signal);
  if(bundle.page_count!==input.binding.page_count||bundle.extraction_version!==input.catalog.extractionVersion)
    throw new ContractError('source_binding_stale');
  const fresh=nativeSourceCatalog(input.scope,bundle,input.binding.file_sha256),snapshots=new Map(fresh.snapshots.map(snapshot=>[snapshot.resource,snapshot]));
  const excerpts=selected.map(part=>({alias:part.alias,page:part.page,text:resolveSourceRef(part.ref,{
    scope:input.scope,mode:'active',read:resource=>snapshots.get(resource),currentRevision:resource=>snapshots.get(resource)?.revision})}));
  input.signal.throwIfAborted();
  const settled=await input.port.call('module.source.snapshot',{module_id:input.moduleId,...(input.campaign?{campaign:input.campaign}:{})});
  input.signal.throwIfAborted();
  if(settled.revision!==input.binding.revision||settled.file_sha256!==input.binding.file_sha256||settled.page_count!==input.binding.page_count
    ||settled.pdf!==input.binding.pdf)throw new ContractError('source_binding_stale');
  const proof:Extract<SourceProof,{kind:'native_consultation'}>={kind:'native_consultation',refs:selected.map(part=>part.ref),coverage:{
    used:selected.map(part=>part.alias),omitted:[...input.catalog.coverage.omittedPages.map(page=>`page:${page}`),
      ...ownerParts.filter(part=>input.approval.classifications[part.alias]==='irrelevant').map(part=>`part:${part.alias}`)],
    unknown:[...input.catalog.coverage.emptyPages,...input.catalog.coverage.errorPages].map(page=>`page:${page}`).concat(
      ownerParts.filter(part=>['uncertain','unknown'].includes(input.approval.classifications[part.alias]??'unknown')).map(part=>`part:${part.alias}`))}};
  return{sourceAnswer:{status:'answered',authority:proof.kind,supported:true,prepared:false,source_layer:'authored_pdf',question:input.question,excerpts,
    source_refs:selected.map(part=>({source_id:`pdf:${input.moduleId}`,pdf_index:part.page-1})),
    limitations:['Exact authored native excerpts; no image/layout proof, playable material, world change, or claim of scanned absence.']},proof};
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
    const approval=nativeConsultationApproval(currentView),eligible=approval?.verdict.selected;
    if (!approval||!eligible||proposal.args.question !== currentView.plan.goal
      || JSON.stringify(proposal.args.aliases) !== JSON.stringify(eligible.map(part => part.alias))) throw new ContractError('native_consultation_not_supported');
    const materialized=await materializeNativeConsultation({port,moduleId:port.moduleId(),campaign:context.task.context.scope.campaign,
      scope:context.task.context.scope,question:currentView.plan.goal,binding:state.binding,catalog:state.catalog,approval,signal:context.task.signal});
    const result=packet(proposal.id,context,{source_answer:materialized.sourceAnswer} as Json,materialized.proof);
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
