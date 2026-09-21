/** Host-internal preparation of an actual pending canonical mutation. No planner capability. */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ContractError,isPlainRecord,type OperationProposal} from './contracts.ts';
import type {TaskLease} from './task-context.ts';
import {assertSourcePreparationAuthority,assertSourcePublicationAdvance,sourceAdvanceAuthority,
  type SourcePreparationAuthority,type SourcePublicationAdvance} from './read-set.ts';
export interface SourcePreparationRequest {authority:SourcePreparationAuthority;read:Record<string,unknown>}
export function assertSourcePreparationRequest(value:unknown):asserts value is SourcePreparationRequest {
  if(!isPlainRecord(value)||Object.keys(value).some(key=>!['authority','read'].includes(key))||!isPlainRecord(value.read)
    ||Object.keys(value.read).some(key=>!['purpose','focus','question','material','pages'].includes(key))||value.read.purpose!=='detail'
    ||typeof value.read.focus!=='string'||!value.read.focus.trim()||value.read.question!==undefined&&typeof value.read.question!=='string'
    ||value.read.material!==undefined&&value.read.material!=='map'||value.read.pages!==undefined&&(!Array.isArray(value.read.pages)||value.read.pages.some(page=>!Number.isSafeInteger(page)||Number(page)<1)))
    throw new ContractError('invalid_source_preparation_request');
  assertSourcePreparationAuthority(value.authority);
}
export async function runOwnedSourcePreparation(input:{
  task:TaskLease;proposal:OperationProposal;callId:string;moduleId:string;failure:unknown;
  ensure(params:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,any>>;
  validateCurrent():Promise<void>;advanced?(advance:SourcePublicationAdvance):Promise<void>;
}):Promise<SourcePublicationAdvance> {
  const {task,proposal}=input,context=task.context,failure=input.failure as any;
  task.assertActive();
  if(!['apply','resolve'].includes(proposal.operation)||proposal.capability!==proposal.operation||!context.capabilities.includes(proposal.capability)
    ||proposal.taskId!==context.id||!isDeepStrictEqual(proposal.scope,context.scope)||failure?.details?.reason!=='material_pending'
    ||typeof input.callId!=='string'||typeof input.moduleId!=='string'||!input.moduleId) throw new ContractError('source_preparation_not_owned');
  await input.validateCurrent();task.assertActive();
  const binding=context.readSet.find(value=>value.kind==='source'&&value.resource===context.scope.campaign),turn=/^t([0-9]+)-c[0-9]+$/.exec(input.callId);
  if(!binding||!turn||!context.scope.campaign)throw new ContractError('source_preparation_binding_missing');
  const request:SourcePreparationRequest={authority:{version:1,owner:'module-reading',token:randomUUID(),taskId:context.id,rootId:context.rootId,
    operationId:proposal.id,callId:input.callId,campaign:context.scope.campaign,moduleId:input.moduleId,scope:context.scope,turn:Number(turn[1]),from:binding.revision},read:structuredClone(failure.details.read)};
  assertSourcePreparationRequest(request);
  const result=await input.ensure({...request.read,foreground:true,_task_prepare:request},task.signal);task.assertActive();
  const advance=result._task_source_advance;assertSourcePublicationAdvance(advance);
  if(!isDeepStrictEqual(sourceAdvanceAuthority(advance),request.authority))throw new ContractError('source_preparation_authority_mismatch');
  task.advanceSource(advance,{...request.authority,publicationId:advance.publicationId,jobId:advance.jobId,lease:advance.lease});
  await input.validateCurrent();task.assertActive();
  await input.advanced?.(advance);return structuredClone(advance);
}
