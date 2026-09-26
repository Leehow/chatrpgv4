/**
 * Host-issued step candidates for one open player turn (single-loop spec, "Candidates are host-issued from real
 * state"; contract §135.2). Moved into the product from `experiments/single-loop-routing/candidates.ts` (SL-02);
 * the prototype re-exports this module.
 *
 * Every candidate comes from an actual kernel read (`table.capsule`, `table.apply.options`,
 * `table.resolve.options`, located entities) or an actual tool definition. Nothing here classifies text and no
 * list below names a meaning: families are the kernel's own closed kinds, and what a candidate still needs is
 * stated as its unbound parameters. Each candidate carries the clerk authority that lets the host run it without
 * the Keeper (`clerk`) and the kernel row it was built from (`basis`); neither is ever shown to Jev or the model,
 * and the kernel's internal tags (`authority: available_route_not_player_choice`) are not in any model-visible
 * field (prototype runs 5-7: with that tag in the detail every move came back "later").
 */
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import type {Candidate, Json, Unbound} from './step-policy.ts';
import {DICE, guardsOf, obligationCandidates, preordainedContacts} from './obligation-candidates.ts';
import {composeSentence} from './composed-arguments.ts';

type Row = Record<string, any>;
export {bindingOf, type Binding, type Candidate, type Json, type Unbound} from './step-policy.ts';

const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => array(value).map(text).filter(Boolean);

/** The canonical resolve intents, read from the Keeper's own resolve tool definition. */
export function resolveIntents(): string[] {
  const tool = COC_TOOLS.find(value => value.name === 'resolve');
  const intent = object(object(object(object(tool?.parameters).properties).action).properties).intent;
  return array(intent?.enum).filter((value): value is string => typeof value === 'string');
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
  /**
   * Pending choices that were already open when this run's player input arrived: the input is their answer, so a
   * closed option of theirs is the clerk's to bind. A choice that opens during the run is the Keeper's to hand back.
   */
  answering?: string[];
  /**
   * `table.look focus=npc` of the NPC whose turn it is, read only when that turn has no standing action (§11.5.3): a
   * card without a combat disposition carries the closed words and the person's own parameters to infer one from.
   */
  fighter?: Row;
}

/** A closed parameter: bound when the kernel issued exactly one value, a closed unbound otherwise. */
function closedParameter(name: string, options: string[]): {bound?: Json; unbound?: Unbound} {
  if (options.length === 1) return {bound: options[0]};
  return {unbound: {name, required: true, vocabulary: 'closed', options}};
}

/**
 * What the combat rules do with each defence (contract §11.5; the kernel's closed `defense` enum). Descriptors of a
 * closed contract enum, shown as the options of a closed bind -- never read from prose.
 */
const DEFENSE_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  dodge: 'Dodge: the defender rolls Dodge against the attack; a better success avoids the blow and harms no one.',
  fight_back: 'Fight back: the defender rolls Fighting against the attack; the better success lands its own blow.',
  none: 'No defence: the attack is rolled unopposed.',
});

/** The standing action words and bases the kernel issues (§11.5.3): closed contract enums, never read from prose. */
const STANDING_ACTIONS: readonly string[] = ['attack', 'hold', 'flee'];
const STANDING_BASES: readonly string[] = ['authored', 'rule-default', 'keeper'];

/**
 * Candidates of the active combat or chase session, from the kernel's own session view (`turn_of`, `actions[]`,
 * `pending_defense`; kernel-ts/read/session-view.ts). The "parameters-only steps never go to the LLM" ruling: a
 * step whose parameters are all issued is direct when it has one value and a Jev bind when it is a closed choice;
 * what the view does not issue stays open for the LLM. Damage and the initiative advance are the kernel's own
 * consequences of the resolve that causes them, so they are never candidates. A sanity bout is a consequence
 * (boss only): it issues nothing here.
 *
 * Three shapes. An NPC's pending defence is forced (the kernel accepts nothing else next) and its option is the
 * standing defence the kernel issues with it (§11.5.2), so it runs directly; only a pending defence without a
 * standing falls back to a Jev bind over the options. An NPC's own turn is forced too -- the initiative order says
 * it acts now -- and which of its issued actions it takes is its standing action when the kernel issues one (§11.5.3:
 * `attack` binds the attack, `hold`/`flee` leave the turn to the Keeper), otherwise a closed Jev bind over those
 * actions (`variants`); a Jev "unknown" hands the choice to the Keeper. The
 * investigator's turn offers each issued action to the route question, keyed without the round, so the action the
 * player declared is carried out once per turn.
 */
function sessionCandidates(session: Row, rawInput: string, answering: readonly string[], pendingChoice: Row, fighter: Row = {}, relationships: Row[] = []): Candidate[] {
  const kind = text(session.kind);
  if ((kind !== 'combat' && kind !== 'chase') || session.status !== 'active') return [];
  const participants = array(session.participants).map(object);
  const label = (id: string): string => text(participants.find(value => text(value.name) === id)?.label) || id;
  const investigator = (id: string): boolean => participants.find(value => text(value.name) === id)?.side === 'investigator';
  // The player's own action carries the player's words (composed, §135.28); an NPC's carries the kernel row it came from.
  const words = (actor: string, decision: string): {goal: string; method: string} =>
    investigator(actor) ? {goal: rawInput, method: rawInput} : {goal: decision, method: decision};
  const composedWords = (actor: string): Partial<Candidate> => investigator(actor) ? {composed: ['goal', 'method']} : {};
  const actorField = (actor: string): Record<string, Json> => investigator(actor) ? {} : {actor};
  const round = Number(session.round ?? 0), out: Candidate[] = [];
  // The kernel's own view of the fight, for Jev to judge a closed choice by (never an internal tag).
  const situation = {kind, round, participants: participants.map(value => ({name: text(value.name), label: text(value.label) || null, side: value.side ?? null,
    ...(value.hp !== undefined ? {hp: value.hp, hp_max: value.hp_max ?? null} : {}), ...(Array.isArray(value.conditions) ? {conditions: value.conditions} : {}),
    ...(value.position !== undefined ? {position: value.position} : {})}))} as Json;
  const pending = session.pending_defense ? object(session.pending_defense) : undefined;
  if (kind === 'combat' && pending) {
    const actor = text(pending.actor), attacker = text(pending.attacker), options = strings(pending.options);
    // The player's defence is a choice handed to the player with `ask`; the clerk binds it only when this input
    // answers a choice that was already open, never one that opened during this run.
    const answered = pending.for === 'player' && answering.length > 0 && answering.includes(text(pendingChoice.name));
    // An NPC's standing defence (contract §11.5.2) is data the kernel issues: it binds the defence, so the step is
    // direct -- no Jev question and no LLM. Without one (a kernel that predates it) the closed choice stays.
    const standing = pending.for === 'npc' ? object(pending.standing) : {};
    const stands = options.includes(text(standing.defense)) && ['authored', 'rule-default', 'keeper'].includes(text(standing.basis));
    if (actor && options.length && (pending.for === 'npc' || answered)) {
      const defense = stands ? {bound: text(standing.defense) as Json} as {bound?: Json; unbound?: Unbound} : closedParameter('defense', options);
      if (defense.unbound) defense.unbound.descriptions = Object.fromEntries(options.map(option => [option, DEFENSE_OPTIONS[option] ?? option]));
      out.push({key: `resolve:combat:defend:${actor}:${attacker}:r${round}`, verb: 'resolve', family: 'combat', source: 'table.resolve.options',
        label: `${label(actor)} defends against ${label(attacker)}'s attack`,
        bound: {intent: 'combat', decision: 'combat:defend', actor, ...words(actor, 'combat:defend'),
          ...(defense.bound !== undefined ? {defense: defense.bound} : {}),
          // The player's answer settles the choice it answers (kernel `bindChoice`: the pending name or its binds).
          ...(answered ? {choice: {pending: text(pendingChoice.name)}} : {})},
        unbound: defense.unbound ? [defense.unbound] : [], detail: situation, ...composedWords(actor),
        clerk: 'session_step', forced: true, basis: {read: 'table.resolve.options', path: 'context.session.pending_defense', row: pending as Json,
          ...(stands ? {standing: {defense: text(standing.defense), basis: text(standing.basis)}} : {})}});
    }
    return out;
  }
  const actor = text(session.turn_of);
  if (!actor) return out;
  const actions = array(session.actions).map(object);
  const own: Candidate[] = [];
  for (const [index, action] of actions.entries()) {
    const decision = text(action.decision);
    if (!decision || text(action.actor || actor) !== actor) continue;
    const basis = {read: 'table.resolve.options', path: `context.session.actions[${index}]`, row: action as Json};
    const base = {verb: 'resolve' as const, family: kind, source: 'table.resolve.options', clerk: 'session_step' as const, basis, detail: situation};
    // The player declared one action this turn: its key carries no round, so it is not offered again after it ran.
    const turnKey = investigator(actor) ? '' : `:r${round}`;
    if (kind === 'combat') {
      const bound: Record<string, Json> = {intent: decision === 'combat:flee' ? 'flee' : 'combat', decision, ...actorField(actor), ...words(actor, decision)};
      const unbound: Unbound[] = [];
      const attackRow = actions.find(value => value.decision === 'combat:attack');
      for (const [name, options] of [['target', strings(action.targets)], ['weapon', decision === 'combat:maneuver' ? strings(attackRow?.weapons) : strings(action.weapons)]] as const) {
        if (!options.length) continue;
        const parameter = closedParameter(name, options);
        if (parameter.bound !== undefined) bound[name] = parameter.bound; else unbound.push(parameter.unbound!);
      }
      if (decision === 'combat:attack' && !strings(action.targets).length) continue;
      // What the session view does not issue is not invented here: a manoeuvre's kind and an ending's outcome. No data
      // source gives them, so the player's manoeuvre or ending is the Keeper's to propose and is not issued to the clerk
      // (§135.28); an NPC's stays one of its issued actions, and choosing it hands the turn to the Keeper.
      if (decision === 'combat:maneuver') { delete bound.goal; unbound.push({name: 'goal', required: true, vocabulary: 'open'}); }
      if (decision === 'combat:end') unbound.push({name: 'outcome', required: true, vocabulary: 'open'});
      if (investigator(actor) && unbound.some(value => value.required && value.vocabulary === 'open')) continue;
      const described = [bound.target ? `at ${label(String(bound.target))}` : '', bound.weapon ? `with ${String(bound.weapon)}` : ''].filter(Boolean).join(' ');
      own.push({...base, key: `resolve:${decision}:${actor}${turnKey}`, label: `${label(actor)}: ${decision}${described ? ` ${described}` : ''}`, bound, unbound,
        ...composedWords(actor)});
    } else {
      const bound: Record<string, Json> = {intent: 'flee', decision, ...actorField(actor), ...words(actor, decision)};
      const unbound: Unbound[] = [];
      const targets = strings(action.targets);
      if (targets.length) {
        const parameter = closedParameter('target', targets);
        if (parameter.bound !== undefined) bound.target = parameter.bound; else unbound.push(parameter.unbound!);
      }
      const suffix = text(action.action) || (text(action.method) ? `${decision}:${text(action.method)}` : '');
      own.push({...base, key: `resolve:${decision}:${actor}:${suffix || index}${turnKey}`, label: `${label(actor)}: ${suffix || decision}`, bound, unbound, ...composedWords(actor)});
    }
  }
  if (investigator(actor) || !own.length) return own;
  // SL-08 (§11.5.3): the NPC's standing action, issued by the kernel on its own turn. `attack` makes the attack the
  // forced step, bound as far as the kernel's lists allow (one target and one weapon: direct; several: a closed Jev
  // bind over the kernel's own `targets` / `weapons`); `hold` and `flee` issue nothing, so the turn is the Keeper's.
  // A standing the builder cannot trust (an unknown word or basis, or an attack the kernel did not issue) keeps the
  // previous route.
  const standing = object(session.standing_action), word = text(standing.action), standingBasis = text(standing.basis);
  if (STANDING_ACTIONS.includes(word) && STANDING_BASES.includes(standingBasis)) {
    const named = {action: word, basis: standingBasis, ...(standing.disposition ? {disposition: standing.disposition as Json} : {})} as Json;
    if (word !== 'attack') return [];
    const attack = own.find(candidate => candidate.bound.decision === 'combat:attack');
    if (attack) return [{...attack, forced: true, basis: {...object(attack.basis), standing: named} as Json}];
  }
  // No standing because the NPC has no combat disposition yet (§11.5.3 source 2): its card, read for this turn, carries
  // the four closed words and its own parameters. Inferring one is a forced closed bind (Jev), written once for the
  // campaign by the clerk; below the gate the Keeper completes the same write. The next read issues the standing.
  const inference = dispositionInference(actor, label(actor), fighter, relationships, situation);
  if (inference) return [inference];
  // An NPC's turn: the initiative order says it acts now, so the step is forced. One issued action is direct; among
  // several, which one it takes is a closed Jev bind whose options are those actions (each variant keeps its own
  // parameters: a closed one is bound next, an open one goes to the LLM). Jev's "unknown" leaves it to the Keeper.
  if (own.length === 1) return [{...own[0], forced: true}];
  return [{key: `resolve:${kind}:turn:${actor}:r${round}`, verb: 'resolve', family: kind, source: 'table.resolve.options',
    label: `${label(actor)} acts on ${label(actor) === actor ? 'its' : 'their'} own initiative (${kind} round ${round})`,
    bound: {intent: kind === 'combat' ? 'combat' : 'flee', actor, goal: `${kind}:turn`, method: `${kind}:turn`},
    unbound: [{name: 'decision', required: true, vocabulary: 'closed', options: own.map(candidate => String(candidate.bound.decision)),
      descriptions: Object.fromEntries(own.map(candidate => [String(candidate.bound.decision), candidate.label]))}],
    variants: Object.fromEntries(own.map(candidate => [String(candidate.bound.decision), {label: candidate.label, bound: candidate.bound, unbound: candidate.unbound, basis: candidate.basis}])),
    detail: situation, clerk: 'session_step', forced: true,
    basis: {read: 'table.resolve.options', path: 'context.session.actions', row: actions as Json}}];
}

/**
 * The forced inference of an NPC's combat disposition (§11.5.3 source 2; the SL-08 extension ruling), or none. Issued
 * only when the NPC's own card says it has no disposition and no action word, and names the closed words: the builder
 * reads the kernel's card, never a list of its own. The material is the person's own text parameters, under the keys
 * the card issued them, plus the first impression an active Mod settled for them (matched by the table's name for
 * them); the parameters read go on the write as its `why` and on the basis.
 */
function dispositionInference(actor: string, name: string, fighter: Row, relationships: Row[], situation: Json): Candidate | undefined {
  const disposition = object(fighter.combat_disposition), action = object(fighter.combat_standing);
  const options = object(disposition.options), words = Object.keys(options);
  if (text(fighter.id) !== actor || disposition.disposition !== null || action.action !== null || !words.length) return undefined;
  const material: Record<string, Json> = {...object(disposition.material)} as Record<string, Json>;
  const impressions = relationships.filter(value => text(value.target) === text(fighter.name) && value.impression != null).map(value => value.impression as Json);
  if (impressions.length) material.first_impression = impressions.length === 1 ? impressions[0] : impressions;
  const read = Object.keys(material);
  if (!read.length) return undefined;
  // The card's own word (§11.5.3 amendment, SL-19): a stated tactic the disposition table maps, issued by the kernel on the
  // card as `default`. It is the bind's rules default when Jev does not settle one; without it the Keeper is asked.
  const fallback = object(disposition.default), word = text(fallback.disposition), tactic = object(object(fallback.from).combat_tactic);
  const ruleDefault = fallback.rule === 'card_disposition' && words.includes(word) ? {rule: 'card_disposition' as const, value: word, read: ['combat_tactic'],
    composed: {why: composeSentence(`${name}'s card states their combat tactic (${text(tactic.defense)}, ${text(tactic.basis)}), which the combat disposition table reads as ${word}; their own parameters did not settle it.`)}} : undefined;
  return {key: `apply:npc-disposition:${actor}`, verb: 'apply', family: 'npc', source: 'table.look',
    label: `How ${name} behaves in this fight, from their own parameters`,
    bound: {kind: 'npc', name: actor, why: composeSentence(`Inferred once for this campaign from ${name}'s own parameters: ${read.join(', ')}.`)},
    composed: ['why'],
    unbound: [{name: 'disposition', required: true, vocabulary: 'closed', options: words, descriptions: Object.fromEntries(words.map(word => [word, text(options[word]) || word])),
      ...(ruleDefault ? {ruleDefault} : {}),
      instruction: `Select how ${name} behaves in a fight, judged only from their own parameters in the chosen operation's detail (person): what they `
        + 'want, fear and hide, their role toward the investigators, their voice, and any first impression. The fight shown there is where it will be '
        + 'used, not evidence of their character. Choose unknown when those parameters do not tell.'}],
    detail: {person: material, fight: situation} as Json, clerk: 'disposition_inference', forced: true,
    basis: {read: 'table.look', path: 'combat_disposition', row: {npc: actor, read} as Json}};
}

/**
 * The first blow (contract §135.30.2): the kernel's `context.first_blow` row -- the people present it can fight and the
 * investigator's weapons -- as one clerk candidate. A parameter the row issues one value for is stated; several are a
 * closed choice (the target from the compile, the weapon from Jev's bind); neither has a rules default (§135.28).
 */
function firstBlowCandidate(row: Row, rawInput: string): Candidate | undefined {
  const targets = strings(row.targets), weapons = strings(row.weapons);
  if (row.decision !== 'combat:attack' || !text(row.intent) || !targets.length || !weapons.length) return undefined;
  const bound: Record<string, Json> = {intent: text(row.intent), decision: 'combat:attack', goal: rawInput, method: rawInput};
  const unbound: Unbound[] = [];
  for (const [name, options] of [['target', targets], ['weapon', weapons]] as const) {
    const parameter = closedParameter(name, options);
    if (parameter.bound !== undefined) bound[name] = parameter.bound; else unbound.push(parameter.unbound!);
  }
  return {key: 'resolve:combat:first-blow', verb: 'resolve', family: 'combat', source: 'table.resolve.options',
    label: `${text(row.actor) || 'The investigator'}: combat:attack${typeof bound.target === 'string' ? ` at ${bound.target}` : ''}, opening a fight`,
    bound, unbound, composed: ['goal', 'method'], clerk: 'first_blow',
    basis: {read: 'table.resolve.options', path: 'context.first_blow', row: row as Json}};
}

/** Scene obligations (SO-04, contract §135.26): their candidates, what they guard, and the Mod checks they preordain. */
export {obligationCandidates} from './obligation-candidates.ts';
/** SL-76 (§135.32, §135.3.1): the three consequence candidate classes, shadow-routed by `consequence-route.ts`. */
export {buildConsequenceCandidates, clueFollowUpCandidates, NPC_REACTION_DECISION, npcReactionCandidates, timeCostCandidates,
  type ConsequenceCandidate, type ConsequenceClass, type ConsequenceNoul, type ConsequenceReads} from './consequence-candidates.ts';

/**
 * candidates(view): apply.options (moves and scene clues the kernel issues), the scene's handout assets, the
 * people present and not yet introduced (under the capsule's own label), the active Mods' pending contact
 * checks, the ordinary check with its closed binder, the active combat/chase session's steps, and located
 * clue/handout entities, and the scene obligations' next steps (§135.26: the stated meeting in place of the roster
 * candidate, the obligation check after the Mod contact checks; what an unsettled obligation guards, and a Mod
 * contact check the book preordains, withheld). Consumed keys are removed. While a combat or chase session runs, leaving is the
 * session's own flee/chase step, so scene moves are not offered then; the ordinary check is not offered either,
 * because the kernel hands a running session to its own resolution owner.
 */
export function buildCandidates(reads: StateReads, rawInput: string, consumed: ReadonlySet<string> = new Set()): Candidate[] {
  const out: Candidate[] = [], seen = new Set<string>();
  // Scene obligations (contract §135.26): an open one's next step, what the unsettled ones guard, and the Mod
  // contact checks a preordained one takes off the clerk's hands.
  const stated = obligationCandidates(reads, rawInput), guards = guardsOf(reads), preordained = preordainedContacts(reads);
  const meetings = new Map(stated.filter(candidate => candidate.family === 'person').map(candidate => [String(candidate.bound.who), candidate]));
  // A meeting a stated check carries is not routed on its own: `now` on the check runs it (§135.26).
  const carried = new Set(stated.flatMap(candidate => candidate.before ? [String(candidate.before.bound.who)] : []));
  const push = (candidate: Candidate) => {
    if (seen.has(candidate.key) || consumed.has(candidate.key)) return;
    seen.add(candidate.key); out.push(candidate);
  };
  const capsule = object(reads.capsule), where = object(capsule.where), resolveContext = object(object(reads.resolveOptions).context);
  const session = object(resolveContext.session ?? where.session);
  const sessionLive = (session.kind === 'combat' || session.kind === 'chase') && session.status === 'active';
  const actors = [...new Set(array(object(reads.resolveOptions).profiles).map(row => text(object(row).actor)).filter(Boolean))];
  const actorBinding = (): {bound: Record<string, Json>; unbound: Unbound[]} => actors.length === 1
    ? {bound: {actor: actors[0]}, unbound: []}
    : {bound: {}, unbound: [{name: 'actor', required: true, vocabulary: 'closed', options: actors}]};
  // A structurally determined step goes first: its candidate is the only thing the kernel accepts next.
  const relationships = array(object(capsule.mods).relationships).map(object);
  for (const candidate of sessionCandidates(session, rawInput, reads.answering ?? [], object(resolveContext.pending_choice), object(reads.fighter), relationships))
    if (candidate.forced) push(candidate);
  // Effects the kernel issues for the current state.
  for (const [index, row] of array(object(reads.applyOptions).candidates).map(object).entries()) {
    const effect = object(row.effect), description = object(row.description), kind = text(effect.kind);
    const basis = {read: 'table.apply.options', path: `candidates[${index}]`, row: row as Json};
    // The kernel's own availability verdict is the only detail shown: `unlock_when.met` false is not a candidate
    // at all, and the internal `authority` tag is not shown.
    const unlock = object(description.unlock_when);
    if (kind === 'move' && (unlock.met === false || sessionLive)) continue;
    // A row an unsettled stated obligation guards is withheld until the kernel stops naming the guard (§135.26).
    if (text(row.guarded_by)) continue;
    if (kind === 'move') push({key: `apply:move:${text(effect.to)}`, verb: 'apply', family: 'move', source: 'table.apply.options',
      label: `Move the party to ${text(description.display_name) || text(effect.to)}`, bound: {kind: 'move', to: text(effect.to)},
      unbound: [{name: 'travel_minutes', required: false, vocabulary: 'open'}, {name: 'label', required: false, vocabulary: 'open'},
        {name: 'via', required: false, vocabulary: 'open'}],
      detail: {available: true, ...(text(description.material) ? {material: text(description.material)} : {})} as Json,
      clerk: 'declared_bookkeeping', basis});
    else if (kind === 'clue') push({key: `apply:clue:${text(effect.clue)}`, verb: 'apply', family: 'clue', source: 'table.apply.options',
      label: `Reveal clue ${text(effect.clue)}: ${text(description.summary)}`, bound: {kind: 'clue', clue: text(effect.clue)},
      unbound: [{name: 'how', required: false, vocabulary: 'open'}, {name: 'label', required: false, vocabulary: 'open'}],
      detail: {...(description.gate !== undefined && description.gate !== null ? {gate: description.gate} : {}), ...(text(description.delivery_kind) ? {delivery_kind: text(description.delivery_kind)} : {})} as Json,
      clerk: 'declared_bookkeeping', basis});
  }
  // Handout assets the current scene carries, less the ones already handed over: consumed by world state (the
  // kernel's `shown`, from `handouts_shown`), never by their words.
  const shown = new Set(strings(object(object(reads.applyOptions).context).handouts_shown));
  for (const [index, asset] of array(where.assets).map(object).entries()) if (asset.kind === 'handout' && text(asset.name) && asset.shown !== true)
    push({key: `apply:handout:${text(asset.name)}`, verb: 'apply', family: 'handout', source: 'capsule.where.assets',
      label: `Show the player handout "${text(asset.name)}"`, bound: {kind: 'handout', name: text(asset.name)},
      unbound: [{name: 'label', required: false, vocabulary: 'open'}], clerk: 'declared_bookkeeping',
      basis: {read: 'table.capsule', path: `where.assets[${index}]`, row: asset as Json}});
  // The people present: a person effect records what this table calls them, in the play language. The capsule
  // already carries the table's own label for a person not yet introduced (`untold.label`); a person already
  // introduced needs no staging; anyone off the roster is never a candidate. Nothing is invented: without a label
  // the name has no data source (an improvised name), so staging that person is the Keeper's to propose and is not
  // issued to the clerk (§135.28). The `why` is composed: the table's label and the player's words, quoted.
  for (const [index, person] of array(capsule.present).map(object).entries()) {
    if (!text(person.name) || text(object(person.called).name) || guards.people.has(text(person.name))) continue;
    // The person the book puts here as an obligation's meeting: the stated candidate replaces this one (§135.26).
    if (carried.has(text(person.name))) continue;
    const meeting = meetings.get(text(person.name));
    if (meeting) { push(meeting); continue; }
    const label = text(object(person.untold).label);
    if (!label) continue;
    push({key: `apply:person:${text(person.name)}`, verb: 'apply', family: 'person', source: 'capsule.present',
      label: `Put ${text(person.name)} (${text(person.role) || 'person present'}) on stage as "${label}"`,
      bound: {kind: 'person', who: text(person.name), name: label,
        why: composeSentence(`The table's own label for ${text(person.name)} in this scene, staged for the player's declared action`, rawInput)},
      unbound: [], composed: ['why'],
      clerk: 'declared_bookkeeping', basis: {read: 'table.capsule', path: `present[${index}]`, row: {name: text(person.name), role: text(person.role) || null, untold: person.untold ?? null} as Json}});
  }
  // Mod checks the active packages declare for the people present and not yet settled. SL-76: the natural-npc
  // first-impression row is also read as a `npc_reaction` candidate (`consequence-candidates.ts`), in the wholly
  // separate shadow list `buildConsequenceCandidates` returns -- never merged here, so this live `mod_contact`
  // candidate (SL-02, already accepted and tested: `single-loop-candidates.test.mjs`) is unchanged.
  for (const [index, contact] of array(object(capsule.mods).pending_contacts).map(object).entries()) {
    const decision = text(contact.decision), target = text(contact.target), actor = text(contact.actor);
    if (!decision || !target) continue;
    // The book preordains this person's reaction (owner ruling Q2), or the person is behind an open guard: not the clerk's.
    if (preordained.get(target)?.has(decision) || guards.people.has(target)) continue;
    push({key: `resolve:${decision}:${actor}:${target}`, verb: 'resolve', family: 'mod_check', source: 'capsule.mods.pending_contacts',
      label: `${decision} for ${actor} meeting ${target} (${text(contact.when)})`,
      bound: {decision, ...(actor ? {actor} : {}), target, goal: rawInput, method: rawInput},
      // The Mod's declaration issues no intent, so the intent is Jev's alone: it has no rules default (§135.28).
      unbound: [{name: 'intent', required: true, vocabulary: 'closed', options: resolveIntents()}], composed: ['goal', 'method'],
      clerk: 'mod_contact', basis: {read: 'table.capsule', path: `mods.pending_contacts[${index}]`, row: contact as Json}});
  }
  // The obligation checks, after the Mod contact checks (precedence person -> mod_check -> obligation_check -> ...).
  for (const candidate of stated) if (candidate.family !== 'person') push(candidate);
  // The ordinary check is always live outside a session and has a closed host binder (route + profile); the
  // specialised families are offered only as the running session's own steps (above and below), never as the
  // compiled decision list (prototype run 1 offered all 52 decisions and Jev's right answer came back at 0.53).
  if (!sessionLive) for (const decision of array(object(reads.resolveOptions).decisions).map(object)) {
    const name = text(decision.name);
    if (name !== 'core-check:ordinary-check') continue;
    const actor = actorBinding();
    push({key: `resolve:${name}`, verb: 'resolve', family: text(decision.family) || 'core-check', source: 'table.resolve.options',
      label: `${name}: ${text(decision.description)}`, bound: {decision: name, ...actor.bound},
      unbound: [...actor.unbound, {name: 'profile, difficulty and modifiers', required: true, vocabulary: 'closed' as const, binder: 'ordinary-resolve' as const}],
      clerk: 'declared_check', basis: {read: 'table.resolve.options', path: 'decisions', row: {name, family: text(decision.family) || null} as Json}});
  }
  // The first blow (§135.30.2, SL-19): outside a fight, the investigator's attack as the kernel's first-blow row issues it.
  // Only the compile selects it (its `first_blow` predicate): the target it reads, the weapon a closed Jev bind.
  if (!sessionLive) { const blow = firstBlowCandidate(object(resolveContext.first_blow), rawInput); if (blow) push(blow); }
  for (const candidate of sessionCandidates(session, rawInput, reads.answering ?? [], object(resolveContext.pending_choice), object(reads.fighter), relationships))
    if (!candidate.forced) push(candidate);
  // Located entities the host can apply directly by handle.
  for (const entity of reads.located ?? []) {
    const basis = {read: 'semantic-locate+workspace.read', row: {handle: entity.handle, kind: entity.kind} as Json};
    if (entity.kind === 'clue' && guards.clues.has(entity.handle)) continue;
    if (entity.kind === 'clue') push({key: `apply:clue:${entity.handle}`, verb: 'apply', family: 'clue', source: 'semantic-locate+workspace.read',
      label: `Reveal clue ${entity.handle}: ${entity.label}`, bound: {kind: 'clue', clue: entity.handle},
      unbound: [{name: 'how', required: false, vocabulary: 'open'}, {name: 'label', required: false, vocabulary: 'open'}], clerk: 'declared_bookkeeping', basis});
    else if (entity.kind === 'handout' && !shown.has(entity.handle)) push({key: `apply:handout:${entity.label}`, verb: 'apply', family: 'handout', source: 'semantic-locate+workspace.read',
      label: `Show the player handout "${entity.label}"`, bound: {kind: 'handout', name: entity.label},
      unbound: [{name: 'label', required: false, vocabulary: 'open'}], clerk: 'declared_bookkeeping', basis});
  }
  return out;
}

/** The kernel call a fully bound candidate becomes. Optional unbound parameters are omitted, never invented. */
export function kernelCall(candidate: Candidate, extra: Record<string, Json> = {}): {method: string; params: Row} {
  const {tool, args} = keeperCall(candidate, extra);
  return {method: tool === 'apply' ? 'table.apply' : 'table.resolve', params: args};
}

/**
 * The Keeper verb a fully bound candidate becomes: the same tool, with the same argument shape, the model would
 * call (one tool catalog for the LLM and Jev, §135.4). Optional unbound parameters are omitted, never invented.
 */
export function keeperCall(candidate: Candidate, extra: Record<string, Json> = {}): {tool: 'apply' | 'resolve'; args: Row} {
  // §135.30.9.3: an accept's candidate carries the kernel's whole settlement, one apply of several effects.
  if (candidate.verb === 'apply' && Array.isArray(candidate.bound.effects)) return {tool: 'apply', args: {effects: candidate.bound.effects as Row[]}};
  if (candidate.verb === 'apply') return {tool: 'apply', args: {effects: [{...candidate.bound, ...extra}]}};
  const {decision, actor, target, goal, method, choice, bonus, penalty, ...rest} = {...candidate.bound, ...extra} as Row;
  // The closed dice words of a bind (the ordinary binder's, §135.26) become the check's modifiers; a die on a social
  // attempt carries its reason, which is the player's declaration, as the ordinary binder's does.
  if (typeof bonus === 'string' || typeof penalty === 'string') {
    const dice = {bonus_dice: DICE[String(bonus)] ?? 0, penalty_dice: DICE[String(penalty)] ?? 0};
    if (dice.bonus_dice || dice.penalty_dice) rest.modifiers = {...object(rest.modifiers), ...dice, reason: typeof goal === 'string' && goal ? goal : 'the player\'s declaration'};
  }
  // A choice answer names the option it settles: the bound closed parameter it answers with (the defence).
  const answered = choice && typeof choice === 'object' ? {choice: {...choice, ...(rest.defense !== undefined && choice.option === undefined ? {option: rest.defense} : {})}} : {};
  return {tool: 'resolve', args: {action: {...rest, decision, ...(actor ? {actor} : {}), ...(target ? {target} : {}), ...answered,
    goal: typeof goal === 'string' ? goal : '', method: typeof method === 'string' ? method : ''}}};
}
