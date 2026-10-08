/**
 * Typed action-admission family, role-first design (contract §32.12.3.2, SL-97 phase 2b): the product port of
 * revision 2a.3 of `experiments/admission-jev-bank/admission-roles.ts`, the design measured offline in SL-97 phase 2a
 * and re-scored against today's lane in the relabel. It sits behind the same family interface as §32.10's v1
 * (`runtime/jev/admission-domain.ts`): the same `AdmissionJevInput`, the same result shape (`AdmissionJevResult`, a
 * lane-shaped verdict and confidence per line), the same fallbacks. Only the questions and the host arithmetic differ.
 *
 * Per proposed line, independent Choices over one shared state (§32.3's input, packed as facts with a field legend):
 *   - `role_i`   who acts in the line: the investigator by their own will, the world answering, or time passing;
 *   - `choice_i` read as the investigator's act, did the player's words choose it;
 *   - `result_i` read as the world's response, does it follow from what the investigator did;
 *   - `span_i`   read as time, whose time is it;
 *   - `target_i` did the player's words address whom or what the act is aimed at;
 *   - `gate_i`   does the line get past an obstacle the player's words did not take on;
 *   - `order_i`  does the line get ahead of a step or a condition the player set;
 *   - `missing_i`, `basis_i`: §32.10's refusal-text questions.
 * The host combines them (closed membership of each question's admitting options, summed):
 *   P(admit_i) = min( P(act)·min(A(choice), A(target)) + P(world)·A(result) + P(time)·A(span), A(gate), A(order) )
 * and the line's confidence is the two-option Choice confidence of that admit/refuse split, |2·P(admit_i) − 1|. The
 * lane-shaped verdict of a line comes from its dominant role (telemetry and grounds only; admission reads `admit`).
 *
 * The measured revision 2a.3's state, keys and arithmetic remain pinned against the experiment. Revision 2a.4 adds
 * explicit handover field semantics; 2a.5 clarifies current execution versus speech in the choice question and criteria;
 * 2a.6 (contract §197.4) says both directions: the player's own narration of steps is execution, speech to someone is not.
 * Those scoped request changes are pinned in `tests/extension/admission-roles-domain.test.mjs`. Jev judges every semantic question; the host
 * only packs, carries the closed effect kind of each line from the proposal, sums probabilities and gates. No list,
 * pattern or table decides anything semantic.
 *
 * Authority boundary, as v1's: this module never admits by itself. It returns a typed reading or an explicit fallback;
 * which readings may settle a line is `extensions/kernel/admission.ts`'s rule (§32.12.3.2), not this module's.
 */
import {createHash} from 'node:crypto';
import type {DecisionPort} from './decision-port.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from './question-packing.ts';
import {splitSourceText} from './source-ref.ts';
import type {DecisionBatch, DecisionDescriptor, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import type {TaskLease} from './task-context.ts';
import {ADMISSION_MISSING_KINDS, batchVerdict} from './admission-domain.ts';
import {HANDOVER_GROUND_NOTE, PLAYER_EXECUTION_CHOICE_NOTE} from './action-field-semantics.ts';
import type {AdmissionJevInput, AdmissionJevLine, AdmissionJevResult, AdmissionJevVerdict, AdmissionMissingKind} from './admission-domain.ts';

/** Stable family id and current prompt revision; historical experiment requests remain frozen. */
export const ADMISSION_ROLES_FAMILY = 'action-admission-roles';
export const ADMISSION_ROLES_VERSION = '2a.7';
export const ADMISSION_ROLES_MODEL = JEV_MODEL;
/** Same bound as §32.10: a larger proposal goes to the lane. */
export const ADMISSION_ROLES_MAX_LINES = 8;

const KEEPER_WINDOW_UTF16 = 1500;
const EARLIER_PLAYER_UTF16 = 400;
const PASSAGE_UTF16 = 160;

type Distribution = Record<string, number>;
export const ROLE_OPTIONS = ['investigator_act', 'world_response', 'time_passing'] as const;
type Role = typeof ROLE_OPTIONS[number];

/** The state's field legend: facts about the data, travelling beside it. Policy lives in the questions. */
const FIELD_NOTES: Record<string, string> = {
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

/** One question family: its closed options, which of them admit, its instruction and criteria. */
interface Family {
  name: string;
  options: readonly string[];
  admitting: readonly string[];
  instructions: (line: string) => string;
  criteria: Record<string, DecisionDescriptor>;
}

const CHOSEN: DecisionDescriptor = {
  what: 'The player\'s words choose this action: their own narration of what the investigator does -- now, next, or as one step of a sequence they lay out ("then", "on arrival", "first ... then") -- including asking someone in the scene to do something, and a conditional whose condition the fiction has met. Where the investigator goes, what they do, how, to whom or to what, and any price or promise. A choice that picks one of the places or options `justTold` named chooses it, travel included. For a chosen move, `registered_destination` names the place: any of its names, in any language, or an unregistered room, floor or entrance of it names the same destination. Its `inside` names the places it lies in: a move between two places inside one place (`relation_to_party` shared), or out to a place the party already stands inside (around) on the way to a place in it the player chose, is part of that one choice. A place registered inside another is still its own place: standing at its door or looking into it does not choose entering it. A short or plain reply that says what to do still chooses it.',
  not_for: 'What the investigator says to someone in the fiction about a future act -- a plan, promise, threat, bluff or hypothetical spoken to another person -- or text quoted from a document, with no narration that the investigator does it: the utterance may be chosen, the physical act it describes is not. Also a step the player holds back from, or a conditional whose condition the fiction has not met.',
};
const UNCLEAR_CHOICE = 'The player\'s words and what they were told do not settle whether they chose this.';
const CHOICE_CRITERIA: Record<string, DecisionDescriptor> = {
  chosen: CHOSEN,
  routine_step: {
    what: 'The player chose the goal and the way, and this line is an ordinary step it needs that adds no new person, approach or obstacle: crossing to the thing they asked to search, the skill roll for exactly the approach they described, the way back they already said they would take.',
    not_for: 'A roll against a person the player did not speak to, a roll for an approach the player did not describe, a roll to get past someone or something the player did not take on.',
  },
  keeper_choice: {
    what: 'The Keeper picks for the player: a destination, method, target, price, payment or promise the player\'s words did not choose; a skill or approach other than the one the player named; a dice roll for an approach or against a person the player\'s words did not choose, such as a social roll with someone they did not speak to; a route or option the Keeper offered that the player did not take up; acting on a subject the player only asked about or showed interest in; something the player limited, postponed, refused or said they would not do; a step past a gatekeeper, a price or a danger the player\'s words did not take on; an action already in `refusedThisTurn` proposed again in other words.',
  },
  unclear: UNCLEAR_CHOICE,
};
const CHOICE: Family = {name: 'choice', options: Object.keys(CHOICE_CRITERIA), admitting: ['chosen', 'routine_step'], criteria: CHOICE_CRITERIA,
  instructions: line => `Read ${line} as something the investigator does by their own will. Judging only from ${EVIDENCE}, ${NOT_KEEPER_TEXT}, did the player choose it? ${PLAYER_EXECUTION_CHOICE_NOTE}`};

const RESULT_CRITERIA: Record<string, DecisionDescriptor> = {
  answers_player: {
    what: 'It is what the investigator\'s chosen action turns up or is told: the reply to their question, what their chosen search, look or visit finds, what the person they addressed says, offers or hands over. The player need not have known or wanted the result.',
  },
  world_on_its_own: {
    what: 'A person, a place, a thing or the rules act on their own, or it is a consequence of something already settled: an unprompted remark or gesture, a manifestation, something done to the investigator.',
  },
  needs_unchosen_act: {
    what: 'It could only happen after an investigator action the player did not choose: a trip they did not take, a search, door, lock or drawer they did not try, a person they did not approach or question, a price or bargain they did not accept, a gatekeeper or refusal their words did not get past.',
  },
  unclear: 'What the player did does not settle whether this follows from it.',
};
const RESULT: Family = {name: 'result', options: Object.keys(RESULT_CRITERIA), admitting: ['answers_player', 'world_on_its_own'], criteria: RESULT_CRITERIA,
  instructions: line => `Read ${line} as what a person, a place or the rules do or give. Judging from ${EVIDENCE} and \`settledThisTurn\`, does it follow from what the investigator did, or does it need an investigator action the player did not choose?`};

const SPAN_CRITERIA: Record<string, DecisionDescriptor> = {
  activity_time: {what: 'Minutes or hours spent on what the investigator is doing: the talk, search, reading, wait or journey the player\'s words chose, or that this turn already settled.'},
  imposed_time: {what: 'Time the world or the rules impose on the investigator: being kept waiting, lying hurt, time a person or an event takes from them.'},
  unchosen_time: {what: 'Time for something the player\'s words did not choose: a journey or activity they did not choose, getting past a gatekeeper their words did not take on, a stay or wait longer than they said, time past a limit, deadline or appointment they set.'},
  unclear: 'What the player chose does not settle whether this time is theirs.',
};
const SPAN: Family = {name: 'span', options: Object.keys(SPAN_CRITERIA), admitting: ['activity_time', 'imposed_time'], criteria: SPAN_CRITERIA,
  instructions: line => `Read ${line} as time passing. Judging from ${EVIDENCE} and \`settledThisTurn\`, whose time is it?`};

const TARGET: Family = {name: 'target', options: ['addressed', 'no_target', 'not_addressed'], admitting: ['addressed', 'no_target'],
  instructions: line => `Whom or what does ${line} act on, speak to or go to? Judging only from ${EVIDENCE}, ${NOT_KEEPER_TEXT}, did the player's words address that person, thing or place?`,
  criteria: {
    addressed: {what: 'The player\'s words name, address or point to this person, thing or place, by name, role or description, or pick it from what `justTold` named, or it is the person the player is already talking to.'},
    no_target: {what: 'The line acts on no person, thing or place beyond the investigator\'s own activity.'},
    not_addressed: {what: 'The player\'s words do not address this person, thing or place: someone they did not speak to or about, a place they did not choose, a thing they did not mention.'},
  }};
const GATE: Family = {name: 'gate', options: ['no_obstacle', 'player_takes_it_on', 'skips_obstacle'], admitting: ['no_obstacle', 'player_takes_it_on'],
  instructions: line => `Does ${line} get the investigator past something \`justTold\` or \`earlier\` put in their way -- a gatekeeper, a refusal, a closed or locked way, a price, a danger -- without the player's words taking it on? Judge from ${EVIDENCE} and \`settledThisTurn\`.`,
  criteria: {
    no_obstacle: {what: 'The line crosses nothing that stood in the investigator\'s way, or `settledThisTurn` already dealt with it.'},
    player_takes_it_on: {what: 'The player\'s words take that obstacle on -- they ask, argue, pay, force, sneak past or wait for it -- and this line is that attempt or its result.'},
    skips_obstacle: {what: 'The line gets past a gatekeeper, a refusal, a closed or locked way, a price or a danger that the player\'s words did not take on.'},
  }};
const ORDER: Family = {name: 'order', options: ['in_step', 'ahead_of_plan'], admitting: ['in_step'],
  instructions: line => `Did the player set an order or a condition that ${line} gets ahead of? Judge from ${EVIDENCE} and \`settledThisTurn\`.`,
  criteria: {
    in_step: {what: 'The line is what the player said to do now, or the player\'s words set no order or condition that it gets ahead of.'},
    ahead_of_plan: {what: 'The player said to do something else first ("first ... then ...", "after ...") and that earlier step is not done yet, or the line acts as if a condition the player set ("if ...", "unless ...", "when ...") has been met when nothing shows it has.'},
  }};

/** The conditional and element questions of revision 2a.3, in the order they are asked. */
const FAMILIES: readonly Family[] = [CHOICE, RESULT, SPAN, TARGET, GATE, ORDER];
/** Each question family's closed options and its admitting subset (read-only view, for tests and telemetry readers). */
export const ADMISSION_ROLES_FAMILIES: ReadonlyArray<{name: string; options: readonly string[]; admitting: readonly string[]}> =
  FAMILIES.map(({name, options, admitting}) => ({name, options, admitting}));

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
 * The closed effect kind of proposal line `index`: the proposal's own kind (`AdmissionJevInput.kinds`, the host's
 * closed contract enum), `resolve` for a `resolve`. Never read from the line's prose.
 */
export function rolesLineKind(input: AdmissionJevInput, index: number): string {
  if (input.tool === 'resolve') return 'resolve';
  return input.kinds?.[index] ?? 'unknown';
}

export function admissionRolesBindings(input: AdmissionJevInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: ADMISSION_ROLES_FAMILY, campaign: input.campaign, audience: 'player'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${input.turn}:admission:${input.tool}`, revision: digest(input)},
    {kind: 'family', resource: ADMISSION_ROLES_FAMILY, revision: ADMISSION_ROLES_VERSION},
    {kind: 'model', resource: `${ADMISSION_ROLES_FAMILY}:jev`, revision: ADMISSION_ROLES_MODEL},
  ]};
}

interface Catalog {state: Json; passages: Map<string, Passage>; basisCriteria: Record<string, DecisionDescriptor>; book: boolean}

/** Exactly §32.3's input, the lane's windows, packed as facts with a field legend. Nothing Keeper-only travels. */
function catalog(input: AdmissionJevInput): Catalog {
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
  notes.handover = HANDOVER_GROUND_NOTE;
  if (input.corrections?.length) notes.proposalCorrections = 'Earlier rejected argument representations, not unmade player choices. The original declaration stands; judge corrected arguments afresh without adding a target, method, cost or commitment.';
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
    ...(input.corrections?.length ? {proposalCorrections: [...input.corrections]} : {}),
    proposal: input.proposal.map((text, index) => ({line: index, kind: rolesLineKind(input, index), text})),
  } as unknown as Json;
  const basisCriteria: Record<string, DecisionDescriptor> = {none: 'No player-visible passage bears on this line.'};
  for (const passage of all) basisCriteria[passage.alias] = `The passage ${passage.alias}.`;
  return {state, passages: new Map(all.map(passage => [passage.alias, passage])), basisCriteria, book: book.length > 0};
}

const choice = (key: string, target: string, instructions: string, criteria: Record<string, DecisionDescriptor>): DecisionQuestion =>
  ({key, target, type: 'choice', instructions, criteria});

/** The questions for one line. Independent: none reads a peer's answer. */
function lineQuestions(index: number, built: Catalog): DecisionQuestion[] {
  const line = `\`proposal[${index}]\``, target = `proposal[${index}]`;
  return [
    choice(`role_${index}`, target,
      `Who acts in ${line}? Read its \`kind\` and \`text\` and classify the line itself, not whether the player wanted it.`,
      {...ROLE_CRITERIA}),
    ...FAMILIES.map(family => choice(`${family.name}_${index}`, target, family.instructions(line), {...family.criteria})),
    choice(`missing_${index}`, target,
      `If the player has not chosen ${line}, select which choice is missing. Select none when the player chose it, it is a routine step of their chosen goal, or it is not the investigator's voluntary action.`,
      {...MISSING_CRITERIA}),
    choice(`basis_${index}`, target,
      `Select the one passage alias in ${EVIDENCE}${built.book ? ' (or `bookText`, for a line the book itself puts here)' : ''} that most decides whether the player chose ${line}: the words that choose it, or the words that show what the player has not chosen. Select by meaning; select none when no passage bears on it.`,
      built.basisCriteria),
  ];
}

/**
 * Same-state batches: as many lines per batch as the packing bound allows (greedy, in order), so almost every proposal
 * is one request. A line that does not fit alone is a packing failure, never a split question.
 */
export function admissionRolesBatches(input: AdmissionJevInput, bindings = admissionRolesBindings(input)): {batches: DecisionBatch[]; passages: Map<string, Passage>} {
  const built = catalog(input);
  const id = `admission-roles:${input.turn}:${digest(input).slice(0, 16)}`;
  const make = (lines: number[], n: number): DecisionBatch => ({id: `${id}:${n}`, model: ADMISSION_ROLES_MODEL, family: ADMISSION_ROLES_FAMILY,
    familyVersion: ADMISSION_ROLES_VERSION, scope: bindings.scope, readSet: bindings.readSet, state: built.state,
    questions: lines.flatMap(index => lineQuestions(index, built))});
  const batches: DecisionBatch[] = [];
  let open: number[] = [];
  for (let index = 0; index < input.proposal.length; index++) {
    const tried = [...open, index];
    let fits = true;
    try { packDecisionBatch(make(tried, batches.length)); } catch (error) {
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
  return {batches, passages: built.passages};
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
export function rolesMixture(role: Distribution, act: number, world: number, time: number): number {
  const total = mass(role, ROLE_OPTIONS);
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, (role.investigator_act! * act + role.world_response! * world + role.time_passing! * time) / total));
}
/** Revision 2a.3's admit probability of one line from its per-question distributions (`answers[family]`). Pure. */
export function rolesAdmitProbability(answers: Record<string, Distribution>): number {
  const admit = (name: string) => mass(answers[name]!, FAMILIES.find(family => family.name === name)!.admitting);
  return round(Math.min(rolesMixture(answers.role!, Math.min(admit('choice'), admit('target')), admit('result'), admit('span')),
    admit('gate'), admit('order')));
}
/** The two-option Choice confidence of an admit/refuse distribution (TypeSafe's formula with n = 2). */
export const rolesConfidence = (pAdmit: number) => round(Math.abs(2 * pAdmit - 1));

/** The lane-shaped label of one line: which role dominates, and which admitting or refusing option within it. */
export function rolesLineVerdict(admit: boolean, answers: Record<string, Distribution>): AdmissionJevVerdict {
  const dominant = top(answers.role!) as Role;
  const conditional = answers[dominant === 'investigator_act' ? 'choice' : dominant === 'world_response' ? 'result' : 'span'] ?? {};
  if (!admit) return conditional.unclear !== undefined && top(conditional) === 'unclear' ? 'uncertain' : 'not_authorized';
  const choiceAnswer = answers.choice ?? {};
  if (dominant === 'investigator_act') return (choiceAnswer.chosen ?? 0) >= (choiceAnswer.routine_step ?? 0) ? 'authorized' : 'entailed';
  return dominant === 'world_response' ? 'not_player_action' : 'entailed';
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

/**
 * Interpret a complete typed result into the family interface's shape: per line the lane-shaped verdict, the binary
 * confidence and the admit probability. Any structural gap, or a confidence under `minConfidence`, is a fallback.
 */
export function interpretAdmissionRoles(input: AdmissionJevInput, result: DecisionResult, byAlias: Map<string, Passage>, minConfidence = 0):
  {status: 'decided'; verdict: AdmissionJevVerdict; grounds: string; missing?: string; confidence: number; lines: AdmissionJevLine[]}
  | {status: 'fallback'; reason: string; confidence?: number; lines?: AdmissionJevLine[]; jevStatus?: number | string} {
  if (result.status !== 'complete') return {status: 'fallback', reason: result.failure?.code ?? `decision_${result.status}`,
    ...(result.failure?.status !== undefined ? {jevStatus: result.failure.status} : {})};
  const families = [{name: 'role', options: ROLE_OPTIONS}, ...FAMILIES];
  const lines: AdmissionJevLine[] = [];
  for (let index = 0; index < input.proposal.length; index++) {
    const answers: Record<string, Distribution> = {};
    for (const family of families) {
      const value = distribution(result, `${family.name}_${index}`, family.options);
      if (!value) return {status: 'fallback', reason: 'invalid_typed_answer'};
      answers[family.name] = value;
    }
    const missing = result.answers[`missing_${index}`], basis = result.answers[`basis_${index}`];
    if (missing?.status !== 'answered' || missing.type !== 'choice' || !(ADMISSION_MISSING_KINDS as readonly string[]).includes(missing.choice)
      || basis?.status !== 'answered' || basis.type !== 'choice' || basis.choice !== 'none' && !byAlias.has(basis.choice))
      return {status: 'fallback', reason: 'invalid_typed_answer'};
    const pAdmit = rolesAdmitProbability(answers), admit = pAdmit >= 0.5;
    lines.push({verdict: rolesLineVerdict(admit, answers), confidence: rolesConfidence(pAdmit), pAdmit,
      missing: missing.choice as AdmissionMissingKind, ...(basis.choice === 'none' ? {} : {basis: basis.choice})});
  }
  const confidence = Math.min(...lines.map(line => line.confidence));
  if (!(confidence >= minConfidence)) return {status: 'fallback', reason: 'low_confidence', confidence, lines};
  const admit = lines.every(line => (line.pAdmit ?? 0) >= 0.5);
  const verdict = batchVerdict(lines.map(line => line.verdict));
  const deciding = admit ? lines.findIndex(line => line.verdict === verdict) : lines.findIndex(line => (line.pAdmit ?? 0) < 0.5);
  const line = lines[deciding]!, passage = line.basis ? byAlias.get(line.basis) : undefined;
  const proposed = clip(input.proposal[deciding]!, 100);
  const grounds = clip(`${passage ? `Decided by ${passage.where}: "${passage.text.trim()}"` : 'No player-visible passage chooses it'
    }; typed review judged line ${deciding + 1} ${line.verdict} (${proposed})`, 300);
  if (admit) return {status: 'decided', verdict, grounds, confidence, lines};
  return {status: 'decided', verdict, grounds, confidence, lines, missing: clip(`${line.verdict === 'uncertain'
    ? 'whether the player chose this is not clear from their words' : MISSING_TEXT[line.missing]}: ${proposed}`, 240)};
}

/** One typed review round. Never throws; every non-verdict is an explicit fallback reason. */
export async function runAdmissionRoles(input: AdmissionJevInput, decision: DecisionPort, lease: TaskLease,
  options: {minConfidence?: number} = {}): Promise<AdmissionJevResult> {
  const began = Date.now(), usage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  let calls = 0;
  const fallback = (reason: string, extra: {confidence?: number; lines?: AdmissionJevLine[]; jevStatus?: number | string} = {}): AdmissionJevResult =>
    ({status: 'fallback', reason, ...extra, calls, elapsedMs: Date.now() - began, usage});
  try {
    if (!input.proposal.length) return fallback('empty_proposal');
    if (input.proposal.length > ADMISSION_ROLES_MAX_LINES) return fallback('too_many_lines');
    if (!nonempty(input.playerText)) return fallback('no_player_text');
    const bindings = admissionRolesBindings(input), context = lease.context;
    if (digest(context.scope) !== digest(bindings.scope) || digest(context.readSet) !== digest(bindings.readSet))
      return fallback('attempt_binding_mismatch');
    let built;
    try { built = admissionRolesBatches(input, bindings); }
    catch (error) { return fallback(error instanceof PackingError ? error.failure : 'schema_error'); }
    const results = await Promise.all(built.batches.map(async batch => {
      const result = await decision.decide(batch, lease); calls++;
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      usage.costUsd += result.usage?.costUsd ?? 0;
      return result;
    }));
    const read = interpretAdmissionRoles(input, merged(results), built.passages, options.minConfidence ?? 0);
    if (read.status === 'fallback') return fallback(read.reason, {...(read.confidence === undefined ? {} : {confidence: read.confidence}),
      ...(read.lines ? {lines: read.lines} : {}), ...(read.jevStatus === undefined ? {} : {jevStatus: read.jevStatus})});
    return {...read, calls, elapsedMs: Date.now() - began, usage};
  } catch {
    return fallback('admission_owner_error');
  }
}
