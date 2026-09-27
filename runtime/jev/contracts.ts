/** Shared host contracts from kernel RPC section 122. No classification executes an operation. */
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { isDeepStrictEqual } from 'node:util';

import { ContractError, isPlainRecord as object, type Json, type ScopeBinding, type SourceRef } from './value-contracts.ts';
export { ContractError, isPlainRecord } from './value-contracts.ts';
export type { Json, Audience, ScopeBinding, SourceRef } from './value-contracts.ts';

export type SourceProof =
  | { kind: 'navigation'; refs: SourceRef[] }
  | { kind: 'native_excerpt'; refs: SourceRef[] }
  | { kind: 'native_consultation'; refs: SourceRef[]; coverage: Coverage }
  | { kind: 'reviewed_source'; refs: SourceRef[]; acceptedRevision: string };
export interface Coverage { used: string[]; omitted: string[]; unknown: string[] }
export type ReadSetKind = 'source' | 'extraction' | 'graph' | 'adaptation' | 'world' | 'memory' | 'memory_index' | 'draft' | 'model' | 'family';
export interface VersionBinding { kind: ReadSetKind; resource: string; revision: string }
export type ReadSet = VersionBinding[];

export interface IntentBinding {
  id: string;
  rawInput: SourceRef;
  actor?: string;
  goal?: string;
  method?: string;
  limits: string[];
  scope: ScopeBinding;
  turn: number;
  inputRevision: string;
}

const sentence = () => Type.String({ minLength: 1, maxLength: 2048 });
const sentences = (minItems = 0) => Type.Array(sentence(), { minItems, maxItems: 32 });
/** Semantic submission only. Executable arguments and identity are deliberately absent. */
export const PlanSubmissionSchema = Type.Object({
  goal: sentence(),
  subgoals: sentences(),
  constraints: sentences(),
  evidenceRequired: sentences(),
  completion: sentences(1),
  capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 32, uniqueItems: true }),
  replanWhen: sentences(),
  returnWhen: sentences(),
}, { additionalProperties: false });
export type PlanSubmission = Static<typeof PlanSubmissionSchema>;
export interface PlanPacket {
  version: 1;
  taskId: string;
  intentId: string;
  revision: string;
  readSet: ReadSet;
  plan: PlanSubmission;
}

export function validatePlanSubmission(value: unknown, allowedCapabilities: readonly string[]): PlanSubmission {
  if (!object(value) || !Check(PlanSubmissionSchema, value)) throw new ContractError('invalid_plan_submission');
  if (value.capabilities.some(capability => !allowedCapabilities.includes(capability)))
    throw new ContractError('capability_out_of_scope');
  // The caller owns this snapshot; later changes to the model response cannot alter it.
  return structuredClone(value);
}

export interface TaskBudget {
  deadlineAt: number;
  remainingInputTokens: number;
  remainingOutputTokens: number;
  remainingCostUsd: number;
  remainingActions: number;
}
export interface TaskContext {
  id: string;
  parentId?: string;
  rootId: string;
  owner: string;
  kind: 'foreground' | 'child' | 'committed_memory';
  goal: string;
  scope: ScopeBinding;
  capabilities: string[];
  readSet: ReadSet;
  budget: TaskBudget;
  checkpointRefs: string[];
  step: number;
  rootStep: number;
  origin?: { turn: number; sourceRefs: SourceRef[] };
}

interface QuestionBase { key: string; target: string; instructions: string }
export type DecisionDescriptor = string | Json[] | { [key: string]: Json } | null;
export type DecisionQuestion = QuestionBase & (
  | { type: 'choice'; criteria: Record<string, DecisionDescriptor> }
  | { type: 'noul'; criteria?: { true: DecisionDescriptor; false: DecisionDescriptor } }
  | { type: 'score'; criteria: DecisionDescriptor[] }
);
export interface DecisionBatch {
  id: string;
  model: string;
  family: string;
  familyVersion: string;
  scope: ScopeBinding;
  readSet: ReadSet;
  state: Json;
  questions: DecisionQuestion[];
}
export interface DecisionUsage { inputTokens: number; outputTokens: number; costUsd?: number }
export type DecisionAnswer =
  | { status: 'answered'; type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { status: 'answered'; type: 'noul'; noul: number }
  | { status: 'answered'; type: 'score'; score: number; confidence: number; legend: Record<string, DecisionDescriptor>; probabilities: Record<string, number> }
  | { status: 'unknown' | 'rejected' };
export interface DecisionIssue { key: string; code: 'missing_answer' | 'invalid_answer' | 'unknown_answer' | 'rejected_answer' | 'unexpected_answer' }
export interface DecisionResult {
  batchId: string;
  status: 'complete' | 'incomplete' | 'unavailable';
  answers: Record<string, DecisionAnswer>;
  coverage: { required: string[]; answered: string[]; unknown: string[] };
  issues: DecisionIssue[];
  usage?: DecisionUsage;
  elapsedMs?: number;
  attempts?: number;
  failure?: { code: 'disabled' | 'unconfigured' | 'timeout' | 'cancelled' | 'rate_limited' | 'service_error' | 'schema_error' | 'budget_exhausted' | 'packing_limit'; retryable: boolean;
    /** SL-84: the last attempt's HTTP status, or its network/timeout code when no response ever arrived. Absent before any transport attempt (disabled/unconfigured/schema/packing/budget checks that never dispatch). */
    status?: number | string };
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
/** Pinned Jev wire replies round probabilities to hundredths; never renormalize the reported values. */
export function probabilityMassValid(values: number[]): boolean {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return false;
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) <= 0.001) return true;
  if (values.some(value => Math.abs(value * 100 - Math.round(value * 100)) > 1e-8)) return false;
  const lower = values.reduce((total, value) => total + Math.max(0, value - 0.005), 0);
  const upper = values.reduce((total, value) => total + Math.min(1, value + 0.005), 0);
  return lower <= 1 + 1e-10 && upper >= 1 - 1e-10;
}
function probability(value: unknown): value is number { return finite(value) && value >= 0 && value <= 1; }
function own(object: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(object, key); }
function hasOnly(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }

/** Validate normalized provider answers. Family policy, never this validator, decides what to do. */
export function bindDecisionAnswers(batch: DecisionBatch, raw: unknown, usage?: DecisionUsage): DecisionResult {
  const required = batch.questions.map(question => question.key);
  if (new Set(required).size !== required.length || required.some(key => !key)) throw new ContractError('duplicate_or_empty_question_key');
  for (const question of batch.questions) {
    if (!question.target || !question.instructions) throw new ContractError('missing_question_target');
    if (question.type === 'choice' && (!object(question.criteria) || Object.keys(question.criteria).length === 0))
      throw new ContractError('empty_choice_candidates');
    if (question.type === 'score' && (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10))
      throw new ContractError('invalid_score_criteria');
  }
  if (usage && (!finite(usage.inputTokens) || usage.inputTokens < 0 || !finite(usage.outputTokens) || usage.outputTokens < 0
    || usage.costUsd !== undefined && (!finite(usage.costUsd) || usage.costUsd < 0))) throw new ContractError('invalid_decision_usage');
  const answers: Record<string, DecisionAnswer> = Object.create(null);
  const issues: DecisionIssue[] = [];
  const answered: string[] = [], unknown: string[] = [];
  for (const question of batch.questions) {
    const key = question.key;
    const answer = object(raw) && own(raw, key) ? raw[key] : undefined;
    let code: DecisionIssue['code'] | undefined;
    if (answer === undefined) code = 'missing_answer';
    else if (!object(answer)) code = 'invalid_answer';
    else if (answer.status === 'unknown' || answer.status === 'rejected') {
      if (!hasOnly(answer, ['status'])) code = 'invalid_answer';
      else {
        answers[key] = { status: answer.status };
        code = answer.status === 'unknown' ? 'unknown_answer' : 'rejected_answer';
      }
    } else {
      let valid = answer.status === 'answered' && answer.type === question.type
        && (answer.confidence === undefined || probability(answer.confidence));
      if (question.type === 'choice') {
        valid &&= hasOnly(answer, ['status', 'type', 'choice', 'confidence', 'probabilities'])
          && typeof answer.choice === 'string' && own(question.criteria, answer.choice);
        if (answer.probabilities !== undefined) {
          const distribution = answer.probabilities;
          valid &&= object(distribution) && Object.keys(distribution).length === Object.keys(question.criteria).length
            && Object.keys(question.criteria).every(candidate => own(distribution, candidate) && probability(distribution[candidate]));
          if (valid) valid &&= probabilityMassValid(Object.values(distribution as Record<string, number>));
        }
      } else if (question.type === 'noul') {
        valid &&= hasOnly(answer, ['status', 'type', 'noul']) && probability(answer.noul);
      } else {
        const keys = question.criteria.map((_, index) => String(index));
        valid &&= hasOnly(answer, ['status', 'type', 'score', 'confidence', 'legend', 'probabilities']) && finite(answer.score)
          && answer.score >= 0 && answer.score <= question.criteria.length - 1 && probability(answer.confidence)
          && object(answer.legend) && Object.keys(answer.legend).length === keys.length
          && object(answer.probabilities) && Object.keys(answer.probabilities).length === keys.length;
        if (valid) {
          const legend = answer.legend as Record<string, unknown>, probabilities = answer.probabilities as Record<string, number>;
          valid &&= keys.every((key, index) => own(legend, key) && isDeepStrictEqual(legend[key], question.criteria[index])
            && own(probabilities, key) && probability(probabilities[key]));
          valid &&= probabilityMassValid(Object.values(probabilities));
        }
      }
      if (valid) answers[key] = structuredClone(answer) as DecisionAnswer;
      else code = 'invalid_answer';
    }
    if (code) { issues.push({ key, code }); unknown.push(key); }
    else answered.push(key);
  }
  if (object(raw)) for (const key of Object.keys(raw)) if (!required.includes(key)) issues.push({ key, code: 'unexpected_answer' });
  return { batchId: batch.id, status: issues.length ? 'incomplete' : 'complete', answers,
    coverage: { required, answered, unknown }, issues, ...(usage ? { usage: structuredClone(usage) } : {}) };
}

export interface OperationProposal {
  id: string;
  taskId: string;
  operation: string;
  args: Record<string, Json>;
  capability: string;
  scope: ScopeBinding;
  readSet: ReadSet;
  basis: SourceRef[];
  /** Private owner evidence; never accepted in a model-authored plan or public tool arguments. */
  bindings?: {fulfillments: Json[]};
}
export interface ObservationPacket {
  operationId: string;
  status: 'succeeded' | 'refused' | 'pending' | 'failed' | 'cancelled' | 'stale';
  result: Json;
  refs: SourceRef[];
  receipts: string[];
  readSet: ReadSet;
  coverage: Coverage;
  diagnostics?: Array<{ code: 'bookkeeping_unavailable' | 'settlement_unknown' | 'owner_cancelled_after_settlement' }>;
}
export const TASK_OUTCOMES = ['complete', 'partial', 'unresolved', 'needs_player', 'pending', 'failed', 'cancelled', 'stale'] as const;
export interface TaskResult {
  taskId: string;
  status: typeof TASK_OUTCOMES[number];
  scope: ScopeBinding;
  refs: SourceRef[];
  receipts: string[];
  coverage: Coverage;
  remainingNeeds: string[];
  /** Host-issued transfer of execution to an existing public tool owner. */
  handoff?: { verbs: Array<'resolve' | 'apply'> };
}
export const MEMORY_KINDS = ['world_event', 'knowledge', 'belief', 'relationship', 'player_assertion', 'player_preference', 'keeper_correction', 'promise'] as const;
export interface MemoryRecord {
  version: 1;
  id: string;
  kind: typeof MEMORY_KINDS[number];
  scope: ScopeBinding;
  sourceRefs: SourceRef[];
  annotations: Record<string, Json>;
  links: Array<{ target: string; relation: 'duplicate' | 'reinforcement' | 'independent' | 'correction' | 'contradiction' | 'temporal_change' }>;
  summary?: { derived: true; text: string; basis: SourceRef[] };
}
