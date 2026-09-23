/**
 * The bodies of the host-issued candidates (contract §135.20, SL-11 scope 1). The read step already issues the scene's
 * clues, handouts, people not yet introduced and exits as candidates; this reads, for each of them, the body the
 * Keeper would otherwise fetch with its own `lookup`/`look` call, from the same kernel reads those calls make:
 *
 * - a clue: its capsule row (`known.clues_here`) and its graph entity (`table.lookup kind=module`, by handle);
 * - a handout: its graph entity (`table.lookup kind=module expected_kind=handout`, by name);
 * - a person: `table.look focus=npc` for that person;
 * - a move: the destination's graph entity and who the book puts there (its `present-in` relations), each person as
 *   `table.look focus=npc` answers for them. This is the fact whose absence split a turn into one call per effect:
 *   the Keeper learns who is at the destination only from the move's result (SL-11 scope 2);
 * - a stated obligation's check (§135.26): the demand and what it guards, from the `table.apply.options.obligations`
 *   row the candidate was built from -- never the page, which stays in the row's `source` on the host side.
 *
 * Nothing is classified: the families are the candidate builder's closed kinds (§135.2) and every value is a kernel
 * row. Each body is bounded like a capsule section (§13.1: 1 KB-class sections), the whole set by
 * `CANDIDATE_BODIES_BYTES`; a body cut to fit says so (`truncated`, `omitted_fields`), and a body that does not fit or
 * could not be read is listed in `omitted` with its reason. Never a silent cut.
 */
import type {Candidate, Json} from './step-policy.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** One candidate body, as §13.1 bounds a capsule section. */
export const CANDIDATE_BODY_BYTES = 1024;
/** All bodies of one read: half the run's prescreen packet (16 KB), so the packet and its bodies fit one request slot. */
export const CANDIDATE_BODIES_BYTES = 8 * 1024;
/** The candidate families that carry a body, in the order the budget serves them (closed kinds of §135.2). */
export const BODY_FAMILIES: readonly string[] = Object.freeze(['clue', 'handout', 'person', 'obligation_check', 'move']);

export interface CandidateBody {
  /** The candidate's host key (`apply:clue:<handle>`); host-side only, the Keeper sees family and name. */
  key: string;
  family: string;
  name: string;
  /** The kernel read(s) the body came from: the calls the Keeper would otherwise have made. */
  read: Array<{method: string; params: Row}>;
  body: Row;
  truncated?: true;
  omitted_fields?: string[];
}
export interface CandidateBodies {
  bodies: CandidateBody[];
  omitted: Array<{key: string; family: string; name: string; reason: 'budget' | 'read_failed' | 'not_found'}>;
  bytes: number;
  reads: number;
  ms: number;
}
type Call = (method: string, params: Row) => Promise<unknown>;

/**
 * Fit a body into `max` bytes: first the kernel row's trailing fields go (the reads put identity and dossier first),
 * then long strings are clipped. What was cut is recorded on the body, never dropped silently.
 */
export function fitBody(body: Row, max = CANDIDATE_BODY_BYTES): {body: Row; truncated?: true; omitted_fields?: string[]} {
  if (bytes(body) <= max) return {body};
  const out: Row = {...body}, keys = Object.keys(out), dropped: string[] = [];
  // Keep at least the first three fields (the identity); drop from the end until the rest fits.
  while (bytes(out) > max && keys.length > 3) { const key = keys.pop()!; delete out[key]; dropped.unshift(key); }
  const done = (value: Row) => ({body: value, truncated: true as const, ...(dropped.length ? {omitted_fields: dropped} : {})});
  if (bytes(out) <= max) return done(out);
  const clip = (value: unknown, cap: number): unknown => typeof value === 'string'
    ? (Array.from(value).length > cap ? `${Array.from(value).slice(0, cap).join('')}…` : value)
    : Array.isArray(value) ? value.map(item => clip(item, cap))
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Row).map(([key, item]) => [key, clip(item, cap)])) : value;
  // The longest per-string cap that fits: every string keeps as much of its start as the budget allows.
  let low = 8, high = 4_000, best: Row | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2), candidate = clip(out, middle) as Row;
    if (bytes(candidate) <= max) { best = candidate; low = middle + 1; } else high = middle - 1;
  }
  if (best) return done(best);
  const [first] = Object.keys(out);
  for (const key of Object.keys(out).slice(1)) dropped.push(key);
  return done({[first]: clip(out[first], 8)});
}

/** The graph entity of `name` with `kind` from a module lookup's entities (a handle can name a beat or quest too). */
function entityOf(entities: Row[], name: string, kind: string): Row | undefined {
  return entities.find(entity => text(entity.kind) === kind && (text(entity.name) === name || text(entity.display_name) === name));
}
/** An entity without the fields every graph row repeats about itself. */
function graphRow(entity: Row): Row {
  const {name: _name, kind: _kind, visibility: _visibility, ...rest} = entity;
  return rest;
}
/**
 * A stated obligation as its check candidate's body (§135.26): its demand, who stands in the way, the next step and what
 * it guards (the guarded clues' summaries the candidate already carries). The page (`source`), the Mod bookkeeping and
 * the book's consequence lines are not in it.
 */
function obligationBody(row: Row, candidate: Candidate): Row {
  const next = object(row.next), guards = array(object(candidate.detail).guards);
  return {demand: text(row.name), ...(text(row.who) ? {who: text(row.who)} : {}), state: text(row.state),
    next: {kind: text(next.kind), ...(text(next.target) ? {target: text(next.target)} : {}), ...(next.selection ? {selection: next.selection} : {}),
      ...(Array.isArray(next.approaches) ? {approaches: next.approaches} : {}), ...(next.difficulty ? {difficulty: next.difficulty} : {})},
    ...(guards.length ? {guards} : {}), ...(row.reaction === 'preordained' && text(row.who) ? {reaction: `the book skips ${text(row.who)}'s reaction roll`} : {})};
}
/** A person as the destination list shows them: who they are and how the table may call them. */
function personLine(look: Row, handle: string): Row {
  return {name: text(look.name) || handle, ...(look.called ? {called: look.called} : {}), ...(look.role ? {role: look.role} : {}),
    ...(look.untold ? {untold: look.untold} : {}), ...(look.wants ? {wants: look.wants} : {})};
}

/**
 * Read the bodies of `candidates` (the builder's families above; the rest carry none). `capsule` is the read's
 * `table.capsule`; `call` is the kernel bridge. Read-only.
 */
export async function readCandidateBodies(input: {candidates: readonly Candidate[]; capsule: Row; call: Call}): Promise<CandidateBodies> {
  const began = Date.now();
  let reads = 0;
  const read = async (method: string, params: Row): Promise<Row | undefined> => {
    reads++;
    try { return object(await input.call(method, params)); } catch { return undefined; }
  };
  const wanted = input.candidates.filter(candidate => BODY_FAMILIES.includes(candidate.family))
    .map(candidate => {
      const bound = object(candidate.bound);
      const name = candidate.family === 'clue' ? text(bound.clue) : candidate.family === 'move' ? text(bound.to)
        : candidate.family === 'person' ? text(bound.who) : candidate.family === 'obligation_check' ? text(bound.obligation) : text(bound.name);
      return {candidate, name};
    }).filter(item => item.name)
    .sort((a, b) => BODY_FAMILIES.indexOf(a.candidate.family) - BODY_FAMILIES.indexOf(b.candidate.family));
  if (!wanted.length) return {bodies: [], omitted: [], bytes: 0, reads: 0, ms: 0};

  // One lookup per clue, exit and handout (the kernel's module lookup answers at most eight entities and matches a
  // many-handle query by search first, so a batch could miss one), one look per person; all in parallel.
  const expected: Readonly<Record<string, string>> = {clue: 'clue', move: 'scene', handout: 'handout'};
  const answers = await Promise.all(wanted.map(async item => {
    // An obligation's body is the issued row the candidate carries: no second read.
    if (item.candidate.family === 'obligation_check') return {params: {section: 'obligations'} as Row, answer: undefined};
    const params = item.candidate.family === 'person' ? {focus: 'npc', name: item.name} : {kind: 'module', query: item.name, expected_kind: expected[item.candidate.family]};
    return {params, answer: await read(item.candidate.family === 'person' ? 'table.look' : 'table.lookup', params)};
  }));
  // Who the book puts at each destination, read the way the Keeper would look them up.
  const destinationPeople = new Map<string, string[]>();
  for (const [index, item] of wanted.entries()) if (item.candidate.family === 'move') {
    const scene = entityOf(array(answers[index].answer?.entities).map(object), item.name, 'scene');
    destinationPeople.set(item.name, array(scene?.relations).map(object).filter(relation => relation.kind === 'present-in' && text(relation.from)).map(relation => text(relation.from)));
  }
  const handlesThere = [...new Set([...destinationPeople.values()].flat())];
  const lookedThere = new Map(await Promise.all(handlesThere.map(async handle => [handle, await read('table.look', {focus: 'npc', name: handle})] as const)));
  const clueRows = new Map(array(object(input.capsule.known).clues_here).map(object).map(row => [text(row.name), row]));

  const bodies: CandidateBody[] = [], omitted: CandidateBodies['omitted'] = [];
  let total = 0;
  for (const [index, {candidate, name}] of wanted.entries()) {
    const skip = (reason: CandidateBodies['omitted'][number]['reason']) => omitted.push({key: candidate.key, family: candidate.family, name, reason});
    const {params, answer} = answers[index], method = candidate.family === 'person' ? 'table.look' : 'table.lookup';
    const entities = array(answer?.entities).map(object);
    let body: Row | undefined, from: CandidateBody['read'] = [{method, params}];
    if (candidate.family === 'obligation_check') {
      const row = object(object(candidate.basis).row);
      if (!text(row.handle)) { skip('not_found'); continue; }
      body = obligationBody(row, candidate);
      from = [{method: 'table.apply.options', params: {section: 'obligations'}}];
    } else if (candidate.family === 'clue') {
      const entity = entityOf(entities, name, 'clue'), row = clueRows.get(name);
      if (!answer && !row) { skip('read_failed'); continue; }
      if (!entity && !row) { skip('not_found'); continue; }
      const {name: _name, ...capsuleRow} = row ?? {};
      body = {...capsuleRow, ...(entity ? graphRow(entity) : {})};
      from = [...(row ? [{method: 'table.capsule', params: {section: 'known.clues_here'}}] : []), ...(entity ? from : [])];
    } else if (candidate.family === 'handout') {
      if (!answer) { skip('read_failed'); continue; }
      const entity = entityOf(entities, name, 'handout') ?? entities.find(value => value.kind === 'handout');
      if (!entity) { skip('not_found'); continue; }
      body = {name: text(entity.name), ...graphRow(entity)};
    } else if (candidate.family === 'person') {
      if (!answer) { skip('read_failed'); continue; }
      const {kind: _kind, ...look} = answer;
      body = look;
    } else {
      if (!answer) { skip('read_failed'); continue; }
      const scene = entityOf(entities, name, 'scene');
      if (!scene) { skip('not_found'); continue; }
      const {relations: _relations, ...rest} = graphRow(scene), there = destinationPeople.get(name) ?? [];
      body = {...rest, people_there: there.map(handle => { const look = lookedThere.get(handle); return look ? personLine(look, handle) : {name: handle, unread: true}; })};
      from = [...from, ...there.map(handle => ({method: 'table.look', params: {focus: 'npc', name: handle}}))];
    }
    const fitted = fitBody(body!, CANDIDATE_BODY_BYTES);
    const entry: CandidateBody = {key: candidate.key, family: candidate.family, name, read: from, body: fitted.body,
      ...(fitted.truncated ? {truncated: true as const} : {}), ...(fitted.omitted_fields ? {omitted_fields: fitted.omitted_fields} : {})};
    // The budget is what the Keeper reads (family, name, body and the cut marks), not the host's key and read list.
    const size = bytes(keeperView(entry));
    if (total + size > CANDIDATE_BODIES_BYTES) { skip('budget'); continue; }
    total += size;
    bodies.push(entry);
  }
  return {bodies, omitted, bytes: total, reads, ms: Date.now() - began};
}

/** What the Keeper is told about the bodies (Keeper-only, system language). */
export const ISSUED_BODIES_HEAD = 'The bodies of what can be done here this turn, read from the kernel before you were asked: each '
  + 'undiscovered clue, handout, person not yet introduced and exit (with who the book puts at that destination), as look and lookup '
  + 'return them, and a stated obligation\'s check (the demand and what it guards). They are current as of this read; do not look or lookup them again. A body marked truncated is cut to its budget: '
  + 'look it up only for a field it omits. Keeper-only material, never player text.';

/** One body as the Keeper reads it: family, name and body; the host key and read list stay on the artifact. */
function keeperView(entry: CandidateBody): Row {
  return {family: entry.family, name: entry.name, body: entry.body,
    ...(entry.truncated ? {truncated: true} : {}), ...(entry.omitted_fields ? {omitted_fields: entry.omitted_fields} : {})};
}
/** The Keeper-facing section of the run's packet. */
export function issuedSection(read: CandidateBodies): Json | undefined {
  if (!read.bodies.length && !read.omitted.length) return undefined;
  return {head: ISSUED_BODIES_HEAD,
    bodies: read.bodies.map(keeperView),
    ...(read.omitted.length ? {omitted: read.omitted.map(entry => ({family: entry.family, name: entry.name, reason: entry.reason}))} : {})} as Json;
}
