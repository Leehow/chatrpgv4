/**
 * Host-issued step candidates for one open player turn (design §5.1). Every candidate comes from an
 * actual kernel read or an actual tool definition; nothing here classifies text, and no list below names
 * a meaning. What a candidate still needs is stated as its unbound parameters.
 */
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';

type Row = Record<string, any>;
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};

/** closed: the host can issue the complete vocabulary; open: only a language model can produce the value. */
export interface Unbound {name: string; required: boolean; vocabulary: 'closed' | 'open'; options?: string[]; binder?: 'ordinary-resolve'}
export interface Candidate {
  /** Host identity, stable while the state it came from is unchanged. Never sent to the model. */
  key: string;
  verb: 'apply' | 'resolve';
  family: string;
  /** Model-visible semantic description. */
  label: string;
  /** The kernel read that issued this candidate. */
  source: string;
  bound: Record<string, Json>;
  unbound: Unbound[];
  detail?: Json;
}
export type Binding = 'none' | 'closed' | 'open';

const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** The canonical resolve intents, read from the Keeper's own resolve tool definition. */
export function resolveIntents(): string[] {
  const tool = COC_TOOLS.find(value => value.name === 'resolve');
  const intent = object(object(object(object(tool?.parameters).properties).action).properties).intent;
  return array(intent?.enum).filter((value): value is string => typeof value === 'string');
}

export function bindingOf(candidate: Candidate): Binding {
  const required = candidate.unbound.filter(value => value.required);
  if (!required.length) return 'none';
  return required.every(value => value.vocabulary === 'closed') ? 'closed' : 'open';
}

export interface StateReads {
  /** table.capsule */
  capsule: Row;
  /** table.apply.options */
  applyOptions: Row;
  /** table.resolve.options */
  resolveOptions: Row;
  /** Handles located by semantic locate and materialized by a read, with their index kind. */
  located?: Array<{handle: string; label: string; kind: string}>;
}

/**
 * candidates(view): apply.options (moves and scene clues the kernel issues), the scene's handout assets,
 * the people present (the roster a `person` effect names), the active Mods' pending contact checks, every
 * compiled resolve decision the kernel lists, and located clue/handout entities. Consumed keys are removed.
 */
export function buildCandidates(reads: StateReads, rawInput: string, consumed: ReadonlySet<string> = new Set()): Candidate[] {
  const out: Candidate[] = [], seen = new Set<string>();
  const push = (candidate: Candidate) => {
    if (seen.has(candidate.key) || consumed.has(candidate.key)) return;
    seen.add(candidate.key); out.push(candidate);
  };
  const capsule = object(reads.capsule), where = object(capsule.where);
  const actors = [...new Set(array(object(reads.resolveOptions).profiles).map(row => text(object(row).actor)).filter(Boolean))];
  const actorBinding = (): {bound: Record<string, Json>; unbound: Unbound[]} => actors.length === 1
    ? {bound: {actor: actors[0]}, unbound: []}
    : {bound: {}, unbound: [{name: 'actor', required: true, vocabulary: 'closed', options: actors}]};
  // Effects the kernel issues for the current state.
  for (const row of array(object(reads.applyOptions).candidates).map(object)) {
    const effect = object(row.effect), description = object(row.description), kind = text(effect.kind);
    // The kernel's own availability verdict is the only detail shown: `unlock_when.met` false is not a candidate
    // at all, and the internal `authority` tag (`available_route_not_player_choice`) is not shown, because in
    // runs 5-7 every move came back "later" at 0.62-0.65 while that tag was in the candidate's detail.
    const unlock = object(description.unlock_when);
    if (kind === 'move' && unlock.met === false) continue;
    if (kind === 'move') push({key: `apply:move:${text(effect.to)}`, verb: 'apply', family: 'move', source: 'table.apply.options',
      label: `Move the party to ${text(description.display_name) || text(effect.to)}`, bound: {kind: 'move', to: text(effect.to)},
      unbound: [{name: 'travel_minutes', required: false, vocabulary: 'open'}, {name: 'label', required: false, vocabulary: 'open'},
        {name: 'via', required: false, vocabulary: 'open'}],
      detail: {available: true, ...(text(description.material) ? {material: text(description.material)} : {})} as Json});
    else if (kind === 'clue') push({key: `apply:clue:${text(effect.clue)}`, verb: 'apply', family: 'clue', source: 'table.apply.options',
      label: `Reveal clue ${text(effect.clue)}: ${text(description.summary)}`, bound: {kind: 'clue', clue: text(effect.clue)},
      unbound: [{name: 'how', required: false, vocabulary: 'open'}, {name: 'label', required: false, vocabulary: 'open'}],
      detail: {...(description.gate !== undefined && description.gate !== null ? {gate: description.gate} : {}), ...(text(description.delivery_kind) ? {delivery_kind: text(description.delivery_kind)} : {})} as Json});
  }
  // Handout assets the current scene carries.
  for (const asset of array(where.assets).map(object)) if (asset.kind === 'handout' && text(asset.name))
    push({key: `apply:handout:${text(asset.name)}`, verb: 'apply', family: 'handout', source: 'capsule.where.assets',
      label: `Show the player handout "${text(asset.name)}"`, bound: {kind: 'handout', name: text(asset.name)},
      unbound: [{name: 'label', required: false, vocabulary: 'open'}]});
  // The people present: a person effect records what this table calls them, in the play language.
  // The capsule already carries the table's own label for a person not yet introduced (`untold.label`, the
  // name a `person` effect records); a person already introduced needs no staging. Nothing is invented.
  for (const person of array(capsule.present).map(object)) {
    if (!text(person.name) || text(object(person.called).name)) continue;
    const label = text(object(person.untold).label);
    push({key: `apply:person:${text(person.name)}`, verb: 'apply', family: 'person', source: 'capsule.present',
      label: `Put ${text(person.name)} (${text(person.role) || 'person present'}) on stage${label ? ` as "${label}"` : ' under what this table calls them'}`,
      bound: {kind: 'person', who: text(person.name), ...(label ? {name: label} : {})},
      unbound: [...(label ? [] : [{name: 'name', required: true, vocabulary: 'open' as const}]), {name: 'why', required: false, vocabulary: 'open' as const}]});
  }
  // Mod checks the active packages declare for the people present and not yet settled.
  for (const contact of array(object(capsule.mods).pending_contacts).map(object)) {
    const decision = text(contact.decision), target = text(contact.target), actor = text(contact.actor);
    if (!decision || !target) continue;
    push({key: `resolve:${decision}:${actor}:${target}`, verb: 'resolve', family: 'mod_check', source: 'capsule.mods.pending_contacts',
      label: `${decision} for ${actor} meeting ${target} (${text(contact.when)})`,
      bound: {decision, actor, target, goal: rawInput, method: rawInput},
      unbound: [{name: 'intent', required: true, vocabulary: 'closed', options: resolveIntents()}]});
  }
  // The rule decisions the kernel lists, narrowed to what the state can use now (design §5.1: candidates come
  // from actual state). The ordinary check is always live and has a closed host binder. A specialised family
  // (combat, chase, sanity bout) is offered only while the kernel reports that subsystem's session active;
  // otherwise those families are reached through the `ask_llm` exit, which is where the design routes them.
  // Run 1 of the prototype offered all 52 decisions and Jev's right answer came back at 0.53 confidence.
  const session = object(object(object(reads.resolveOptions).context).session);
  const sessionText = JSON.stringify(session).toLowerCase();
  const familyLive = (family: string): boolean => family === 'core-check' ? true
    : Object.keys(session).length > 0 && sessionText.includes(family.toLowerCase());
  for (const decision of array(object(reads.resolveOptions).decisions).map(object)) {
    const name = text(decision.name);
    if (!name) continue;
    if (text(decision.family) === 'core-check' ? name !== 'core-check:ordinary-check' : !familyLive(text(decision.family))) continue;
    const actor = actorBinding();
    push({key: `resolve:${name}`, verb: 'resolve', family: text(decision.family), source: 'table.resolve.options',
      label: `${name}: ${text(decision.description)}`, bound: {decision: name, ...actor.bound},
      unbound: [...actor.unbound, ...(name === 'core-check:ordinary-check'
        ? [{name: 'profile, difficulty and modifiers', required: true, vocabulary: 'closed' as const, binder: 'ordinary-resolve' as const}]
        : [{name: 'family action parameters', required: true, vocabulary: 'open' as const}])]});
  }
  // Located entities the host can apply directly by handle.
  for (const entity of reads.located ?? []) {
    if (entity.kind === 'clue') push({key: `apply:clue:${entity.handle}`, verb: 'apply', family: 'clue', source: 'semantic-locate+workspace.read',
      label: `Reveal clue ${entity.handle}: ${entity.label}`, bound: {kind: 'clue', clue: entity.handle},
      unbound: [{name: 'how', required: false, vocabulary: 'open'}, {name: 'label', required: false, vocabulary: 'open'}]});
    else if (entity.kind === 'handout') push({key: `apply:handout:${entity.label}`, verb: 'apply', family: 'handout', source: 'semantic-locate+workspace.read',
      label: `Show the player handout "${entity.label}"`, bound: {kind: 'handout', name: entity.label},
      unbound: [{name: 'label', required: false, vocabulary: 'open'}]});
  }
  return out;
}

/** The kernel call a fully bound candidate becomes. Optional unbound parameters are omitted, never invented. */
export function kernelCall(candidate: Candidate, extra: Record<string, Json> = {}): {method: string; params: Row} {
  if (candidate.verb === 'apply') return {method: 'table.apply', params: {effects: [{...candidate.bound, ...extra}]}};
  const {decision, actor, target, goal, method, ...rest} = {...candidate.bound, ...extra} as Row;
  return {method: 'table.resolve', params: {action: {...rest, decision, ...(actor ? {actor} : {}), ...(target ? {target} : {}),
    ...(goal ? {goal} : {}), ...(method ? {method} : {})}}};
}
