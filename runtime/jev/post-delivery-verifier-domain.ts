/** Reference-first policy for the advisory post-delivery verifier. No publication authority. */
import {createHash} from 'node:crypto';
import type {DecisionPort} from './decision-port.ts';
import {JEV_MODEL} from './question-packing.ts';
import {issueSourceRef, resolveSourceRef, splitSourceText, type SourceAccess, type SourceSnapshot} from './source-ref.ts';
import {ContractError, type DecisionBatch, type DecisionDescriptor, type Json, type ReadSet, type ScopeBinding, type SourceRef} from './contracts.ts';
import type {TaskLease} from './task-context.ts';

export const POST_DELIVERY_VERIFIER_FAMILY = 'post-delivery-verifier';
export const POST_DELIVERY_VERIFIER_VERSION = '1';
export const POST_DELIVERY_VERIFIER_MODEL = JEV_MODEL;
export const POST_DELIVERY_MAX_FINDINGS = 10;
export const POST_DELIVERY_FINDING_KINDS = [
  'reveal', 'uncommitted_state', 'player_agency', 'play_language_mismatch', 'unmarked_speech',
  'investigator_identity_mismatch',
] as const;
export type PostDeliveryFindingKind = typeof POST_DELIVERY_FINDING_KINDS[number];
export interface PostDeliveryFinding {kind: PostDeliveryFindingKind; quote: string; why: string; clue?: string}

export interface PostDeliveryVerifierInput {
  campaign: string;
  turn: number;
  commit?: string;
  incumbentModel?: string;
  renderedText: string;
  playLanguage?: string;
  facts?: {committed?: unknown[]; keeper_only?: unknown[]; public?: unknown[]};
  speech?: unknown[];
}
export interface PostDeliveryVerifierUsage {inputTokens: number; outputTokens: number; costUsd: number}
export type PostDeliveryVerifierResult =
  | {status: 'complete'; findings: PostDeliveryFinding[]; calls: number; elapsedMs: number; usage: PostDeliveryVerifierUsage}
  | {status: 'fallback'; reason: string; calls: number; elapsedMs: number; usage: PostDeliveryVerifierUsage};

interface Candidate {alias: string; text: string; ref: SourceRef; clue?: string}
interface Catalog {
  scope: ScopeBinding;
  readSet: ReadSet;
  playLanguage: string;
  access: SourceAccess;
  prose: Candidate[];
  committed: Candidate[];
  keeper: Candidate[];
  public: Candidate[];
  speech: Array<{alias: string; speaker: string; text: string}>;
}

const MAX_QUOTE_UTF16 = 120;
const NONE = 'none';
const WHY: Record<PostDeliveryFindingKind, string> = {
  reveal: 'The delivered prose appears to disclose Keeper-only material that the player had not earned.',
  uncommitted_state: 'The delivered prose appears to claim a state change absent from the committed facts.',
  player_agency: 'The delivered prose appears to choose voluntary words or action for the player.',
  play_language_mismatch: 'The delivered prose appears not to use the campaign play language.',
  unmarked_speech: 'The delivered prose appears to contain spoken words outside the canonical speech spans.',
  investigator_identity_mismatch: 'The delivered prose appears to conflict with the investigator identity already made public.',
};
const INSTRUCTIONS: Record<PostDeliveryFindingKind, string> = {
  reveal: 'Select one prose alias that discloses a Keeper-only fact not already public. A repeated public fact is not a reveal. Select none when no remaining passage does this.',
  uncommitted_state: 'Select one prose alias that claims movement, acquisition, resource change, elapsed time, or another world change absent from committedFacts. Select none when no remaining passage does this.',
  player_agency: 'Select one prose alias that makes an undeclared voluntary choice, action, or spoken statement for the player. Enacting what the player actually chose is allowed. Select none when no remaining passage does this.',
  play_language_mismatch: 'Select one prose alias whose player-facing prose is not written in playLanguage. Proper names, quoted rules terms, and dice notation are allowed. Select none when no remaining passage does this.',
  unmarked_speech: 'Select one prose alias containing a line spoken aloud that is absent from speech. Reported speech, thought, signage, and document text are not spoken lines. Select none when no remaining passage does this.',
  investigator_identity_mismatch: 'Select one prose alias whose pronoun, address, or identity description explicitly conflicts with publicFacts about the investigator. Never infer identity from a name or occupation. Select none when no remaining passage does this.',
};

function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function factText(value: unknown): string {
  if (typeof value === 'string') return value;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
function factRows(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function clueOf(value: string): string | undefined {
  // Closed kernel-owned system format from kernel-ts/write/text.ts, not an open semantic classifier.
  const prefix = 'Undiscovered clue: ', separator = ' -- ';
  if (!value.startsWith(prefix)) return undefined;
  const end = value.indexOf(separator, prefix.length);
  if (end <= prefix.length) return undefined;
  const clue = value.slice(prefix.length, end);
  return clue.trim() === clue && clue ? clue : undefined;
}
function speechRows(value: unknown): Array<{alias: string; speaker: string; text: string}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as {who?: {name?: unknown; label?: unknown}; text?: unknown};
    if (typeof row.text !== 'string' || !row.text) return [];
    const speaker = typeof row.who?.name === 'string' ? row.who.name : typeof row.who?.label === 'string' ? row.who.label : '?';
    return [{alias: `speech:${index}`, speaker, text: row.text}];
  });
}

export function postDeliveryVerifierBindings(input: PostDeliveryVerifierInput): {scope: ScopeBinding; readSet: ReadSet} {
  if (typeof input.commit !== 'string' || !input.commit.trim() || input.commit !== input.commit.trim())
    throw new ContractError('verifier_commit_unavailable');
  const scope: ScopeBinding = {owner: POST_DELIVERY_VERIFIER_FAMILY, campaign: input.campaign, audience: 'keeper'};
  const contextRevision = digest(JSON.stringify([input.renderedText, input.playLanguage ?? null, input.facts ?? null, input.speech ?? null]));
  return {scope, readSet: [
    {kind: 'source', resource: `turn:${input.turn}:keeper`, revision: input.commit},
    {kind: 'extraction', resource: `turn:${input.turn}:verifier-context`, revision: contextRevision},
    {kind: 'family', resource: POST_DELIVERY_VERIFIER_FAMILY, revision: POST_DELIVERY_VERIFIER_VERSION},
    {kind: 'model', resource: `${POST_DELIVERY_VERIFIER_FAMILY}:jev`, revision: POST_DELIVERY_VERIFIER_MODEL},
    {kind: 'model', resource: `${POST_DELIVERY_VERIFIER_FAMILY}:incumbent`, revision: input.incumbentModel ?? 'unavailable'},
  ]};
}

/** An incumbent-only attempt binds its draft bytes without pretending they are a canonical committed origin. */
export function postDeliveryVerifierFallbackBindings(input: PostDeliveryVerifierInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: POST_DELIVERY_VERIFIER_FAMILY, campaign: input.campaign, audience: 'keeper'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${input.turn}:uncommitted-verifier-input`,
      revision: digest(JSON.stringify([input.renderedText, input.playLanguage ?? null, input.facts ?? null, input.speech ?? null]))},
    {kind: 'family', resource: POST_DELIVERY_VERIFIER_FAMILY, revision: POST_DELIVERY_VERIFIER_VERSION},
    {kind: 'model', resource: `${POST_DELIVERY_VERIFIER_FAMILY}:incumbent`, revision: input.incumbentModel ?? 'unavailable'},
  ]};
}

function buildCatalog(input: PostDeliveryVerifierInput, expected: ReturnType<typeof postDeliveryVerifierBindings>): Catalog {
  const snapshots = new Map<string, SourceSnapshot>(), current = new Map<string, string>();
  const addSnapshot = (snapshot: SourceSnapshot) => {
    snapshots.set(`${snapshot.resource}\u0000${snapshot.revision}`, snapshot);
    current.set(snapshot.resource, snapshot.revision);
  };
  const textCandidates = (group: 'committed' | 'keeper' | 'public', values: unknown[]): Candidate[] => values.map((value, index) => {
    const text = factText(value), resource = `turn:${input.turn}:fact:${group}:${index}`;
    const snapshot: SourceSnapshot = {scope: expected.scope, resource, revision: input.commit!, sourceType: 'record', text};
    const clue = group === 'keeper' ? clueOf(text) : undefined;
    addSnapshot(snapshot);
    return {alias: `${group}-fact:${index}`, text, ref: issueSourceRef(snapshot, {kind: 'utf16', start: 0, end: text.length}),
      ...(clue ? {clue} : {})};
  });
  const proseSnapshot: SourceSnapshot = {scope: expected.scope, resource: `turn:${input.turn}:keeper`,
    revision: input.commit!, sourceType: 'turn', text: input.renderedText};
  addSnapshot(proseSnapshot);
  const prose = splitSourceText(input.renderedText, MAX_QUOTE_UTF16).flatMap(({start, end}, index) => {
    const text = input.renderedText.slice(start, end);
    return text.trim() ? [{alias: `prose:${index}`, text, ref: issueSourceRef(proseSnapshot, {kind: 'utf16', start, end})}] : [];
  });
  // A delivered turn is an immutable committed origin; later turns do not stale its advisory review.
  const access: SourceAccess = {scope: expected.scope, mode: 'historical',
    read: (resource, revision) => snapshots.get(`${resource}\u0000${revision}`),
    currentRevision: resource => current.get(resource)};
  return {scope: expected.scope, readSet: expected.readSet, playLanguage: input.playLanguage ?? 'the campaign play language', access, prose,
    committed: textCandidates('committed', factRows(input.facts?.committed)),
    keeper: textCandidates('keeper', factRows(input.facts?.keeper_only)),
    public: textCandidates('public', factRows(input.facts?.public)), speech: speechRows(input.speech)};
}

function visible(candidate: Candidate): {alias: string; text: string} { return {alias: candidate.alias, text: candidate.text}; }
function criteria(aliases: string[]): Record<string, DecisionDescriptor> {
  return {none: 'No remaining passage has this defect.', ...Object.fromEntries(aliases.map(alias => [alias, `The exact passage identified by ${alias}.`]))};
}
function answer(result: Awaited<ReturnType<DecisionPort['decide']>>, key: string): string | undefined {
  const value = result.answers[key];
  return value?.status === 'answered' && value.type === 'choice' ? value.choice : undefined;
}
function usageAdd(total: PostDeliveryVerifierUsage, result: Awaited<ReturnType<DecisionPort['decide']>>): void {
  total.inputTokens += result.usage?.inputTokens ?? 0;
  total.outputTokens += result.usage?.outputTokens ?? 0;
  total.costUsd += result.usage?.costUsd ?? 0;
}
function materialize(candidate: Candidate, catalog: Catalog): string {
  const value = resolveSourceRef(candidate.ref, catalog.access);
  if (typeof value !== 'string') throw new Error('verifier_source_not_text');
  return value;
}
function batch(catalog: Catalog, round: number, remaining: Map<PostDeliveryFindingKind, Set<string>>): DecisionBatch {
  const aliases = new Set<string>();
  for (const values of remaining.values()) for (const alias of values) aliases.add(alias);
  const prose = catalog.prose.filter(candidate => aliases.has(candidate.alias)).map(visible);
  return {id: `post-delivery:${round}`, model: POST_DELIVERY_VERIFIER_MODEL, family: POST_DELIVERY_VERIFIER_FAMILY,
    familyVersion: POST_DELIVERY_VERIFIER_VERSION, scope: catalog.scope, readSet: catalog.readSet,
    state: {playLanguage: catalog.playLanguage, prose, committedFacts: catalog.committed.map(visible),
      keeperFacts: catalog.keeper.map(visible), publicFacts: catalog.public.map(visible), speech: catalog.speech} as Json,
    questions: POST_DELIVERY_FINDING_KINDS.flatMap(kind => {
      const issued = [...(remaining.get(kind) ?? [])];
      return issued.length ? [{key: kind, target: `remaining ${kind} defect`, instructions: INSTRUCTIONS[kind], type: 'choice' as const,
        criteria: criteria(issued)}] : [];
    })};
}
function basisBatch(catalog: Catalog, round: number, reveals: Array<{key: string; source: Candidate}>): DecisionBatch {
  const factCriteria = criteria(catalog.keeper.map(candidate => candidate.alias));
  return {id: `post-delivery:${round}:reveal-basis`, model: POST_DELIVERY_VERIFIER_MODEL, family: POST_DELIVERY_VERIFIER_FAMILY,
    familyVersion: POST_DELIVERY_VERIFIER_VERSION, scope: catalog.scope, readSet: catalog.readSet,
    state: {reveals: reveals.map(row => ({key: row.key, source: row.source.alias, text: row.source.text})),
      keeperFacts: catalog.keeper.map(visible), publicFacts: catalog.public.map(visible)} as Json,
    questions: reveals.map(row => ({key: row.key, target: `Keeper-only basis for ${row.source.alias}`,
      instructions: `Choose the one issued keeperFacts alias disclosed by ${row.source.alias}, or none. Select by semantic support; never reproduce its text or name.`,
      type: 'choice' as const, criteria: factCriteria}))};
}

export async function runPostDeliveryVerifier(input: PostDeliveryVerifierInput, decision: DecisionPort,
  lease: TaskLease): Promise<PostDeliveryVerifierResult> {
  const began = Date.now(), usage: PostDeliveryVerifierUsage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  let calls = 0;
  const fallback = (reason: string): PostDeliveryVerifierResult => ({status: 'fallback', reason, calls,
    elapsedMs: Date.now() - began, usage});
  try {
    const bindings = postDeliveryVerifierBindings(input), context = lease.context;
    if (context.scope.owner !== bindings.scope.owner || context.scope.campaign !== bindings.scope.campaign
      || context.scope.audience !== 'keeper' || JSON.stringify(context.readSet) !== JSON.stringify(bindings.readSet))
      return fallback('attempt_binding_mismatch');
    const catalog = buildCatalog(input, bindings);
    if (!catalog.prose.length) return {status: 'complete', findings: [], calls, elapsedMs: Date.now() - began, usage};
    const remaining = new Map<PostDeliveryFindingKind, Set<string>>(POST_DELIVERY_FINDING_KINDS.map(kind =>
      [kind, new Set(catalog.prose.map(candidate => candidate.alias))]));
    const byAlias = new Map(catalog.prose.map(candidate => [candidate.alias, candidate])), keeperByAlias = new Map(catalog.keeper.map(candidate => [candidate.alias, candidate]));
    const findings: PostDeliveryFinding[] = [];
    for (let round = 1; findings.length < POST_DELIVERY_MAX_FINDINGS; round++) {
      const current = batch(catalog, round, remaining);
      if (!current.questions.length) break;
      const judged = await decision.decide(current, lease); calls++; usageAdd(usage, judged);
      if (judged.status !== 'complete') return fallback(judged.failure?.code ?? judged.status);
      const selected: Array<{kind: PostDeliveryFindingKind; source: Candidate}> = [];
      for (const kind of POST_DELIVERY_FINDING_KINDS) {
        if (!current.questions.some(question => question.key === kind)) continue;
        const choice = answer(judged, kind);
        if (!choice) return fallback(`missing_${kind}`);
        if (choice === NONE) { remaining.set(kind, new Set()); continue; }
        const source = byAlias.get(choice);
        if (!source || !remaining.get(kind)?.delete(choice)) return fallback(`invalid_${kind}_alias`);
        selected.push({kind, source});
      }
      if (!selected.length) break;
      const reveals = selected.filter(row => row.kind === 'reveal').map((row, index) => ({key: `reveal:${round}:${index}`, source: row.source}));
      const revealFacts = new Map<string, Candidate>();
      if (reveals.length && catalog.keeper.length) {
        const basis = await decision.decide(basisBatch(catalog, round, reveals), lease); calls++; usageAdd(usage, basis);
        if (basis.status !== 'complete') return fallback(basis.failure?.code ?? basis.status);
        for (const reveal of reveals) {
          const choice = answer(basis, reveal.key);
          if (!choice) return fallback('missing_reveal_basis');
          if (choice !== NONE) {
            const fact = keeperByAlias.get(choice);
            if (!fact) return fallback('invalid_reveal_basis');
            revealFacts.set(reveal.source.alias, fact);
          }
        }
      }
      for (const row of selected) {
        const fact = row.kind === 'reveal' ? revealFacts.get(row.source.alias) : undefined;
        findings.push({kind: row.kind, quote: materialize(row.source, catalog), why: WHY[row.kind], ...(fact?.clue ? {clue: fact.clue} : {})});
        if (findings.length >= POST_DELIVERY_MAX_FINDINGS) break;
      }
    }
    return {status: 'complete', findings, calls, elapsedMs: Date.now() - began, usage};
  } catch (error) {
    return fallback(error instanceof ContractError ? error.code : 'verifier_owner_error');
  }
}
