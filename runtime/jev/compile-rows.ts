/**
 * The compile's feature rows (contract §135.30): the options of each typed feature, read from the same kernel reads the
 * candidates come from (§135.2) and nothing else. A row is the kernel's own identity for the thing (a scene handle, a
 * person's record name, an obligation handle, an action word, a participant, an object) and the row's own words for
 * Jev. Nothing here reads the player's input, and no list below names a meaning: every option is a row the kernel issued.
 */
import type {Json} from './step-policy.ts';
import type {FeatureRow, FeatureRows} from './route-compile.ts';
import type {StateReads} from './candidates.ts';
import {resolveIntents} from './candidates.ts';
import {guardedThings, guardsOf} from './obligation-candidates.ts';
import {ORDINARY_CHOICES} from './ordinary-resolve-domain.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => array(value).map(text).filter(Boolean);

/** Rows in their first-seen order, one per identity. */
function unique(rows: FeatureRow[]): FeatureRow[] {
  const seen = new Set<string>();
  return rows.filter(row => row.id && !seen.has(row.id) && (seen.add(row.id), true));
}
/** A resolve intent's words: the ordinary binder's description where the contract gives one, else the intent itself. */
const intentWords = (intent: string): string => {
  const described = (ORDINARY_CHOICES.intent.criteria as Record<string, string>)[intent];
  return described ? `${intent}: ${described}` : intent;
};

/**
 * The rows of every feature family, from the run's reads:
 * - destination: `table.apply.options` move rows (`to`, the kernel's `display_name`);
 * - addressee: `table.capsule.present` (the table's own label: `called.name`, else `untold.label`; the role; the record
 *   name only for a person the table has no label for);
 * - ask: the open obligations' demands (their name and what they guard), the issued clue rows no obligation guards, the
 *   scene's handouts not yet shown;
 * - act: in a running session on the investigator's turn, the actions the session issues for them; outside a session,
 *   the canonical resolve intents;
 * - target: in a running combat on the investigator's turn, the targets its attack row issues; outside a session, the
 *   people present (the addressee rows) when the kernel issues a first blow (§135.30.2);
 * - item: the object instances an investigator carries.
 */
export function compileRows(reads: StateReads): FeatureRows {
  const capsule = object(reads.capsule), where = object(capsule.where), applyOptions = object(reads.applyOptions);
  const resolveContext = object(object(reads.resolveOptions).context), session = object(resolveContext.session ?? where.session);
  const options = array(applyOptions.candidates).map(object);
  const destination = unique(options.filter(row => object(row.effect).kind === 'move').map(row => {
    const to = text(object(row.effect).to), name = text(object(row.description).display_name);
    return {id: to, describe: (name ? {place: name, handle: to} : {place: to}) as Json};
  }));
  const addressee = unique(array(capsule.present).map(object).filter(person => text(person.name)).map(person => {
    const label = text(object(person.called).name) || text(object(person.untold).label), role = text(person.role);
    return {id: text(person.name), describe: {...(label ? {label} : {name: text(person.name)}), ...(role ? {role} : {})} as Json};
  }));
  const guards = guardsOf({capsule, applyOptions, resolveOptions: object(reads.resolveOptions)});
  const shown = new Set(strings(object(applyOptions.context).handouts_shown));
  const ask = unique([
    ...array(applyOptions.obligations).map(object).filter(row => row.state === 'open' && text(row.handle)).map(row => {
      const things = guardedThings({capsule, applyOptions, resolveOptions: object(reads.resolveOptions)}, row);
      return {id: `obligation:${text(row.handle)}`, describe: {demand: text(row.name) || text(row.handle), ...(things.length ? {guards: things} : {})} as Json};
    }),
    ...options.filter(row => object(row.effect).kind === 'clue' && !text(row.guarded_by) && !guards.clues.has(text(object(row.effect).clue)))
      .map(row => ({id: `clue:${text(object(row.effect).clue)}`, describe: {clue: text(object(row.description).summary) || text(object(row.effect).clue)} as Json})),
    ...array(where.assets).map(object).filter(asset => asset.kind === 'handout' && text(asset.name) && asset.shown !== true && !shown.has(text(asset.name)))
      .map(asset => ({id: `handout:${text(asset.name)}`, describe: {handout: text(asset.name)} as Json})),
  ]);
  const live = (session.kind === 'combat' || session.kind === 'chase') && session.status === 'active';
  const participants = array(session.participants).map(object);
  const investigators = new Set([...participants.filter(value => value.side === 'investigator').map(value => text(value.name)),
    text(object(object(capsule.known).investigator).name), text(object(object(capsule.known).investigator).id),
    ...array(object(reads.resolveOptions).profiles).map(value => text(object(value).actor))].filter(Boolean));
  const turnOf = text(session.turn_of), ownTurn = live && !!turnOf && participants.some(value => text(value.name) === turnOf && value.side === 'investigator');
  const actions = ownTurn ? array(session.actions).map(object).filter(action => text(action.decision) && text(action.actor || turnOf) === turnOf) : [];
  const act = live ? unique(actions.map(action => ({id: text(action.decision), describe: text(action.decision) as Json})))
    : resolveIntents().map(intent => ({id: intent, describe: intentWords(intent) as Json}));
  const label = (name: string): string => text(participants.find(value => text(value.name) === name)?.label) || name;
  // Outside a session, the first blow (§135.30.2): with the kernel's first-blow row, the target rows are the people present,
  // the addressee rows themselves; without it there is nothing to attack and `target` is not asked.
  const firstBlow = object(resolveContext.first_blow);
  const target = live ? session.kind === 'combat'
    ? unique(actions.filter(action => action.decision === 'combat:attack').flatMap(action => strings(action.targets)).map(name => ({id: name, describe: {fighter: label(name)} as Json})))
    : [] : firstBlow.decision === 'combat:attack' && strings(firstBlow.targets).length ? addressee : [];
  const owner = (value: unknown): boolean => typeof value === 'string' ? investigators.has(value)
    : object(value).kind === 'investigator' || investigators.has(text(object(value).id)) || investigators.has(text(object(value).name));
  const item = unique(array(object(object(capsule.mods).objects).instances).map(object).filter(instance => text(instance.name) && owner(instance.owner))
    .map(instance => ({id: text(instance.id) || text(instance.name), describe: {item: text(instance.name)} as Json})));
  return {destination, addressee, ask, act, target, item};
}
