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
 */
import type {Candidate, Json, Unbound} from './step-policy.ts';
import {ORDINARY_CHOICES} from './ordinary-resolve-domain.ts';

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
function meeting(reads: ObligationReads, row: Row, index: number): Candidate | undefined {
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
    bound: {kind: 'person', who: name, name: label || name},
    unbound: [{name: 'why', required: false, vocabulary: 'open' as const}],
    detail: {demand: text(row.name), stated_by: 'the module', ...(detail.length ? {guards: detail} : {})} as Json,
    clerk: 'stated_obligation', basis: basisOf(row, index, 'meet')};
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
    unbound.push({name: 'skill', required: true, vocabulary: 'closed', options: skills,
      descriptions: Object.fromEntries(approaches.map(value => [text(value.skill),
        `${text(value.skill)}${Number.isSafeInteger(value.minimum) ? ` (the book asks for ${value.minimum} or more)` : ''}`])),
      instruction: `Select the approach the player's declared words take${target ? ` toward ${target}` : ''}: the one skill among these the investigator `
        + 'uses. Judge only the declared method, never the skill values. Choose unknown when the words do not settle which one.'});
    for (const name of ['bonus', 'penalty'] as const)
      unbound.push({name, required: true, vocabulary: 'closed', options: Object.keys(DICE), descriptions: descriptors(name), instruction: ORDINARY_CHOICES[name].instructions});
  }
  unbound.push({name: 'intent', required: true, vocabulary: 'closed', options: CHECK_INTENTS, descriptions: descriptors('intent'), instruction: ORDINARY_CHOICES.intent.instructions});
  const {words, detail} = guarded(reads, row);
  const how = approach ? listed(skills, 'or') : `the higher of ${listed(skills, 'and')}`;
  return {key: `resolve:obligation:${text(row.handle)}`, verb: 'resolve', family: 'obligation_check', source: 'table.apply.options',
    label: `The book's price of "${text(row.name)}": ${first ? `meet ${text(first.bound.who)} first, then ` : ''}a ${text(next.difficulty)} ${how} check`
      + `${target ? ` against ${target}` : ''}${words.length ? ` before anyone gets ${listed(words, 'or')}` : ''}`,
    bound: {obligation: text(row.handle), ...(target ? {target} : {}), ...(actor ? {actor} : {}), ...(approach && skills.length === 1 ? {skill: skills[0]} : {}),
      goal: rawInput, method: rawInput},
    unbound,
    detail: {demand: text(row.name), stated_by: 'the module', difficulty: text(next.difficulty),
      approaches: approaches.map(value => ({skill: text(value.skill), ...(Number.isSafeInteger(value.minimum) ? {minimum: value.minimum} : {})})),
      ...(detail.length ? {guards: detail} : {})} as Json,
    clerk: 'stated_obligation', basis: basisOf(row, index, 'check'), ...(first ? {before: first} : {})};
}
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
    const first = next.kind === 'meet' ? meeting(reads, row, index) : undefined;
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
