/**
 * Conservative Jev packing. UTF-8 JSON bytes are a token upper bound, not a tokenizer result: the vendor does
 * not publish its tokenizer, and a byte-level tokenizer never emits more tokens than bytes.
 */
import { ContractError, isPlainRecord, type DecisionBatch, type DecisionDescriptor, type DecisionQuestion, type Json } from './contracts.ts';

export const JEV_MODEL = 'jev-1.13.0';
export const JEV_VISUAL_MODEL = 'jev-1.14.0';
export const JEV_LONG_CONTEXT_LIMIT = 262_000;
export const JEV_IMAGE_HEADER = 'TypeSafe-Danger-Zone-Images';
export const JEV_LONG_CONTEXT_HEADER = 'TypeSafe-Danger-Zone-Long-Context';
/**
 * Documented jev-1.13 limits (https://docs.typesafe.ai/models): 64k tokens per request, 32k tokens for `state`
 * plus the longest question. "k" is read as 1000 so the bound stays conservative.
 */
export const JEV_REQUEST_TOKEN_LIMIT = 64_000;
export const JEV_STATE_QUESTION_TOKEN_LIMIT = 32_000;
export const PROVIDER_CHOICE_LIMIT = 255;
export const ESTIMATE_PROVENANCE = 'utf8_json_bytes_token_upper_bound' as const;
export const IMAGE_ESTIMATE_PROVENANCE = 'configured_image_context_reservation' as const;

export interface PackedQuestion {
  type: 'choice' | 'noul' | 'score' | 'box';
  instructions: { target: string; instruction: string };
  criteria?: Record<string, DecisionDescriptor> | { true: DecisionDescriptor; false: DecisionDescriptor } | DecisionDescriptor[];
}
export interface PackedRequest { model: string; state: Json; questions: Record<string, PackedQuestion>; assets?: Record<string, {type: 'image'; format: 'png' | 'jpg'; data_base64: string}> }
export interface PackingEstimate {
  provenance: typeof ESTIMATE_PROVENANCE | typeof IMAGE_ESTIMATE_PROVENANCE;
  stateUpperBound: number;
  longestQuestionUpperBound: number;
  totalUpperBound: number;
  responseUpperBound: number;
  requestLimit: number;
  stateQuestionLimit: number;
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
    || typeof value.instructions !== 'string' || !value.instructions || !['choice', 'noul', 'score', 'box'].includes(String(value.type))) return false;
  if (value.type === 'box') return !Object.hasOwn(value, 'criteria');
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
    if (item.type === 'box') return [item.key, {type: 'box', confidence: NUMERIC_PLACEHOLDER,
      box: {left: NUMERIC_PLACEHOLDER, top: NUMERIC_PLACEHOLDER, right: NUMERIC_PLACEHOLDER, bottom: NUMERIC_PLACEHOLDER}}];
    return [item.key, { type: 'score', score: NUMERIC_PLACEHOLDER, confidence: NUMERIC_PLACEHOLDER,
      legend: Object.fromEntries(item.criteria.map((value, index) => [String(index), value])),
      probabilities: Object.fromEntries(item.criteria.map((_, index) => [String(index), NUMERIC_PLACEHOLDER])) }];
  }));
  return bytes({ model: JEV_MODEL, answers, usage: { input_tokens: NUMERIC_PLACEHOLDER, output_tokens: NUMERIC_PLACEHOLDER } });
}

export function packDecisionBatch(batch: DecisionBatch): { request: PackedRequest; estimate: PackingEstimate } {
  if (!isPlainRecord(batch) || !ownKeys(batch, ['id', 'model', 'family', 'familyVersion', 'scope', 'readSet', 'state', 'questions', 'assets', 'longContext'])
    || typeof batch.id !== 'string' || !batch.id || ![JEV_MODEL, JEV_VISUAL_MODEL].includes(batch.model)
    || typeof batch.family !== 'string' || !batch.family || typeof batch.familyVersion !== 'string' || !batch.familyVersion
    || !json(batch.state) || !dense(batch.questions) || !batch.questions.length || !batch.questions.every(question))
    throw new PackingError('schema_error');
  if (batch.longContext !== undefined && typeof batch.longContext !== 'boolean') throw new PackingError('schema_error');
  if (batch.questions.some(item => item.type === 'box') && (batch.model !== JEV_VISUAL_MODEL || !batch.assets)) throw new PackingError('schema_error');
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
  const request: PackedRequest = { model: batch.model, state: structuredClone(batch.state), questions };
  if (batch.assets !== undefined) {
    if (!isPlainRecord(batch.assets) || !Object.keys(batch.assets).length) throw new PackingError('schema_error');
    const content = JSON.stringify([request.state, questions]);
    let references = 0, expanded = Buffer.byteLength(content, 'utf8'), processedImages = 0;
    request.assets = {};
    for (const [key, asset] of Object.entries(batch.assets)) {
      if (!key.trim() || Buffer.byteLength(key, 'utf8') > 1024 || !isPlainRecord(asset)
        || !ownKeys(asset, ['type', 'format', 'data_base64', 'width', 'height']) || asset.type !== 'image'
        || !['png', 'jpg'].includes(asset.format) || typeof asset.data_base64 !== 'string'
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.data_base64)) throw new PackingError('schema_error');
      const image = Buffer.from(asset.data_base64, 'base64'), dimensions = imageDimensions(image, asset.format);
      if (!dimensions || dimensions[0] !== asset.width || dimensions[1] !== asset.height
        || !dimensions.every(n => n >= 256 && n <= 1568) || asset.width * asset.height < 78_400
        || image.length > 16 * 1024 * 1024) throw new PackingError('schema_error');
      // Count only string VALUES, as the API never expands object keys.
      const uses = assetUses([request.state, questions], key);
      if (!uses) throw new PackingError('schema_error');
      references += Buffer.byteLength(key, 'utf8');
      // Reserve uncompressed RGBA as well as file bytes for server re-encoding.
      const processed = Math.max(image.length, asset.width * asset.height * 4);
      processedImages += processed; expanded += processed * uses;
      request.assets[key] = {type: 'image', format: asset.format, data_base64: asset.data_base64};
    }
    const keys = Object.keys(batch.assets);
    if (keys.some((key, at) => keys.some((other, i) => i !== at && other.includes(key)))) throw new PackingError('schema_error');
    if (references > 65_536 || processedImages > 32 * 1024 * 1024 || expanded > 32 * 1024 * 1024
      || bytes(request) > 32 * 1024 * 1024) throw new PackingError('packing_limit');
  }
  const stateUpperBound = bytes(request.state);
  const questionBounds = Object.entries(questions).map(([key, value]) => bytes({ [key]: value }));
  const estimate: PackingEstimate = {
    provenance: batch.assets ? IMAGE_ESTIMATE_PROVENANCE : ESTIMATE_PROVENANCE,
    stateUpperBound,
    longestQuestionUpperBound: Math.max(...questionBounds),
    totalUpperBound: batch.assets ? (batch.longContext ? JEV_LONG_CONTEXT_LIMIT : JEV_REQUEST_TOKEN_LIMIT) : bytes(request),
    responseUpperBound: responseUpperBound(batch),
    requestLimit: batch.longContext ? JEV_LONG_CONTEXT_LIMIT : JEV_REQUEST_TOKEN_LIMIT,
    stateQuestionLimit: batch.longContext ? JEV_LONG_CONTEXT_LIMIT : JEV_STATE_QUESTION_TOKEN_LIMIT,
  };
  if (estimate.totalUpperBound > estimate.requestLimit
    || estimate.stateUpperBound + estimate.longestQuestionUpperBound > estimate.stateQuestionLimit) throw new PackingError('packing_limit', estimate);
  return { request, estimate };
}

function assetUses(value: unknown, key: string): number {
  if (typeof value === 'string') return value.split(key).length - 1;
  if (value && typeof value === 'object') return Object.values(value).reduce<number>((n, child) => n + assetUses(child, key), 0);
  return 0;
}
function imageDimensions(image: Buffer, format: string): [number, number] | undefined {
  if (format === 'png') return image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && image.toString('ascii',12,16) === 'IHDR' ? [image.readUInt32BE(16), image.readUInt32BE(20)] : undefined;
  if (image[0] !== 255 || image[1] !== 216) return;
  for (let at = 2; at + 4 < image.length;) {
    if (image[at++] !== 255) return;
    while (image[at] === 255) at++;
    const marker = image[at++];
    if (marker === 217 || marker === 218) return;
    const length = image.readUInt16BE(at);
    if (length < 2 || at + length > image.length) return;
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8) return;
      return [image.readUInt16BE(at + 5), image.readUInt16BE(at + 3)];
    }
    at += length;
  }
}
