/** Conservative Jev packing. UTF-8 JSON bytes are a token upper bound, not a tokenizer result. */
import { ContractError, isPlainRecord, type DecisionBatch, type DecisionDescriptor, type DecisionQuestion, type Json } from './contracts.ts';

export const JEV_MODEL = 'jev-1.13.0';
export const PROJECT_TOTAL_TOKEN_UPPER_BOUND = 32_768;
export const PROVIDER_CHOICE_LIMIT = 255;
export const ESTIMATE_PROVENANCE = 'utf8_json_bytes_token_upper_bound' as const;

export interface PackedQuestion {
  type: 'choice' | 'noul' | 'score';
  instructions: { target: string; instruction: string };
  criteria?: Record<string, DecisionDescriptor> | { true: DecisionDescriptor; false: DecisionDescriptor } | DecisionDescriptor[];
}
export interface PackedRequest { model: typeof JEV_MODEL; state: Json; questions: Record<string, PackedQuestion> }
export interface PackingEstimate {
  provenance: typeof ESTIMATE_PROVENANCE;
  stateUpperBound: number;
  longestQuestionUpperBound: number;
  totalUpperBound: number;
  responseUpperBound: number;
  projectLimit: number;
}
export class PackingError extends ContractError {
  readonly failure: 'packing_limit' | 'schema_error';
  readonly estimate?: PackingEstimate;
  constructor(failure: 'packing_limit' | 'schema_error', estimate?: PackingEstimate) {
    super(failure); this.failure = failure; this.estimate = estimate;
  }
}

const ownKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
function json(value: unknown, seen = new Set<object>()): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && value.every(child => json(child, seen))
    : isPlainRecord(value) && Object.values(value).every(child => json(child, seen));
  seen.delete(value);
  return valid;
}
function descriptor(value: unknown): value is DecisionDescriptor {
  return value === null || typeof value === 'string' || Array.isArray(value) && json(value) || isPlainRecord(value) && json(value);
}
function described(value: unknown): value is Exclude<DecisionDescriptor, null> { return value !== null && descriptor(value); }
function dense(value: unknown): value is unknown[] { return Array.isArray(value) && Object.keys(value).length === value.length; }
function question(value: unknown): value is DecisionQuestion {
  if (!isPlainRecord(value) || !ownKeys(value, ['key', 'target', 'instructions', 'type', 'criteria'])
    || typeof value.key !== 'string' || !value.key || typeof value.target !== 'string' || !value.target
    || typeof value.instructions !== 'string' || !value.instructions || !['choice', 'noul', 'score'].includes(String(value.type))) return false;
  if (value.type === 'choice') return isPlainRecord(value.criteria) && Object.keys(value.criteria).length > 0
    && Object.values(value.criteria).every(descriptor);
  if (value.type === 'noul') return value.criteria === undefined || isPlainRecord(value.criteria)
    && ownKeys(value.criteria, ['true', 'false']) && Object.keys(value.criteria).length === 2
    && described(value.criteria.true) && described(value.criteria.false);
  return dense(value.criteria) && value.criteria.length >= 2 && value.criteria.length <= 10 && value.criteria.every(described);
}
function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
const NUMERIC_PLACEHOLDER = '00000000000000000000000000000000';
function responseUpperBound(batch: DecisionBatch): number {
  const answers = Object.fromEntries(batch.questions.map(item => {
    if (item.type === 'choice') {
      const choices = Object.keys(item.criteria);
      const longest = choices.reduce((left, right) => bytes(left) >= bytes(right) ? left : right);
      return [item.key, { type: 'choice', choice: longest, confidence: NUMERIC_PLACEHOLDER,
        probabilities: Object.fromEntries(choices.map(key => [key, NUMERIC_PLACEHOLDER])) }];
    }
    if (item.type === 'noul') return [item.key, { type: 'noul', noul: NUMERIC_PLACEHOLDER }];
    return [item.key, { type: 'score', score: NUMERIC_PLACEHOLDER, confidence: NUMERIC_PLACEHOLDER,
      legend: Object.fromEntries(item.criteria.map((value, index) => [String(index), value])),
      probabilities: Object.fromEntries(item.criteria.map((_, index) => [String(index), NUMERIC_PLACEHOLDER])) }];
  }));
  return bytes({ model: JEV_MODEL, answers, usage: { input_tokens: NUMERIC_PLACEHOLDER, output_tokens: NUMERIC_PLACEHOLDER } });
}

export function packDecisionBatch(batch: DecisionBatch): { request: PackedRequest; estimate: PackingEstimate } {
  if (!isPlainRecord(batch) || !ownKeys(batch, ['id', 'model', 'family', 'familyVersion', 'scope', 'readSet', 'state', 'questions'])
    || typeof batch.id !== 'string' || !batch.id || batch.model !== JEV_MODEL
    || typeof batch.family !== 'string' || !batch.family || typeof batch.familyVersion !== 'string' || !batch.familyVersion
    || !json(batch.state) || !dense(batch.questions) || !batch.questions.length || !batch.questions.every(question))
    throw new PackingError('schema_error');
  const keys = batch.questions.map(item => item.key);
  if (new Set(keys).size !== keys.length) throw new PackingError('schema_error');
  if (batch.questions.some(item => item.type === 'choice' && Object.keys(item.criteria).length > PROVIDER_CHOICE_LIMIT)) {
    // A global winner across independently normalized groups would be a new semantic policy.
    throw new PackingError('packing_limit');
  }
  const questions = Object.fromEntries(batch.questions.map(item => [item.key, {
    type: item.type,
    instructions: { target: item.target, instruction: item.instructions },
    ...('criteria' in item && item.criteria !== undefined ? { criteria: structuredClone(item.criteria) } : {}),
  }])) as Record<string, PackedQuestion>;
  const request: PackedRequest = { model: JEV_MODEL, state: structuredClone(batch.state), questions };
  const stateUpperBound = bytes(request.state);
  const questionBounds = Object.entries(questions).map(([key, value]) => bytes({ [key]: value }));
  const estimate: PackingEstimate = {
    provenance: ESTIMATE_PROVENANCE,
    stateUpperBound,
    longestQuestionUpperBound: Math.max(...questionBounds),
    totalUpperBound: bytes(request),
    responseUpperBound: responseUpperBound(batch),
    projectLimit: PROJECT_TOTAL_TOKEN_UPPER_BOUND,
  };
  if (estimate.totalUpperBound > estimate.projectLimit
    || estimate.stateUpperBound + estimate.longestQuestionUpperBound > estimate.projectLimit) throw new PackingError('packing_limit', estimate);
  return { request, estimate };
}
