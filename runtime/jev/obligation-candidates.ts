/**
 * Scene obligations as candidates (SO-04 of `docs/specs/scene-obligations-as-candidates-tickets.md`, spec D6;
 * contract §135.26). The clerk's half of what the kernel issues in `table.apply.options.obligations` (§134.9–§134.10).
 *
 * Everything here is read from that one issued list and its sibling rows -- the same projection the Keeper's capsule
 * compacts -- and nothing classifies text:
 *
 * - an `open` obligation's next `check` step becomes an `obligation_check` candidate with a closed binder: one available
 *   approach is bound, several are a closed Jev bind together with the ordinary binder's closed dice-modifier choice;
 * - a `meet` step the book puts before that check is carried by it (owner ruling 2026-09-23): the check is offered while
 *   the meeting is still owed, and `now` on it runs the meeting directly first, then binds and rolls the check;
 * - a `meet`-only obligation (the archivist) is the stated person candidate, routed like any person. A stated meeting
 *   is data, not an open name (owner ruling 2026-09-23): the person is staged under the table's own label if the kernel
 *   issued one, else under the book's name for them. Either way it replaces the roster candidate for that person;
 * - `blocked`, `settled` and `waived` obligations issue nothing;
 * - what an unsettled obligation guards is withheld from the clerk (the `guarded_by` rows, and the same clues, exits
 *   and people however else they would be offered), the hygiene of an exit whose `unlock_when.met` is false;
 * - a `reaction: "preordained"` obligation withholds the Mod contact check for its person (owner ruling Q2);
 * - hazards are never candidates (owner ruling Q1): only the issued obligation rows are read, never `on_enter` or a
 *   module's mechanics.
 *
 * Labels carry the demand and what it guards. The page, the handle's kernel tags and `authority` strings stay in
 * `basis`, which Jev and the model never read.
 *
 * Binding never goes to the LLM (§135.27): the approach among several and the dice words are closed Jev binds with a
 * rules default each (the actor's highest current value among the offered approaches, first in the stated order on a
 * tie; no modifier), and the meeting's `why` is composed from the demand and the player's words, quoted.
 */
import type {Candidate, Json, RuleDefault, Unbound} from './step-policy.ts';
import {ORDINARY_CHOICES} from './ordinary-resolve-domain.ts';
import {composeSentence} from './composed-arguments.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => array(value).map(text).filter(Boolean);

/** The reads the builder takes (the subset of `StateReads` this module reads). */
export interface ObligationReads {capsule: Row; applyOptions: Row; resolveOptions: Row}

/** The closed dice words of the ordinary binder and the dice count each stands for. */
export const DICE: Readonly<Record<string, number>> = Object.freeze({none: 0, one: 1, two: 2});
/** The canonical intents an ordinary-capable check takes (the ordinary binder's closed intent vocabulary). */
const CHECK_INTENTS = Object.keys(ORDINARY_CHOICES.intent.criteria).filter(value => value !== 'unknown');

const unsettled = (row: Row): boolean => row.state === 'open' || row.state === 'blocked';
const listed = (values: string[], word: string): string => values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} ${word} ${values.at(-1)}`;

/** What the unsettled obligations of the scene guard, as the options name them: clue handles, exit handles, people. */
export interface Guards {clues: Set<string>; exits: Set<string>; people: Set<string>}
export function guardsOf(reads: ObligationReads): Guards {
  const guards: Guards = {clues: new Set(), exits: new Set(), people: new Set()};
  for (const row of array(object(reads.applyOptions).obligations).map(object)) {
    if (!unsettled(row) || object(row.trigger).kind !== 'attempt') continue;
    const guarded = object(object(row.trigger).guards);
    for (const key of ['clues', 'exits', 'people'] as const) for (const name of strings(guarded[key])) guards[key].add(name);
  }
  return guards;
}

/**
 * The Mod contact checks the book preordains (owner ruling Q2): per person, the Mod checks the clerk does not settle
 * for them. Read from the issued row's `mod_contact` and `who`, whatever the obligation's state: the book says that
 * person's reaction roll is not used.
 */
export function preordainedContacts(reads: ObligationReads): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of array(object(reads.applyOptions).obligations).map(object)) {
    if (row.reaction !== 'preordained' || !text(row.who)) continue;
    const checks = out.get(row.who) ?? new Set<string>();
    for (const contact of array(row.mod_contact).map(object)) if (text(contact.check) && contact.clerk === false) checks.add(contact.check);
    out.set(row.who, checks);
  }
  return out;
}

/** What an obligation guards, in words Jev can judge: the guarded clue's summary, the exit's name, the person. */
function guarded(reads: ObligationReads, row: Row): {words: string[]; detail: Json[]} {
  const guards = object(object(row.trigger).guards), candidates = array(object(reads.applyOptions).candidates).map(object);
  const detail: Json[] = [], words: string[] = [];
  for (const clue of strings(guards.clues)) {
    const issued = candidates.find(value => object(value.effect).kind === 'clue' && object(value.effect).clue === clue);
    words.push(`clue ${clue}`);
    detail.push({clue, ...(text(object(issued?.description).summary) ? {summary: text(object(issued!.description).summary)} : {})});
  }
  for (const exit of strings(guards.exits)) {
    const issued = candidates.find(value => object(value.effect).kind === 'move' && object(value.effect).to === exit);
    const name = text(object(issued?.description).display_name) || exit;
    words.push(`the way to ${name}`);
    detail.push({exit: name});
  }
  for (const person of strings(guards.people)) { words.push(person); detail.push({person}); }
  return {words, detail};
}

/**
 * What an obligation stands in front of, for its route question: its own guards, else (an `after` obligation, such as
 * the archivist) the guards of the obligation it waits on, followed back through the issued list.
 */
function guardedFor(reads: ObligationReads, row: Row): {words: string[]; detail: Json[]} {
  const rows = array(object(reads.applyOptions).obligations).map(object);
  for (let at: Row | undefined = row, depth = 0; at && depth < 8; depth++) {
    const found = guarded(reads, at);
    if (found.detail.length) return found;
    const after = text(object(at.trigger).after);
    at = after ? rows.find(value => value.handle === after) : undefined;
  }
  return {words: [], detail: []};
}
/**
 * The route question of an obligation candidate (owner ruling 2026-09-23): not "do this step now or later" -- the order
 * of steps is the Keeper's craft -- but a fact about the input Jev can judge: is the declaration after what the
 * obligation guards? `seeks` selects it; `not`/`unknown` leave it to the Keeper for the run (§135.26).
 */
function routeFact(reads: ObligationReads, row: Row): Candidate['routeFact'] | undefined {
  const {detail} = guardedFor(reads, row);
  if (!detail.length) return undefined;
  const things = detail.map(value => { const item = object(value);
    return item.clue ? `clue ${text(item.clue)}${text(item.summary) ? ` (${text(item.summary)})` : ''}` : item.exit ? `the way to ${text(item.exit)}` : text(item.person); });
  return {target: `is the player's declared action after any of: ${things.join('; ')}?`, selects: 'seeks',
    instructions: 'Judge one fact about the player\'s input, not an order of steps: does the declared action seek any of the things listed '
      + '(to get it, find it, reach it or learn it)? Seeking one of them is enough. What the book demands on the way, and in what order, is not '
      + 'this question.',
    criteria: {seeks: 'The declared action is after at least one of the listed things.', not: 'The declared action is after something else.',
      unknown: 'The input does not tell whether it is after any of them.'}};
}
/** The name of the obligation an `after` row waits on, from the same issued list. */
function afterName(reads: ObligationReads, row: Row): string {
  const handle = text(object(row.trigger).after);
  return handle ? text(array(object(reads.applyOptions).obligations).map(object).find(value => value.handle === handle)?.name) || handle : '';
}
const basisOf = (row: Row, index: number, step: 'meet' | 'check'): Json =>
  ({read: 'table.apply.options', path: `obligations[${index}]`, row: row as Json, obligation: text(row.handle), step});

/**
 * The stated meeting: the roster candidate for the person the book puts here, marked as the book's (spec D6). Its name
 * is the table's own label when the kernel issued one, else the book's name for the person (the record's `name`): the
 * book names who stands there, so no LLM step writes it (owner ruling 2026-09-23; §135.2's open name does not apply).
 */
function meeting(reads: ObligationReads, row: Row, index: number, rawInput = ''): Candidate | undefined {
  const next = object(row.next), name = text(next.person);
  const present = array(object(reads.capsule).present).map(object);
  const at = present.findIndex(person => text(person.name) === name);
  // Only someone on the roster and not yet introduced: anyone else is the Keeper's to stage.
  if (at < 0 || text(object(present[at].called).name)) return undefined;
  const person = present[at], label = text(object(person.untold).label), role = text(person.role);
  const {words, detail} = guarded(reads, row), after = afterName(reads, row);
  const where = words.length ? `in the way of "${text(row.name)}": whoever is after ${listed(words, 'or')} meets ${name} first`
    : after ? `for "${text(row.name)}" once "${after}" is settled: ${name} is met next` : `for "${text(row.name)}": ${name} is met first`;
  return {key: `apply:person:${name}`, verb: 'apply', family: 'person', source: 'table.apply.options',
    label: `The book puts ${name}${role ? ` (${role})` : ''} here ${where}; put them on stage as "${label || name}"`,
    bound: {kind: 'person', who: name, name: label || name,
      why: composeSentence(`The book puts ${name} here for "${text(row.name)}"${label ? ', named by the table\'s own label' : ', under the book\'s name'}`, rawInput)},
    unbound: [], composed: ['why'],
    detail: {demand: text(row.name), stated_by: 'the module', ...(detail.length ? {guards: detail} : {})} as Json,
    clerk: 'stated_obligation', basis: basisOf(row, index, 'meet'), ...withFact(routeFact(reads, row))};
}

/** The approaches the acting investigator can take: a stated minimum the actor's issued rating misses rules one out. */
function available(reads: ObligationReads, approaches: Row[], actor: string | undefined): Row[] {
  const profiles = array(object(reads.resolveOptions).profiles).map(object);
  return approaches.filter(approach => {
    if (!Number.isSafeInteger(approach.minimum)) return true;
    if (!actor) return true;
    const profile = profiles.find(value => text(value.actor) === actor && text(value.skill) === text(approach.skill));
    return profile?.availability === 'bound' && Number(profile.value) >= Number(approach.minimum);
  });
}

/**
 * The rules default of the approach (§135.27): the actor's highest current value among the offered approaches, read from
 * the profiles the kernel issues in `table.resolve.options` (a value the kernel does not bind is not compared); a tie goes
 * to the first in the book's stated order. Arithmetic over issued values, never over words. None when no offered approach
 * has a bound value.
 */
export function highestOffered(reads: ObligationReads, skills: string[], actor: string): string | undefined {
  const profiles = array(object(reads.resolveOptions).profiles).map(object);
  let best: {skill: string; value: number} | undefined;
  for (const skill of skills) {
    const profile = profiles.find(value => text(value.actor) === actor && text(value.skill) === skill);
    if (profile?.availability !== 'bound' || !Number.isSafeInteger(profile.value)) continue;
    if (!best || Number(profile.value) > best.value) best = {skill, value: Number(profile.value)};
  }
  return best?.skill;
}
/** The approach's rules default: one value for a bound actor, one per actor when the actor is still to bind. */
function approachDefault(reads: ObligationReads, skills: string[], actor: string | undefined, actors: string[]): RuleDefault | undefined {
  if (actor) { const value = highestOffered(reads, skills, actor); return value ? {rule: 'highest_offered_skill', value} : undefined; }
  const values = Object.fromEntries(actors.flatMap(name => { const value = highestOffered(reads, skills, name); return value ? [[name, value]] : []; }));
  return Object.keys(values).length ? {rule: 'highest_offered_skill', by: {name: 'actor', values}} : undefined;
}

/** The obligation check: the book's stated price, with the closed approach binder (spec D6, clerk authority (e)). */
function check(reads: ObligationReads, row: Row, index: number, rawInput: string, step: Row = object(row.next), first?: Candidate): Candidate | undefined {
  const next = step, target = text(next.target);
  // The Mod check that serves this step (§134.13) is its candidate; a step the page leaves unstated is the Keeper's.
  if (next.served_by || next.approaches_unstated === true || next.difficulty_unstated === true || !text(next.difficulty)) return undefined;
  if (target && !strings(object(object(reads.applyOptions).context).present).includes(target)) return undefined;
  const actors = [...new Set(array(object(reads.resolveOptions).profiles).map(value => text(object(value).actor)).filter(Boolean))];
  const actor = actors.length === 1 ? actors[0] : undefined;
  const approaches = available(reads, array(next.approaches).map(object).filter(value => text(value.skill)), actor);
  if (!approaches.length) return undefined;
  const skills = approaches.map(value => text(value.skill)), approach = next.selection === 'approach';
  const unbound: Unbound[] = [];
  if (!actor) unbound.push({name: 'actor', required: true, vocabulary: 'closed', options: actors});
  // Several approaches: the player's own words choose among the book's, never the clerk; with them the ordinary
  // binder's closed dice choice. One approach is bound. `maximum` is the kernel's to bind (§134.11).
  if (approach && skills.length > 1) {
    const ruleDefault = approachDefault(reads, skills, actor, actors);
    unbound.push({name: 'skill', required: true, vocabulary: 'closed', options: skills, ...(ruleDefault ? {ruleDefault} : {}),
      descriptions: Object.fromEntries(approaches.map(value => [text(value.skill),
        `${text(value.skill)}${Number.isSafeInteger(value.minimum) ? ` (the book asks for ${value.minimum} or more)` : ''}`])),
      instruction: `Select the approach the player's declared words take${target ? ` toward ${target}` : ''}: the one skill among these the investigator `
        + 'uses. Judge only the declared method, never the skill values. Choose unknown when the words do not settle which one.'});
    for (const name of ['bonus', 'penalty'] as const)
      unbound.push({name, required: true, vocabulary: 'closed', options: Object.keys(DICE), descriptions: descriptors(name), instruction: ORDINARY_CHOICES[name].instructions,
        ruleDefault: {rule: 'no_modifier', value: 'none'}});
  }
  // The obligation row declares no intent (§134.9 issues none), so the intent is Jev's alone: no rules default (§135.27).
  unbound.push({name: 'intent', required: true, vocabulary: 'closed', options: CHECK_INTENTS, descriptions: descriptors('intent'), instruction: ORDINARY_CHOICES.intent.instructions});
  const {words, detail} = guarded(reads, row);
  const how = approach ? listed(skills, 'or') : `the higher of ${listed(skills, 'and')}`;
  return {key: `resolve:obligation:${text(row.handle)}`, verb: 'resolve', family: 'obligation_check', source: 'table.apply.options',
    label: `The book's price of "${text(row.name)}": ${first ? `meet ${text(first.bound.who)} first, then ` : ''}a ${text(next.difficulty)} ${how} check`
      + `${target ? ` against ${target}` : ''}${words.length ? ` before anyone gets ${listed(words, 'or')}` : ''}`,
    bound: {obligation: text(row.handle), ...(target ? {target} : {}), ...(actor ? {actor} : {}), ...(approach && skills.length === 1 ? {skill: skills[0]} : {}),
      goal: rawInput, method: rawInput},
    unbound, composed: ['goal', 'method'],
    detail: {demand: text(row.name), stated_by: 'the module', difficulty: text(next.difficulty),
      approaches: approaches.map(value => ({skill: text(value.skill), ...(Number.isSafeInteger(value.minimum) ? {minimum: value.minimum} : {})})),
      ...(detail.length ? {guards: detail} : {})} as Json,
    clerk: 'stated_obligation', basis: basisOf(row, index, 'check'), ...(first ? {before: first} : {}), ...withFact(routeFact(reads, row))};
}
const withFact = (fact: Candidate['routeFact'] | undefined): Partial<Candidate> => fact ? {routeFact: fact} : {};
function descriptors(name: 'intent' | 'bonus' | 'penalty'): Record<string, string> {
  return Object.fromEntries(Object.entries(ORDINARY_CHOICES[name].criteria).filter(([key]) => key !== 'unknown').map(([key, value]) => [key, String(value)]));
}

/**
 * The candidates an open obligation's next step issues, in the order the kernel lists the obligations: an obligation
 * check (carrying the meeting the book puts before it, as `before`), or, for a meeting-only obligation, the stated
 * meeting (keyed like the roster candidate it replaces), which is also what a meeting leading to a check the clerk may
 * not roll (served by a Mod, or unstated) issues. Blocked, settled and waived rows issue nothing; a meeting whose person
 * is not on the roster issues nothing, and neither does the check it leads to.
 */
export function obligationCandidates(reads: ObligationReads, rawInput = ''): Candidate[] {
  const out: Candidate[] = [];
  for (const [index, row] of array(object(reads.applyOptions).obligations).map(object).entries()) {
    if (row.state !== 'open') continue;
    const next = object(row.next), then = object(row.then);
    // A meeting the book puts before a check is carried by that check (owner ruling 2026-09-23); a meeting alone is routed.
    const first = next.kind === 'meet' ? meeting(reads, row, index, rawInput) : undefined;
    const candidate = next.kind === 'check' ? check(reads, row, index, rawInput)
      : first && then.kind === 'check' ? check(reads, row, index, rawInput, then, first) ?? first
        : first;
    if (candidate) out.push(candidate);
  }
  return out;
}

/** The kernel row of an obligation step, when the candidate is one (its `basis.obligation`). */
export function obligationBasis(candidate: Candidate | undefined): {handle: string; step: string; row: Row} | undefined {
  const basis = object(candidate?.basis);
  return text(basis.obligation) ? {handle: text(basis.obligation), step: text(basis.step), row: object(basis.row)} : undefined;
}

/**
 * The "clerk did" line of an obligation step (spec D6): the obligation, the step, the receipt and the page, e.g.
 * `obligation globe-clippings-access: Persuade (regular) passed, settled; receipt r-1; pdf p.448`.
 */
export function obligationClerkLine(candidate: Candidate, ok: boolean, result: Row, receipts: string[]): string | undefined {
  const basis = obligationBasis(candidate);
  if (!basis) return undefined;
  const pages = [...new Set(array(basis.row.source).map(value => object(value).page).filter(Number.isSafeInteger))];
  const where = [`receipt ${receipts.length ? receipts.join(', ') : 'none'}`, ...(pages.length ? [`pdf p.${pages.join(', ')}`] : [])].join('; ');
  if (!ok) return `obligation ${basis.handle}: the clerk's ${basis.step} step was refused, so it is still open and yours; ${where}`;
  if (basis.step === 'meet') return `obligation ${basis.handle}: met ${text(object(basis.row.next).person)}; ${where}`;
  const outcome = object(result.outcome), claim = object(result.obligation);
  const skill = text(outcome.skill) || text(object(candidate.bound).skill) || 'the check';
  const settled = claim.settled === true ? 'settled' : `still open${text(claim.book) ? ` (book: ${text(claim.book)})` : ''}`;
  return `obligation ${basis.handle}: ${skill} (${text(object(basis.row.next).difficulty)}) ${outcome.passed === true ? 'passed' : outcome.passed === false ? 'failed' : 'rolled'}, ${settled}; ${where}`;
}

/** One line for a clerk step whose result crossed an open obligation's guard (owner ruling Q5), or none. */
export function obligationCrossing(candidate: Candidate, result: Row, receipts: string[]): string | undefined {
  const handle = text(result.obligation_open);
  return handle ? `obligation ${handle} is open and the clerk's step "${candidate.label}" crossed what it guards (receipt ${receipts.join(', ') || 'none'}); `
    + 'the book was not followed there, so realise it or waive the obligation with apply flag' : undefined;
}
