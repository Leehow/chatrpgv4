/**
 * An NPC's standing defence (contract §11.5.2; the spec ruling "An NPC's defence is data"). Three sources, a later
 * one replacing an earlier one: the NPC record's authored tactic (`combat.defense`), the rules default from the
 * numbers the profile builder makes (`defaultDefense`), and the Keeper's override (`apply npc {defense, why}`,
 * `world.npc_defense`). Read, never stored: the session view and the NPC card compute it from state each time.
 *
 * Beside it, the NPC's standing action on its own turn (contract §11.5.3; the rulings "An NPC's action in a fight is
 * data too" and "An NPC's fight behaviour follows the NPC's own parameters"): the Keeper's override
 * (`world.npc_action`), the record's authored `combat.action`, else the ruleset table `npc-combat-disposition.json`
 * over the NPC's combat disposition (`world.npc_disposition` or the record's `combat.disposition`) and the fight's
 * state. Read, never stored, the same way.
 */
import { join } from 'node:path';
import type { ModuleGraph } from '../read/module-graph.js';
import { recordOf } from '../read/module-graph.js';
import { isJsonObject } from '../json.js';
import { RpcError } from '../errors.js';
import type { KernelContext } from '../context.js';
import { array, clone, number, row, string, type Row } from '../read/values.js';
import { emptyLedgerEntry, foldNpcTurn, stanceTable } from '../write/contributions.js';
import { defaultDefense, npcDefenceSkills } from './profiles.js';
import { ACTION_WORDS, AUTHORED_ACTION_WORDS, DISPOSITION_WORDS } from './standing-words.js';
export { ACTION_WORDS, AUTHORED_ACTION_WORDS, DISPOSITION_WORDS, OVERRIDE_ACTION_WORDS } from './standing-words.js';

/** The §11.9 defence words: the closed enum a tactic is written in. */
export const DEFENSE_WORDS: readonly string[] = Object.freeze(['dodge', 'fight_back', 'none']);
export type StandingBasis = 'authored' | 'rule-default' | 'keeper';
export interface Standing { defense: string | null; basis: StandingBasis }

const word = (value: unknown): string | null => typeof value === 'string' && DEFENSE_WORDS.includes(value) ? value : null;

/** The Keeper's override for this person, if one was written (§11.5.2 source 3). */
export function keeperDefense(world: Row, handle: string): string | null {
    return word(row(row(world.npc_defense)[handle]).defense);
}
/** The book's tactic for this person: the record's `combat.defense`, when it is a defence word (source 1). */
export function authoredDefense(graph: ModuleGraph, handle: string): string | null {
    const node = graph.find(handle, ['npc']);
    return node ? word(row(recordOf(node).combat).defense) : null;
}
/**
 * The standing of an NPC defender against one pending attack. `participant` is the combat snapshot's row for the
 * defender (the numbers the defence is rolled with); `options` are the options the kernel issues for this attack.
 * A standing `fight_back` against a firearm reads as `dodge`, as the engine turns every defence but `none` into
 * diving for cover there; the basis is kept.
 */
export function standingDefense(graph: ModuleGraph, world: Row, handle: string, participant: Row, options: readonly string[], firearm: boolean): Standing {
    const keeper = keeperDefense(world, handle), authored = keeper ? null : authoredDefense(graph, handle);
    const basis: StandingBasis = keeper ? 'keeper' : authored ? 'authored' : 'rule-default';
    let defense = keeper ?? authored ?? defaultDefense(number(participant.combat_skill), number(participant.dodge_skill));
    if (firearm && defense === 'fight_back') defense = 'dodge';
    // The standing is always an issued option (the kernel issues `none` against every attack).
    if (!options.includes(defense)) defense = options.includes('dodge') ? 'dodge' : 'none';
    return { defense, basis };
}
/**
 * The NPC card's line (Keeper-only): the override or the authored word, else the rules default from the person's
 * profile (the book's, else a pinned archetype, §34.10), else no word for someone without numbers.
 */
export function cardTactic(graph: ModuleGraph, world: Row, node: Row): Standing {
    const handle = graph.handle(node), keeper = keeperDefense(world, handle);
    if (keeper) return { defense: keeper, basis: 'keeper' };
    const authored = word(row(recordOf(node).combat).defense);
    if (authored) return { defense: authored, basis: 'authored' };
    const book = row(recordOf(node).mechanics).profile, pinned = row(world.npc_profiles)[handle];
    const profile = isJsonObject(book) ? book : isJsonObject(pinned) ? pinned : null;
    if (!profile) return { defense: null, basis: 'rule-default' };
    const skills = npcDefenceSkills(profile);
    return { defense: defaultDefense(skills.combat_skill, skills.dodge_skill), basis: 'rule-default' };
}

// ---- §11.5.3: an NPC's standing action, read from its combat disposition and the ruleset table ----------------

/** The conditions a table row may state: a closed schema, so a row the kernel cannot read is refused at load. */
const CONDITION_KEYS: readonly string[] = Object.freeze(['hp_fraction_at_most', 'outnumbered', 'stance_in']);

export type DispositionBasis = 'authored' | 'inferred' | 'keeper';
export interface Disposition { disposition: string; basis: DispositionBasis }
export type ActionBasis = 'authored' | 'rule-default' | 'keeper';
export interface StandingAction { action: string; basis: ActionBasis; disposition?: Disposition; read?: Row }
/** The fight's state for one NPC, as the table reads it. */
export interface FightState { hp_fraction: number; outnumbered: boolean; stance: string | null }  // stance null: unreadable
/** The two tables a standing action reads: the stance ledger's (§17.3) and the combat disposition table. */
export interface StandingTables { stance: Row; disposition: Row }

const tableError = (message: string, file: string, details: Row = {}) => new RpcError('campaign_not_ready', message,
    { fix: `restore content/rulesets/coc7/rules-json/${file}`, details });
/** The combat disposition table, checked whole: a disposition without a final unconditional row would give no action. */
export async function dispositionTable(context: KernelContext): Promise<Row> {
    const file = 'npc-combat-disposition.json', table = row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'rules-json', file)));
    if (table.contract_id !== 'coc.npc-combat-disposition.v1')
        throw tableError('npc-combat-disposition does not declare coc.npc-combat-disposition.v1', file, { declared: table.contract_id ?? null });
    const dispositions = row(table.dispositions);
    if (Object.keys(dispositions).join('|') !== DISPOSITION_WORDS.join('|'))
        throw tableError('npc-combat-disposition must list exactly the four dispositions, in order', file, { dispositions: Object.keys(dispositions), expected: [...DISPOSITION_WORDS] });
    for (const [name, entry] of Object.entries(dispositions)) {
        const rules = array(row(entry).rules);
        const bad = rules.findIndex(rule => !isJsonObject(rule) || !ACTION_WORDS.includes(string(rule.action))
            || Object.hasOwn(rule, 'when') && (!isJsonObject(rule.when) || Object.keys(rule.when).some(key => !CONDITION_KEYS.includes(key))));
        if (!rules.length || bad >= 0 || Object.hasOwn(row(rules.at(-1)), 'when'))
            throw tableError(`npc-combat-disposition: ${name} needs rules ending in one without a condition`, file, { disposition: name, rule: bad >= 0 ? bad : rules.length - 1 });
    }
    return table;
}
/** Both tables a standing action reads. */
export async function standingTables(context: KernelContext): Promise<StandingTables> {
    return { stance: await stanceTable(context), disposition: await dispositionTable(context) };
}

/**
 * The table's first row for this disposition whose every condition holds (§11.5.3). Every threshold is the
 * table's; the code only knows what each condition compares.
 */
export function tableAction(table: Row, disposition: string, state: FightState): string | null {
    for (const rule of array(row(row(table.dispositions)[disposition]).rules)) {
        const when = row(rule.when);
        if (Object.hasOwn(when, 'hp_fraction_at_most') && !(state.hp_fraction <= number(when.hp_fraction_at_most))) continue;
        if (Object.hasOwn(when, 'outnumbered') && state.outnumbered !== (when.outnumbered === true)) continue;
        if (Object.hasOwn(when, 'stance_in') && !array(when.stance_in).includes(state.stance)) continue;
        return string(rule.action);
    }
    return null;
}

/**
 * The stance word as the ledger folds it now (§17.3, §11.5.3). The committed ledger folds a turn when it closes, and
 * a fight usually starts inside one turn, so the open turn's receipts are folded onto a copy by the same fold and the
 * same table. A turn that has closed (`asked`, `awaiting_player`) is already in the committed ledger. Without an
 * entry the person stands at the table's initial score. Nothing is written.
 */
export function stanceNow(graph: ModuleGraph, ledger: Row, table: Row, turn: Row, handle: string): string | null {
    const node = graph.find(handle, ['npc']);
    if (!node) return null;
    let entry = row(ledger[node.node_id]);
    if (['open', 'acting'].includes(string(turn.state)) && array(turn.receipts).length) {
        const scratch: Row = Object.keys(entry).length ? { [node.node_id]: { ...emptyLedgerEntry(), ...clone(entry) } } : {};
        foldNpcTurn(scratch, graph, { turn: turn.turn, receipts: turn.receipts }, table);
        entry = row(scratch[node.node_id]);
    }
    const stance = row(entry.stance);
    if (typeof stance.value === 'string') return stance.value;
    const initial = number(table.initial_score);
    return string(array(table.levels).find(level => initial <= number(row(level).at_most))?.value ?? null) || null;
}

/** The record's authored combat disposition (`combat.disposition`), when it is one of the four words. */
export function authoredDisposition(graph: ModuleGraph, handle: string): string | null {
    const node = graph.find(handle, ['npc']), word = node ? string(row(recordOf(node).combat).disposition) : '';
    return DISPOSITION_WORDS.includes(word) ? word : null;
}
/**
 * This person's combat disposition (§11.5.3): the Keeper's override, else the record's authored one, else the one Jev
 * inferred for this campaign. A written row without a basis predates the inference and is the Keeper's.
 */
export function dispositionOf(graph: ModuleGraph, world: Row, handle: string): Disposition | null {
    const written = row(row(world.npc_disposition)[handle]), word = string(written.disposition);
    const inferred = written.basis === 'inferred';
    if (DISPOSITION_WORDS.includes(word) && !inferred) return { disposition: word, basis: 'keeper' };
    const authored = authoredDisposition(graph, handle);
    if (authored) return { disposition: authored, basis: 'authored' };
    return DISPOSITION_WORDS.includes(word) ? { disposition: word, basis: 'inferred' } : null;
}
/**
 * The Keeper's standing-action override, if one is live. `attack` stands until rewritten; `hold` holds for the combat
 * round it was written in (§11.5.3), so it is live only while the saved fight is that fight and that round.
 */
export function keeperAction(world: Row, handle: string, combat: Row | null): string | null {
    const written = row(row(world.npc_action)[handle]), action = string(written.action);
    if (action === 'attack') return action;
    if (action === 'hold' && combat?.status === 'active' && string(combat.combat_id) === string(written.combat_id)
        && number(combat.current_round) === number(written.round)) return action;
    return null;
}
/** The record's authored standing action (`combat.action`, enum `{attack}`). */
export function authoredAction(graph: ModuleGraph, handle: string): string | null {
    const node = graph.find(handle, ['npc']), word = node ? string(row(recordOf(node).combat).action) : '';
    return AUTHORED_ACTION_WORDS.includes(word) ? word : null;
}
/**
 * An NPC's standing action on its own turn (§11.5.3), or null when no source gives one (the Keeper decides). An NPC
 * that cannot act has none; an `attack` from any source needs a legal target. Order: the live Keeper override, the
 * record's authored word, the table over the NPC's disposition and the fight's state.
 */
export function standingAction(graph: ModuleGraph, world: Row, handle: string, combat: Row | null, fight: { canAct: boolean; hasTarget: boolean; state: FightState }, table: Row): StandingAction | null {
    if (!fight.canAct) return null;
    const attackable = (action: string | null): boolean => action === 'attack' ? fight.hasTarget : action !== null;
    const disposition = dispositionOf(graph, world, handle);
    const keeper = keeperAction(world, handle, combat);
    if (keeper) return attackable(keeper) ? { action: keeper, basis: 'keeper', ...(disposition ? { disposition } : {}) } : null;
    const authored = authoredAction(graph, handle);
    if (authored) return attackable(authored) ? { action: authored, basis: 'authored', ...(disposition ? { disposition } : {}) } : null;
    // The table reads the stance; without one (an unreadable ledger) its reading is withheld, never guessed.
    if (!disposition || fight.state.stance === null) return null;
    const action = tableAction(table, disposition.disposition, fight.state);
    return attackable(action) ? { action: action!, basis: 'rule-default', disposition, read: { ...fight.state } } : null;
}
/**
 * The NPC card's two lines (Keeper-only, §11.5.3): the disposition with its basis, and the standing action a card can
 * state without a fight -- the live override or the authored word; otherwise the table decides in the fight.
 */
export function cardAction(graph: ModuleGraph, world: Row, node: Row, combat: Row | null, table: Row | null = null): { combat_disposition: Row; combat_standing: Row } {
    const handle = graph.handle(node), disposition = dispositionOf(graph, world, handle);
    const keeper = keeperAction(world, handle, combat), authored = keeper ? null : authoredAction(graph, handle);
    return { combat_disposition: disposition ? { ...disposition } : { disposition: null, basis: null, ...(table ? inferenceInput(graph, node, table) : {}) },
        combat_standing: keeper ? { action: keeper, basis: 'keeper' } : authored ? { action: authored, basis: 'authored' } : { action: null, basis: 'rule-default' } };
}
/**
 * What a disposition is inferred from (§11.5.3 source 2): the closed words with the table's own descriptions, and the
 * person's own text parameters -- the contract's actor-dossier profile keys (`module-graph-contract-v3.json`), never
 * a list of this module's -- under the key each came from. Issued on the card only while the person has none.
 */
export function inferenceInput(graph: ModuleGraph, node: Row, table: Row): { options: Row; material: Row } {
    const profile = graph.npcProfile(node), dispositions = row(table.dispositions);
    const material = Object.fromEntries(array(graph.dossier.profile_keys).map(string).filter(key => key && isJsonObject(profile) && profile[key] != null && profile[key] !== '')
        .map(key => [key, profile[key]]));
    return { options: Object.fromEntries(DISPOSITION_WORDS.map(word => [word, string(row(dispositions[word]).description) || word])), material };
}
