/** Reference-first memory write policy. Kernel owners validate and publish every result. */
import { isDeepStrictEqual } from 'node:util';
import { ContractError, isPlainRecord, type DecisionBatch, type DecisionDescriptor, type Json, type SourceRef } from './contracts.ts';
import { assertSourceRef } from './source-ref.ts';
import type { TaskDomain, TaskStep, TaskView } from './task-runtime.ts';
import { JEV_MODEL, packDecisionBatch } from './question-packing.ts';
import {TaskLease} from './task-context.ts';
import type {DecisionPort} from './decision-port.ts';

export const MEMORY_WRITE_CAPABILITY = 'memory.write';
export const MEMORY_WRITE_KINDS = ['world_event', 'knowledge', 'belief', 'relationship', 'player_assertion',
  'player_preference', 'keeper_correction', 'promise'] as const;
export const MEMORY_RELATIONS = ['duplicate', 'reinforcement', 'independent', 'correction', 'contradiction', 'temporal_change'] as const;
export const MEMORY_WRITE_POLICY_VERSION = '5';
const MAX_DECISION_BYTES = 30_000;

type Kind = typeof MEMORY_WRITE_KINDS[number];
type AttributionKind = 'player' | 'keeper_narration' | 'speech' | 'mixed' | 'unknown';
type AttributionSpeakerKind = 'npc' | 'investigator' | 'label';
type Attribution = { kind: AttributionKind; speaker?: {name: string; kind: AttributionSpeakerKind} };
interface Segment { alias: string; role: 'player' | 'keeper'; text: string; ref: SourceRef; attribution?: Attribution }
interface Known { alias: string; name: string; kind: string }
interface Prior { alias: string; kind: string; subject: string; statement: string; status: string;
  authority: 'conversation_report'; attribution: Attribution }
interface Packet {
  protocol: 'memory-reference-v1'; job_id: string; turn: number; commit: string; status: 'open' | 'pending' | 'done';
  origin: { scope: TaskView['context']['scope']; revision: string };
  step: { key: string; sequence: number; total: number; remaining: number; segments: Segment[] };
  known_entities: Known[]; prior: Prior[]; prior_coverage: {total: number; included: number; omitted: number};
  story_context?: Json; story_sources: Segment[]; story_complete: boolean; result?: Json;
}
interface Publication { status: 'open' | 'pending' | 'done'; remaining: number; next?: Packet }

const packetKeys = ['protocol', 'job_id', 'turn', 'commit', 'status', 'origin', 'step', 'known_entities', 'prior', 'prior_coverage',
  'story_context', 'story_sources', 'story_complete', 'result'];
const reservedNames: Known[] = ['world', 'party', 'keeper', 'player'].map((name, index) => ({alias: `reserved:${index}`, name, kind: 'reserved'}));
const UNCERTAIN_ATTRIBUTION = 'uncertain_attribution';
const NO_ANNOTATION = 'no_annotation';
const KIND_DEFINITIONS: Record<Kind, string> = {
  world_event: 'A durable event or changed condition in the shared fiction; not a speaker\'s knowledge, belief, preference, correction, or promise.',
  knowledge: 'A durable proposition known in fiction by one or more issued knowers; attribution to a knower is required.',
  belief: 'An attributed in-fiction epistemic stance that may be accurate, uncertain, or distorted; an out-of-character preference or instruction is not a belief.',
  relationship: 'A durable directed in-fiction relationship: the subject is the person whose view or cooperation toward exactly one other issued person is established or changed. Preserve the specific shared event or explicit stance; courtesy alone is insufficient, a promise is not its fulfillment, and the reverse person\'s feelings are not implied.',
  player_assertion: 'A durable player claim about the fiction, character, or campaign state; an out-of-character play or style preference is not an additional assertion merely because the player stated it.',
  player_preference: 'An explicit out-of-character preference about play style, pacing, boundaries, or how the Keeper should interact.',
  keeper_correction: 'An explicit Keeper correction or retraction of a prior durable claim, linked only to the occurrence it corrects.',
  promise: 'An in-fiction commitment by the subject to do, provide, avoid, or preserve something.',
};
const RELATION_DEFINITIONS: Record<'none' | typeof MEMORY_RELATIONS[number], string> = {
  none: 'No semantic relation: the occurrences concern unrelated propositions, relations, or commitments.',
  duplicate: 'The same proposition is repeated without meaningful new confirmation, correction, or temporal change.',
  reinforcement: 'The same proposition receives new confirmation or support; a shared topic alone is insufficient.',
  independent: 'A distinct proposition about the same relation or commitment should coexist with the prior occurrence; an unrelated proposition is none.',
  correction: 'The new occurrence explicitly corrects or retracts the prior occurrence.',
  contradiction: 'The new occurrence asserts a proposition incompatible with the prior occurrence without framing it as a later state change.',
  temporal_change: 'The new occurrence describes a later state replacing or changing the prior state while preserving both points in time. For a prior non-material promise, actual delivery of the promised answer or information, or an explicit terminal refusal or withdrawal, can settle that commitment even when the new annotation has another kind. A repeated pledge, a mere attempt, another referral, or saying the work is done without its promised result does not settle it. Speech alone never proves a cash, item or object transfer; those require canonical effects.',
};
const MULTI_KIND_POLICY = 'Select multiple kinds only when the exact source independently supports distinct durable propositions for those kinds. Do not multiply one proposition across categories: a player preference is not also a belief or player assertion merely because the player stated it.';
const q = (key: string, target: string, instructions: string, criteria: Record<string, DecisionDescriptor>): DecisionBatch['questions'][number] =>
  ({key, target, instructions, type: 'choice', criteria});
const yesNo = {yes: 'Include this issued annotation.', no: 'Do not include this annotation.'};
const membership = {yes: 'This exact issued name has the stated role in the annotation.', no: 'This exact issued name does not have the stated role in the annotation.',
  [UNCERTAIN_ATTRIBUTION]: 'The exact source does not support deciding this attribution safely.'};

function fail(code = 'invalid_memory_reference_packet'): never { throw new ContractError(code); }
function dense(value: unknown): value is unknown[] { return Array.isArray(value) && Object.keys(value).length === value.length; }
function only(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function attribution(value: unknown): Attribution {
  if (!isPlainRecord(value) || !only(value, ['kind', 'speaker'])
    || !['player', 'keeper_narration', 'speech', 'mixed', 'unknown'].includes(String(value.kind))) fail();
  if (value.speaker === undefined) return {kind: value.kind as AttributionKind};
  if (!isPlainRecord(value.speaker) || !only(value.speaker, ['name', 'kind']) || Object.keys(value.speaker).length !== 2
    || !text(value.speaker.name) || value.speaker.name !== value.speaker.name.trim()
    || !['npc', 'investigator', 'label'].includes(String(value.speaker.kind))) fail();
  return {kind: value.kind as AttributionKind, speaker: {name: value.speaker.name, kind: value.speaker.kind as AttributionSpeakerKind}};
}
function segment(value: unknown, scope: TaskView['context']['scope']): Segment {
  if (!isPlainRecord(value) || !only(value, ['alias', 'role', 'text', 'ref', 'attribution']) || !text(value.alias)
    || !['player', 'keeper'].includes(String(value.role)) || typeof value.text !== 'string') fail();
  assertSourceRef(value.ref);
  if (!isDeepStrictEqual(value.ref.scope, scope)) fail('memory_source_scope_mismatch');
  const parsedAttribution = value.attribution === undefined ? undefined : attribution(value.attribution);
  if (parsedAttribution && (value.role === 'player' && parsedAttribution.kind !== 'player'
    || value.role === 'keeper' && parsedAttribution.kind === 'player')) fail();
  return {alias: value.alias, role: value.role as Segment['role'], text: value.text, ref: structuredClone(value.ref),
    ...(parsedAttribution ? {attribution: parsedAttribution} : {})};
}
function known(value: unknown, index: number): Known {
  if (!isPlainRecord(value) || !only(value, ['alias', 'name', 'kind']) || !text(value.name) || !text(value.kind)
    || value.alias !== undefined && !text(value.alias)) fail();
  return {alias: text(value.alias) ? value.alias : `name:${index}`, name: value.name, kind: value.kind};
}
function prior(value: unknown): Prior {
  if (!isPlainRecord(value) || !only(value, ['alias', 'kind', 'subject', 'statement', 'status', 'authority', 'attribution'])
    || ![value.alias, value.kind, value.subject, value.statement, value.status].every(text)
    || value.authority !== undefined && value.authority !== 'conversation_report') fail();
  return {alias: value.alias as string, kind: value.kind as string, subject: value.subject as string,
    statement: value.statement as string, status: value.status as string, authority: 'conversation_report',
    attribution: value.attribution === undefined ? {kind: 'unknown'} : attribution(value.attribution)};
}
function parsePacket(value: unknown, view: {context:Pick<TaskView['context'],'scope'>}): Packet {
  if (!isPlainRecord(value) || !only(value, packetKeys) || value.protocol !== 'memory-reference-v1'
    || !text(value.job_id) || !integer(value.turn) || !text(value.commit) || !['open', 'pending', 'done'].includes(String(value.status))
    || !isPlainRecord(value.origin) || !only(value.origin, ['scope', 'revision']) || !text(value.origin.revision)
    || !isDeepStrictEqual(value.origin.scope, view.context.scope) || !isPlainRecord(value.step)
    || !only(value.step, ['key', 'sequence', 'total', 'remaining', 'segments']) || !text(value.step.key)
    || !integer(value.step.sequence) || !integer(value.step.total) || !integer(value.step.remaining)
    || value.step.remaining > value.step.total
    || !dense(value.step.segments) || value.step.segments.length > 12 || value.status === 'open' && !value.step.segments.length
    || value.step.segments.length > value.step.remaining
    || !dense(value.known_entities) || !dense(value.prior) || !dense(value.story_sources) || !isPlainRecord(value.prior_coverage)
    || !only(value.prior_coverage, ['total', 'included', 'omitted']) || !integer(value.prior_coverage.total)
    || !integer(value.prior_coverage.included) || !integer(value.prior_coverage.omitted)
    || value.prior_coverage.included + value.prior_coverage.omitted !== value.prior_coverage.total
    || typeof value.story_complete !== 'boolean'
    || value.story_context !== undefined && !json(value.story_context) || value.result !== undefined && !json(value.result)) fail();
  const segments = value.step.segments.map(item => segment(item, view.context.scope));
  const storySources = value.story_sources.map(item => segment(item, view.context.scope));
  const names = value.known_entities.map(known), priors = value.prior.map(prior);
  for (const rows of [segments, storySources, names, priors]) if (new Set(rows.map(row => row.alias)).size !== rows.length) fail();
  const hostAliases = new Set([...reservedNames.map(row => row.alias), UNCERTAIN_ATTRIBUTION]);
  if (names.some(row => hostAliases.has(row.alias))) fail();
  return {protocol: 'memory-reference-v1', job_id: value.job_id, turn: value.turn, commit: value.commit, status: value.status as Packet['status'],
    origin: structuredClone(value.origin) as Packet['origin'], step: {key: value.step.key as string, sequence: value.step.sequence as number,
      total: value.step.total as number, remaining: value.step.remaining as number, segments},
    known_entities: names, prior: priors, prior_coverage: structuredClone(value.prior_coverage) as Packet['prior_coverage'],
    ...(value.story_context !== undefined ? {story_context: structuredClone(value.story_context) as Json} : {}),
    story_sources: storySources, story_complete: value.story_complete,
    ...(value.result !== undefined ? {result: structuredClone(value.result) as Json} : {})};
}
function json(value: unknown, seen = new Set<object>()): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value) ? Object.keys(value).length === value.length && value.every(child => json(child, seen))
    : isPlainRecord(value) && Object.values(value).every(child => json(child, seen));
  seen.delete(value); return valid;
}
function semantic(value: Json): Json {
  if (Array.isArray(value)) return value.map(semantic);
  if (!isPlainRecord(value)) return value;
  const hidden = new Set(['id', 'job_id', 'commit', 'revision', 'ref', 'refs', 'source_refs', 'step', 'key', 'hash', 'digest']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !hidden.has(key)).map(([key, child]) => [key, semantic(child as Json)]));
}
function batch(family: string, state: Json, questions: DecisionBatch['questions']): Omit<DecisionBatch, 'id' | 'scope' | 'readSet'> {
  return {model: JEV_MODEL, family, familyVersion: MEMORY_WRITE_POLICY_VERSION, state, questions};
}
function fits(value: Omit<DecisionBatch, 'id' | 'scope' | 'readSet'>): boolean {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_DECISION_BYTES;
}
function decision(view: Pick<TaskView,'decisions'>, key: string) { return view.decisions.find(row => row.key === key); }
function choice(view: Pick<TaskView,'decisions'>, row: string, question: string): string | undefined {
  const answer = decision(view, row)?.result.answers[question];
  return answer?.status === 'answered' && answer.type === 'choice' ? answer.choice : undefined;
}
function operation(name: string, key: string, args: Record<string, Json>, basis: SourceRef[] = []): TaskStep {
  return {kind: 'operation', key, operation: name, args, capability: MEMORY_WRITE_CAPABILITY, basis};
}
function finish(status: 'complete' | 'partial' | 'unresolved', needs: string[] = []): TaskStep {
  return {kind: 'finish', status, remainingNeeds: needs};
}
function latest(view: TaskView, operationName: string) {
  return view.observations.findLast(row => row.proposal.operation === operationName);
}
function publication(value: unknown, view: TaskView): Publication {
  if (!isPlainRecord(value) || !only(value, ['job_id', 'turn', 'status', 'remaining', 'candidates', 'written', 'superseded', 'story', 'replayed', 'next'])
    || !text(value.job_id) || !integer(value.turn) || !['open', 'pending', 'done'].includes(String(value.status))
    || !integer(value.remaining) || !integer(value.candidates) || !dense(value.written) || !value.written.every(text)
    || !dense(value.superseded) || !value.superseded.every(text) || !isPlainRecord(value.next)
    || value.story !== undefined && !json(value.story) || value.replayed !== undefined && typeof value.replayed !== 'boolean'
    || value.status === 'done' && value.remaining !== 0) fail('invalid_memory_publication_result');
  return {status: value.status as Publication['status'], remaining: value.remaining,
    ...(value.status === 'open' ? {next: parsePacket(value.next, view)} : {})};
}
function currentPacket(view: TaskView): {packet?: Packet; result?: Publication} {
  const submitted = latest(view, 'memory.submit');
  if (submitted) {
    const result = publication(submitted.packet.result, view);
    return {result, ...(result.next ? {packet: result.next} : {})};
  }
  const job = latest(view, 'memory.job');
  if (!job) return {};
  if (isPlainRecord(job.packet.result) && job.packet.result.protocol === 'memory-reference-v1') return {packet: parsePacket(job.packet.result, view)};
  const result = publication(job.packet.result, view);
  return {result, ...(result.next ? {packet: result.next} : {})};
}
function nameCatalog(packet: Packet): Known[] {
  const result = [...packet.known_entities], present = new Set(result.map(row => row.name));
  for (const row of reservedNames) if (!present.has(row.name)) result.push(row);
  return result;
}
function subjectCatalog(packet: Packet, kind: Kind): Known[] {
  if (kind === 'world_event') return reservedNames.filter(row => row.name === 'world');
  if (['player_assertion', 'player_preference'].includes(kind)) return reservedNames.filter(row => row.name === 'player');
  if (kind === 'promise') return [...packet.known_entities.filter(row=>row.kind==='npc'||row.kind==='investigator'), ...reservedNames.filter(row=>row.name==='party')];
  return nameCatalog(packet);
}
function knowerCatalog(packet: Packet): Known[] {
  return [...packet.known_entities.filter(row=>row.kind==='npc'||row.kind==='investigator'), ...reservedNames.filter(row => ['party', 'keeper', 'player'].includes(row.name))];
}
function entityCatalog(packet: Packet): Known[] { return packet.known_entities; }
function issuedNameCatalog(packet: Packet): Json[] {
  const subjectAliases = new Set(nameCatalog(packet).map(row => row.alias).concat(reservedNames.map(row => row.alias)));
  const knowerAliases = new Set(knowerCatalog(packet).map(row => row.alias));
  const entityAliases = new Set(entityCatalog(packet).map(row => row.alias));
  const names = [...packet.known_entities, ...reservedNames].filter((row, index, rows) => rows.findIndex(other => other.alias === row.alias) === index);
  return names.map(row => ({alias: row.alias, name: row.name, kind: row.kind, eligibleAs: [
    ...(subjectAliases.has(row.alias) ? ['subject'] : []), ...(knowerAliases.has(row.alias) ? ['knower'] : []),
    ...(entityAliases.has(row.alias) ? ['entity'] : []),
  ]}));
}
function sourceAttribution(segment: Segment): Attribution { return structuredClone(segment.attribution ?? {kind: 'unknown'}); }
function attributionState(value: Attribution): Json {
  return {kind: value.kind, ...(value.speaker ? {speaker: {name: value.speaker.name, kind: value.speaker.kind}} : {})};
}
function sourceState(segment: Segment): Json {
  const value = sourceAttribution(segment);
  return {alias: segment.alias, role: segment.role, text: segment.text, attribution: attributionState(value)};
}
function worldEventEligible(segment: Segment): boolean {
  return segment.role === 'keeper' && sourceAttribution(segment).kind === 'keeper_narration';
}
function segmentState(packet: Packet, segment: Segment): Json {
  return {source: sourceState(segment),
    knownNames: issuedNameCatalog(packet), kindDefinitions: KIND_DEFINITIONS, relationDefinitions: RELATION_DEFINITIONS,
    classificationPolicy: MULTI_KIND_POLICY,
    prior: packet.prior.map(row => ({alias: row.alias, kind: row.kind, subject: row.subject, statement: row.statement,
      status: row.status, authority: row.authority, attribution: attributionState(row.attribution)})),
    priorCoverage: packet.prior_coverage};
}
function retainBatch(packet: Packet): Omit<DecisionBatch, 'id' | 'scope' | 'readSet'> {
  return batch('memory-write-retain', {sources: packet.step.segments.map(sourceState)},
    packet.step.segments.map((row, index) => q(`retain_${index}`, row.alias,
      'Classify this exact committed source segment. Retain only durable information; skip non-memory prose; defer whenever context or attribution is insufficient.',
      {retain: 'Contains one or more durable memory annotations.', skip: 'Contains no durable memory annotation.', defer: 'Cannot classify safely from issued context.'})));
}
function kindBatch(packet: Packet, segment: Segment, index: number): Omit<DecisionBatch, 'id' | 'scope' | 'readSet'> {
  return batch('memory-write-kinds', segmentState(packet, segment), MEMORY_WRITE_KINDS.map((kind, kindIndex) =>
    q(`kind_${index}_${kindIndex}`, `${segment.alias} ${kind}`, `${KIND_DEFINITIONS[kind]} ${MULTI_KIND_POLICY}`,
      kind === 'world_event' && !worldEventEligible(segment)
        ? {no: 'Host attribution does not identify this exact source as Keeper narration, so it cannot be unqualified world truth.'}
        : {yes: `The exact source independently supports this definition: ${KIND_DEFINITIONS[kind]}`, no: `The exact source does not support this definition: ${KIND_DEFINITIONS[kind]}`})));
}
function annotationQuestions(packet: Packet, segment: Segment, index: number, kind: Kind, kindIndex: number): DecisionBatch['questions'] {
  const subjects = subjectCatalog(packet, kind), knowers = knowerCatalog(packet), entities = entityCatalog(packet);
  const questions: DecisionBatch['questions'] = [
    q(`subject_${index}_${kindIndex}`, `${segment.alias} ${kind} subject`, kind==='promise'
      ? 'First distinguish an actual in-fiction commitment from a plan or intention. Select no_annotation if the exact source does not make an actual promise. Otherwise select the issued promisor; select uncertain_attribution only if a real commitment exists but its owner cannot be identified. The message author need not be the fictional promisor; use the surrounding exchange for quoted or reported speech.'
      : 'Select the issued semantic name that owns this annotation. For relationship, choose the person whose view of the other person is described, not automatically the person who performed an action. Choose uncertainty when the exact source does not support attribution.',
      {...Object.fromEntries(subjects.map(row => [row.alias, {name: row.name, kind: row.kind}])),
        ...(kind==='promise'?{[NO_ANNOTATION]:'The source contains a plan, intention, question or other material but no actual in-fiction commitment.'}:{}),
        [UNCERTAIN_ATTRIBUTION]: 'The exact source does not support assigning an issued subject safely.'}),
    q(`privacy_${index}_${kindIndex}`, `${segment.alias} ${kind} audience`, 'Classify the minimum safe audience.',
      {player_safe: 'Safe for player-visible memory.', keeper_only: 'Keeper-private memory.'}),
    q(`state_${index}_${kindIndex}`, `${segment.alias} ${kind} epistemic state`, 'Classify attribution certainty without promoting a report to source truth.',
      {accurate: 'Accurate report of the committed conversation.', uncertain: 'Explicitly uncertain or unresolved.', distorted: 'Attributed distortion or false belief.'}),
  ];
  knowers.forEach((name, nameIndex) => questions.push(q(`knower_${index}_${kindIndex}_${nameIndex}`,
    `${segment.alias} ${kind} knower ${name.alias}`, 'Classify this issued knower attribution from the exact source; choose uncertainty instead of guessing.', membership)));
  entities.forEach((name, nameIndex) => questions.push(q(`entity_${index}_${kindIndex}_${nameIndex}`,
    `${segment.alias} ${kind} entity ${name.alias}`, 'Classify this issued entity attribution from the exact source; choose uncertainty instead of guessing.', membership)));
  packet.prior.forEach((row, priorIndex) => questions.push(q(`relation_${index}_${kindIndex}_${priorIndex}`,
    `${segment.alias} ${kind} relation ${row.alias}`, 'Compare exact propositions. Choose none for unrelated occurrences and uncertainty when the issued evidence cannot support a relation.',
    {...RELATION_DEFINITIONS, [UNCERTAIN_ATTRIBUTION]: 'The issued evidence does not support classifying this occurrence pair safely.'})));
  return questions;
}
interface AnnotationGroup { key: string; kind: Kind; kindIndex: number; batch: Omit<DecisionBatch, 'id' | 'scope' | 'readSet'> }
function annotationGroups(packet: Packet, segment: Segment, index: number, kinds: Kind[]): {groups: AnnotationGroup[]; oversized: boolean} {
  const groups: AnnotationGroup[] = [], state = segmentState(packet, segment);
  if (!fits(batch('memory-write-annotations', state, []))) return {groups, oversized: true};
  for (let kindIndex = 0; kindIndex < kinds.length; kindIndex++) {
    const kind = kinds[kindIndex], questions = annotationQuestions(packet, segment, index, kind, kindIndex);
    let chunk: DecisionBatch['questions'] = [], part = 0;
    const append = () => {
      if (!chunk.length) return true;
      const value = batch('memory-write-annotations', state, chunk);
      if (!fits(value)) return false;
      groups.push({key: `memory-annotations:${packet.step.sequence}:${index}:${kindIndex}:${part++}`, kind, kindIndex, batch: value});
      chunk = []; return true;
    };
    for (const question of questions) {
      const candidate = [...chunk, question];
      if (chunk.length && !fits(batch('memory-write-annotations', state, candidate)) && !append()) return {groups: [], oversized: true};
      chunk.push(question);
      if (!fits(batch('memory-write-annotations', state, chunk))) return {groups: [], oversized: true};
    }
    if (!append()) return {groups: [], oversized: true};
  }
  return {groups, oversized: false};
}
function storyBatch(packet: Packet): Omit<DecisionBatch, 'id' | 'scope' | 'readSet'> {
  const context = semantic(packet.story_context!);
  const rows = isPlainRecord(context) && Array.isArray(context.threads) ? context.threads : [];
  const threads = Object.fromEntries(rows.map((row, index) => [isPlainRecord(row) && text(row.alias) ? row.alias : `thread:${index}`, row as Json]));
  const player = packet.story_sources.filter(row => row.role === 'player'), keeper = packet.story_sources.filter(row => row.role === 'keeper');
  return batch('memory-write-story', {context, sources: packet.story_sources.map(sourceState)}, [
    q('story_status', 'story assessment status', 'Assess only the supplied acquired-evidence context.',
      {aligned: 'Aligned with an acquired-evidence causal thread.', unclear: 'No reliable causal frame.', misframed: 'Explicit frame conflicts with acquired evidence.', detached: 'Chosen direction lacks a visible path to the selected thread.'}),
    q('story_thread', 'story thread alias', 'Select an issued thread alias, or none for unclear.', {none: 'No thread.', ...threads}),
    q('frame_source', 'player frame source alias', 'Select the exact player source containing the frame, or none.',
      {none: 'No frame source.', ...Object.fromEntries(player.map(row => [row.alias, {role: row.role, text: row.text}]))}),
    q('bridge_delivered', 'bridge delivery status', 'Select yes only when the Keeper source explicitly delivered the acquired-evidence bridge.', yesNo),
    q('delivery_source', 'Keeper delivery source alias', 'Select the exact Keeper source containing the delivered bridge, or none.',
      {none: 'No delivery source.', ...Object.fromEntries(keeper.map(row => [row.alias, {role: row.role, text: row.text}]))}),
  ]);
}
function kindsFor(view: Pick<TaskView,'decisions'>, packet: Packet, index: number): Kind[] | undefined {
  const row = decision(view, `memory-kinds:${packet.step.sequence}:${index}`);
  if (!row) return undefined;
  const answers = MEMORY_WRITE_KINDS.map((_, kindIndex) => choice(view, row.key, `kind_${index}_${kindIndex}`));
  if (!worldEventEligible(packet.step.segments[index]) && answers[0] !== 'no') return undefined;
  if (answers.some(value => !['yes', 'no'].includes(value ?? ''))) return undefined;
  return MEMORY_WRITE_KINDS.filter((kind, kindIndex) => answers[kindIndex] === 'yes'
    && (kind !== 'world_event' || worldEventEligible(packet.step.segments[index])));
}
function annotationFor(view: Pick<TaskView,'decisions'>, packet: Packet, index: number, kind: Kind, kindIndex: number, groups: AnnotationGroup[]): Json | undefined {
  if (!groups.length || groups.some(group => !decision(view, group.key))) return undefined;
  const selected = (question: string) => groups.map(group => choice(view, group.key, question)).find(value => value !== undefined);
  const subjects = subjectCatalog(packet, kind), knowersCatalog = knowerCatalog(packet), entitiesCatalog = entityCatalog(packet);
  const subjectAlias = selected(`subject_${index}_${kindIndex}`), subject = subjects.find(name => name.alias === subjectAlias);
  if(kind==='promise'&&subjectAlias===NO_ANNOTATION)return null;
  const privacy = selected(`privacy_${index}_${kindIndex}`), state = selected(`state_${index}_${kindIndex}`);
    if (!subject || !['player_safe', 'keeper_only'].includes(privacy ?? '') || !['accurate', 'uncertain', 'distorted'].includes(state ?? '')) return undefined;
    const knowers: string[] = [], entities: string[] = [], relations: Json[] = [];
    for (let nameIndex = 0; nameIndex < knowersCatalog.length; nameIndex++) {
      const knower = selected(`knower_${index}_${kindIndex}_${nameIndex}`);
      if (!['yes', 'no'].includes(knower ?? '')) return undefined;
      if (knower === 'yes') knowers.push(knowersCatalog[nameIndex].name);
    }
    for (let nameIndex = 0; nameIndex < entitiesCatalog.length; nameIndex++) {
      const entity = selected(`entity_${index}_${kindIndex}_${nameIndex}`);
      if (!['yes', 'no'].includes(entity ?? '')) return undefined;
      if (entity === 'yes') entities.push(entitiesCatalog[nameIndex].name);
    }
    if (kind === 'relationship' && entities.length !== 1) return undefined;
    for (let priorIndex = 0; priorIndex < packet.prior.length; priorIndex++) {
      const relation = selected(`relation_${index}_${kindIndex}_${priorIndex}`);
      if (!relation || !['none', ...MEMORY_RELATIONS].includes(relation as any)) return undefined;
      if (relation !== 'none') {
        if (relation === 'correction' && kind !== 'keeper_correction') return undefined;
        relations.push({relation, target: packet.prior[priorIndex].alias});
      }
    }
  return {kind, subject: subject.name, ...(knowers.length ? {knowers} : {}), ...(entities.length ? {entities} : {}),
    privacy: privacy as Json, state: state as Json, ...(relations.length ? {relations} : {})};
}
function storyFor(view: TaskView, packet: Packet): Json | undefined {
  if (packet.story_complete || packet.story_context === undefined) return null;
  const key = `memory-story:${packet.step.sequence}`;
  if (!decision(view, key)) return undefined;
  const status = choice(view, key, 'story_status'), thread = choice(view, key, 'story_thread'), frame = choice(view, key, 'frame_source'),
    bridge = choice(view, key, 'bridge_delivered'), delivery = choice(view, key, 'delivery_source');
  if (!['aligned', 'unclear', 'misframed', 'detached'].includes(status ?? '') || !['yes', 'no'].includes(bridge ?? '')) return undefined;
  if (status === 'unclear') return {status, thread: null, frame_source: null, bridge_delivered: false, delivery_source: null};
  if (!thread || thread === 'none' || !frame || frame === 'none') return undefined;
  const context = semantic(packet.story_context!), rows = isPlainRecord(context) && Array.isArray(context.threads) ? context.threads : [];
  const actualThread = rows.map((row, index) => ({alias: isPlainRecord(row) && text(row.alias) ? row.alias : `thread:${index}`,
    name: isPlainRecord(row) && text(row.thread) ? row.thread : undefined})).find(row => row.alias === thread)?.name;
  if (!actualThread) return undefined;
  if (bridge === 'yes' && (!delivery || delivery === 'none')) return undefined;
  return {status: status as Json, thread: actualThread, frame_source: frame, bridge_delivered: bridge === 'yes', delivery_source: bridge === 'yes' ? delivery! : null};
}

/** Native Pi consumes exact source annotations without an author or TaskHost. */
export async function decideReferencedMemoryStep(value: unknown, port: DecisionPort, signal: AbortSignal,
 record: (row: Record<string, unknown>) => Promise<void>, options: {longContext?: boolean} = {}): Promise<{step: string; decisions: Json[]}> {
 const raw = value as Packet, packet = parsePacket(value, {context: {scope: raw.origin.scope}});
 const view: Pick<TaskView, 'decisions'> = {decisions: []};
 const sample = packet.step.segments[0], shared = sample ? segmentState(packet, sample) : {};
 const {source: _source, prior: _prior, priorCoverage: _coverage, ...common} = shared as Record<string, Json>;
 const base = {...common, exchange: packet.story_sources.length ? packet.story_sources.map(sourceState) : packet.step.segments.map(sourceState),
  annotationPolicy: 'Use the exact source alias in target within exchange, with its surrounding dialogue. Context may establish speaker and hearer; a report never becomes unqualified world truth. Attribute only supported roles. Compare the recorded propositions, not their objective truth. Unknown provenance of a prior report alone does not prevent comparing its recorded wording. Shared topic alone is not a relation. Use uncertainty only when the proposition or attribution needed for this question cannot be determined. Apply every relationDefinitions restriction, including all promise-fulfillment gates.'};
 const version = MEMORY_WRITE_POLICY_VERSION + '-native-10';
 type Group = {key: string; batch: Omit<DecisionBatch, 'id' | 'scope' | 'readSet'>};
 const compact = (question: DecisionBatch['questions'][number]): DecisionBatch['questions'][number] => {
  if (question.type !== 'choice') return question;
  if (question.key.startsWith('kind_')) {
   if (Object.keys(question.criteria!).length === 1) return question;
   return {...question, instructions: 'Apply classificationPolicy. Does the exact source independently support a durable annotation of the kind in target, as defined in kindDefinitions?',
    criteria: {yes: `The exact source supports: ${KIND_DEFINITIONS[question.target.split(' ').at(-1) as Kind]}${question.target.endsWith(' knowledge') ? ' Practical facts and instructions newly supplied in dialogue count as knowledge of the speaker and recipient; the source need not explicitly use a word meaning knows.' : ''}`, no: `The exact source does not support: ${KIND_DEFINITIONS[question.target.split(' ').at(-1) as Kind]}`,
     [UNCERTAIN_ATTRIBUTION]: 'Insufficient context to determine whether this kind is supported.'}};
  }
  if (question.key.startsWith('subject_')) {
   const kind = question.target.split(' ').at(-2) as Kind;
   if (kind === 'knowledge') return {...question,
    instructions: 'Select the focal supported knower of this proposition. Knowledge belongs to a person who knows or reports it, not the owner of the object, building, document or service being described. For attributed dialogue, prefer its reporting speaker when supported; for a narrated discovery, prefer the investigator who learns it. Use the surrounding exchange to resolve pronouns. Choose uncertainty only when no issued knower can be supported.',
    criteria: {...Object.fromEntries(knowerCatalog(packet).map(row => [row.alias, {name: row.name, kind: row.kind}])), [UNCERTAIN_ATTRIBUTION]: 'No issued focal knower can be safely supported.'}};
   if (['world_event', 'player_assertion', 'player_preference'].includes(kind)) {
    const subjects = subjectCatalog(packet, kind);
    if (subjects.length === 1) return {...question, criteria: {[subjects[0].alias]: {name: subjects[0].name, kind: subjects[0].kind}}};
   }
  }
  if (question.key.startsWith('relation_')) {
   const prior = packet.prior.find(row => question.target.endsWith(' ' + row.alias));
   const kind = question.target.split(' ')[1];
   const mayClose = !question.key.startsWith('relation_fallback_') && prior?.status !== 'superseded';
   return {...question,
   instructions: question.key.startsWith('relation_fallback_')
    ? 'Classify the non-closing relation if this source/kind is not the selected closer. Distinct reported detail may coexist independently. Choose uncertainty if the pair cannot be classified without closing. Compare recorded propositions, not their objective truth; shared topic alone is none.'
    : 'Compare the recorded source/kind and prior named in target, not their objective truth. Unknown provenance alone does not prevent this comparison. Shared topic alone is none. Apply the complete relationDefinitions, including every promise-fulfillment gate.',
   criteria: {none: 'Unrelated propositions: no relation.', duplicate: 'Same proposition without meaningful new support or change.', reinforcement: 'New support for the same proposition.', independent: 'A distinct proposition about the same specific relation or commitment.',
    ...(kind === 'keeper_correction' && mayClose ? {correction: 'Explicit correction or retraction.'} : {}),
    contradiction: 'Incompatible proposition without later-state framing.',
    ...(mayClose ? {temporal_change: 'Later replacement or fulfillment; apply every gate in relationDefinitions.temporal_change.'} : {}),
    [UNCERTAIN_ATTRIBUTION]: 'The recorded propositions lack context needed to determine their relation.'}};
  }
  if (question.key.startsWith('knower_') || question.key.startsWith('entity_')) return {...question,
   instructions: 'Does the exact source, understood in its surrounding exchange, give this specific issued name the role in target? Being listed in knownNames alone is not evidence for that role.',
   criteria: {yes: 'The source and dialogue context support this specific name having this role.', no: 'There is no source evidence giving this specific name that role.', [UNCERTAIN_ATTRIBUTION]: 'The source indicates this role but the participant is ambiguous and cannot be disambiguated safely.'}};
  return {...question, instructions: 'Apply annotationPolicy. ' + question.instructions};
 };
 const batchFor = (questions: DecisionBatch['questions']): DecisionBatch => { const batch: DecisionBatch = {id: packet.step.key, model: JEV_MODEL,
  family: 'native-memory', familyVersion: version, scope: packet.origin.scope,
  readSet: [{kind: 'source', resource: packet.job_id, revision: packet.origin.revision}, {kind: 'family', resource: 'native-memory', revision: version}],
  state: {...base, prior: packet.prior.filter(row => questions.some(question => question.target.endsWith(' ' + row.alias))).map(row=>({...row}))}, questions};
  if (options.longContext && questions.length) {try {packDecisionBatch(batch);} catch {return {...batch, longContext: true};}}
  return batch;
 };
 const allAnswers: Record<string, import('./contracts.ts').DecisionAnswer> = {};
 const run = async (groups: Group[], phase: string) => {
  const fixed: Record<string, import('./contracts.ts').DecisionAnswer> = {};
  const questions = groups.flatMap(group => group.batch.questions).map(compact).filter(question => {
   if (question.type !== 'choice' || Object.keys(question.criteria).length !== 1) return true;
   const only = Object.keys(question.criteria)[0];
   fixed[question.key] = {status: 'answered', type: 'choice', choice: only, confidence: 1, probabilities: {[only]: 1}};
   return false;
  });
  questions.sort((a, b) => {
   const priorIndex = (q: DecisionBatch['questions'][number]) => q.key.startsWith('relation_') ? packet.prior.findIndex(p => q.target.endsWith(' ' + p.alias)) : -1;
   return priorIndex(a) - priorIndex(b);
  });
  const chunks: DecisionBatch['questions'][] = []; const planningBegan = Date.now(); let packChecks = 0;
  const fitsNative = (qs: DecisionBatch['questions']) => {
   packChecks++; const batch = batchFor(qs);
   try {packDecisionBatch(batch); return true;} catch {return false;}
  };
  for (let offset = 0; offset < questions.length;) {
   if (!fitsNative([questions[offset]])) {
    await record({event: 'reference_question_deferred', phase, target: questions[offset].target, reason: 'packing_limit'});
    offset++; continue;
   }
   let end = offset + 1, upper = questions.length;
   while (end < upper) {
    const middle = Math.ceil((end + upper) / 2);
    if (fitsNative(questions.slice(offset, middle))) end = middle;
    else upper = middle - 1;
   }
   chunks.push(questions.slice(offset, end)); offset = end;
  }
  await record({event: 'reference_planning', phase, ms: Date.now() - planningBegan, questions: questions.length, batches: chunks.length, pack_checks: packChecks});
  const results: Awaited<ReturnType<DecisionPort['decide']>>[] = []; let next = 0;
  await Promise.all(Array.from({length: Math.min(4, chunks.length)}, async () => {while (next < chunks.length && !signal.aborted) {
   const i = next++, batch = {...batchFor(chunks[i]), id: `${packet.step.key}:${phase}:${i}`};
   const began = Date.now(), timeout = batch.longContext || phase === 'closures' ? 6000 : 2000, lease = new TaskLease({owner: 'native-memory', goal: 'Annotate committed source occurrences', scope: batch.scope,
    readSet: batch.readSet, capabilities: ['decision'], signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    budget: {deadlineAt: Date.now() + timeout, remainingInputTokens: 300000, remainingOutputTokens: packDecisionBatch(batch).estimate.responseUpperBound, remainingCostUsd: .02, remainingActions: 1}});
   const families: Record<string, number> = {}; for (const q of batch.questions) families[q.key.split('_')[0]] = (families[q.key.split('_')[0]] ?? 0) + 1;
   const footprint = {long_context: batch.longContext === true, state_bytes: Buffer.byteLength(JSON.stringify(batch.state)), question_bytes: Buffer.byteLength(JSON.stringify(batch.questions)), families};
   try {const result = await port.decide(batch, lease); results.push(result);
    await record({event: 'reference_decision', phase, batch: i, questions: batch.questions.length, status: result.status, ms: Date.now() - began, ...footprint});}
   catch {await record({event: 'reference_decision', phase, batch: i, questions: batch.questions.length, status: 'unavailable', ms: Date.now() - began, ...footprint});}
   finally {lease.close();}
  }}));
  const answers = Object.assign(allAnswers, fixed, ...results.map(result => result.answers));
  for (const group of groups) view.decisions.push({key: group.key, batch: batchFor(group.batch.questions), result: {batchId: group.key,
   status: 'complete', answers, coverage: {required: [], answered: Object.keys(answers), unknown: []}, issues: []}});
 };
 const layoutOnly = (segment: Segment) => !segment.text.trim() || /^[\s\p{P}]+$/u.test(segment.text);
 await run(packet.step.segments.flatMap((segment, i) => layoutOnly(segment) ? [] : [{key: `memory-kinds:${packet.step.sequence}:${i}`, batch: kindBatch(packet, segment, i)}]), 'kinds');
 const selections = packet.step.segments.map((segment, index) => layoutOnly(segment) ? [] : kindsFor(view, packet, index));
 const groups = new Map(selections.map((kinds, index) => [index, (kinds ?? []).map((kind, kindIndex) => ({key: `native-annotation:${index}:${kindIndex}`,
  kind, kindIndex, batch: batch('memory-write-annotations', {}, annotationQuestions(packet, packet.step.segments[index], index, kind, kindIndex))}))]));
 await run([...groups.values()].flat(), 'annotations');
 const decisions: Json[] = [];
 for (const [index, segment] of packet.step.segments.entries()) {
  const kinds = selections[index], annotationGroups = groups.get(index)!;
  const reviewed = kinds?.map((kind, k) => annotationFor(view, packet, index, kind, k, annotationGroups.filter(g => g.kindIndex === k)));
  const annotations=reviewed?.filter(a=>a!==null);
  const outcome = !kinds ? 'defer' : !kinds.length ? 'skip' : annotations!.some(a => a === undefined) ? 'defer' : !annotations!.length ? 'skip' : 'retain';
  if(reviewed?.some(a=>a===null))await record({event:'reference_kind_rejected',source:segment.alias,kind:'promise',reason:NO_ANNOTATION});
  decisions.push({source: segment.alias, outcome, ...(outcome === 'retain' ? {annotations: annotations as Json[]} : {})});
  if (outcome === 'defer') {
   const blockers = view.decisions.flatMap(group => group.batch.questions.filter(q => q.target.startsWith(segment.alias + ' ')).flatMap(q => {
    const selected = choice(view, group.key, q.key);
    return !selected || selected === UNCERTAIN_ATTRIBUTION ? [{target: q.target, answer: selected ?? 'unavailable'}] : [];
   }));
   await record({event: 'reference_source_deferred', source: segment.alias, reason: !kinds ? 'kind_uncertainty' : 'annotation_incomplete', blockers});
  }
 }
 type Closing = {source: number; kind: Kind; link: {relation: string; target: string}; fallback?: string};
 const closingTargets = new Map<string, Closing[]>();
 decisions.forEach((decision, source) => {
  if (!isPlainRecord(decision) || decision.outcome !== 'retain') return;
  for (const annotation of decision.annotations as Array<{kind: Kind; relations?: Closing['link'][]}>) for (const link of annotation.relations ?? []) {
   if (!['correction', 'temporal_change'].includes(link.relation)) continue;
   const closers = closingTargets.get(link.target) ?? [];
   closers.push({source, kind: annotation.kind, link}); closingTargets.set(link.target, closers);
  }
 });
 const conflicts = [...closingTargets].filter(([, closers]) => closers.length > 1);
 if (conflicts.length) {
  const questions: DecisionBatch['questions'] = [];
  for (const [index, [target, closers]] of conflicts.entries()) {
   questions.push(q(`closure_${index}`, `memory closing owner ${target}`,
    'Select the single issued source/kind that should close this prior occurrence, considering the complete exchange and temporal order. Other occurrences must coexist through non-closing relations. Choose none if no proposed closer is justified; choose uncertainty if no unique closer is supported.',
    {none: 'No proposed occurrence validly closes this prior.', ...Object.fromEntries(closers.map((closer, i) => [`closer:${i}`, {source: packet.step.segments[closer.source].alias, kind: closer.kind}])),
     [UNCERTAIN_ATTRIBUTION]: 'The exchange does not support selecting a unique closing occurrence.'}));
   for (const [i, closer] of closers.entries()) {
    closer.fallback = `relation_fallback_${index}_${i}`;
    questions.push(q(closer.fallback, `${packet.step.segments[closer.source].alias} ${closer.kind} relation ${target}`,
     'Classify the non-closing relationship if this occurrence is not the selected closer. Preserve distinct reported detail without closing the historical occurrence again. Choose uncertainty if no non-closing classification is supported.',
     {...Object.fromEntries(Object.entries(RELATION_DEFINITIONS).filter(([key]) => !['correction', 'temporal_change'].includes(key))),
      [UNCERTAIN_ATTRIBUTION]: 'A non-closing classification is not supported.'}));
   }
  }
  const key = `native-closures:${packet.step.sequence}`;
  await run([{key, batch: batch('memory-write-closures', {}, questions)}], 'closures');
  const uncertain = new Set<number>();
  for (const [index, [, closers]] of conflicts.entries()) {
   const owner = choice(view, key, `closure_${index}`);
   const winner = owner === 'none' ? -1 : closers.findIndex((_, i) => owner === `closer:${i}`);
   if (!owner || owner === UNCERTAIN_ATTRIBUTION || owner !== 'none' && winner < 0) {
    closers.forEach(closer => uncertain.add(closer.source)); continue;
   }
   for (const [i, closer] of closers.entries()) {
    if (i === winner) continue;
    const fallback = choice(view, key, closer.fallback!);
    if (!fallback || !['none', 'duplicate', 'reinforcement', 'independent', 'contradiction'].includes(fallback)) uncertain.add(closer.source);
    else closer.link.relation = fallback;
   }
  }
  decisions.forEach((decision, i) => {
   if (!isPlainRecord(decision) || decision.outcome !== 'retain') return;
   if (uncertain.has(i)) { decisions[i] = {source: packet.step.segments[i].alias, outcome: 'defer'}; return; }
   for (const annotation of decision.annotations as Array<{relations?: Closing['link'][]}>) if (annotation.relations) annotation.relations = annotation.relations.filter(link => link.relation !== 'none');
  });
  for (const i of uncertain) await record({event: 'reference_source_deferred', source: packet.step.segments[i].alias, reason: 'closing_conflict'});
  await record({event: 'reference_closing_conflicts', targets: conflicts.length, deferred: uncertain.size});
 }
 return {step: packet.step.key, decisions};
}

export function createMemoryWriteDomain(): TaskDomain {
  return {id: 'memory-write', version: MEMORY_WRITE_POLICY_VERSION, capabilities: [MEMORY_WRITE_CAPABILITY], next(view) {
    const current = currentPacket(view);
    if (!latest(view, 'memory.job')) return operation('memory.job', 'memory-job:initial', {}, view.context.origin?.sourceRefs ?? []);
    if (current.result?.status === 'done' || current.packet?.status === 'done') return finish('complete');
    if (current.result?.status === 'pending' || current.result && !current.packet)
      return {kind: 'wait', remainingNeeds: [`Memory publication has ${current.result.remaining} retained segment(s) pending.`]};
    if (!current.packet) return finish('unresolved', ['The referenced memory owner returned no current source packet.']);
    const packet = current.packet, retainKey = `memory-retain:${packet.step.sequence}`, retain = packet.step.segments.length ? retainBatch(packet) : undefined;
    if (retain && !decision(view, retainKey) && fits(retain)) return {kind: 'decision', key: retainKey, batch: retain};
    const outcomes = packet.step.segments.map((_, index) => retain && decision(view, retainKey) ? choice(view, retainKey, `retain_${index}`) ?? 'defer' : 'defer');
    const retained = packet.step.segments.map((row, index) => ({row, index})).filter((_, index) => outcomes[index] === 'retain');
    const missingKinds = retained.flatMap(({row, index}) => {
      const key = `memory-kinds:${packet.step.sequence}:${index}`, value = kindBatch(packet, row, index);
      return !decision(view, key) && fits(value) ? [{key, batch: value}] : [];
    });
    if (missingKinds.length) return {kind: 'decisions', batches: missingKinds};
    const selections = new Map(retained.map(({index}) => [index, kindsFor(view, packet, index) ?? []]));
    const groups = new Map(retained.map(({row, index}) => [index, annotationGroups(packet, row, index, selections.get(index) ?? [])]));
    const missingAnnotations = retained.flatMap(({index}) => {
      const kinds = selections.get(index)!;
      if (!kinds.length) return [];
      return groups.get(index)!.groups.filter(group => !decision(view, group.key)).map(group => ({key: group.key, batch: group.batch}));
    });
    if (missingAnnotations.length) return {kind: 'decisions', batches: missingAnnotations.slice(0, 16)};
    const storyKey = `memory-story:${packet.step.sequence}`, storyDecision = packet.story_complete || packet.story_context === undefined ? undefined : storyBatch(packet);
    if (storyDecision && !decision(view, storyKey) && fits(storyDecision)) return {kind: 'decision', key: storyKey, batch: storyDecision};
    const story = storyFor(view, packet), decisions = packet.step.segments.map((row, index): Json => {
      if (outcomes[index] === 'skip') return {source: row.alias, outcome: 'skip'};
      if (outcomes[index] !== 'retain') return {source: row.alias, outcome: 'defer'};
      const kinds = selections.get(index), annotationGroupsForSegment = groups.get(index);
      if (!kinds?.length || !annotationGroupsForSegment || annotationGroupsForSegment.oversized) return {source: row.alias, outcome: 'defer'};
      const reviewed = kinds.map((kind, kindIndex) => annotationFor(view, packet, index, kind, kindIndex,
        annotationGroupsForSegment.groups.filter(group => group.kindIndex === kindIndex)));
      if (reviewed.some(value => value === undefined)) return {source: row.alias, outcome: 'defer'};
      const annotations=reviewed.filter(value=>value!==null);
      if(!annotations.length)return {source:row.alias,outcome:'skip'};
      return {source: row.alias, outcome: 'retain', annotations: annotations as Json[]};
    });
    const hasDeferred = decisions.some(row => isPlainRecord(row) && row.outcome === 'defer')
      || !packet.story_complete && packet.story_context !== undefined && story === undefined;
    const submitKey = `memory-submit:${packet.step.sequence}`;
    if (!view.observations.some(row => row.key === submitKey)) return operation('memory.submit', submitKey, {
      referenced: {step: packet.step.key, decisions, ...(story !== null && story !== undefined ? {story} : {})}},
    [...packet.step.segments, ...packet.story_sources].map(row => row.ref));
    if (hasDeferred) return {kind: 'wait', remainingNeeds: ['One or more memory source segments remain explicitly deferred.']};
    return finish('unresolved', ['The memory publication owner returned no terminal or next-step disposition.']);
  }};
}
