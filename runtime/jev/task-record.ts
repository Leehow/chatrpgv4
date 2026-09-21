/** Validate durable coordination records before they reach an owner authorization callback. */
import { isDeepStrictEqual } from 'node:util';
import { bindDecisionAnswers, ContractError, isPlainRecord, validatePlanSubmission, type DecisionBatch } from './contracts.ts';
import { assertSourcePublicationAdvance, compareReadSet } from './read-set.ts';
import { assertSourceRef } from './source-ref.ts';
import type { TaskRecord } from './task-runtime.ts';

function fail(): never { throw new ContractError('invalid_task_record'); }
const text = (value: unknown): value is string => typeof value === 'string' && !!value;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && Object.keys(value).length === value.length && value.every(text);
function object(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!isPlainRecord(value) || Object.keys(value).some(key => !keys.includes(key))) fail();
}
function json(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value) ? Object.keys(value).length === value.length && value.every(row => json(row, seen))
    : isPlainRecord(value) && Object.values(value).every(row => json(row, seen));
  seen.delete(value); return valid;
}
function refs(value: unknown, scope: unknown): void {
  if (!Array.isArray(value)) fail();
  for (const ref of value) { assertSourceRef(ref); if (!isDeepStrictEqual(ref.scope, scope)) fail(); }
}
function coverage(value: unknown): void {
  object(value, ['used', 'omitted', 'unknown']);
  if (![value.used, value.omitted, value.unknown].every(strings)) fail();
}
export function assertTaskRecord(value: unknown): asserts value is TaskRecord {
  try {
    if (!json(value)) fail();
    object(value, ['version', 'revision', 'domain', 'intent', 'checkpoint', 'phase', 'status', 'plan', 'observations', 'decisions',
      'remainingNeeds', 'replans', 'steps', 'pending', 'identities', 'result', 'reason']);
    if (value.version !== 1 || !count(value.revision) || !count(value.replans) || value.replans > 2 || !count(value.steps)
      || !strings(value.remainingNeeds) || !['active', 'waiting', 'ready', 'closed'].includes(value.status)
      || !['planning', 'deciding', 'waiting', 'composing', 'auditing', 'committing', 'delivering', 'terminal'].includes(value.phase)) fail();
    if (value.status === 'closed' && value.phase !== 'terminal' || value.status === 'waiting' && value.phase !== 'waiting'
      || value.status === 'ready' && !['composing', 'auditing', 'committing', 'delivering'].includes(value.phase)
      || value.status === 'active' && !['planning', 'deciding'].includes(value.phase) || value.reason !== undefined && !text(value.reason)) fail();
    object(value.domain, ['id', 'version']);
    if (!text(value.domain.id) || !text(value.domain.version)) fail();
    const checkpoint = value.checkpoint;
    object(checkpoint, ['version', 'context', 'phase', 'settledReceipts', 'remainingGoal', 'sourceAdvances']);
    if (checkpoint.version !== 1 || checkpoint.phase !== value.phase || !strings(checkpoint.settledReceipts) || typeof checkpoint.remainingGoal !== 'string') fail();
    const task = checkpoint.context;
    object(task, ['id', 'parentId', 'rootId', 'owner', 'kind', 'goal', 'scope', 'capabilities', 'readSet', 'budget', 'checkpointRefs', 'step', 'rootStep', 'origin']);
    if (![task.id, task.rootId, task.owner, task.goal].every(text) || !['foreground', 'committed_memory', 'child'].includes(task.kind)
      || !strings(task.capabilities) || !strings(task.checkpointRefs) || !count(task.step) || !count(task.rootStep) || task.rootStep < task.step
      || new Set(task.capabilities).size !== task.capabilities.length) fail();
    if (task.kind === 'child' ? !text(task.parentId) : task.parentId !== undefined || task.rootId !== task.id) fail();
    object(task.scope, ['owner', 'campaign', 'worldline', 'loop', 'audience']);
    if (!text(task.scope.owner) || !['keeper', 'player', 'system'].includes(task.scope.audience)
      || [task.scope.campaign, task.scope.worldline].some(field => field !== undefined && !text(field))
      || task.scope.loop !== undefined && !count(task.scope.loop)) fail();
    object(task.budget, ['deadlineAt', 'remainingInputTokens', 'remainingOutputTokens', 'remainingCostUsd', 'remainingActions']);
    if (!Number.isFinite(task.budget.deadlineAt)
      || ['remainingInputTokens', 'remainingOutputTokens', 'remainingActions'].some(key => !Number.isSafeInteger(task.budget[key]))
      || !Number.isFinite(task.budget.remainingCostUsd)) fail();
    if (value.status !== 'closed' && Object.entries(task.budget).some(([key, n]) => key !== 'deadlineAt' && Number(n) < 0)) fail();
    compareReadSet(task.readSet, task.readSet);
    if (checkpoint.sourceAdvances !== undefined) {
      if (!Array.isArray(checkpoint.sourceAdvances)) fail();
      const ids = new Set<string>();
      for (const advance of checkpoint.sourceAdvances) {
        assertSourcePublicationAdvance(advance);
        if (advance.rootId !== task.rootId || !isDeepStrictEqual(advance.scope, task.scope) || ids.has(advance.publicationId)) fail();
        ids.add(advance.publicationId);
      }
    }
    if (task.kind === 'committed_memory' && !task.origin) fail();
    if (task.origin !== undefined) {
      object(task.origin, ['turn', 'sourceRefs']);
      if (!count(task.origin.turn) || !task.origin.sourceRefs?.length) fail(); refs(task.origin.sourceRefs, task.scope);
    }
    object(value.intent, ['id', 'rawInput', 'actor', 'goal', 'method', 'limits', 'scope', 'turn', 'inputRevision']);
    if (!text(value.intent.id) || !text(value.intent.inputRevision) || !count(value.intent.turn) || !strings(value.intent.limits)
      || !isDeepStrictEqual(value.intent.scope, task.scope)
      || ['actor', 'goal', 'method'].some(key => value.intent[key] !== undefined && !text(value.intent[key]))) fail();
    refs([value.intent.rawInput], task.scope);
    if (value.intent.rawInput.revision !== value.intent.inputRevision) fail();
    if (value.plan !== undefined) validatePlanSubmission(value.plan, task.capabilities);
    const proposal = (item: unknown) => {
      object(item, ['id', 'taskId', 'operation', 'args', 'capability', 'scope', 'readSet', 'basis', 'bindings']);
      if (![item.id, item.operation, item.capability].every(text) || item.taskId !== task.id || !isPlainRecord(item.args)
        || !task.capabilities.includes(item.capability) || !isDeepStrictEqual(item.scope, task.scope)) fail();
      compareReadSet(item.readSet, item.readSet); refs(item.basis, task.scope);
      if (item.bindings !== undefined) {
        object(item.bindings, ['fulfillments']);
        if (item.operation!=='apply' || !Array.isArray(item.bindings.fulfillments) || !item.bindings.fulfillments.length || item.bindings.fulfillments.length>8) fail();
      }
    };
    if (value.pending !== undefined) { object(value.pending, ['key', 'proposal']); if (!text(value.pending.key)) fail(); proposal(value.pending.proposal); }
    if (!Array.isArray(value.observations) || !Array.isArray(value.decisions) || !isPlainRecord(value.identities)) fail();
    const operationIds = new Set<string>();
    for (const row of value.observations) {
      object(row, ['key', 'proposal', 'packet']); if (!text(row.key)) fail(); proposal(row.proposal);
      const packet = row.packet;
      object(packet, ['operationId', 'status', 'result', 'refs', 'receipts', 'readSet', 'coverage', 'diagnostics']);
      if (packet.operationId !== row.proposal.id || operationIds.has(packet.operationId) || !strings(packet.receipts)
        || !['succeeded', 'refused', 'pending', 'failed', 'cancelled', 'stale'].includes(packet.status) || !Object.hasOwn(packet, 'result')) fail();
      operationIds.add(packet.operationId); refs(packet.refs, task.scope); coverage(packet.coverage); compareReadSet(packet.readSet, packet.readSet);
      if (packet.diagnostics !== undefined && (!Array.isArray(packet.diagnostics) || packet.diagnostics.some((d: any) =>
        !isPlainRecord(d) || Object.keys(d).length !== 1 || !['bookkeeping_unavailable', 'settlement_unknown', 'owner_cancelled_after_settlement'].includes(String(d.code))))) fail();
    }
    for (const row of value.decisions) {
      object(row, ['key', 'batch', 'result']); if (!text(row.key)) fail();
      object(row.batch, ['id', 'model', 'family', 'familyVersion', 'scope', 'readSet', 'state', 'questions']);
      if (![row.batch.id, row.batch.model, row.batch.family, row.batch.familyVersion].every(text)
        || !isDeepStrictEqual(row.batch.scope, task.scope) || !Object.hasOwn(row.batch, 'state')) fail();
      compareReadSet(row.batch.readSet, row.batch.readSet);
      object(row.result, ['batchId', 'status', 'answers', 'coverage', 'issues', 'usage', 'elapsedMs', 'attempts', 'failure']);
      if (row.result.batchId !== row.batch.id || !['complete', 'incomplete', 'unavailable'].includes(row.result.status)
        || !isPlainRecord(row.result.answers) || !Array.isArray(row.result.issues)) fail();
      object(row.result.coverage, ['required', 'answered', 'unknown']);
      if (![row.result.coverage.required, row.result.coverage.answered, row.result.coverage.unknown].every(strings)) fail();
      const rebound = bindDecisionAnswers(row.batch as DecisionBatch, row.result.answers, row.result.usage);
      if (!isDeepStrictEqual(rebound.coverage, row.result.coverage) || row.result.status === 'complete' && rebound.status !== 'complete') fail();
      for (const issue of row.result.issues) {
        object(issue, ['key', 'code']);
        if (!text(issue.key) || !['missing_answer', 'invalid_answer', 'unknown_answer', 'rejected_answer', 'unexpected_answer'].includes(issue.code)) fail();
        if (issue.code === 'unexpected_answer' ? rebound.coverage.required.includes(issue.key) : !rebound.coverage.unknown.includes(issue.key)) fail();
      }
      if (row.result.status === 'complete' && row.result.issues.length || row.result.status === 'incomplete' && !row.result.issues.length
        || row.result.status === 'unavailable' && (Object.keys(row.result.answers).length || row.result.issues.length || !row.result.failure)) fail();
      if (row.result.status === 'incomplete' && rebound.coverage.unknown.some(key => !row.result.issues.some((issue: any) => issue.key === key))) fail();
      if (row.result.elapsedMs !== undefined && (!Number.isFinite(row.result.elapsedMs) || row.result.elapsedMs < 0)
        || row.result.attempts !== undefined && !count(row.result.attempts)) fail();
      if (row.result.failure !== undefined) {
        object(row.result.failure, ['code', 'retryable']);
        if (!['disabled', 'unconfigured', 'timeout', 'cancelled', 'rate_limited', 'service_error', 'schema_error', 'budget_exhausted', 'packing_limit'].includes(row.result.failure.code)
          || typeof row.result.failure.retryable !== 'boolean') fail();
      }
    }
    for (const [id, identity] of Object.entries(value.identities)) {
      object(identity, ['operationId', 'taskId', 'signature', 'callId', 'request']);
      if (identity.operationId !== id || identity.taskId !== task.id || !text(identity.signature)) fail();
      if (identity.callId !== undefined && (typeof identity.callId !== 'string' || !/^t\d+-c\d+$/.test(identity.callId))) fail();
      if (identity.request !== undefined && (!isPlainRecord(identity.request) || identity.request.call_id !== identity.callId
        || identity.request.campaign !== task.scope.campaign)) fail();
      if (!operationIds.has(id) && value.pending?.proposal.id !== id) fail();
    }
    if (value.result !== undefined) {
      const result = value.result;
      object(result, ['taskId', 'status', 'scope', 'refs', 'receipts', 'coverage', 'remainingNeeds', 'handoff']);
      if (result.taskId !== task.id || !isDeepStrictEqual(result.scope, task.scope) || !strings(result.receipts) || !strings(result.remainingNeeds)
        || !['complete', 'partial', 'unresolved', 'needs_player', 'pending', 'failed', 'cancelled', 'stale'].includes(result.status)) fail();
      refs(result.refs, task.scope); coverage(result.coverage);
      if (result.handoff !== undefined) {
        object(result.handoff, ['verbs']);
        if (!strings(result.handoff.verbs) || !result.handoff.verbs.length || result.handoff.verbs.length > 2
          || new Set(result.handoff.verbs).size !== result.handoff.verbs.length
          || result.handoff.verbs.some((verb: string) => !['resolve', 'apply'].includes(verb) || !task.capabilities.includes(verb))) fail();
      }
    }
  } catch { fail(); }
}
