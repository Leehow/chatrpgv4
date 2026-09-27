/**
 * SL-97 phase 2a: an alternative typed admission family, offline only (experiment code, not wired into the product).
 *
 * The §32.10 family asks one five-verdict Choice per proposed line and reads only its top option. Phase 1 found that
 * (a) half the low-confidence lines are the world's response (an NPC's answer, a manifestation) judged as if the
 * player had to choose them, and (b) three of the five verdicts admit, so probability split between two admitting
 * verdicts lowers the confidence of an answer whose admit/refuse reading is clear.
 *
 * This family follows the lane's own order (§32.2's clarification, "agency precedes consent") and the Jev skill's
 * guidance (decompose, one question per judgement, fan-out over one state, combine in host arithmetic):
 *   - `role_i`   Choice: who acts in line i -- the investigator by their own will, the world answering, or time passing;
 *   - `choice_i` Choice: read as the investigator's act, did the player's words choose it;
 *   - `result_i` Choice: read as the world's response, does it follow from what the investigator did, or does it need an
 *                investigator action the player did not choose;
 *   - `span_i`   Choice: read as time, is it the time the chosen activity takes;
 *   - revision 2a.2 adds two element questions: `target_i` (did the player address whom or what the act is aimed at)
 *                and `gate_i` (does the line get past an obstacle the player's words did not take on);
 *   - revision 2a.3 adds `order_i` (does the line get ahead of a step or a condition the player set) and names a skill
 *                other than the one the player named as the Keeper choosing;
 *   - `missing_i`, `basis_i`: the §32.10 refusal-text questions, unchanged in meaning.
 * Every conditional question is asked for every line; the role distribution weighs them. Each question's admitting
 * options are summed (a closed membership, below), so probability spread across two admitting readings is not lost:
 *   2a.1: P(admit_i) = P(act)·A(choice) + P(world)·A(result) + P(time)·A(span)
 *   2a.2: P(admit_i) = min( P(act)·min(A(choice), A(target)) + P(world)·A(result) + P(time)·A(span), A(gate) )
 *   2a.3: the same, with A(order) beside A(gate) in the outer min
 * where A(q) is question q's admitting mass. min is the weakest-judgment rule of TypeSafe's function-calling cookbook.
 * The line's confidence is the two-option Choice confidence of that admit/refuse distribution, |2·P(admit_i) − 1|.
 * Jev judges every semantic question; the host only packs the §32.3 input, parses the closed effect kind from the
 * host's own line grammar, sums probabilities and gates. No list, pattern or table decides anything semantic.
 *
 * `ablation: true` adds one more question per line, `single_i`: a single Choice over collapsed verdicts, admit mass
 * summed, so one run measures the role decomposition against collapsing labels alone.
 */
import {createHash} from 'node:crypto';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from '../../runtime/jev/question-packing.ts';
import {splitSourceText} from '../../runtime/jev/source-ref.ts';
import type {DecisionBatch, DecisionDescriptor, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from '../../runtime/jev/contracts.ts';
import type {TaskLease} from '../../runtime/jev/task-context.ts';
import type {AdmissionJevInput, AdmissionJevVerdict, AdmissionMissingKind} from '../../runtime/jev/admission-domain.ts';
import {ADMISSION_MISSING_KINDS, batchVerdict} from '../../runtime/jev/admission-domain.ts';

export const ROLES_FAMILY = 'action-admission-roles';
export const ROLES_REVISIONS = ['2a.1', '2a.2', '2a.3'] as const;
export type RolesRevision = typeof ROLES_REVISIONS[number];
export const ROLES_DEFAULT_REVISION: RolesRevision = '2a.2';
export const ROLES_MODEL = JEV_MODEL;
/** The fast path's default (§32.11); a policy constant, not a calibrated claim. */
export const ROLES_DEFAULT_MIN_CONFIDENCE = 0.87;
/** Same bound as §32.10: a larger proposal goes to the lane. */
export const ROLES_MAX_LINES = 8;

const KEEPER_WINDOW_UTF16 = 1500;
const EARLIER_PLAYER_UTF16 = 400;
const PASSAGE_UTF16 = 160;

type Distribution = Record<string, number>;
export const ROLE_OPTIONS = ['investigator_act', 'world_response', 'time_passing'] as const;
type Role = typeof ROLE_OPTIONS[number];

/** The state's field legend: facts about the data, travelling beside it. Policy lives in the questions. */
export const FIELD_NOTES: Record<string, string> = {
  playerWords: 'What the player typed this turn, split into passages. This is the only current evidence of what the player chose.',
  justTold: 'The last thing the Keeper delivered before the player spoke, and what the player said then: what the player is answering.',
  earlier: 'Older deliveries, oldest first, with what the player said at each.',
  unfinishedDeclaration: 'The player\'s previous words, from a turn that ended without any delivery. Context: the current words may resume, narrow, replace or withdraw it.',
  settledThisTurn: 'What this turn already settled before this proposal.',
  refusedThisTurn: 'Proposals already refused this turn and why.',
  proposal: 'The Keeper\'s proposed lines. `kind` is the effect kind. Every why, how, goal, method, stakes, via and label field in a line is the Keeper describing its own proposal: it is never the player\'s words and never evidence of the player\'s choice.',
};
/** §11.5.4 (SL-51), as in §32.10. */
const BOOK_TEXT_NOTE = 'The book\'s own text the host carried to the Keeper this turn: it says whom and what the book puts here. It is never what the player was told and never the player\'s choice.';
const EVIDENCE = '`playerWords`, `unfinishedDeclaration`, `justTold` and `earlier`';
const NOT_KEEPER_TEXT = 'never from the line\'s own why, how, goal, method, stakes, via or label';

const ROLE_CRITERIA: Record<Role, DecisionDescriptor> = {
  investigator_act: {
    what: 'The line has the investigator do something by their own will: travel or move to a place, search, open, force, take or use something, speak to persuade, deceive, bargain with, question or threaten someone, pay, give or promise something, attack, or roll dice for such an attempt.',
    not_for: 'What another person says, does, shows or hands over; what the investigator sees, hears, finds or learns as a result; a roll the rules impose on the investigator; time passing.',
  },
  world_response: {
    what: 'Someone or something other than the investigator acts or answers: a person\'s reply, information, offer, handover or own initiative; what a place, a document or a search turns up; something done to the investigator; a roll the rules impose on the investigator, such as staying alive, resisting or noticing; the result of something already settled.',
    not_for: 'The investigator going somewhere or attempting something by their own will.',
  },
  time_passing: {
    what: 'The line only records minutes or hours passing.',
    not_for: 'A line that also moves the investigator, hands over something or rolls dice.',
  },
};

/** One question family of a revision: its closed options, which of them admit, its instruction and criteria. */
interface Family {
  name: string;
  options: readonly string[];
  admitting: readonly string[];
  instructions: (line: string) => string;
  criteria: Record<string, DecisionDescriptor>;
}

const CHOICE_2A1: Record<string, DecisionDescriptor> = {
  chosen: {
    what: 'The player\'s words choose this action: where the investigator goes, what they do, how, to whom or to what, and any price or promise. Words that pick one of the places or options `justTold` named choose it, travel included. For a move, `registered_destination` names the place: naming it by any of its names, in any language, or naming a room, floor or entrance of it, chooses it. A short or plain reply that says what to do still chooses it.',
  },
  routine_step: {
    what: 'The player chose the goal, and this line is an ordinary step that goal needs: the dice roll their chosen approach calls for, crossing to the thing they asked to search, the way back they already said they would take.',
  },
  keeper_choice: {
    what: 'The Keeper picks for the player: a destination, method, target, price, payment or promise the player\'s words did not choose; a route or option the Keeper offered that the player did not take up; acting on a subject the player only asked about or showed interest in; something the player limited, postponed, refused or said they would not do; a step past a gatekeeper, a price or a danger the player\'s words did not address; an action already in `refusedThisTurn` proposed again in other words.',
  },
  unclear: 'The player\'s words and what they were told do not settle whether they chose this.',
};
const CHOICE_2A2: Record<string, DecisionDescriptor> = {
  chosen: CHOICE_2A1.chosen!,
  routine_step: {
    what: 'The player chose the goal and the way, and this line is an ordinary step it needs that adds no new person, approach or obstacle: crossing to the thing they asked to search, the skill roll for exactly the approach they described, the way back they already said they would take.',
    not_for: 'A roll against a person the player did not speak to, a roll for an approach the player did not describe, a roll to get past someone or something the player did not take on.',
  },
  keeper_choice: {
    what: 'The Keeper picks for the player: a destination, method, target, price, payment or promise the player\'s words did not choose; a dice roll for an approach or against a person the player\'s words did not choose, such as a social roll with someone they did not speak to; a route or option the Keeper offered that the player did not take up; acting on a subject the player only asked about or showed interest in; something the player limited, postponed, refused or said they would not do; a step past a gatekeeper, a price or a danger the player\'s words did not take on; an action already in `refusedThisTurn` proposed again in other words.',
  },
  unclear: CHOICE_2A1.unclear!,
};
const CHOICE_2A3: Record<string, DecisionDescriptor> = {
  chosen: CHOICE_2A1.chosen!,
  routine_step: CHOICE_2A2.routine_step!,
  keeper_choice: {
    what: 'The Keeper picks for the player: a destination, method, target, price, payment or promise the player\'s words did not choose; a skill or approach other than the one the player named; a dice roll for an approach or against a person the player\'s words did not choose, such as a social roll with someone they did not speak to; a route or option the Keeper offered that the player did not take up; acting on a subject the player only asked about or showed interest in; something the player limited, postponed, refused or said they would not do; a step past a gatekeeper, a price or a danger the player\'s words did not take on; an action already in `refusedThisTurn` proposed again in other words.',
  },
  unclear: CHOICE_2A1.unclear!,
};
const choiceFamily = (criteria: Record<string, DecisionDescriptor>): Family => ({name: 'choice', options: Object.keys(criteria),
  admitting: ['chosen', 'routine_step'], criteria,
  instructions: line => `Read ${line} as something the investigator does by their own will. Judging only from ${EVIDENCE}, ${NOT_KEEPER_TEXT}, did the player choose it?`});

const RESULT_2A1: Record<string, DecisionDescriptor> = {
  follows: {
    what: 'It answers or results from what the player\'s words did or asked, this turn or already settled: the reply to their question, what their chosen search, look or visit turns up, what the person they addressed says, offers or hands over. Or it is a person, a place or the rules acting on their own, or a consequence of something already settled. The player need not have known or wanted the result.',
  },
  needs_unchosen_act: {
    what: 'It could only happen after an investigator action the player did not choose: a trip they did not take, a search, door, lock or drawer they did not try, a person they did not approach or question, a price or bargain they did not accept, a gatekeeper or refusal their words did not get past.',
  },
  unclear: 'What the player did does not settle whether this follows from it.',
};
const RESULT_2A2: Record<string, DecisionDescriptor> = {
  answers_player: {
    what: 'It is what the investigator\'s chosen action turns up or is told: the reply to their question, what their chosen search, look or visit finds, what the person they addressed says, offers or hands over. The player need not have known or wanted the result.',
  },
  world_on_its_own: {
    what: 'A person, a place, a thing or the rules act on their own, or it is a consequence of something already settled: an unprompted remark or gesture, a manifestation, something done to the investigator.',
  },
  needs_unchosen_act: RESULT_2A1.needs_unchosen_act!,
  unclear: RESULT_2A1.unclear!,
};
const resultFamily = (criteria: Record<string, DecisionDescriptor>, admitting: readonly string[]): Family => ({name: 'result',
  options: Object.keys(criteria), admitting, criteria,
  instructions: line => `Read ${line} as what a person, a place or the rules do or give. Judging from ${EVIDENCE} and \`settledThisTurn\`, does it follow from what the investigator did, or does it need an investigator action the player did not choose?`});

const SPAN_2A1: Record<string, DecisionDescriptor> = {
  fits: {what: 'The time the investigator\'s current activity ordinarily takes: the talk, search, reading, wait or journey the player\'s words chose or this turn already settled, or time the world imposes on the investigator.'},
  unchosen_time: {what: 'Time the player did not choose: a journey or activity their words did not choose, getting past a gatekeeper their words did not address, a stay or wait much longer than they said, time past a limit, deadline or appointment the player set.'},
  unclear: 'What the player chose does not settle whether this time is theirs.',
};
const SPAN_2A2: Record<string, DecisionDescriptor> = {
  activity_time: {what: 'Minutes or hours spent on what the investigator is doing: the talk, search, reading, wait or journey the player\'s words chose, or that this turn already settled.'},
  imposed_time: {what: 'Time the world or the rules impose on the investigator: being kept waiting, lying hurt, time a person or an event takes from them.'},
  unchosen_time: {what: 'Time for something the player\'s words did not choose: a journey or activity they did not choose, getting past a gatekeeper their words did not take on, a stay or wait longer than they said, time past a limit, deadline or appointment they set.'},
  unclear: SPAN_2A1.unclear!,
};
const spanFamily = (criteria: Record<string, DecisionDescriptor>, admitting: readonly string[], question: string): Family => ({name: 'span',
  options: Object.keys(criteria), admitting, criteria,
  instructions: line => `Read ${line} as time passing. Judging from ${EVIDENCE} and \`settledThisTurn\`, ${question}`});

const TARGET_2A2: Family = {name: 'target', options: ['addressed', 'no_target', 'not_addressed'], admitting: ['addressed', 'no_target'],
  instructions: line => `Whom or what does ${line} act on, speak to or go to? Judging only from ${EVIDENCE}, ${NOT_KEEPER_TEXT}, did the player's words address that person, thing or place?`,
  criteria: {
    addressed: {what: 'The player\'s words name, address or point to this person, thing or place, by name, role or description, or pick it from what `justTold` named, or it is the person the player is already talking to.'},
    no_target: {what: 'The line acts on no person, thing or place beyond the investigator\'s own activity.'},
    not_addressed: {what: 'The player\'s words do not address this person, thing or place: someone they did not speak to or about, a place they did not choose, a thing they did not mention.'},
  }};
const GATE_2A2: Family = {name: 'gate', options: ['no_obstacle', 'player_takes_it_on', 'skips_obstacle'], admitting: ['no_obstacle', 'player_takes_it_on'],
  instructions: line => `Does ${line} get the investigator past something \`justTold\` or \`earlier\` put in their way -- a gatekeeper, a refusal, a closed or locked way, a price, a danger -- without the player's words taking it on? Judge from ${EVIDENCE} and \`settledThisTurn\`.`,
  criteria: {
    no_obstacle: {what: 'The line crosses nothing that stood in the investigator\'s way, or `settledThisTurn` already dealt with it.'},
    player_takes_it_on: {what: 'The player\'s words take that obstacle on -- they ask, argue, pay, force, sneak past or wait for it -- and this line is that attempt or its result.'},
    skips_obstacle: {what: 'The line gets past a gatekeeper, a refusal, a closed or locked way, a price or a danger that the player\'s words did not take on.'},
  }};

const ORDER_2A3: Family = {name: 'order', options: ['in_step', 'ahead_of_plan'], admitting: ['in_step'],
  instructions: line => `Did the player set an order or a condition that ${line} gets ahead of? Judge from ${EVIDENCE} and \`settledThisTurn\`.`,
  criteria: {
    in_step: {what: 'The line is what the player said to do now, or the player\'s words set no order or condition that it gets ahead of.'},
    ahead_of_plan: {what: 'The player said to do something else first ("first ... then ...", "after ...") and that earlier step is not done yet, or the line acts as if a condition the player set ("if ...", "unless ...", "when ...") has been met when nothing shows it has.'},
  }};

const SINGLE_OPTIONS = ['player_chose', 'routine_step', 'not_investigator_choice', 'keeper_chooses', 'unclear'] as const;
const singleFamily = (choice: Record<string, DecisionDescriptor>): Family => ({name: 'single', options: SINGLE_OPTIONS,
  admitting: ['player_chose', 'routine_step', 'not_investigator_choice'],
  instructions: line => `Judging only from ${EVIDENCE}, ${NOT_KEEPER_TEXT}, did the player choose ${line}?`,
  criteria: {player_chose: choice.chosen!, routine_step: choice.routine_step!,
    not_investigator_choice: {what: 'The line is not the investigator acting by their own will: a person\'s reply, handover or own initiative, what a chosen search or visit turns up, something done to the investigator, a roll the rules impose, a consequence of something already settled, or the time a chosen activity takes.'},
    keeper_chooses: choice.keeper_choice!, unclear: choice.unclear!}});

interface Revision {families: Family[]; single: Family; combine: (answers: Record<string, Distribution>, admitting: (name: string) => number) => number}
const REVISIONS: Record<RolesRevision, Revision> = {
  '2a.1': {
    families: [choiceFamily(CHOICE_2A1), resultFamily(RESULT_2A1, ['follows']), spanFamily(SPAN_2A1, ['fits'], 'is it the time the investigator\'s current activity takes?')],
    single: singleFamily(CHOICE_2A1),
    combine: (answers, admit) => mixture(answers.role!, admit('choice'), admit('result'), admit('span')),
  },
  '2a.2': {
    families: [choiceFamily(CHOICE_2A2), resultFamily(RESULT_2A2, ['answers_player', 'world_on_its_own']),
      spanFamily(SPAN_2A2, ['activity_time', 'imposed_time'], 'whose time is it?'), TARGET_2A2, GATE_2A2],
    single: singleFamily(CHOICE_2A2),
    combine: (answers, admit) => Math.min(mixture(answers.role!, Math.min(admit('choice'), admit('target')), admit('result'), admit('span')), admit('gate')),
  },
  '2a.3': {
    families: [choiceFamily(CHOICE_2A3), resultFamily(RESULT_2A2, ['answers_player', 'world_on_its_own']),
      spanFamily(SPAN_2A2, ['activity_time', 'imposed_time'], 'whose time is it?'), TARGET_2A2, GATE_2A2, ORDER_2A3],
    single: singleFamily(CHOICE_2A3),
    combine: (answers, admit) => Math.min(mixture(answers.role!, Math.min(admit('choice'), admit('target')), admit('result'), admit('span')),
      admit('gate'), admit('order')),
  },
};
export function revisionFamilies(revision: RolesRevision = ROLES_DEFAULT_REVISION): Array<{name: string; options: readonly string[]; admitting: readonly string[]}> {
  return REVISIONS[revision].families.map(({name, options, admitting}) => ({name, options, admitting}));
}

/** §32.10's closed missing kinds, unchanged. */
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
/** §32.10's host rendering of a closed missing kind; English, read by the Keeper. */
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

interface Passage {alias: string; text: string; where: string}

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

/**
 * The closed effect kind of a proposal line, read from the host's own line grammar (`admissionRequest`:
 * `resolve (...)` or `apply <kind>: ...`). A grammar parse of host output, not a reading of the prose.
 */
export function lineKind(line: string): string {
  if (/^resolve\b/.test(line)) return 'resolve';
  const match = /^apply ([a-z_]+):/.exec(line);
  return match ? match[1]! : 'unknown';
}

export function rolesBindings(input: AdmissionJevInput, revision: RolesRevision = ROLES_DEFAULT_REVISION): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: ROLES_FAMILY, campaign: input.campaign, audience: 'player'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${input.turn}:admission:${input.tool}`, revision: digest(input)},
    {kind: 'family', resource: ROLES_FAMILY, revision},
    {kind: 'model', resource: `${ROLES_FAMILY}:jev`, revision: ROLES_MODEL},
  ]};
}

export interface RolesCatalog {state: Json; passages: Map<string, Passage>; basisCriteria: Record<string, DecisionDescriptor>; book: boolean}

/** Exactly §32.3's input, the lane's windows, packed as facts with a field legend. Nothing Keeper-only travels. */
export function rolesCatalog(input: AdmissionJevInput): RolesCatalog {
  const all: Passage[] = [];
  const told = input.delivered.map((row, index) => {
    const turn = String(row.turn);
    const player = nonempty(row.player) ? passages(clip(row.player, EARLIER_PLAYER_UTF16), `told:${index}:player`, `what the player said at turn ${turn}`) : [];
    const keeper = passages(clip(row.keeper, KEEPER_WINDOW_UTF16), `told:${index}:keeper`, `what the player was told at turn ${turn}`);
    all.push(...player, ...keeper);
    return {turn, playerSaid: player.map(({alias, text}) => ({alias, text})), keeperDelivered: keeper.map(({alias, text}) => ({alias, text}))};
  });
  const said = passages(input.playerText, 'said', 'the player\'s words this turn');
  const unfinished = input.interruptedPlayerText ? passages(input.interruptedPlayerText, 'unfinished', 'the unfinished declaration') : [];
  const book = (input.bookText ?? []).flatMap((row, index) => passages(row.text, `book:${index}`, `the book's text (${row.where}) the Keeper was shown`));
  all.push(...said, ...unfinished, ...book);
  const visible = (rows: Passage[]) => rows.map(({alias, text}) => ({alias, text}));
  const justTold = told.length ? told[told.length - 1] : undefined;
  const notes: Record<string, string> = {...FIELD_NOTES};
  if (!unfinished.length) delete notes.unfinishedDeclaration;
  if (book.length) notes.bookText = BOOK_TEXT_NOTE;
  const state = {
    fieldNotes: notes,
    investigators: input.investigators.map(row => row.occupation ? `${row.name} (${row.occupation})` : row.name),
    scene: {name: input.scene ?? '(unnamed)', present: [...input.present]},
    earlier: told.slice(0, -1),
    justTold: justTold ?? null,
    playerWords: visible(said),
    ...(unfinished.length ? {unfinishedDeclaration: visible(unfinished)} : {}),
    ...(book.length ? {bookText: visible(book)} : {}),
    settledThisTurn: [...input.landed],
    refusedThisTurn: [...input.refused],
    proposal: input.proposal.map((text, index) => ({line: index, kind: lineKind(text), text})),
  } as unknown as Json;
  const basisCriteria: Record<string, DecisionDescriptor> = {none: 'No player-visible passage bears on this line.'};
  for (const passage of all) basisCriteria[passage.alias] = `The passage ${passage.alias}.`;
  return {state, passages: new Map(all.map(passage => [passage.alias, passage])), basisCriteria, book: book.length > 0};
}

const choice = (key: string, target: string, instructions: string, criteria: Record<string, DecisionDescriptor>): DecisionQuestion =>
  ({key, target, type: 'choice', instructions, criteria});

export interface RolesOptions {ablation?: boolean; revision?: RolesRevision}

/** The questions for one line. Independent: none reads a peer's answer. */
export function lineQuestions(index: number, catalog: RolesCatalog, options: RolesOptions = {}): DecisionQuestion[] {
  const revision = REVISIONS[options.revision ?? ROLES_DEFAULT_REVISION];
  const line = `\`proposal[${index}]\``, target = `proposal[${index}]`;
  const family = (value: Family) => choice(`${value.name}_${index}`, target, value.instructions(line), {...value.criteria});
  return [
    choice(`role_${index}`, target,
      `Who acts in ${line}? Read its \`kind\` and \`text\` and classify the line itself, not whether the player wanted it.`,
      {...ROLE_CRITERIA}),
    ...revision.families.map(family),
    choice(`missing_${index}`, target,
      `If the player has not chosen ${line}, select which choice is missing. Select none when the player chose it, it is a routine step of their chosen goal, or it is not the investigator's voluntary action.`,
      {...MISSING_CRITERIA}),
    choice(`basis_${index}`, target,
      `Select the one passage alias in ${EVIDENCE}${catalog.book ? ' (or `bookText`, for a line the book itself puts here)' : ''} that most decides whether the player chose ${line}: the words that choose it, or the words that show what the player has not chosen. Select by meaning; select none when no passage bears on it.`,
      catalog.basisCriteria),
    ...(options.ablation ? [family(revision.single)] : []),
  ];
}

export interface RolesBatchOptions extends RolesOptions {maxLinesPerBatch?: number}

/**
 * Same-state batches: as many lines per batch as the packing bound allows (greedy, in order), so most proposals are
 * one request. A line that does not fit alone is a packing failure, never a split question.
 */
export function rolesBatches(input: AdmissionJevInput, bindings?: {scope: ScopeBinding; readSet: ReadSet}, options: RolesBatchOptions = {}):
  {batches: DecisionBatch[]; passages: Map<string, Passage>} {
  const revision = options.revision ?? ROLES_DEFAULT_REVISION;
  const bound = bindings ?? rolesBindings(input, revision);
  const catalog = rolesCatalog(input);
  const id = `admission-roles:${input.turn}:${digest(input).slice(0, 16)}`;
  const make = (lines: number[], n: number): DecisionBatch => ({id: `${id}:${n}`, model: ROLES_MODEL, family: ROLES_FAMILY,
    familyVersion: revision, scope: bound.scope, readSet: bound.readSet, state: catalog.state,
    questions: lines.flatMap(index => lineQuestions(index, catalog, options))});
  const limit = options.maxLinesPerBatch ?? Infinity;
  const batches: DecisionBatch[] = [];
  let open: number[] = [];
  for (let index = 0; index < input.proposal.length; index++) {
    const tried = [...open, index];
    let fits = tried.length <= limit;
    if (fits) try { packDecisionBatch(make(tried, batches.length)); } catch (error) {
      if (!(error instanceof PackingError) || error.failure !== 'packing_limit') throw error;
      fits = false;
    }
    if (fits) { open = tried; continue; }
    if (!open.length) throw new PackingError('packing_limit');
    batches.push(make(open, batches.length));
    open = [index];
    packDecisionBatch(make(open, batches.length));
  }
  if (open.length) batches.push(make(open, batches.length));
  return {batches, passages: catalog.passages};
}

export interface RolesLine {
  /** The lane-shaped verdict this line maps to (telemetry and exact-agreement only; admission reads `admit`). */
  verdict: AdmissionJevVerdict;
  admit: boolean;
  pAdmit: number;
  confidence: number;
  /** Every typed distribution of this line, by question family (`role`, `choice`, `result`, `span`, ...). */
  answers: Record<string, Distribution>;
  missing: AdmissionMissingKind;
  basis?: string;
  /** Ablation: the collapsed single Choice's admit mass, when asked. */
  singleAdmit?: number;
}

function distribution(result: DecisionResult, key: string, options: readonly string[]): Distribution | undefined {
  const value = result.answers[key];
  if (value?.status !== 'answered' || value.type !== 'choice' || !value.probabilities) return undefined;
  const out: Distribution = {};
  for (const option of options) {
    const p = value.probabilities[option];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return undefined;
    out[option] = p;
  }
  return out;
}
const mass = (value: Distribution, keys: readonly string[]) => keys.reduce((total, key) => total + (value[key] ?? 0), 0);
const top = (value: Distribution) => Object.entries(value).reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** The mixture over roles: each role's admitting mass weighed by the role's probability. Pure arithmetic. */
export function mixture(role: Distribution, act: number, world: number, time: number): number {
  const total = mass(role, ROLE_OPTIONS);
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, (role.investigator_act! * act + role.world_response! * world + role.time_passing! * time) / total));
}
/** 2a.1's admit probability from its three conditional answers (kept for the tests and the first iteration's rows). */
export function admitProbability(role: Distribution, choiceAnswer: Distribution, resultAnswer: Distribution, spanAnswer: Distribution): number {
  return mixture(role, mass(choiceAnswer, ['chosen', 'routine_step']), mass(resultAnswer, ['follows']), mass(spanAnswer, ['fits']));
}
/** The two-option Choice confidence of an admit/refuse distribution (TypeSafe's formula with n = 2). */
export const binaryConfidence = (pAdmit: number) => round(Math.abs(2 * pAdmit - 1));

/** The lane-shaped label of one line: which role dominates, and which admitting or refusing option within it. */
export function lineVerdict(admit: boolean, answers: Record<string, Distribution>): AdmissionJevVerdict {
  const dominant = top(answers.role!) as Role;
  const conditional = answers[dominant === 'investigator_act' ? 'choice' : dominant === 'world_response' ? 'result' : 'span'] ?? {};
  if (!admit) return conditional.unclear !== undefined && top(conditional) === 'unclear' ? 'uncertain' : 'not_authorized';
  const choiceAnswer = answers.choice ?? {};
  if (dominant === 'investigator_act') return (choiceAnswer.chosen ?? 0) >= (choiceAnswer.routine_step ?? 0) ? 'authorized' : 'entailed';
  return dominant === 'world_response' ? 'not_player_action' : 'entailed';
}

export type RolesInterpretation =
  | {status: 'decided'; verdict: AdmissionJevVerdict; admit: boolean; confidence: number; lines: RolesLine[]; grounds: string; missing?: string}
  | {status: 'fallback'; reason: string; confidence?: number; lines?: RolesLine[]};

/** Interpret a complete typed result. A structural gap or a confidence under the minimum is a fallback, never a verdict. */
export function interpretRoles(input: AdmissionJevInput, result: DecisionResult, byAlias: Map<string, Passage>,
  minConfidence = ROLES_DEFAULT_MIN_CONFIDENCE, options: RolesOptions = {}): RolesInterpretation {
  if (result.status !== 'complete') return {status: 'fallback', reason: result.failure?.code ?? `decision_${result.status}`};
  const revision = REVISIONS[options.revision ?? ROLES_DEFAULT_REVISION];
  const families = [{name: 'role', options: ROLE_OPTIONS, admitting: []}, ...revision.families];
  const lines: RolesLine[] = [];
  for (let index = 0; index < input.proposal.length; index++) {
    const answers: Record<string, Distribution> = {};
    for (const family of families) {
      const value = distribution(result, `${family.name}_${index}`, family.options);
      if (!value) return {status: 'fallback', reason: 'invalid_typed_answer'};
      answers[family.name] = value;
    }
    const single = options.ablation ? distribution(result, `single_${index}`, revision.single.options) : undefined;
    const missing = result.answers[`missing_${index}`], basis = result.answers[`basis_${index}`];
    if (options.ablation && !single
      || missing?.status !== 'answered' || missing.type !== 'choice' || !(ADMISSION_MISSING_KINDS as readonly string[]).includes(missing.choice)
      || basis?.status !== 'answered' || basis.type !== 'choice' || basis.choice !== 'none' && !byAlias.has(basis.choice))
      return {status: 'fallback', reason: 'invalid_typed_answer'};
    const admitting = (name: string) => mass(answers[name]!, revision.families.find(family => family.name === name)!.admitting);
    const pAdmit = round(revision.combine(answers, admitting)), admit = pAdmit >= 0.5;
    lines.push({verdict: lineVerdict(admit, answers), admit, pAdmit, confidence: binaryConfidence(pAdmit), answers,
      missing: missing.choice as AdmissionMissingKind, ...(basis.choice === 'none' ? {} : {basis: basis.choice}),
      ...(single ? {singleAdmit: round(mass(single, revision.single.admitting))} : {})});
  }
  const confidence = Math.min(...lines.map(line => line.confidence));
  if (!(confidence >= minConfidence)) return {status: 'fallback', reason: 'low_confidence', confidence, lines};
  const admit = lines.every(line => line.admit);
  const verdict = batchVerdict(lines.map(line => line.verdict));
  const deciding = admit ? lines.findIndex(line => line.verdict === verdict) : lines.findIndex(line => !line.admit);
  const line = lines[deciding]!, passage = line.basis ? byAlias.get(line.basis) : undefined;
  const proposed = clip(input.proposal[deciding]!, 100);
  const grounds = clip(`${passage ? `Decided by ${passage.where}: "${passage.text.trim()}"` : 'No player-visible passage chooses it'
    }; typed review judged line ${deciding + 1} ${line.verdict} (${proposed})`, 300);
  return admit ? {status: 'decided', verdict, admit, confidence, lines, grounds}
    : {status: 'decided', verdict, admit, confidence, lines, grounds, missing: clip(`${line.verdict === 'uncertain'
      ? 'whether the player chose this is not clear from their words' : MISSING_TEXT[line.missing]}: ${proposed}`, 240)};
}

/** Several complete results over one state become one; any gap keeps that batch's failure. */
function merged(results: DecisionResult[]): DecisionResult {
  const failed = results.find(result => result.status !== 'complete');
  const answers = Object.assign(Object.create(null), ...results.map(result => result.answers)) as DecisionResult['answers'];
  const keys = (field: 'required' | 'answered' | 'unknown') => results.flatMap(result => result.coverage[field]);
  return {batchId: results.map(result => result.batchId).join('+'), status: failed ? failed.status : 'complete', answers,
    coverage: {required: keys('required'), answered: keys('answered'), unknown: keys('unknown')},
    issues: results.flatMap(result => result.issues), ...(failed?.failure ? {failure: failed.failure} : {})};
}

export type RolesResult = RolesInterpretation & {calls: number; elapsedMs: number; usage: {inputTokens: number; outputTokens: number; costUsd: number}};

/** One typed review round. Never throws; every non-verdict is an explicit fallback reason. */
export async function runAdmissionRoles(input: AdmissionJevInput, decision: DecisionPort, lease: TaskLease,
  options: {minConfidence?: number} & RolesBatchOptions = {}): Promise<RolesResult> {
  const began = Date.now(), usage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  let calls = 0;
  const done = (value: RolesInterpretation): RolesResult => ({...value, calls, elapsedMs: Date.now() - began, usage});
  try {
    if (!input.proposal.length) return done({status: 'fallback', reason: 'empty_proposal'});
    if (input.proposal.length > ROLES_MAX_LINES) return done({status: 'fallback', reason: 'too_many_lines'});
    if (!nonempty(input.playerText)) return done({status: 'fallback', reason: 'no_player_text'});
    const revision = options.revision ?? ROLES_DEFAULT_REVISION;
    const bindings = rolesBindings(input, revision), context = lease.context;
    if (digest(context.scope) !== digest(bindings.scope) || digest(context.readSet) !== digest(bindings.readSet))
      return done({status: 'fallback', reason: 'attempt_binding_mismatch'});
    let built;
    try { built = rolesBatches(input, bindings, options); }
    catch (error) { return done({status: 'fallback', reason: error instanceof PackingError ? error.failure : 'schema_error'}); }
    const results = await Promise.all(built.batches.map(async batch => {
      const result = await decision.decide(batch, lease); calls++;
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      usage.costUsd += result.usage?.costUsd ?? 0;
      return result;
    }));
    return done(interpretRoles(input, merged(results), built.passages, options.minConfidence, options));
  } catch {
    return done({status: 'fallback', reason: 'admission_owner_error'});
  }
}
