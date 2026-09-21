/** Host revision comparison and receipt-bound advancement; unrelated resources are ignored. */
import { ContractError, isPlainRecord, type ReadSet, type ReadSetKind, type VersionBinding } from './contracts.ts';

const KINDS: readonly ReadSetKind[] = ['source', 'extraction', 'graph', 'adaptation', 'world', 'memory', 'memory_index', 'draft', 'model', 'family'];
function key(binding: Pick<VersionBinding, 'kind' | 'resource'>): string { return JSON.stringify([binding.kind, binding.resource]); }
function index(bindings: ReadSet): Map<string, VersionBinding> {
  if (!Array.isArray(bindings) || Object.keys(bindings).length !== bindings.length) throw new ContractError('invalid_read_set');
  const result = new Map<string, VersionBinding>();
  for (const binding of bindings) {
    if (!isPlainRecord(binding) || Object.keys(binding).some(field => !['kind', 'resource', 'revision'].includes(field))
      || !KINDS.includes(binding.kind) || typeof binding.resource !== 'string' || !binding.resource
      || typeof binding.revision !== 'string' || !binding.revision || result.has(key(binding))) throw new ContractError('invalid_read_set');
    result.set(key(binding), binding);
  }
  return result;
}

export function compareReadSet(captured: ReadSet, current: ReadSet) {
  const wanted = index(captured), observed = index(current);
  const changed = [...wanted].flatMap(([identity, expected]) => {
    const actual = observed.get(identity);
    return actual?.revision === expected.revision ? [] : [{ ...expected, currentRevision: actual?.revision }];
  });
  return { status: changed.length ? 'stale' as const : 'current' as const, changed };
}

export interface ReceiptAdvance {
  operationId: string;
  receiptId: string;
  changes: Array<{ kind: ReadSetKind; resource: string; from?: string; to: string }>;
}
/** Call only with an actual validated owning-operation receipt, never with a model response. */
export function advanceReadSet(captured: ReadSet, receipt: ReceiptAdvance): ReadSet {
  const original = index(captured);
  if (!isPlainRecord(receipt) || Object.keys(receipt).some(field => !['operationId', 'receiptId', 'changes'].includes(field))
    || typeof receipt.operationId !== 'string' || !receipt.operationId || typeof receipt.receiptId !== 'string' || !receipt.receiptId
    || !Array.isArray(receipt.changes) || !receipt.changes.length || Object.keys(receipt.changes).length !== receipt.changes.length
    || receipt.changes.some(change => !isPlainRecord(change) || Object.keys(change).some(field => !['kind', 'resource', 'from', 'to'].includes(field))
      || change.from !== undefined && (typeof change.from !== 'string' || !change.from))) throw new ContractError('invalid_receipt_advance');
  const changes = index(receipt.changes.map(change => ({ kind: change.kind, resource: change.resource, revision: change.to })));
  for (const change of receipt.changes) if (original.get(key(change))?.revision !== change.from) throw new ContractError('stale_receipt_advance');
  return structuredClone([...new Map([...original, ...changes]).values()]);
}

/** Exact private authority for one pending mutation's source-owner publication. */
export interface SourcePreparationAuthority {
  version:1;owner:'module-reading';token:string;taskId:string;rootId:string;operationId:string;callId:string;
  campaign:string;moduleId:string;scope:import('./contracts.ts').ScopeBinding;turn:number;from:string;
}
export interface SourcePublicationExpectation extends SourcePreparationAuthority {publicationId:string;jobId:string;lease:string}
export interface SourcePublicationAdvance extends SourcePreparationAuthority {
  publicationId:string;jobId:string;lease:string;to:string;
}
const SOURCE_AUTHORITY_KEYS=['version','owner','token','taskId','rootId','operationId','callId','campaign','moduleId','scope','turn','from'];
export function assertSourcePreparationAuthority(value:unknown):asserts value is SourcePreparationAuthority {
  if(!isPlainRecord(value)||Object.keys(value).some(key=>!SOURCE_AUTHORITY_KEYS.includes(key))
    ||SOURCE_AUTHORITY_KEYS.some(key=>!Object.hasOwn(value,key))||value.version!==1||value.owner!=='module-reading'
    ||['token','taskId','rootId','operationId','callId','campaign','moduleId','from'].some(key=>typeof value[key]!=='string'||!value[key])
    ||!Number.isSafeInteger(value.turn)||Number(value.turn)<0||!/^t[0-9]+-c[0-9]+$/.test(String(value.callId))
    ||Number(/^t([0-9]+)-c/.exec(String(value.callId))?.[1])!==value.turn
    ||!isPlainRecord(value.scope)||Object.keys(value.scope).some(key=>!['owner','campaign','worldline','loop','audience'].includes(key))
    ||typeof value.scope.owner!=='string'||!value.scope.owner||value.scope.campaign!==value.campaign||value.scope.audience!=='keeper'
    ||typeof value.scope.worldline!=='string'||!value.scope.worldline||!Number.isSafeInteger(value.scope.loop)||Number(value.scope.loop)<0)
    throw new ContractError('invalid_source_preparation_authority');
}
export function sourceAdvanceAuthority(value:SourcePreparationAuthority):SourcePreparationAuthority {
  return Object.fromEntries(SOURCE_AUTHORITY_KEYS.map(key=>[key,(value as any)[key]])) as unknown as SourcePreparationAuthority;
}
export function assertSourcePublicationAdvance(value:unknown):asserts value is SourcePublicationAdvance {
  if(!isPlainRecord(value)||Object.keys(value).some(key=>![...SOURCE_AUTHORITY_KEYS,'publicationId','jobId','lease','to'].includes(key))
    ||['publicationId','jobId','lease','to'].some(key=>typeof value[key]!=='string'||!value[key])) throw new ContractError('invalid_source_publication_advance');
  assertSourcePreparationAuthority(sourceAdvanceAuthority(value as unknown as SourcePublicationAdvance));
  if(value.from===value.to) throw new ContractError('invalid_source_publication_advance');
}
export function advanceSourceReadSet(captured:ReadSet,advance:SourcePublicationAdvance,expected:SourcePublicationExpectation):ReadSet {
  assertSourcePublicationAdvance(advance);
  if(!isPlainRecord(expected)||Object.keys(expected).some(key=>![...SOURCE_AUTHORITY_KEYS,'publicationId','jobId','lease'].includes(key)))throw new ContractError('invalid_source_publication_expectation');
  assertSourcePreparationAuthority(sourceAdvanceAuthority(expected));
  if(['publicationId','jobId','lease'].some(key=>typeof (expected as any)[key]!=='string'||!(expected as any)[key]||(advance as any)[key]!==(expected as any)[key]))throw new ContractError('source_publication_owner_mismatch');
  const actual=sourceAdvanceAuthority(advance);
  for(const field of SOURCE_AUTHORITY_KEYS) if(field==='scope'
    ? ['owner','campaign','worldline','loop','audience'].some(key=>(actual.scope as any)[key]!==(expected.scope as any)[key])
    : (actual as any)[field]!==(expected as any)[field]) throw new ContractError('source_preparation_authority_mismatch');
  const bindings=index(captured),identity=key({kind:'source',resource:advance.campaign}),before=bindings.get(identity);
  if(!before||before.revision!==advance.from) throw new ContractError('stale_source_publication_advance');
  bindings.set(identity,{...before,revision:advance.to});return structuredClone([...bindings.values()]);
}
