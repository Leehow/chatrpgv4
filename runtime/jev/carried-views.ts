/**
 * What the run has read, carried to the Keeper before each model step (contract §135.31, SL-15; the owner's ruling "The
 * Keeper is shown what the run has read"). On the live gate the Keeper spent three model rounds on `look` for data the
 * run held or could fetch by code: the scene it had just been moved into, the card of the man it was about to hit, the
 * fight once it opened. The `coc-clerk` message now carries those views, exactly as `look` returns them:
 *
 * - the scene: `table.look {focus: scene}`, once the active scene differs from the one the run began in;
 * - a person: `table.look {focus: npc, name}` (without `kind`, the §135.20 person body's shape) for each person a
 *   candidate of this run names, read off the candidate's closed structure (`namedPeople`), never its words;
 * - the session: `{session, pending_choice}`, which the fresh read already holds from `table.resolve.options`.
 *
 * When each is due (once per scene, once per person, the session whenever it changed) is the engine's; this module reads
 * the views it is asked for and bounds them with ceilings of their own (owner decision 2026-09-24: §135.20's 1 KiB cut
 * dropped what a view is for -- a card's `mechanics`, a scene's exits and people), cut the way §135.20 cuts a body; a cut
 * is marked, and a view that does not fit, could not be read or does not resolve is listed with its reason. Never a silent
 * cut. §135.20's own ceilings stay for the issued bodies.
 */
import {fitBody} from './candidate-bodies.ts';
import type {Candidate, Json} from './step-policy.ts';

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** One carried view (§135.31): a whole scene view or card on the gate state is 4.0-4.5 KB before this cut. */
export const CARRIED_VIEW_BYTES = 4 * 1024;
/** All carried views of one `coc-clerk` message (§135.31). */
export const CARRIED_VIEWS_BYTES = 12 * 1024;

/** The wrapper keys of a view whose own fields are the view's fields for the cut (`where.scene`, `session.round`, …). */
const WRAPPERS: readonly string[] = Object.freeze(['where', 'session']);

/**
 * The people a candidate names, from its closed structure: `bound.target`, `bound.actor` and `bound.who` (and the same
 * in each variant), `bound.name` of an `npc`-family candidate, the options of a closed unbound `target`/`actor`, the
 * `who` of a meeting it carries, and a pending-defence row's `actor` and `attacker`. Investigators are filtered later.
 */
export function namedPeople(candidate: Pick<Candidate, 'family' | 'bound'> & Partial<Candidate> | undefined): string[] {
  if (!candidate) return [];
  const out: string[] = [];
  const add = (value: unknown) => { const name = text(value); if (name && !out.includes(name)) out.push(name); };
  const fromBound = (bound: unknown) => { const row = object(bound); add(row.target); add(row.actor); add(row.who); };
  fromBound(candidate.bound);
  if (candidate.family === 'npc') add(object(candidate.bound).name);
  for (const variant of Object.values(candidate.variants ?? {})) fromBound(variant.bound);
  for (const parameter of candidate.unbound ?? [])
    if ((parameter.name === 'target' || parameter.name === 'actor') && parameter.vocabulary === 'closed') for (const option of parameter.options ?? []) add(option);
  if (candidate.before) fromBound(candidate.before.bound);
  const basis = object(candidate.basis);
  if (basis.path === 'context.session.pending_defense') { add(object(basis.row).actor); add(object(basis.row).attacker); }
  return out;
}

/**
 * Fit a view into `max` bytes the way `fitBody` fits a body. A wrapper's own fields count as the view's fields in order
 * (so the scene keeps `where.scene` and drops `present` and `where`'s tail first); cut fields are named with their
 * wrapper (`where.affordances`).
 */
export function fitView(view: Row, max = CARRIED_VIEW_BYTES): {view: Row; truncated?: true; omitted_fields?: string[]} {
  if (bytes(view) <= max) return {view};
  const flat: Row = {};
  for (const [key, value] of Object.entries(view)) {
    const inner = WRAPPERS.includes(key) ? object(value) : undefined;
    if (inner && Object.keys(inner).length && value === inner) for (const [field, item] of Object.entries(inner)) flat[`${key}.${field}`] = item;
    else flat[key] = value;
  }
  const nest = (row: Row): Row => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      const dot = key.indexOf('.'), wrapper = dot > 0 ? key.slice(0, dot) : '';
      if (wrapper && WRAPPERS.includes(wrapper) && Object.hasOwn(view, wrapper)) (out[wrapper] ??= {})[key.slice(dot + 1)] = value;
      else out[key] = value;
    }
    return out;
  };
  // Nesting can cost a few bytes over the flat form (one wrapper with one field left); fit again a little tighter.
  for (let limit = max; limit > 0; limit -= 16) {
    const fitted = fitBody(flat, limit), nested = nest(fitted.body);
    if (bytes(nested) <= max) return {view: nested, truncated: true, ...(fitted.omitted_fields ? {omitted_fields: fitted.omitted_fields} : {})};
  }
  return {view: {}, truncated: true, omitted_fields: Object.keys(flat)};
}

/** One carried view as the host keeps it: `look`'s focus, the name `look` gives, the view, the cut marks and its read. */
export interface CarriedView {
  focus: 'scene' | 'npc' | 'session';
  name?: string;
  /** The npc's own id from its card (the host's dedupe key); host-side only. */
  id?: string;
  view: Row;
  truncated?: true;
  omitted_fields?: string[];
  read: {method: string; params: Row} | null;
}
export interface CarriedViews {
  views: CarriedView[];
  omitted: Array<{focus: string; name?: string; reason: 'budget' | 'read_failed' | 'not_found'}>;
  /** Every name asked for that resolved, to the card's id (so a later step does not read it again). */
  resolved: Array<{name: string; id: string}>;
  bytes: number;
  reads: number;
  ms: number;
}

/**
 * Read and bound the views due at this step. `scene`: the scene handle whose view is due; `people`: the names due, in the
 * order they were named; `skip`: names and card ids already shown this run (a card that resolves to one is not carried
 * again); `session`: the fresh read's `{session, pending_choice}`, or `'read'` when that read failed and a session is
 * active (then `look focus=session` is read). Read-only.
 */
export async function readCarriedViews(input: {call: Call; scene?: string; people: readonly string[]; skip?: ReadonlySet<string>;
  session?: Row | 'read'}): Promise<CarriedViews> {
  const began = Date.now();
  let reads = 0;
  const read = async (method: string, params: Row): Promise<{ok: true; value: Row} | {ok: false; code: string}> => {
    reads++;
    try { return {ok: true, value: object(await input.call(method, params))}; }
    catch (error) { return {ok: false, code: text(object(error).code) || text(object(object(error).error).code) || 'read_failed'}; }
  };
  const due: Array<Omit<CarriedView, 'view'> & {view?: Row; reason?: 'read_failed' | 'not_found'}> = [];
  const resolved: CarriedViews['resolved'] = [];
  if (input.session === 'read') {
    const params = {focus: 'session'}, answer = await read('table.look', params);
    if (answer.ok) due.push({focus: 'session', view: {session: answer.value.session ?? null, pending_choice: answer.value.pending_choice ?? null}, read: {method: 'table.look', params}});
    else due.push({focus: 'session', read: {method: 'table.look', params}, reason: 'read_failed'});
  } else if (input.session) due.push({focus: 'session', view: input.session, read: null});
  const skip = new Set(input.skip ?? []);
  const cards = await Promise.all(input.people.filter(name => !skip.has(name)).map(async name => {
    const params = {focus: 'npc', name};
    return {name, params, answer: await read('table.look', params)};
  }));
  for (const {name, params, answer} of cards) {
    if (!answer.ok) { due.push({focus: 'npc', name, read: {method: 'table.look', params}, reason: answer.code === 'unknown_entity' ? 'not_found' : 'read_failed'}); continue; }
    const {kind: _kind, ...card} = answer.value, id = text(card.id) || text(card.name) || name;
    resolved.push({name, id});
    if (skip.has(id)) continue;
    skip.add(id);
    due.push({focus: 'npc', name: text(card.name) || name, id, view: card, read: {method: 'table.look', params}});
  }
  if (input.scene) {
    const params = {focus: 'scene'}, answer = await read('table.look', params);
    if (answer.ok) due.push({focus: 'scene', name: input.scene, view: answer.value, read: {method: 'table.look', params}});
    else due.push({focus: 'scene', name: input.scene, read: {method: 'table.look', params}, reason: 'read_failed'});
  }
  const views: CarriedView[] = [], omitted: CarriedViews['omitted'] = [];
  let total = 0;
  for (const item of due) {
    const named = item.name ? {name: item.name} : {};
    if (item.reason || !item.view) { omitted.push({focus: item.focus, ...named, reason: item.reason ?? 'read_failed'}); continue; }
    const fitted = fitView(item.view, CARRIED_VIEW_BYTES);
    const entry: CarriedView = {focus: item.focus, ...named, ...(item.id ? {id: item.id} : {}), view: fitted.view, read: item.read,
      ...(fitted.truncated ? {truncated: true as const} : {}), ...(fitted.omitted_fields ? {omitted_fields: fitted.omitted_fields} : {})};
    // The budget is what the Keeper reads (focus, name, view and the cut marks), not the host's id and read.
    const size = bytes(keeperView(entry));
    if (total + size > CARRIED_VIEWS_BYTES) { omitted.push({focus: item.focus, ...named, reason: 'budget'}); continue; }
    total += size;
    views.push(entry);
  }
  return {views, omitted, resolved, bytes: total, reads, ms: Date.now() - began};
}

/** What the Keeper is told about the carried views (Keeper-only, system language). */
export const CARRIED_VIEWS_HEAD = 'What look would return right now, read by the host from this run\'s fresh read before you were asked: '
  + 'the scene (it changed during this run), the card of each person a step of this turn names, and the session underway. '
  + 'They are current as of this step; do not look them again. A view marked truncated is cut to its budget: look only for a '
  + 'field it omits. Keeper-only material, never player text.';

/** One view as the Keeper reads it: `look`'s focus, the name, the view and the cut marks; the id and the read stay host-side. */
function keeperView(entry: CarriedView): Row {
  return {focus: entry.focus, ...(entry.name ? {name: entry.name} : {}), view: entry.view,
    ...(entry.truncated ? {truncated: true} : {}), ...(entry.omitted_fields ? {omitted_fields: entry.omitted_fields} : {})};
}
/** The Keeper-facing `carried` section of the `coc-clerk` message, or none. */
export function carriedSection(carried: CarriedViews): Json | undefined {
  if (!carried.views.length && !carried.omitted.length) return undefined;
  return {head: CARRIED_VIEWS_HEAD, views: carried.views.map(keeperView),
    ...(carried.omitted.length ? {omitted: carried.omitted} : {})} as Json;
}
