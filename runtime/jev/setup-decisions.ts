/**
 * The two Jev families of the driven setup run (contract §150.6, spec `jev-decides-llm-writes.md` D-E):
 *
 * - `setup-input-route` v1: what the player's latest input does, over the setup moves the host issues as legal now
 *   (one Noul per move, the `ask_llm | none_of_above` exit Choice, and a target Choice for a move that needs one);
 * - `setup-card-fields` v1: which closed card fields the input states (occupation, era, aptitude as Choices over
 *   the catalog the kernel issues, one Noul per catalog skill) and whether it states each open field.
 *
 * Pure: batches are built from the setup read, answers are read back through the data gates, and the card plan
 * says what the run does with them. Jev never generates a name, a number or a quotation here; every candidate is a
 * value the kernel or the host issued, and every open word stays the Keeper's (`setup_card`).
 */
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {extensionContentRoot} from '../../extensions/ui/words.ts';
import {JEV_MODEL} from './question-packing.ts';
import type {DecisionAnswer, DecisionBatch, DecisionQuestion, DecisionResult, ReadSet, ScopeBinding} from './contracts.ts';

export const SETUP_ROUTE_FAMILY = 'setup-input-route';
export const SETUP_FIELDS_FAMILY = 'setup-card-fields';
export const SETUP_INTEREST_FAMILY = 'setup-interest-fit';
export const SETUP_POLICY = Object.freeze({name: 'coc-setup-v1', version: '1'});

type Row = Record<string, any>;

// ---- Gates (data) --------------------------------------------------------------------------------------------

/** `setup_driven` in `content/rulesets/coc7/host-budgets.json` (§150.6 decision 6). */
export interface SetupDrivenBudget {
  /** A Noul clears at `yes >= rowMin` ... */
  rowMin: number;
  /** ... and `yes >= rowRatio * no` (jev-driven-steps D2.5). */
  rowRatio: number;
  /** A Choice clears at `confidence >= choiceMin`. */
  choiceMin: number;
  /** One decision's deadline. */
  decisionTimeoutMs: number;
  /** Jev decision steps per run: the route, the card fields, the interest fit (one fan-out each). */
  maxDecisions: number;
  /** `setup-interest-fit`'s own row gate (the same D2.5 form). */
  interestRowMin: number;
  interestRowRatio: number;
  /** At most this many fitting skills are put on the interest list. */
  interestSkillMax: number;
}

/** Used only if the file or its `setup_driven` section cannot be read; the shipped file carries the real values. */
export const SETUP_DRIVEN_FALLBACK: SetupDrivenBudget = Object.freeze({rowMin: 0.5, rowRatio: 2, choiceMin: 0.5, decisionTimeoutMs: 8000, maxDecisions: 3,
  interestRowMin: 0.5, interestRowRatio: 1, interestSkillMax: 6});

let cached: Promise<SetupDrivenBudget> | undefined;

/** Read once per process and cached; `contentRoot` is for tests only and is never cached. */
export function setupDrivenBudget(contentRoot?: string): Promise<SetupDrivenBudget> {
  if (contentRoot !== undefined) return readSetupDrivenBudget(contentRoot);
  return cached ??= readSetupDrivenBudget();
}

async function readSetupDrivenBudget(contentRoot?: string): Promise<SetupDrivenBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {setup_driven?: Row};
    const block = raw.setup_driven ?? {}, fallback = SETUP_DRIVEN_FALLBACK;
    const unit = (value: unknown, otherwise: number) => typeof value === 'number' && value > 0 && value < 1 ? value : otherwise;
    const positive = (value: unknown, otherwise: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : otherwise;
    return {rowMin: unit(block.row_min, fallback.rowMin), rowRatio: positive(block.row_ratio, fallback.rowRatio), choiceMin: unit(block.choice_min, fallback.choiceMin),
      decisionTimeoutMs: positive(block.decision_timeout_ms, fallback.decisionTimeoutMs),
      maxDecisions: Number.isInteger(block.max_decisions) && block.max_decisions >= 1 ? block.max_decisions : fallback.maxDecisions,
      interestRowMin: unit(block.interest_row_min, fallback.interestRowMin), interestRowRatio: positive(block.interest_row_ratio, fallback.interestRowRatio),
      interestSkillMax: Number.isInteger(block.interest_skill_max) && block.interest_skill_max >= 1 ? block.interest_skill_max : fallback.interestSkillMax};
  } catch {
    return SETUP_DRIVEN_FALLBACK;
  }
}

/** Test-only: forgets the cached value. */
export function resetSetupDrivenBudgetCache(): void { cached = undefined; }

// ---- The setup read ------------------------------------------------------------------------------------------

/** What the onboarding extension's `read()` returns (§150.6 Read): the setup state, the catalog, the latest input. */
export interface SetupRead {
  ready: boolean;
  blocked: {kind: string; code?: string} | null;
  complete: boolean;
  campaign: string | null;
  created: boolean;
  next: string | null;
  allowed: string[];
  completed: string[];
  source_kind: string | null;
  investigator_source: string | null;
  /** The table's step ids by the op each runs (the table names them; the host knows the ops). */
  steps: {choose?: string; prepare?: string; create?: string; draft?: string; confirm?: string; browse?: string; load?: string};
  /** The card on the table: its summary (numbers, budget), its profile (the words and lists) and the rulebook era it is built on. */
  card: {revision: number; summary: Row; profile: Row; era?: string} | null;
  confirmed: boolean;
  loaded: boolean;
  /** §26: an active package's brief still asks before the first draft. */
  brief_holds: boolean;
  sources: Array<{kind: string; module: string; title?: string}>;
  openings: Array<{scene: string; name?: string; summary?: string}> | null;
  library: Array<{library_id: string; name?: string; occupation?: string}>;
  catalog: {occupations: Array<{id: string; label?: string; skills?: string[]}>; skills: Array<{name: string; label?: string; listed?: boolean}>; characteristics: Array<{abbr: string; name?: string}>} | null;
  eras: string[];
  input: {key: string; text: string} | null;
  play_language: string | null;
}

// ---- Answers through the gates -------------------------------------------------------------------------------

export function noul(answer: DecisionAnswer | undefined): number | undefined {
  return answer?.status === 'answered' && answer.type === 'noul' ? answer.noul : undefined;
}
/** D2.5: a row clears at `yes >= rowMin` and `yes >= rowRatio * no`. */
export function clears(answer: DecisionAnswer | undefined, budget: SetupDrivenBudget): boolean {
  const yes = noul(answer);
  return yes !== undefined && yes >= budget.rowMin && yes >= budget.rowRatio * (1 - yes);
}
export function chosen(answer: DecisionAnswer | undefined, budget: SetupDrivenBudget): string | undefined {
  return answer?.status === 'answered' && answer.type === 'choice' && (answer.confidence ?? 0) >= budget.choiceMin ? answer.choice : undefined;
}
/** Every answer's distribution, for the telemetry row (spec user story 28 of pi-native-single-loop). */
export function answerRows(result: DecisionResult): Record<string, unknown> {
  return Object.fromEntries(Object.entries(result.answers ?? {}).map(([key, value]) => [key,
    value.status !== 'answered' ? {status: value.status}
      : value.type === 'noul' ? {noul: value.noul}
        : value.type === 'choice' ? {choice: value.choice, confidence: value.confidence ?? null, probabilities: value.probabilities ?? null} : {score: value.score}]));
}

// ---- setup-input-route v1 ------------------------------------------------------------------------------------

export const SETUP_MOVES = ['choose_source', 'pick_opening', 'card_fields', 'draft_now', 'approve_card', 'load_library'] as const;
export type SetupMove = typeof SETUP_MOVES[number];

/**
 * The moves the read issues as legal now (§150.6 decisions 4 and 10), and every condition that withheld one --
 * `<move>:<condition>`, structural names only -- so a run that offers nothing says why (the setup `run` row's
 * `withheld`). A move whose target list is empty is not issued.
 *
 * While a §26 package brief still asks and no card exists, the card-field move is withheld (a brief answer is the
 * Keeper's to note) and `draft_now` is issued instead: the player ending the questions or handing the rest to the
 * Keeper. Its execution records the brief's own `stop` note, after which the card-field path runs.
 */
export function moveGates(read: SetupRead): {moves: SetupMove[]; withheld: string[]} {
  const moves: SetupMove[] = [], withheld: string[] = [];
  const offer = (move: SetupMove, failed: Array<[boolean, string]>) => {
    const reasons = failed.filter(([blocked]) => blocked).map(([, name]) => `${move}:${name}`);
    if (reasons.length) withheld.push(...reasons); else moves.push(move);
  };
  const chooseDone = !!read.steps.choose && read.completed.includes(read.steps.choose);
  offer('choose_source', [[chooseDone, 'source_chosen'], [!read.sources.length, 'no_sources']]);
  offer('pick_opening', [[!read.openings?.length, 'no_opening_question']]);
  const library = read.investigator_source === 'library';
  const cardGates: Array<[boolean, string]> = [[!read.created, 'no_campaign'], [read.confirmed, 'confirmed'], [read.loaded, 'loaded'], [library, 'library_lane'],
    [!read.catalog?.occupations.length, 'no_catalog']];
  offer('card_fields', [...cardGates, [read.brief_holds && !read.card, 'brief_holds']]);
  offer('draft_now', [...cardGates, [!read.brief_holds, 'no_brief'], [!!read.card, 'card_drawn']]);
  offer('approve_card', [[!((read.card && !read.confirmed) || (read.loaded && !read.complete)), read.confirmed ? 'confirmed' : 'no_card']]);
  offer('load_library', [[!read.created, 'no_campaign'], [!!read.card, 'card_drawn'], [read.loaded, 'loaded'], [!read.library.length, 'no_library'],
    [read.investigator_source === 'new', 'new_lane'], [!read.steps.load, 'no_load_step']]);
  return {moves, withheld};
}

export function legalMoves(read: SetupRead): SetupMove[] {
  return moveGates(read).moves;
}

const MOVE_QUESTIONS: Record<SetupMove, string> = {
  choose_source: 'Does the player choose one of the listed sources (a ready-made starter or an installed module) as the book to start the campaign from? Asking about a source or comparing sources is not choosing one.',
  pick_opening: 'Does the player pick one of the listed openings as the way their campaign starts?',
  card_fields: 'Does the player state or change something about their own investigator (name, trade, age, sex, strengths, skills, background, gear, language), or ask the Keeper to fill in their investigator\'s details?',
  draft_now: 'Does the player ask to make the investigator card now, to stop the setup questions, or ask the Keeper to fill in the rest of the investigator? Only answering a setup question is not asking for the card.',
  approve_card: 'Does the player approve the investigator card on the table as it is, ready to start play (for example "that is good", "confirm it", "let us begin")? Asking for any change is not approval.',
  load_library: 'Does the player choose one of the listed saved investigators to play in this campaign?',
};

export interface RouteQuestionInput {read: SetupRead; scope: ScopeBinding; readSet: ReadSet}

/**
 * One fanned-out request (jev-driven-steps D2): a Noul per legal move -- the moves are selected by these, never by a
 * pick-one over them -- the exit Choice for an input no move carries, and each legal move's target Choice. The exit's
 * `continue` is the family's "something here applies" answer, so its probabilities are not forced onto the exits
 * when a move does apply (D2.2).
 */
export function routeBatch({read, scope, readSet}: RouteQuestionInput): DecisionBatch | undefined {
  const moves = legalMoves(read);
  if (!moves.length || !read.input) return undefined;
  const questions: DecisionQuestion[] = moves.map(move => ({key: `move_${move}`, target: 'player_input', type: 'noul' as const, instructions: MOVE_QUESTIONS[move]}));
  questions.push({key: 'exit', target: 'player_input', type: 'choice',
    instructions: 'Besides the listed setup moves, what does player_input need? Choose continue when a listed move carries what the input does.',
    criteria: {continue: 'A listed move (choosing a source or an opening, stating or changing investigator details, asking for the card now, approving the card, choosing a saved investigator) carries what the input does.',
      ask_llm: 'Asks a question, discusses or wants an opinion, asks for something no listed move carries out, or anything else the Keeper must answer in words.',
      none_of_above: 'Does none of these.'}});
  const state: Row = {player_input: read.input.text,
    setup: {next_step: read.next, card_on_table: !!read.card, ...(read.card ? {card: {name: read.card.summary?.card?.name ?? null, occupation: read.card.summary?.card?.occupation ?? null}} : {}),
      investigator_loaded: read.loaded}};
  if (moves.includes('choose_source')) {
    state.sources = read.sources.map((row, index) => ({key: `s${index}`, name: row.title ?? row.module, kind: row.kind}));
    state.configured_language = read.play_language;
    questions.push({key: 'source', target: 'sources', type: 'choice', instructions: 'Which listed source does player_input choose to start the campaign from?',
      criteria: {...Object.fromEntries(read.sources.map((row, index) => [`s${index}`, {what: row.title ?? row.module, kind: row.kind}])), none: 'No listed source is chosen.'}});
    questions.push({key: 'language_change', target: 'player_input', type: 'noul',
      instructions: 'Does player_input explicitly ask for a play language different from configured_language? Equivalent language names and tags are the same language; no stated preference means no change.'});
  }
  if (moves.includes('pick_opening')) {
    state.openings = read.openings!.map((row, index) => ({key: `o${index}`, name: row.name ?? row.scene, ...(row.summary ? {summary: row.summary} : {})}));
    questions.push({key: 'opening', target: 'openings', type: 'choice', instructions: 'Which listed opening does player_input pick?',
      criteria: {...Object.fromEntries(read.openings!.map((row, index) => [`o${index}`, {what: row.name ?? row.scene, ...(row.summary ? {summary: row.summary} : {})}])), none: 'No listed opening is picked.'}});
  }
  if (moves.includes('load_library')) {
    state.library = read.library.map((row, index) => ({key: `l${index}`, name: row.name ?? row.library_id, ...(row.occupation ? {occupation: row.occupation} : {})}));
    questions.push({key: 'library', target: 'library', type: 'choice', instructions: 'Which listed saved investigator does player_input choose to play?',
      criteria: {...Object.fromEntries(read.library.map((row, index) => [`l${index}`, {what: row.name ?? row.library_id, ...(row.occupation ? {occupation: row.occupation} : {})}])), none: 'No listed investigator is chosen.'}});
  }
  return {id: randomUUID(), model: JEV_MODEL, family: SETUP_ROUTE_FAMILY, familyVersion: '1', scope, readSet, state, questions};
}

export type RouteTarget = {kind: 'source'; source: SetupRead['sources'][number]} | {kind: 'opening'; opening: NonNullable<SetupRead['openings']>[number]}
  | {kind: 'library'; entry: SetupRead['library'][number]};
export interface RouteOutcome {
  offered: SetupMove[];
  /** The cleared move, or null when the run goes to the Keeper. */
  move: SetupMove | null;
  target?: RouteTarget;
  exit: 'ask_llm' | 'none_of_above' | null;
  reason: string;
}

/**
 * A move is selected by its own Noul (and, where it has one, its target); an input that clears two moves is the
 * Keeper's (a compound input), and one that clears none goes to the exit: `ask_llm`, `none_of_above`, or below the gate.
 */
export function interpretRoute(read: SetupRead, result: DecisionResult, budget: SetupDrivenBudget): RouteOutcome {
  const offered = legalMoves(read);
  if (result.status !== 'complete') return {offered, move: null, exit: null, reason: `jev_${result.failure?.code ?? result.status}`};
  const cleared = offered.filter(move => clears(result.answers[`move_${move}`], budget));
  if (cleared.length > 1) return {offered, move: null, exit: null, reason: 'several_moves'};
  if (!cleared.length) {
    const exit = chosen(result.answers.exit, budget);
    return exit === 'ask_llm' || exit === 'none_of_above' ? {offered, move: null, exit, reason: exit} : {offered, move: null, exit: null, reason: 'move_below_gate'};
  }
  const move = cleared[0];
  const index = (key: string, prefix: string) => {
    const value = chosen(result.answers[key], budget);
    return value && value.startsWith(prefix) && /^\d+$/.test(value.slice(prefix.length)) ? Number(value.slice(prefix.length)) : undefined;
  };
  if (move === 'choose_source') {
    const at = index('source', 's'), source = at === undefined ? undefined : read.sources[at];
    if (!source) return {offered, move: null, exit: null, reason: 'source_below_gate'};
    // The preflight's own rule (§149): a different play language is the Keeper's to settle with the player.
    if (noul(result.answers.language_change) === undefined || (noul(result.answers.language_change) ?? 1) >= budget.rowMin) return {offered, move: null, exit: null, reason: 'language_change'};
    return {offered, move, target: {kind: 'source', source}, exit: null, reason: 'move'};
  }
  if (move === 'pick_opening') {
    const at = index('opening', 'o'), opening = at === undefined ? undefined : read.openings?.[at];
    if (!opening) return {offered, move: null, exit: null, reason: 'opening_below_gate'};
    return {offered, move, target: {kind: 'opening', opening}, exit: null, reason: 'move'};
  }
  if (move === 'load_library') {
    const at = index('library', 'l'), entry = at === undefined ? undefined : read.library[at];
    if (!entry) return {offered, move: null, exit: null, reason: 'library_below_gate'};
    return {offered, move, target: {kind: 'library', entry}, exit: null, reason: 'move'};
  }
  return {offered, move, exit: null, reason: 'move'};
}

// ---- setup-card-fields v1 ------------------------------------------------------------------------------------

/**
 * The open words of the profile (§150.6 decision 3): the only keys `setup_card` writes. `name` and
 * `occupation_stated` are issued input selections (a proposed name may be `{generated}`); everything else is
 * written in the play language. The closed keys (occupation, the skill lists, era, aptitude, numbers, limits) are
 * the clerk's or the kernel's.
 */
export const OPEN_PROFILE_KEYS = Object.freeze(['name', 'occupation_stated', 'age', 'sex', 'concept', 'own_language', 'backstory', 'key_connection', 'equipment', 'weapons', 'custom_skills'] as const);
export type OpenProfileKey = typeof OPEN_PROFILE_KEYS[number];
/** The open words the kernel's `setup.draft` needs before a first card exists (kernel-ts/setup/drafts.ts resolveProfile). */
export const FIRST_CARD_OPEN_KEYS = Object.freeze(['name', 'sex', 'concept', 'own_language', 'backstory', 'key_connection', 'equipment'] as const);

/** The open fields a `stated?` Noul is asked for, each with the profile keys it opens. */
export const STATED_FIELDS: Readonly<Record<string, {asks: string; keys: readonly OpenProfileKey[]}>> = Object.freeze({
  name: {asks: 'the investigator\'s name', keys: ['name']},
  age: {asks: 'the investigator\'s age', keys: ['age']},
  sex: {asks: 'the investigator\'s sex or gender', keys: ['sex']},
  concept: {asks: 'who the investigator is beyond the trade (personality, situation, a reason to be here)', keys: ['concept']},
  own_language: {asks: 'the investigator\'s native language', keys: ['own_language']},
  backstory: {asks: 'the investigator\'s background (people, places, beliefs, treasured things, looks or history)', keys: ['backstory', 'key_connection']},
  equipment: {asks: 'gear, a vehicle, weapons or other things the investigator carries or owns', keys: ['equipment', 'weapons']},
});

export interface FieldsQuestionInput {read: SetupRead; scope: ScopeBinding; readSet: ReadSet}

/** A skill as a question shows it: the play-language label the catalog issues beside the rules' own name. */
function skillShown(row: {name: string; label?: string}): string {
  return row.label && row.label !== row.name ? `"${row.label}" (${row.name})` : `"${row.name}"`;
}

/** The catalog skills a skill list may hold: the kernel marks the others `listed: false` (Credit Rating, Cthulhu Mythos). */
export function listableSkills(catalog: NonNullable<SetupRead['catalog']>): Array<{name: string; label?: string}> {
  return catalog.skills.filter(row => row.listed !== false);
}

export function fieldsBatch({read, scope, readSet}: FieldsQuestionInput): DecisionBatch | undefined {
  const catalog = read.catalog;
  if (!catalog || !read.input) return undefined;
  const card = read.card;
  const state: Row = {player_input: read.input.text,
    card: card ? {name: card.summary?.card?.name ?? null, occupation: card.summary?.card?.occupation ?? null,
      occupation_skills: card.profile?.occupation_skills ?? [], interest_skills: card.profile?.interest_skills ?? []} : null,
    occupations: catalog.occupations.map(row => row.label && row.label !== row.id ? `${row.label} (${row.id})` : row.id),
    skills: listableSkills(catalog).map(row => row.label && row.label !== row.name ? `${row.label} (${row.name})` : row.name)};
  const questions: DecisionQuestion[] = [
    {key: 'occupation', target: 'player_input', type: 'choice',
      instructions: 'Which listed occupation is the investigator\'s trade as player_input states it? When the stated trade is not listed, choose the closest listed occupation. Choose not_stated when player_input states no trade.',
      criteria: {...Object.fromEntries(catalog.occupations.map((row, index) => [`o${index}`, {what: row.label ?? row.id, id: row.id}])),
        not_stated: 'player_input states no trade or profession for the investigator.'}},
    {key: 'occupation_stated', target: 'player_input', type: 'noul', instructions: 'Does player_input state or change the investigator\'s trade or profession?'},
    {key: 'occupation_outside', target: 'player_input', type: 'noul',
      instructions: 'Does player_input describe the investigator\'s trade in words naming something more specific than, or different from, every listed occupation (a trade the list covers only by a broader or nearby entry)?'},
  ];
  if (read.eras.length > 1) {
    state.eras = read.eras;
    questions.push({key: 'era', target: 'player_input', type: 'choice', instructions: 'Which listed finance period does player_input name as the investigator\'s time? Choose not_stated unless the player names a time or period.',
      criteria: {...Object.fromEntries(read.eras.map((era, index) => [`e${index}`, era])), not_stated: 'No time or period is named.'}});
  }
  if (catalog.characteristics.length) {
    const criteria = {...Object.fromEntries(catalog.characteristics.map(row => [row.abbr, row.name ?? row.abbr])), not_stated: 'None is described.'};
    questions.push({key: 'strong', target: 'player_input', type: 'choice',
      instructions: 'Which characteristic does player_input describe as the investigator\'s most notable strength of body or mind? Choose not_stated unless the player describes one.', criteria});
    questions.push({key: 'weak', target: 'player_input', type: 'choice',
      instructions: 'Which characteristic does player_input describe as the investigator\'s most notable weakness of body or mind? Choose not_stated unless the player describes one.', criteria});
  }
  // §150.6 decision 11: the question names the skill in the play language and in the rules' own name (the catalog's
  // `label`, from the rules data's localized labels), and asks about the ability the player describes, in any words.
  listableSkills(catalog).forEach((row, index) => questions.push({key: `skill_${index}`, target: `skills[${index}]`, type: 'noul',
    instructions: `Does player_input say the investigator is good at, trained in or known for the ability the skill ${skillShown(row)} covers, in any words (naming the skill or describing what it does)? A skill the player calls weak, untrained, to be kept at its starting value or not to be raised does not count.`}));
  for (const [field, spec] of Object.entries(STATED_FIELDS))
    questions.push({key: `stated_${field}`, target: 'player_input', type: 'noul', instructions: `Does player_input state ${spec.asks}?`});
  questions.push({key: 'delegated', target: 'player_input', type: 'noul', instructions: 'Does player_input ask the Keeper to decide or fill in details of the investigator that the player did not state?'});
  questions.push({key: 'delegated_skills', target: 'player_input', type: 'noul', instructions: 'Does player_input ask the Keeper to choose the investigator\'s skills or abilities?'});
  questions.push({key: 'numbers', target: 'player_input', type: 'noul', instructions: 'Does player_input give a specific number (in digits or words) for a characteristic, a skill or credit rating?'});
  if (card) questions.push({key: 'removal', target: 'player_input', type: 'noul', instructions: 'Does player_input ask to remove, lower or take away something already on the investigator\'s card?'});
  return {id: randomUUID(), model: JEV_MODEL, family: SETUP_FIELDS_FAMILY, familyVersion: '1', scope, readSet, state, questions};
}

export interface FieldsOutcome {
  occupation?: {id: string; label?: string};
  outside: boolean;
  era?: string;
  aptitude?: {strong: string[]; weak: string[]; origin: 'player'};
  /** Named skills, strongest Noul first. */
  skills: Array<{name: string; noul: number}>;
  stated: string[];
  delegated: boolean;
  /** The player asked the Keeper to choose the skills (the interest fit's other trigger). */
  delegatedSkills: boolean;
  numbers: boolean;
  removal: boolean;
  reason: string;
}

export function interpretFields(read: SetupRead, result: DecisionResult, budget: SetupDrivenBudget): FieldsOutcome | {unavailable: string} {
  if (result.status !== 'complete' || !read.catalog) return {unavailable: `jev_${result.failure?.code ?? result.status}`};
  const catalog = read.catalog, answers = result.answers;
  const occupationChoice = chosen(answers.occupation, budget), at = occupationChoice?.startsWith('o') ? Number(occupationChoice.slice(1)) : NaN;
  const occupation = clears(answers.occupation_stated, budget) && Number.isInteger(at) ? catalog.occupations[at] : undefined;
  const eraChoice = chosen(answers.era, budget), era = eraChoice?.startsWith('e') ? read.eras[Number(eraChoice.slice(1))] : undefined;
  const pick = (key: string) => {
    const value = chosen(answers[key], budget);
    return value && value !== 'not_stated' && catalog.characteristics.some(row => row.abbr === value) ? value : undefined;
  };
  const strong = pick('strong'), weak = pick('weak');
  const aptitude = strong === weak ? undefined : strong || weak ? {strong: strong ? [strong] : [], weak: weak ? [weak] : [], origin: 'player' as const} : undefined;
  const skills = listableSkills(catalog).map((row, index) => ({name: row.name, noul: noul(answers[`skill_${index}`]) ?? 0, cleared: clears(answers[`skill_${index}`], budget)}))
    .filter(row => row.cleared).sort((a, b) => b.noul - a.noul || a.name.localeCompare(b.name)).map(({name, noul: value}) => ({name, noul: value}));
  return {
    ...(occupation ? {occupation: {id: occupation.id, ...(occupation.label ? {label: occupation.label} : {})}} : {}),
    outside: !!occupation && clears(answers.occupation_outside, budget),
    ...(era ? {era} : {}), ...(aptitude ? {aptitude} : {}), skills,
    stated: Object.keys(STATED_FIELDS).filter(field => clears(answers[`stated_${field}`], budget)),
    delegated: clears(answers.delegated, budget), delegatedSkills: clears(answers.delegated_skills, budget), numbers: clears(answers.numbers, budget), removal: clears(answers.removal, budget),
    reason: 'fields'};
}

// ---- The card plan -------------------------------------------------------------------------------------------

export interface BoundField {field: string; path: 'jev' | 'stated' | 'rule-default'; value?: unknown}
/**
 * `interest`: after the card is written, `setup-interest-fit` picks interest skills for the points left (§150.6
 * decision 9) -- only when the player delegated the card or its skills. `kind: 'interest'` is that step alone, on a
 * card already drawn.
 */
export type CardPlan =
  | {kind: 'direct'; profile: Row; bound: BoundField[]; interest?: boolean}
  | {kind: 'bind'; first: boolean; closed: Row; open: OpenProfileKey[]; required: OpenProfileKey[]; bound: BoundField[]; interest?: boolean}
  | {kind: 'interest'; bound: BoundField[]; interest: true}
  | {kind: 'compose'; missing: string[]; bound: BoundField[]}
  | {kind: 'adjudicate'; reason: string; bound: BoundField[]};

/** A card already drawn: named skills move to the front of the list they are on; unlisted ones lead the interest list (§98). */
function reorderedLists(profile: Row, named: string[]): Row {
  const occupation: string[] = Array.isArray(profile.occupation_skills) ? profile.occupation_skills.map(String) : [];
  const interest: string[] = Array.isArray(profile.interest_skills) ? profile.interest_skills.map(String) : [];
  const front = (list: string[], names: string[]) => [...names.filter(name => list.includes(name)), ...list.filter(name => !names.includes(name))];
  const unlisted = named.filter(name => !occupation.includes(name) && !interest.includes(name));
  const nextOccupation = front(occupation, named), nextInterest = [...unlisted, ...front(interest, named)];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
  return {...(same(nextOccupation, occupation) ? {} : {occupation_skills: nextOccupation}), ...(same(nextInterest, interest) ? {} : {interest_skills: nextInterest})};
}

/** What the run does with the bound fields (§150.6 decision 5). Pure. */
export function cardPlan(read: SetupRead, fields: FieldsOutcome): CardPlan {
  const bound: BoundField[] = [];
  const card = read.card;
  if (fields.numbers) return {kind: 'adjudicate', reason: 'stated_numbers', bound};
  if (card && fields.removal) return {kind: 'adjudicate', reason: 'removal', bound};
  const closed: Row = {};
  const current = card?.profile?.occupation ?? card?.summary?.card?.occupation;
  if (fields.occupation && fields.occupation.id !== current) { closed.occupation = fields.occupation.id; bound.push({field: 'occupation', path: 'jev', value: fields.occupation.id}); }
  if (fields.era) { closed.era = fields.era; bound.push({field: 'era', path: 'jev', value: fields.era}); }
  if (fields.aptitude) { closed.aptitude = fields.aptitude; bound.push({field: 'aptitude', path: 'jev', value: fields.aptitude}); }
  const named = fields.skills.map(row => row.name);
  if (named.length) {
    if (!card) closed.occupation_skills = named;
    else Object.assign(closed, reorderedLists(card.profile ?? {}, named));
    for (const key of ['occupation_skills', 'interest_skills']) if (closed[key]) bound.push({field: key, path: 'jev', value: closed[key]});
  }
  const open = new Set<OpenProfileKey>(fields.stated.flatMap(field => [...(STATED_FIELDS[field]?.keys ?? [])]));
  // The player's own trade words ride on the card only as a copy of what they wrote (§150.6 Decide).
  if (fields.outside && fields.occupation) open.add('occupation_stated');
  // §150.6 decision 9: a card the player delegated gets its interest skills from the interest fit once it is written.
  const interest = fields.delegated || fields.delegatedSkills ? {interest: true as const} : {};
  if (!card) {
    if (!closed.occupation) return fields.delegated ? {kind: 'adjudicate', reason: 'delegated_trade', bound} : {kind: 'compose', missing: ['occupation'], bound};
    if (!fields.stated.includes('name') && !fields.delegated) return {kind: 'compose', missing: ['name'], bound};
    bound.push({field: 'characteristics', path: 'rule-default'}, {field: 'credit_rating', path: 'rule-default'}, {field: 'skill_points', path: 'rule-default'});
    return {kind: 'bind', first: true, closed, open: [...OPEN_PROFILE_KEYS],
      required: [...FIRST_CARD_OPEN_KEYS, ...(open.has('occupation_stated') ? ['occupation_stated' as const] : [])], bound, ...interest};
  }
  if (open.size) return {kind: 'bind', first: false, closed, open: OPEN_PROFILE_KEYS.filter(key => open.has(key)), required: [], bound, ...interest};
  if (Object.keys(closed).length) return {kind: 'direct', profile: closed, bound, ...interest};
  if (interest.interest) return {kind: 'interest', bound, interest: true};
  return {kind: 'adjudicate', reason: 'nothing_bound', bound};
}

// ---- setup-interest-fit v1 -----------------------------------------------------------------------------------

/**
 * The skills the interest fit may pick (§150.6 decision 9): catalog skills a list may hold, not already on the card
 * (either list) and not the occupation's own printed skills. Structural set arithmetic over names the kernel issued.
 */
export function interestCandidates(read: SetupRead): Array<{name: string; label?: string}> {
  const card = read.card, catalog = read.catalog;
  if (!card || !catalog) return [];
  const listed = new Set([...(Array.isArray(card.profile?.occupation_skills) ? card.profile.occupation_skills : []),
    ...(Array.isArray(card.profile?.interest_skills) ? card.profile.interest_skills : [])].map(String));
  const occupation = String(card.profile?.occupation ?? card.summary?.card?.occupation ?? '');
  const printed = new Set((catalog.occupations.find(row => row.id === occupation)?.skills ?? []).map(String));
  return listableSkills(catalog).filter(row => !listed.has(row.name) && !printed.has(row.name));
}

/** The interest points the drawn card still has to spend (the kernel's own budget report). */
export function interestPointsLeft(read: SetupRead): number {
  const left = Number(read.card?.summary?.budget?.interest?.unspent);
  return Number.isFinite(left) ? left : 0;
}

const FIT_QUESTION = 'Does this skill fit the investigator as the card describes them -- their concept, background and way of life -- so that a player building this character would plausibly give it interest points?';

/**
 * One fan-out: one Noul per candidate skill and one `exists` Noul, split into as many batches as packing needs (the
 * `exists` question rides on the first). State is minimal (D2.3): the card's occupation, concept and background as
 * drafted, its era, and the batch's candidates.
 */
export function interestBatches({read, scope, readSet}: FieldsQuestionInput, pack: (batch: DecisionBatch) => void): DecisionBatch[] {
  const candidates = interestCandidates(read), card = read.card;
  if (!card || !candidates.length) return [];
  // §150.6 decision 11: the player's own words ride along, so a skill the player asked to keep is asked about too.
  const playerInput = read.input?.text ?? null;
  const profile = card.profile ?? {};
  const investigator: Row = {occupation: profile.occupation ?? card.summary?.card?.occupation ?? null, ...(profile.occupation_stated ? {occupation_stated: profile.occupation_stated} : {}),
    concept: profile.concept ?? null, backstory: profile.backstory ?? null, era: card.era ?? profile.era ?? null};
  const build = (from: number, to: number, first: boolean): DecisionBatch => {
    const slice = candidates.slice(from, to);
    const questions: DecisionQuestion[] = slice.flatMap((row, local) => [
      {key: `fit_${from + local}`, target: `skills[${local}]`, type: 'noul' as const, instructions: FIT_QUESTION},
      {key: `hold_${from + local}`, target: `skills[${local}]`, type: 'noul' as const,
        instructions: `Did the player, in player_input, ask to keep the skill ${skillShown(row)} at its starting value, or not to raise it?`}]);
    if (first) questions.push({key: 'exists', target: 'skills', type: 'noul',
      instructions: 'Does any listed skill fit the investigator as the card describes them, so that a player building this character would plausibly give it interest points?'});
    return {id: randomUUID(), model: JEV_MODEL, family: SETUP_INTEREST_FAMILY, familyVersion: '1', scope, readSet,
      state: {investigator, player_input: playerInput, skills: slice.map(row => row.label && row.label !== row.name ? `${row.label} (${row.name})` : row.name)}, questions};
  };
  const split = (from: number, to: number, first: boolean): DecisionBatch[] => {
    const batch = build(from, to, first);
    try { pack(batch); return [batch]; }
    catch (error) {
      if (to - from < 2) throw error;
      const middle = from + Math.ceil((to - from) / 2);
      return [...split(from, middle, first), ...split(middle, to, false)];
    }
  };
  return split(0, candidates.length, true);
}

export interface InterestOutcome {
  status: 'set' | 'none_cleared' | 'no_points' | 'no_candidates' | 'unavailable' | 'budget';
  /** The fitting skills, strongest Noul first, at most `interestSkillMax`. */
  skills: string[];
  reason?: string;
  /** The interest list the revise sets: the card's own interest skills first, then the fitting ones (an addition takes what is left, §98). */
  list?: string[];
  /** The interest points the card had left when the fit was asked. */
  points_left?: number;
  /** Skills the player asked to keep at their starting value: never picked, whatever their fit. */
  held?: string[];
}

/** Skills whose Noul clears the family's gate, strongest first, capped by data; none unless `exists` clears too. */
export function interpretInterest(read: SetupRead, results: DecisionResult[], budget: SetupDrivenBudget): InterestOutcome {
  if (!results.length || results.some(result => result.status !== 'complete')) {
    const failed = results.find(result => result.status !== 'complete');
    return {status: 'unavailable', skills: [], reason: `jev_${failed?.failure?.code ?? failed?.status ?? 'unavailable'}`};
  }
  const gate: SetupDrivenBudget = {...budget, rowMin: budget.interestRowMin, rowRatio: budget.interestRowRatio};
  const answers: Record<string, DecisionAnswer> = Object.assign({}, ...results.map(result => result.answers));
  if (!clears(answers.exists, gate)) return {status: 'none_cleared', skills: [], reason: 'exists_below_gate'};
  const candidates = interestCandidates(read);
  // A player's explicit hold wins over any fit (§150.6 decision 11).
  const held = candidates.filter((_row, index) => clears(answers[`hold_${index}`], gate)).map(row => row.name);
  const skills = candidates.map((row, index) => ({name: row.name, yes: noul(answers[`fit_${index}`]) ?? 0, cleared: clears(answers[`fit_${index}`], gate) && !held.includes(row.name)}))
    .filter(row => row.cleared).sort((a, b) => b.yes - a.yes || a.name.localeCompare(b.name)).slice(0, budget.interestSkillMax).map(row => row.name);
  const holds = held.length ? {held} : {};
  return skills.length ? {status: 'set', skills, ...holds} : {status: 'none_cleared', skills: [], reason: 'no_skill_cleared', ...holds};
}
