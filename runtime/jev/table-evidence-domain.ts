/** Bounded read-only table evidence policy. Full source/memory retrieval has separate domain gates. */
import { createHash } from 'node:crypto';
import { isPlainRecord, type DecisionQuestion, type Json } from './contracts.ts';
import type { TaskDomain, TaskStep, TaskView } from './task-runtime.ts';
import { JEV_MODEL } from './question-packing.ts';
import {createOrdinaryResolveDomain} from './ordinary-resolve-domain.ts';
import {createOrdinaryApplyDomain} from './ordinary-apply-domain.ts';

interface Candidate { operation: string; args: Record<string, Json>; capability: string; description: Json }
/** This domain reads table/history evidence, not prose guidance or hidden module declarations. */
export function tableEvidenceCapsule(raw: Json): Json {
  if (!isPlainRecord(raw)) return { status: 'unavailable' };
  const where = isPlainRecord(raw.where) ? raw.where : {}, known = isPlainRecord(raw.known) ? raw.known : {};
  const select = (record: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])) as Json;
  return {
    turn: (raw.turn ?? null) as Json,
    where: select(where, ['scene', 'display_name', 'clock', 'session']),
    investigator: (known.investigator ?? null) as Json,
    discoveredClues: (known.discovered_clues ?? []) as Json,
    present: Array.isArray(raw.present) ? raw.present.flatMap(row => isPlainRecord(row) ? [select(row, ['name', 'called', 'role'])] : []) : [],
    coverage: {
      investigator: 'The capsule is a partial sheet projection; it omits baseline and other unlisted skills. Read the full sheet for a complete comparison.',
      history: 'The capsule is not original spoken text. Retrieve and read original pages for historical wording or promises.',
      omitted: Object.keys(raw).filter(key => !['turn', 'where', 'known', 'present'].includes(key)),
      omittedWhere: Object.keys(where).filter(key => !['scene', 'display_name', 'clock', 'session'].includes(key)),
      omittedKnown: Object.keys(known).filter(key => !['investigator', 'discovered_clues'].includes(key)),
      present: 'Only issued names and roles; private source secrets and unspoken terms are unavailable in this evidence view.',
    },
  };
}
const candidateKey = (candidate: Candidate) => `read-${createHash('sha256').update(JSON.stringify([candidate.operation, candidate.args])).digest('hex')}`;
const candidateStep = (candidate: Candidate): TaskStep => ({ kind: 'operation', key: candidateKey(candidate),
  operation: candidate.operation, args: candidate.args, capability: candidate.capability, basis: [] });
function observationEvidence(row: TaskView['observations'][number]): Json {
  const body = row.packet.result;
  if (!isPlainRecord(body)) return body;
  if (row.proposal.operation === 'apply.options') return {context: body.context as Json,
    candidates: Array.isArray(body.candidates) ? body.candidates.map(value => isPlainRecord(value) ? {alias: value.alias, description: value.description} : null) as Json : [],
    promises: (body.promises ?? []) as Json};
  if (row.proposal.operation === 'resolve.options') return {context: body.context as Json, profiles: body.profiles as Json, decisions: body.decisions as Json};
  if (row.proposal.operation === 'apply.fulfillment.options') return (body.catalog ?? null) as Json;
  if (row.proposal.operation === 'apply.fulfillment.prepare') return {status: row.packet.status, purpose: 'The source-bound effect owner prepared an exact batch.'};
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== '_task_advance')) as Json;
}
function candidates(view: TaskView, memoryReadEnabled = false): Candidate[] {
  const offered: Candidate[] = [
    { operation: 'look', args: { focus: 'investigator' }, capability: 'look', description: 'Read the investigator sheet when the current capsule does not answer it.' },
    { operation: 'look', args: { focus: 'session' }, capability: 'look', description: 'Read an active fight, chase or madness subsystem, if required by the goal.' },
    { operation: 'recall', args: { what: 'transcript' }, capability: 'recall', description: 'List bounded original-text cards for the recent three turns; card heads are not full evidence.' },
    { operation: 'recall', args: { what: 'memory' }, capability: 'recall', description: 'Read the bounded default memory view, preserving belief, correction, status and attribution.' },
    { operation: 'recall', args: { what: 'history' }, capability: 'recall', description: 'Read the bounded recent canonical timeline and receipt-derived changes.' },
  ];
  for (const kind of ['module', 'rule', 'catalog']) if (view.plan.capabilities.includes(`lookup.${kind}`))
    offered.push({operation: 'lookup', args: {kind, query: view.plan.goal}, capability: `lookup.${kind}`,
      description: `Search the current accepted ${kind} index for this bounded goal. This does not prepare new source material.`});
  if (memoryReadEnabled && view.plan.capabilities.includes('recall')) offered.push({operation: 'memory.search', args: {query: view.plan.goal, filters: {},
    needs: view.plan.subgoals.length ? view.plan.subgoals : view.plan.evidenceRequired.length ? view.plan.evidenceRequired : [view.plan.goal]}, capability: 'recall',
    description: 'Search the whole eligible memory pool and raw extraction gaps for this goal, read canonical original context, and report support, attribution, applicability, contradiction and omissions. This read-only task never pays a reward.'});
  if (view.plan.capabilities.includes('lookup.source.answer')) for (const requirement of view.plan.evidenceRequired.length ? view.plan.evidenceRequired : [view.plan.goal])
    offered.push({operation: 'source.consult', args: {question: requirement}, capability: 'lookup.source.answer',
      description: { purpose: 'Consult the authored module PDF for this requirement, using native text or independently reviewed original pages. This is not campaign history, preparation, or player authorization.', requirement }});
  if (view.intent.turn > 2) offered.push({ operation: 'recall', args: { what: 'transcript', turns: [0, view.intent.turn - 1] },
    capability: 'recall', description: 'List earlier original-text cards across this campaign up to the prior turn; bounded pages, with actual continuations. Use when recent turns do not cover the requested earlier statement.' });
  for (const { packet, proposal } of view.observations) {
    if (packet.status !== 'succeeded' || proposal.operation !== 'recall' || !isPlainRecord(packet.result)) continue;
    const body = packet.result;
    const add = (args: unknown, description: Json) => {
      // Only continuation objects issued by the actual recall owner become candidates.
      if (isPlainRecord(args) && ['transcript', 'memory', 'history'].includes(String(args.what)))
        offered.push({ operation: 'recall', args: structuredClone(args) as Record<string, Json>, capability: 'recall', description });
    };
    if (Array.isArray(body.cards)) for (const card of body.cards) if (isPlainRecord(card)) {
      add(card.read, { purpose: 'Read this actual original-text card before relying on its head.', head: String(card.head ?? ''), role: String(card.role ?? '') });
      add(card.detail, { purpose: 'Read this oversized structured card.', head: String(card.head ?? '') });
    }
    add(body.next, 'Read the actual continuation issued by the previous read; preserve its scope and filters.');
    if (Array.isArray(body.hits)) for (const hit of body.hits) if (isPlainRecord(hit)) add(hit.detail, 'Read this actual oversized memory result.');
  }
  const unique = new Map<string, Candidate>();
  for (const candidate of offered) {
    const key = candidateKey(candidate);
    if (view.context.capabilities.includes(candidate.capability) && view.plan.capabilities.includes(candidate.capability)
      && !view.observations.some(row => row.key === key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}
export function createTableEvidenceDomain(input: { rawInput(): string; capsule(): Json; memoryReadEnabled?: boolean; resolveEnabled?: boolean; applyEnabled?: boolean }): TaskDomain {
  const resolve = createOrdinaryResolveDomain(input);
  const apply = createOrdinaryApplyDomain(input);
  const mutations = (view: TaskView): TaskStep => {
    if (input.resolveEnabled && view.plan.capabilities.includes('resolve')) {
      const next = resolve.next(view);
      if (next.kind === 'handoff' && input.applyEnabled && view.plan.capabilities.includes('apply'))
        return {...next, verbs: [...new Set([...next.verbs, 'apply' as const])]};
      if (!(next.kind==='finish' && next.status==='complete' && input.applyEnabled && view.plan.capabilities.includes('apply'))) return next;
    }
    return apply.next(view);
  };
  return { id: 'table-evidence', version: input.applyEnabled ? '4' : input.resolveEnabled ? '3' : '2', capabilities: ['look', 'recall', 'lookup.module', 'lookup.rule', 'lookup.catalog', 'lookup.source.answer', ...(input.resolveEnabled ? ['resolve'] : []), ...(input.applyEnabled ? ['apply'] : [])], next(view) {
    const mutationPlan = !!(input.resolveEnabled && view.plan.capabilities.includes('resolve') || input.applyEnabled && view.plan.capabilities.includes('apply'));
    const readPlan = view.plan.capabilities.some(value => value === 'look' || value === 'recall' || value.startsWith('lookup.'));
    if (mutationPlan && !readPlan) return mutations(view);
    if (input.memoryReadEnabled && view.plan.capabilities.every(capability=>capability==='recall')) {
      const memory = view.observations.findLast(value=>value.proposal.operation==='memory.search' && value.packet.status==='succeeded');
      if (memory && isPlainRecord(memory.packet.result) && ['ready','partial'].includes(String(memory.packet.result.status)))
        return {kind:'finish',status:memory.packet.result.status==='ready'?'complete':'partial',
          remainingNeeds:memory.packet.result.status==='ready'?[]:['The memory owner returned explicitly partial evidence; preserve its omissions and unknowns.']};
    }
    const available = candidates(view, input.memoryReadEnabled);
    if (available.length > 240) return { kind: 'finish', status: 'partial', remainingNeeds: ['Candidate coverage exceeds the current bounded read policy.'] };
    const evidenceCount = mutationPlan ? view.observations.filter(row => ['look', 'recall', 'lookup', 'source.consult', 'memory.search'].includes(row.proposal.operation)).length
      : view.observations.length;
    const key = `evidence-${view.replans}-${evidenceCount}`;
    const decision = view.decisions.find(row => row.key === key)?.result;
    const requirements = mutationPlan ? view.plan.evidenceRequired : [...view.plan.evidenceRequired, ...view.plan.completion];
    if (!decision) {
      const criteria: Record<string, string> = Object.fromEntries(available.map((_, index) => [`candidate_${index}`, `Execute candidates[${index}] to obtain missing evidence.`]));
      Object.assign(criteria, {
        complete: mutationPlan ? 'Existing authorized observations and capsule provide all required evidence to select this action. Its effects need not have happened yet.'
          : 'Existing authorized observations and capsule fully support the bounded goal without an additional read.',
        needs_player: 'A genuine consequential player decision is required before continuing the goal, not merely missing evidence.',
        unresolved: 'The available read capabilities cannot obtain enough evidence for this goal.',
      });
      const questions: DecisionQuestion[] = [{ key: 'next', target: 'next operation', type: 'choice', criteria,
        instructions: 'Choose the next useful candidate for rawInput and plan using actual observations. A card head is navigation only; read originals before asserting their contents. Preserve unknowns, scope, negation, conditions, historical beliefs, and missing context. Do not treat private module or NPC secrets as player knowledge. A successful tool call is not goal completion. Repeated same-goal activity does not itself require a player question.' },
      ...requirements.map((requirement, index): DecisionQuestion => ({ key: `support_${index}`, target: requirement, type: 'choice',
        criteria: { sufficient: 'The actual evidence is enough to answer this requirement, including a well-supported negative answer.',
          needs_more: 'An original page, unlisted field, missing condition or additional context must still be read.',
          unavailable: 'The available evidence and authorized capabilities cannot answer this requirement.' },
        instructions: `Classify evidence coverage for this requirement: ${requirement}. Read observations literally: an explicit field in a complete sheet supports its value; a complete canonical ledger supports whether a transfer occurred. An original transcript supports what was said, including omission of an amount, only over its explicit covered range. Navigation/card heads alone cannot support original wording or omitted conditions. Judge independently from the next-operation answer.` }))];
      return { kind: 'decision', key, batch: { model: JEV_MODEL, family: 'table-evidence', familyVersion: '2',
        state: { rawInput: input.rawInput(), plan: view.plan, capsule: tableEvidenceCapsule(input.capsule()),
          stage: mutationPlan ? 'Gather evidence before selecting a canonical action. Do not require its future receipt as evidence to act.' : 'Read-only evidence goal.',
          observations: view.observations.map(row => ({ status: row.packet.status, result: observationEvidence(row), coverage: { ...row.packet.coverage } })),
          candidates: available.map(candidate => candidate.description) }, questions } };
    }
    const choice = decision.answers.next;
    if (decision.status !== 'complete' || choice?.status !== 'answered' || choice.type !== 'choice')
      return { kind: 'finish', status: 'unresolved', remainingNeeds: [decision.failure?.code ?? 'The typed evidence decision is incomplete.'] };
    if (choice.choice === 'needs_player') return { kind: 'finish', status: 'needs_player', remainingNeeds: ['Return the genuine decision boundary to the player.'] };
    if (choice.choice === 'unresolved') return { kind: 'finish', status: 'unresolved', remainingNeeds: requirements };
    if (choice.choice === 'complete') {
      const missing = requirements.filter((_, index) => {
        const answer = decision.answers[`support_${index}`];
        return answer?.status !== 'answered' || answer.type !== 'choice' || answer.choice !== 'sufficient';
      });
      const needsMore = requirements.some((_, index) => {
        const answer = decision.answers[`support_${index}`];
        return answer?.status === 'answered' && answer.type === 'choice' && answer.choice === 'needs_more';
      });
      if (needsMore) {
        const alternatives = available.map((candidate, index) => ({ candidate, weight: choice.probabilities?.[`candidate_${index}`] ?? 0 }))
          .filter(row => row.weight > 0).sort((left, right) => right.weight - left.weight);
        // A premature global completion never overrides an independent missing-evidence verdict.
        if (alternatives.length) return candidateStep(alternatives[0].candidate);
      }
      if (mutationPlan && !missing.length) return mutations(view);
      return { kind: 'finish', status: missing.length ? 'partial' : 'complete', remainingNeeds: missing };
    }
    const selected = available.find((_, index) => choice.choice === `candidate_${index}`);
    return selected ? candidateStep(selected) : { kind: 'finish', status: 'failed', remainingNeeds: ['The decision selected an unissued candidate.'] };
  } };
}
