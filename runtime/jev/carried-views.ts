/**
 * What the run has read, carried to the Keeper before each model step (contract §135.31, SL-15; the owner's ruling "The
 * Keeper is shown what the run has read"). On the live gate the Keeper spent three model rounds on `look` for data the
 * run held or could fetch by code: the scene it had just been moved into, the card of the man it was about to hit, the
 * fight once it opened. The `coc-clerk` message now carries those views, exactly as `look` returns them:
 *
 * - the scene: `table.look {focus: scene}`, once the active scene differs from the one the run began in, its `present`
 *   reduced to who is there (`PRESENT_FIELDS`);
 * - a person: `table.look {focus: npc, name}` (without `kind`, the §135.20 person body's shape) for each person a
 *   candidate of this run names, read off the candidate's closed structure (`namedPeople`), never its words;
 * - the session: `{session, pending_choice}`, which the fresh read already holds from `table.resolve.options`;
 * - a scene's source passages (§135.31.1, SL-27): what this run's prescreen located about the scene -- the book's own
 *   passages and the module's authored material on the place and what is there -- grouped by entity (`scenePassages`);
 * - a source consultation that went pending (§135.31.2, SL-36): once it lands, its checked answer (`source_answer`), and
 *   while it is still being read, a `pending` row, both from the kernel extension's `coc:source-answers` port.
 *
 * When each is due (once per scene, once per person, the session whenever it changed) is the engine's; this module reads
 * the views it is asked for, orders each view's fields so what the Keeper acts on comes first (`FIELD_ORDER`), and bounds
 * them with ceilings of their own (owner decision 2026-09-24: §135.20's 1 KiB cut
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
/**
 * §22.4.7 (SL-47): a scene's book text, carried once when a move lands on it. A page of a PDF book is 3.5-4.6 KB of
 * native text; this holds about two, and the message's 12 KiB is shared.
 */
export const SCENE_TEXT_VIEW_BYTES = 8 * 1024;

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
 * §135.31 (owner decision 2026-09-24): the clerk orders a view's fields before it cuts, so what the Keeper needs to act
 * travels first and prose last. Closed lists of `look`'s own field names, in priority order; every field a list does not
 * name follows in the order `look` gave it. Nothing is renamed or invented.
 *
 * - a person card: identity; the rules numbers and the fight (`mechanics`, the standing defence, disposition and action of
 *   §11.5.2-.3, `deflect_options`); what drives them (wants, fears, hides, and `relationships`, which carries the first
 *   impression a Mod settled); what they know and what was said (knowledge, the ledger, the Keeper's note); the rest.
 * - a scene view: where it is, the exits, the affordances, the assets and obligations, the classifications a reviewer
 *   contested (§22.3.2), then `present` (reduced to who is there, `PRESENT_FIELDS`), then the rest of `where` (the
 *   dramatic question, the pressure moves, the notes).
 */
export const CARD_FIELD_ORDER: readonly string[] = Object.freeze(['name', 'called', 'id', 'role', 'scene', 'visibility',
  'mechanics', 'combat_tactic', 'combat_disposition', 'combat_standing', 'deflect_options',
  'wants', 'fears', 'hides', 'relationships',
  'knows', 'knowledge', 'believes', 'hides_claims', 'would_lie_about', 'ledger', 'keeper_note']);
export const SCENE_FIELD_ORDER: readonly string[] = Object.freeze(['where.scene', 'where.display_name', 'where.summary',
  'where.exits', 'where.affordances', 'where.assets', 'where.obligations', 'where.contested', 'where.contested_note', 'present']);
/** A person in a carried scene view's `present`: who is there; their dossier is what the person cards carry. */
export const PRESENT_FIELDS: readonly string[] = Object.freeze(['name', 'called', 'role']);
/** §135.31.2: a landed consultation's view: what it concluded and its limits before the references and the question. */
export const ANSWER_FIELD_ORDER: readonly string[] = Object.freeze(['status', 'answer', 'answers', 'limitations', 'source_refs', 'question']);
/** The field order a carried view of `focus` is cut in (§135.31); none for the session, which `look` orders already. */
export const FIELD_ORDER: Readonly<Record<string, readonly string[]>> = Object.freeze({npc: CARD_FIELD_ORDER, scene: SCENE_FIELD_ORDER,
  source_answer: ANSWER_FIELD_ORDER});

/**
 * Fit a view into `max` bytes the way `fitBody` fits a body. A wrapper's own fields count as the view's fields
 * (`where.scene`, `session.round`); `first` puts the named fields (flat names) ahead of the rest, in its order, before
 * the cut, which drops from the tail. Cut fields are named with their wrapper (`where.keeper_notes`).
 */
export function fitView(view: Row, max = CARRIED_VIEW_BYTES, first: readonly string[] = []): {view: Row; truncated?: true; omitted_fields?: string[]} {
  const given: Row = {};
  for (const [key, value] of Object.entries(view)) {
    const inner = WRAPPERS.includes(key) ? object(value) : undefined;
    if (inner && Object.keys(inner).length && value === inner) for (const [field, item] of Object.entries(inner)) given[`${key}.${field}`] = item;
    else given[key] = value;
  }
  const flat: Row = {};
  for (const key of first) if (Object.hasOwn(given, key)) flat[key] = given[key];
  for (const [key, value] of Object.entries(given)) if (!Object.hasOwn(flat, key)) flat[key] = value;
  const nest = (row: Row): Row => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      const dot = key.indexOf('.'), wrapper = dot > 0 ? key.slice(0, dot) : '';
      if (wrapper && WRAPPERS.includes(wrapper) && Object.hasOwn(view, wrapper)) (out[wrapper] ??= {})[key.slice(dot + 1)] = value;
      else out[key] = value;
    }
    return out;
  };
  if (bytes(view) <= max) return {view: nest(flat)};
  // Nesting can cost a few bytes over the flat form (one wrapper with one field left); fit again a little tighter.
  for (let limit = max; limit > 0; limit -= 16) {
    const fitted = fitBody(flat, limit), nested = nest(fitted.body);
    if (bytes(nested) <= max) return {view: nested, truncated: true, ...(fitted.omitted_fields ? {omitted_fields: fitted.omitted_fields} : {})};
  }
  return {view: {}, truncated: true, omitted_fields: Object.keys(flat)};
}

/** One carried view as the host keeps it: `look`'s focus, the name `look` gives, the view, the cut marks and its read. */
export interface CarriedView {
  focus: 'scene' | 'npc' | 'session' | 'source' | 'source_answer' | 'scene_text' | 'scene_record';
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
  /** §135.31.2: the consultations still being read (Keeper-facing rows), when any are due. */
  pending?: Row[];
}

/**
 * Read and bound the views due at this step. `scene`: the scene handle whose view is due; `people`: the names due, in the
 * order they were named; `skip`: names and card ids already shown this run (a card that resolves to one is not carried
 * again); `session`: the fresh read's `{session, pending_choice}`, or `'read'` when that read failed and a session is
 * active (then `look focus=session` is read). Read-only.
 */
export async function readCarriedViews(input: {call: Call; scene?: string; people: readonly string[]; skip?: ReadonlySet<string>;
  session?: Row | 'read'; passages?: {scene: string; view: Row}; answers?: Array<{name: string; view: Row}>; pending?: Row[];
  /** §22.4.7: the book's text of scenes a move landed on (once each), and the records of scenes that settled away from the party. */
  sceneTexts?: Array<{scene: string; pages: Array<{page: number; pdf_label?: string; text: string}>}>;
  sceneRecords?: Array<{scene: string; view: Row}>}): Promise<CarriedViews> {
  const began = Date.now();
  let reads = 0;
  const read = async (method: string, params: Row): Promise<{ok: true; value: Row} | {ok: false; code: string}> => {
    reads++;
    try { return {ok: true, value: object(await input.call(method, params))}; }
    catch (error) { return {ok: false, code: text(object(error).code) || text(object(object(error).error).code) || 'read_failed'}; }
  };
  const due: Array<Omit<CarriedView, 'view'> & {view?: Row; reason?: 'read_failed' | 'not_found'; dropped?: string[]}> = [];
  const resolved: CarriedViews['resolved'] = [];
  if (input.session === 'read') {
    const params = {focus: 'session'}, answer = await read('table.look', params);
    if (answer.ok) due.push({focus: 'session', view: {session: answer.value.session ?? null, pending_choice: answer.value.pending_choice ?? null}, read: {method: 'table.look', params}});
    else due.push({focus: 'session', read: {method: 'table.look', params}, reason: 'read_failed'});
  } else if (input.session) due.push({focus: 'session', view: input.session, read: null});
  // §135.31.2: a consultation the Keeper asked for that has since landed, next after the session; nothing is read for it.
  for (const answer of input.answers ?? []) due.push({focus: 'source_answer', name: answer.name, view: answer.view, read: null});
  // §22.4.7: the book's text of a scene a move landed on, next; nothing is read for it (the host extracted it).
  // Whole pages in the book's order while they fit the ceiling; a page that does not fit is dropped and named, so the first
  // page arrives whole (a long string cut mid-page would lose the page's end, where the scene's own lines often are).
  for (const entry of input.sceneTexts ?? []) {
    const view: Row = {}, dropped: string[] = [];
    for (const page of entry.pages) {
      const key = `page ${page.page}${page.pdf_label ? ` (${page.pdf_label})` : ''}`;
      if (Object.keys(view).length && bytes({...view, [key]: page.text}) > SCENE_TEXT_VIEW_BYTES) { dropped.push(key); continue; }
      view[key] = page.text;
    }
    due.push({focus: 'scene_text', name: entry.scene, read: null, view, ...(dropped.length ? {dropped} : {})});
  }
  for (const entry of input.sceneRecords ?? []) due.push({focus: 'scene_record', name: entry.scene, view: entry.view, read: null});
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
    // §135.31: `present` is reduced to who is there (the dossiers are what the person cards carry).
    const who = (person: unknown): Row => Object.fromEntries(PRESENT_FIELDS.filter(key => Object.hasOwn(object(person), key)).map(key => [key, object(person)[key]]));
    if (answer.ok) due.push({focus: 'scene', name: input.scene, read: {method: 'table.look', params},
      view: Array.isArray(answer.value.present) ? {...answer.value, present: answer.value.present.map(who)} : answer.value});
    else due.push({focus: 'scene', name: input.scene, read: {method: 'table.look', params}, reason: 'read_failed'});
  }
  // §135.31.1: the passages are the prescreen's materials the run already holds; nothing is read for them. Served last.
  if (input.passages) due.push({focus: 'source', name: input.passages.scene, view: input.passages.view, read: null});
  const views: CarriedView[] = [], omitted: CarriedViews['omitted'] = [];
  let total = 0;
  for (const item of due) {
    const named = item.name ? {name: item.name} : {};
    if (item.reason || !item.view) { omitted.push({focus: item.focus, ...named, reason: item.reason ?? 'read_failed'}); continue; }
    const fitted = fitView(item.view, item.focus === 'scene_text' ? SCENE_TEXT_VIEW_BYTES : CARRIED_VIEW_BYTES, FIELD_ORDER[item.focus] ?? []);
    const omittedFields = [...(item.dropped ?? []), ...(fitted.omitted_fields ?? [])];
    const entry: CarriedView = {focus: item.focus, ...named, ...(item.id ? {id: item.id} : {}), view: fitted.view, read: item.read,
      ...(fitted.truncated || item.dropped?.length ? {truncated: true as const} : {}), ...(omittedFields.length ? {omitted_fields: omittedFields} : {})};
    // The budget is what the Keeper reads (focus, name, view and the cut marks), not the host's id and read.
    const size = bytes(keeperView(entry));
    if (total + size > CARRIED_VIEWS_BYTES) { omitted.push({focus: item.focus, ...named, reason: 'budget'}); continue; }
    total += size;
    views.push(entry);
  }
  return {views, omitted, resolved, bytes: total, reads, ms: Date.now() - began, ...(input.pending?.length ? {pending: input.pending} : {})};
}

/** What the Keeper is told about the carried views (Keeper-only, system language). */
export const CARRIED_VIEWS_HEAD = 'What look would return right now, read by the host from this run\'s fresh read before you were asked: '
  + 'the scene (it changed during this run), the card of each person a step of this turn names, and the session underway. '
  + 'They are current as of this step; do not look them again. A view marked truncated is cut to its budget: look only for a '
  + 'field it omits. Keeper-only material, never player text.';
/** §135.31.1: what the Keeper is told about a scene's passages (`focus: "source"`), after the head above. */
export const CARRIED_PASSAGES_HEAD = 'A view with focus source is the source passages this run\'s prescreen located about that scene: the book\'s '
  + 'own passages, and what the module authored about the place and what is there.';
/**
 * §135.31.1: the module's source, when the read knows it: the capsule carries `reading` (the book's table of contents, §22)
 * only for a module that came from an original document. Without one, the authored graph is the whole source.
 */
export const CARRIED_NO_DOCUMENT = 'This module has no original document: its authored graph is its whole source, these passages are what it '
  + 'says about the scene, and lookup kind=source answers no_source_document here.';
export const CARRIED_DOCUMENT = 'lookup kind=source reads the original document for what they do not cover.';
/** §135.31.2: what the Keeper is told about a landed consultation (`focus: "source_answer"`). */
export const CARRIED_ANSWERS_HEAD = 'A view with focus source_answer is a source consultation you asked for earlier that has come back since: the '
  + 'checked answer with its question, carried once and kept in the campaign memo (the same lookup returns it at once). It is a source '
  + 'consultation, not prepared material. One marked unavailable could not be read: that is the clerk\'s business, never the fiction or the '
  + 'player\'s; play on without it.';
/** §22.4.7 (SL-47): what the Keeper is told about a scene's book text (`focus: "scene_text"`). */
export const CARRIED_SCENE_TEXT_HEAD = 'A view with focus scene_text is the book\'s own text for a scene a move just landed on, page by page, carried '
  + 'once: the scene\'s reviewed record (its exits, the people there, the things and clues) is still being read. Narrate the arrival from it; do '
  + 'not invent exits, people, clues or numbers it does not state. The record lands on a later note.';
/** §22.4.7: what the Keeper is told about a scene record that settled (`focus: "scene_record"`, or the scene view itself). */
export const CARRIED_SCENE_RECORD_HEAD = 'A view with focus scene_record says a scene\'s reviewed record has landed (look focus=scene when the party '
  + 'is there) or could not be read (the clerk\'s business, never the fiction); a scene view of a scene you were given as scene_text is its '
  + 'reviewed record, carried once.';
/** §22.4.7: what the Keeper is told when a pending row names a scene. */
export const CARRIED_PENDING_SCENE_HEAD = 'A pending row with a scene is that scene\'s reviewed record (its exits, the people there, the things and '
  + 'clues): not known yet; do not invent them.';
/** §135.31.2: what the Keeper is told about the consultations still being read (`pending`). */
export const CARRIED_PENDING_HEAD = 'pending lists source consultations still being read: their answers are not here yet and will be carried once '
  + 'they land. Use the passages and what you already know, narrate what the investigator does meanwhile, and do not ask for them again this turn.';

/** One view as the Keeper reads it: `look`'s focus, the name, the view and the cut marks; the id and the read stay host-side. */
function keeperView(entry: CarriedView): Row {
  return {focus: entry.focus, ...(entry.name ? {name: entry.name} : {}), view: entry.view,
    ...(entry.truncated ? {truncated: true} : {}), ...(entry.omitted_fields ? {omitted_fields: entry.omitted_fields} : {})};
}
/**
 * The Keeper-facing `carried` section of the `coc-clerk` message, or none. `document`: whether the module has an original
 * document (the capsule's `reading` section), when the read knows it; it only chooses the passages' last sentence.
 */
export function carriedSection(carried: CarriedViews, options: {document?: boolean; record?: boolean} = {}): Json | undefined {
  if (!carried.views.length && !carried.omitted.length && !carried.pending?.length) return undefined;
  const source = options.document === false ? ` ${CARRIED_NO_DOCUMENT}` : options.document === true ? ` ${CARRIED_DOCUMENT}` : '';
  const head = [carried.views.some(entry => entry.focus === 'source') ? `${CARRIED_VIEWS_HEAD} ${CARRIED_PASSAGES_HEAD}${source}` : CARRIED_VIEWS_HEAD,
    ...(carried.views.some(entry => entry.focus === 'source_answer') ? [CARRIED_ANSWERS_HEAD] : []),
    ...(carried.views.some(entry => entry.focus === 'scene_text') ? [CARRIED_SCENE_TEXT_HEAD] : []),
    ...(options.record || carried.views.some(entry => entry.focus === 'scene_record') ? [CARRIED_SCENE_RECORD_HEAD] : []),
    ...(carried.pending?.length ? [CARRIED_PENDING_HEAD] : []),
    ...(carried.pending?.some(row => typeof row.scene === 'string') ? [CARRIED_PENDING_SCENE_HEAD] : [])].join(' ');
  return {head, views: carried.views.map(keeperView),
    ...(carried.omitted.length ? {omitted: carried.omitted} : {}), ...(carried.pending?.length ? {pending: carried.pending} : {})} as Json;
}

/** One prescreen material of this run, with the scene of the read that prepared (or reused) it. */
export interface PassageSource {scene: string; material: Row}

const parsed = (value: unknown): Row => {
  if (typeof value !== 'string') return object(value);
  try { return object(JSON.parse(value)); } catch { return {}; }
};
/** Whether `value` holds `handle` as a whole string anywhere (a relation's `to`, an authored `scene_id`): handle equality. */
function names(value: unknown, handle: string): boolean {
  if (typeof value === 'string') return value === handle;
  if (Array.isArray(value)) return value.some(item => names(item, handle));
  return !!value && typeof value === 'object' && Object.values(value as Row).some(item => names(item, handle));
}
/** Merge one located unit's fields into an entity's passage: objects field by field, anything else kept from the first unit. */
function mergeUnit(into: Row, unit: Row): void {
  for (const [key, value] of Object.entries(unit)) {
    if (!Object.hasOwn(into, key)) into[key] = structuredClone(value);
    else if (value && typeof value === 'object' && !Array.isArray(value) && into[key] && typeof into[key] === 'object' && !Array.isArray(into[key]))
      for (const [field, item] of Object.entries(value as Row)) if (!Object.hasOwn(into[key], field)) into[key][field] = structuredClone(item);
  }
}

/**
 * §135.31.1 (SL-27): the source passages of `scene` among this run's prescreen materials, as the carried view's body, or
 * none. The book's passages (`kind: "source"`: a checked answer, a native page, a supported consultation) of a read made at
 * the scene, under their labels; then the `graph_entity` materials of the scene's own entity and of every entity one of
 * whose located units names the scene handle as a value, each under its locator with its units merged (the identity
 * once). Book first, the scene's own entity next, the others in the packet's order. Structure and handle equality only.
 */
export function scenePassages(rows: readonly PassageSource[], scene: string): Row | undefined {
  if (!scene) return undefined;
  const book: Array<[string, Row]> = [];
  const entities = new Map<string, {name: string; kind: string; units: Row[]; anchored: boolean}>();
  const seen = new Set<string>();
  for (const {scene: at, material} of rows) {
    const key = JSON.stringify([material.kind, material.label, material.content]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (text(material.kind) === 'source') {
      if (at !== scene) continue;
      let label = text(material.label) || `passage ${book.length + 1}`;
      for (let n = 2; book.some(([name]) => name === label); n++) label = `${text(material.label)} (${n})`;
      book.push([label, {authority: material.authority ?? null, content: material.content ?? null, ...(material.provenance ? {provenance: material.provenance} : {})}]);
      continue;
    }
    if (text(material.kind) !== 'graph_entity') continue;
    const content = parsed(material.content), entity = object(content.entity), name = text(entity.name);
    if (!name) continue;
    const locator = text(object(material.provenance).locator) || `${text(entity.kind) || 'entity'}:${name}`;
    const {entity: _stub, ...rest} = content;
    const entry = entities.get(locator) ?? {name, kind: text(entity.kind), units: [], anchored: false};
    if (!entry.units.length) entry.units.push({entity});
    entry.units.push(rest);
    entry.anchored ||= name === scene || names(rest, scene);
    entities.set(locator, entry);
  }
  const anchored = [...entities.entries()].filter(([, entry]) => entry.anchored);
  // The scene's own entity leads the graph passages.
  anchored.sort(([, a], [, b]) => Number(b.kind === 'scene' && b.name === scene) - Number(a.kind === 'scene' && a.name === scene));
  const view: Row = Object.fromEntries(book);
  for (const [locator, entry] of anchored) {
    const merged: Row = {};
    for (const unit of entry.units) mergeUnit(merged, unit);
    view[locator] = merged;
  }
  return Object.keys(view).length ? view : undefined;
}
