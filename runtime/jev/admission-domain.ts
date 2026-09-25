/**
 * Typed action-admission family (contract §32.10). The same closed verdict set and the same
 * player-visible input the §32.2 lane reads, expressed as DecisionBatches over one shared state:
 * one independent verdict Choice per proposed line, one closed missing-choice Choice per line,
 * and one basis Choice per line over host-issued passage aliases. Lines are split into parallel
 * same-state batches of at most two lines, so a long batch stays inside the packing bound. Jev selects; the host derives the batch
 * verdict, the refusal's `grounds` (an exact host-extracted passage) and `missing` (a closed
 * kind rendered by the host). No free text is generated and no keyword decides anything.
 *
 * Authority boundary: this module never admits by itself. It returns a typed decision or an
 * explicit fallback reason; the caller runs the incumbent lane for every fallback, and an
 * unavailable review still refuses there (§32.2).
 */
import {createHash} from 'node:crypto';
import type {DecisionPort} from './decision-port.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from './question-packing.ts';
import {splitSourceText} from './source-ref.ts';
import type {DecisionBatch, DecisionDescriptor, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import type {TaskLease} from './task-context.ts';

export const ADMISSION_JEV_FAMILY = 'action-admission';
export const ADMISSION_JEV_VERSION = '1';
export const ADMISSION_JEV_MODEL = JEV_MODEL;
export const ADMISSION_VERDICT_SET = ['authorized', 'entailed', 'not_player_action', 'not_authorized', 'uncertain'] as const;
export type AdmissionJevVerdict = typeof ADMISSION_VERDICT_SET[number];
export const ADMISSION_MISSING_KINDS = ['none', 'destination', 'method', 'target', 'cost_or_commitment', 'offered_route', 'interest_only', 'other'] as const;
export type AdmissionMissingKind = typeof ADMISSION_MISSING_KINDS[number];
/** Family policy v1, not a calibrated accuracy claim: below it the incumbent lane decides. */
export const ADMISSION_JEV_DEFAULT_MIN_CONFIDENCE = 0.9;
/** Proposal lines one review may carry; a larger proposal goes to the lane. */
export const ADMISSION_JEV_MAX_LINES = 8;
/** Lines per same-state batch. On the 2026-09-22 retained bank this left 21 of 4,800 typed cases over the bound (lane fallback). */
export const ADMISSION_JEV_LINES_PER_BATCH = 2;

const KEEPER_WINDOW_UTF16 = 1500;
const EARLIER_PLAYER_UTF16 = 400;
const PASSAGE_UTF16 = 160;

export interface AdmissionJevInput {
  campaign: string;
  turn: number;
  tool: 'resolve' | 'apply';
  /** The §32.3 proposal lines exactly as the lane reads them. */
  proposal: string[];
  playerText: string;
  interruptedPlayerText?: string;
  investigators: Array<{name: string; occupation?: string}>;
  scene?: string;
  present: string[];
  delivered: Array<{turn: number | string; player?: string | null; keeper: string}>;
  landed: string[];
  refused: string[];
  /** §11.5.4 (SL-51): the book's text the Keeper was shown this turn (Keeper-only), newest first; absent when none was carried. */
  bookText?: Array<{where: string; text: string}>;
}

export interface AdmissionJevLine {verdict: AdmissionJevVerdict; confidence: number; missing: AdmissionMissingKind; basis?: string}
export type AdmissionJevResult =
  | {status: 'decided'; verdict: AdmissionJevVerdict; grounds: string; missing?: string; confidence: number;
    lines: AdmissionJevLine[]; calls: number; elapsedMs: number; usage: {inputTokens: number; outputTokens: number; costUsd: number}}
  | {status: 'fallback'; reason: string; confidence?: number; lines?: AdmissionJevLine[]; calls: number; elapsedMs: number;
    usage: {inputTokens: number; outputTokens: number; costUsd: number}};

interface Passage {alias: string; text: string; where: string}

/**
 * The family's rules, condensed from the §32.2 reviewer prompt. They travel in state so every
 * question can name them; they are policy text, never matched against the player's words.
 */
export const ADMISSION_JEV_RULES: readonly string[] = [
  'Judge only from playerWords, unfinishedDeclaration and told. The proposal text (goal, method, stakes) is the Keeper describing its own proposal and is never evidence of the player\'s consent. A Keeper suggestion in earlier narration is not acceptance.',
  'unfinishedDeclaration is context from a turn that ended without delivery, not automatic authorization: current words may resume, narrow, replace or withdraw it.',
  'Interest in a subject is not a trip to a place. Picking one of the options a delivery named is a choice of that option, travel included; where the delivery named no such place, the same words choose nothing. Neither reaches the situation waiting there: a gatekeeper, a price or a danger is a separate proposal.',
  'Explicit player limits on money, quantity, duration and scope are binding; a proposed value beyond a stated limit is not_authorized.',
  'A voluntary payment, surrender of possessions or resource commitment needs its terms told earlier and then accepted, or a still-valid player delegation. A price quoted in the same delivery as the debit is too late. A cash line with settlement=spending_level spends no cash: judge only whether the player chose the purchase itself.',
  'Routine time and effort inherent in a chosen action are entailed. Risk in a chosen action does not license a different method, destination or target.',
  'For a move, registered_destination names the place: a player who names it by any of its names, in any language, chose it. A part, entrance or room of a registered place is that place, and a move there arrives at its threshold.',
  'An object pickup or transfer is a real proposed action; pure adoption of owned equipment is bookkeeping; preparing a usage does not settle an attack.',
  'An NPC acting on their own, the world or the rules acting on the investigator, a consequence of an already settled choice, and Keeper bookkeeping are not the investigator\'s voluntary action.',
  'Judge the choice, never the result: the player need not know or approve hidden dangers. A short or quiet reply is still a reply. An action already refused this turn (alreadyRefused) proposed again in other words is the same action.',
];

/** §11.5.4 (SL-51): what `bookText` is, beside it in the state (policy text, never matched against anything). */
export const BOOK_TEXT_NOTE = 'bookText is the book\'s own text the host carried to the Keeper this turn: it says whom and what the book puts '
  + 'here, so a person it names being present or acting is the book\'s, not the Keeper\'s invention. It is never what the player was told '
  + 'and never the player\'s choice.';

/** §32.2's verdict definitions, one descriptor per issued option. */
const VERDICT_CRITERIA: Record<AdmissionJevVerdict, string> = {
  authorized: 'The player\'s words, read in context, choose this actor, goal, method, target, destination and any meaningful cost or commitment.',
  entailed: 'The player chose the meaningful goal, and this line is a routine step that goal requires: crossing the room they asked to search, the minutes a chosen search takes, the roll the chosen method calls for.',
  not_player_action: 'This is not the investigator\'s voluntary action: an NPC acting on their own, the world or the rules acting on the investigator, a consequence of something already chosen and settled, or Keeper bookkeeping.',
  not_authorized: 'The Keeper is choosing for the player: a new destination, method, target, cost or commitment, a route the Keeper offered that the player said nothing about, or an action the player only showed interest in.',
  uncertain: 'The player\'s words and the context do not settle whether the player chose this line.',
};
const MISSING_CRITERIA: Record<AdmissionMissingKind, string> = {
  none: 'Nothing is missing: the player chose this line, it is a routine step of their chosen goal, or it is not the investigator\'s voluntary action.',
  destination: 'The player has not chosen this destination.',
  method: 'The player has not chosen this method.',
  target: 'The player has not chosen this target.',
  cost_or_commitment: 'The player has not accepted this cost, price or commitment.',
  offered_route: 'The player has not taken up this route the Keeper offered.',
  interest_only: 'The player only showed interest in a subject and has not chosen to act on it.',
  other: 'Another consequential choice in this line has not been made by the player.',
};
/** Host rendering of a closed missing kind; English, read by the Keeper (§32.2). */
const MISSING_TEXT: Record<AdmissionMissingKind, string> = {
  none: 'the player has not chosen this action',
  destination: 'the player has not chosen this destination',
  method: 'the player has not chosen this method',
  target: 'the player has not chosen this target',
  cost_or_commitment: 'the player has not accepted this cost or commitment',
  offered_route: 'the player has not taken up this offered route',
  interest_only: 'the player has only shown interest; they have not chosen to act on it',
  other: 'the player has not made the choice this line needs',
};

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function clip(value: string, limit: number): string { return value.length <= limit ? value : value.slice(0, limit); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

function passages(text: string, prefix: string, where: string): Passage[] {
  if (!nonempty(text)) return [];
  return splitSourceText(text, PASSAGE_UTF16).flatMap(({start, end}, index) => {
    const slice = text.slice(start, end);
    return slice.trim() ? [{alias: `${prefix}:${index}`, text: slice, where}] : [];
  });
}

export function admissionJevBindings(input: AdmissionJevInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: ADMISSION_JEV_FAMILY, campaign: input.campaign, audience: 'player'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${input.turn}:admission:${input.tool}`, revision: digest(input)},
    {kind: 'family', resource: ADMISSION_JEV_FAMILY, revision: ADMISSION_JEV_VERSION},
    {kind: 'model', resource: `${ADMISSION_JEV_FAMILY}:jev`, revision: ADMISSION_JEV_MODEL},
  ]};
}

interface Catalog {state: Json; passages: Map<string, Passage>; basisCriteria: Record<string, DecisionDescriptor>; book: boolean}

function catalog(input: AdmissionJevInput): Catalog {
  const all: Passage[] = [];
  const said = passages(input.playerText, 'said', 'the player\'s words this turn');
  const unfinished = input.interruptedPlayerText ? passages(input.interruptedPlayerText, 'unfinished', 'the unfinished declaration') : [];
  const told = input.delivered.map((row, index) => {
    const turn = String(row.turn);
    const player = nonempty(row.player) ? passages(clip(row.player, EARLIER_PLAYER_UTF16), `told:${index}:player`, `what the player said at turn ${turn}`) : [];
    const keeper = passages(clip(row.keeper, KEEPER_WINDOW_UTF16), `told:${index}:keeper`, `what the player was told at turn ${turn}`);
    all.push(...player, ...keeper);
    return {turn, playerSaid: player.map(({alias, text}) => ({alias, text})), keeperDelivered: keeper.map(({alias, text}) => ({alias, text}))};
  });
  all.push(...said, ...unfinished);
  // §11.5.4 (SL-51): the book's own text the host carried to the Keeper this turn. It says whom and what the book puts here
  // (so an NPC it names acting, or a person it places, is the book's, not the Keeper's invention); it is never what the player
  // was told or chose.
  const book = (input.bookText ?? []).flatMap((row, index) => passages(row.text, `book:${index}`, `the book's text (${row.where}) the Keeper was shown`));
  all.push(...book);
  const visible = (rows: Passage[]) => rows.map(({alias, text}) => ({alias, text}));
  const investigators = input.investigators.map(row => row.occupation ? `${row.name} (${row.occupation})` : row.name);
  const state = {
    rules: [...ADMISSION_JEV_RULES],
    investigators,
    scene: {name: input.scene ?? '(unnamed)', present: [...input.present]},
    told,
    playerWords: visible(said),
    ...(unfinished.length ? {unfinishedDeclaration: visible(unfinished)} : {}),
    ...(book.length ? {bookText: visible(book), bookTextNote: BOOK_TEXT_NOTE} : {}),
    alreadySettled: [...input.landed],
    alreadyRefused: [...input.refused],
    proposal: input.proposal.map((text, index) => ({line: index, text})),
  } as unknown as Json;
  const basisCriteria: Record<string, DecisionDescriptor> = {none: 'No player-visible passage bears on this line.'};
  for (const passage of all) basisCriteria[passage.alias] = `The passage ${passage.alias}.`;
  return {state, passages: new Map(all.map(passage => [passage.alias, passage])), basisCriteria, book: book.length > 0};
}

function choice(key: string, target: string, instructions: string, criteria: Record<string, DecisionDescriptor>): DecisionQuestion {
  return {key, target, type: 'choice', instructions, criteria};
}

/**
 * The batches this family sends: every batch carries the same state, and its questions are
 * independent. No question reads a peer's answer, so the batches run in parallel.
 */
export function admissionJevBatches(input: AdmissionJevInput, bindings = admissionJevBindings(input)): {batches: DecisionBatch[]; passages: Map<string, Passage>} {
  const built = catalog(input);
  const question = (index: number): DecisionQuestion[] => [
    choice(`verdict_${index}`, `proposal[${index}]`,
      `Apply \`rules\` to decide whether the player chose the Keeper's proposed line \`proposal[${index}].text\`, judged only from \`playerWords\`, \`unfinishedDeclaration\` and \`told\`. The other \`proposal\` lines are context; \`alreadySettled\` and \`alreadyRefused\` say what this turn already did.`,
      {...VERDICT_CRITERIA}),
    choice(`missing_${index}`, `proposal[${index}]`,
      `If the player has not chosen \`proposal[${index}].text\` (apply \`rules\`), select which choice is missing. Select none when the player chose it, it is a routine step of their chosen goal, or it is not the investigator's voluntary action.`,
      {...MISSING_CRITERIA}),
    choice(`basis_${index}`, `proposal[${index}]`,
      `Select the one passage alias in \`playerWords\`, \`unfinishedDeclaration\` or \`told\`${built.book ? ' (or \`bookText\`, for a line the book itself puts here)' : ''} that most decides whether the player chose \`proposal[${index}].text\`: the words that choose it, or the words that show what the player has not chosen. Select by meaning; select none when no passage bears on it.`,
      built.basisCriteria),
  ];
  const id = `admission:${input.turn}:${digest(input).slice(0, 16)}`, batches: DecisionBatch[] = [];
  for (let start = 0; start < input.proposal.length; start += ADMISSION_JEV_LINES_PER_BATCH) {
    const lines = input.proposal.slice(start, start + ADMISSION_JEV_LINES_PER_BATCH).map((_, offset) => start + offset);
    batches.push({id: `${id}:${batches.length}`, model: ADMISSION_JEV_MODEL, family: ADMISSION_JEV_FAMILY,
      familyVersion: ADMISSION_JEV_VERSION, scope: bindings.scope, readSet: bindings.readSet, state: built.state,
      questions: lines.flatMap(question)});
  }
  return {batches, passages: built.passages};
}

/** Several complete results over one state become one; any gap keeps the batch's own failure. */
function merged(results: DecisionResult[]): DecisionResult {
  const failed = results.find(result => result.status !== 'complete');
  const answers = Object.assign(Object.create(null), ...results.map(result => result.answers)) as DecisionResult['answers'];
  const keys = (field: 'required' | 'answered' | 'unknown') => results.flatMap(result => result.coverage[field]);
  return {batchId: results.map(result => result.batchId).join('+'), status: failed ? failed.status : 'complete', answers,
    coverage: {required: keys('required'), answered: keys('answered'), unknown: keys('unknown')},
    issues: results.flatMap(result => result.issues), ...(failed?.failure ? {failure: failed.failure} : {})};
}

function answered(result: DecisionResult, key: string): {choice: string; confidence?: number} | undefined {
  const value = result.answers[key];
  return value?.status === 'answered' && value.type === 'choice' ? {choice: value.choice, ...(value.confidence === undefined ? {} : {confidence: value.confidence})} : undefined;
}

/** Closed rank: a batch is admitted only when every line admits; the first refusing kind wins. */
export function batchVerdict(lines: readonly AdmissionJevVerdict[]): AdmissionJevVerdict {
  if (lines.includes('not_authorized')) return 'not_authorized';
  if (lines.includes('uncertain')) return 'uncertain';
  if (lines.includes('authorized')) return 'authorized';
  if (lines.includes('entailed')) return 'entailed';
  return 'not_player_action';
}

/**
 * Interpret a complete typed result into the lane's verdict shape. Any structural gap, or a
 * verdict confidence under the family minimum, is a fallback, never a verdict.
 */
export function interpretAdmissionJev(input: AdmissionJevInput, result: DecisionResult, passagesByAlias: Map<string, Passage>,
  minConfidence = ADMISSION_JEV_DEFAULT_MIN_CONFIDENCE):
  {status: 'decided'; verdict: AdmissionJevVerdict; grounds: string; missing?: string; confidence: number; lines: AdmissionJevLine[]}
  | {status: 'fallback'; reason: string; confidence?: number; lines?: AdmissionJevLine[]} {
  if (result.status !== 'complete') return {status: 'fallback', reason: result.failure?.code ?? `decision_${result.status}`};
  const lines: AdmissionJevLine[] = [];
  for (let index = 0; index < input.proposal.length; index++) {
    const verdict = answered(result, `verdict_${index}`), missing = answered(result, `missing_${index}`), basis = answered(result, `basis_${index}`);
    if (!verdict || !missing || !basis || !(ADMISSION_VERDICT_SET as readonly string[]).includes(verdict.choice)
      || !(ADMISSION_MISSING_KINDS as readonly string[]).includes(missing.choice)
      || basis.choice !== 'none' && !passagesByAlias.has(basis.choice)) return {status: 'fallback', reason: 'invalid_typed_answer'};
    lines.push({verdict: verdict.choice as AdmissionJevVerdict, confidence: typeof verdict.confidence === 'number' ? verdict.confidence : 0,
      missing: missing.choice as AdmissionMissingKind, ...(basis.choice === 'none' ? {} : {basis: basis.choice})});
  }
  const confidence = Math.min(...lines.map(line => line.confidence));
  if (!(confidence >= minConfidence)) return {status: 'fallback', reason: 'low_confidence', confidence, lines};
  const verdict = batchVerdict(lines.map(line => line.verdict));
  const deciding = lines.findIndex(line => line.verdict === verdict);
  const line = lines[deciding]!, passage = line.basis ? passagesByAlias.get(line.basis) : undefined;
  const proposed = clip(input.proposal[deciding]!, 100);
  // The words relied on come first, as the lane's grounds do; the line and verdict follow.
  const grounds = clip(`${passage ? `Decided by ${passage.where}: "${passage.text.trim()}"` : 'No player-visible passage chooses it'
    }; typed review judged line ${deciding + 1} ${verdict} (${proposed})`, 300);
  if (verdict === 'not_authorized' || verdict === 'uncertain') {
    const missing = verdict === 'uncertain' ? 'whether the player chose this is not clear from their words' : MISSING_TEXT[line.missing];
    return {status: 'decided', verdict, grounds, missing: clip(`${missing}: ${proposed}`, 240), confidence, lines};
  }
  return {status: 'decided', verdict, grounds, confidence, lines};
}

/** One typed review round. Never throws; every non-verdict is an explicit fallback reason. */
export async function runAdmissionJev(input: AdmissionJevInput, decision: DecisionPort, lease: TaskLease,
  options: {minConfidence?: number} = {}): Promise<AdmissionJevResult> {
  const began = Date.now(), usage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  let calls = 0;
  const fallback = (reason: string, extra: {confidence?: number; lines?: AdmissionJevLine[]} = {}): AdmissionJevResult =>
    ({status: 'fallback', reason, ...extra, calls, elapsedMs: Date.now() - began, usage});
  try {
    if (!input.proposal.length) return fallback('empty_proposal');
    if (input.proposal.length > ADMISSION_JEV_MAX_LINES) return fallback('too_many_lines');
    if (!nonempty(input.playerText)) return fallback('no_player_text');
    const bindings = admissionJevBindings(input), context = lease.context;
    if (digest(context.scope) !== digest(bindings.scope) || digest(context.readSet) !== digest(bindings.readSet))
      return fallback('attempt_binding_mismatch');
    const {batches, passages: byAlias} = admissionJevBatches(input, bindings);
    try { for (const batch of batches) packDecisionBatch(batch); }
    catch (error) { return fallback(error instanceof PackingError ? error.failure : 'schema_error'); }
    const results = await Promise.all(batches.map(async batch => {
      const result = await decision.decide(batch, lease); calls++;
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      usage.costUsd += result.usage?.costUsd ?? 0;
      return result;
    }));
    const read = interpretAdmissionJev(input, merged(results), byAlias, options.minConfidence);
    if (read.status === 'fallback') return fallback(read.reason, {...(read.confidence === undefined ? {} : {confidence: read.confidence}),
      ...(read.lines ? {lines: read.lines} : {})});
    return {...read, calls, elapsedMs: Date.now() - began, usage};
  } catch {
    return fallback('admission_owner_error');
  }
}
