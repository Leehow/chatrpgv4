/**
 * Contract §143.8 (docs/specs/npc-acts-first.md D9, ticket 09): the stakes die. `npc.stakes {campaign, name}` is a
 * host-only write the act step calls once per person per turn, before it generates what that person does (§143.2).
 *
 * The owner's words: where nothing is prepared, the table may roll for how far a person goes; a high roll can make
 * him do something far more dangerous than before. "Nothing prepared" is structural: no stated obligation of his scene
 * preordains his reaction (`preordainedReaction`, from the same rows as the packet's `constraints`, §143.1). Then a
 * rung is read from the ruleset table `npc-stakes.json` (base from his combat disposition, else the archetype the
 * table pinned for him, else the table's default; moved by the table's shifts; clamped to its ends), 1d100 is rolled
 * on the kernel's seeded die, and a keeper-visible `roll` receipt of family `stakes` goes into the open turn. The
 * player is never told the die was rolled (§16.5, `visibility: keeper`); the Keeper sees the receipt; the generation
 * step reads only `{rung, outcome, line, surprise, surprise_line}` through the situation packet, never a threshold.
 *
 * Spec D10 (ticket 20, §143.19): the same roll, at most the rung's `surprise_at_most`, is a surprise -- this person may
 * bring out something no one at the table knew they had. The table gives the permission as a line (`lines.surprise`, or
 * `lines.severe_surprise` on a severe roll): a permission and its degree, never an object.
 *
 * Ticket 27 (§143.26): a person being fought is not calm between blows. Two more structural shifts -- a fight running
 * with them and an investigator among its participants, and last turn's attack or damage against them (the newest
 * committed turn, read by the same predicate as this turn's). With `attacked_this_turn` they are one dimension, violence
 * toward this person: the table groups them (`shift_groups`, a shift's `group`), and a group moves the rung once, by the
 * largest step among its shifts that hold -- the punch that opens a fight is one event, not two.
 *
 * Every number is the table's; this file knows only what each shift compares.
 */
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {archetypeIds} from '../apply/archetype.js';
import {DISPOSITION_WORDS, dispositionOf, stanceNow} from '../combat/standing.js';
import type {CampaignSnapshot} from '../read/campaign.js';
import {actorNode} from '../read/capsule.js';
import {readCampaign} from '../read/handlers.js';
import {recordOf, type ModuleGraph} from '../read/module-graph.js';
import {clockSegment, tableThreats, tableThreatSegment} from '../read/pressures.js';
import {SessionView} from '../read/session-view.js';
import {array, number, numeric, row, string, type Row} from '../read/values.js';
import {npcProfileOf} from '../resolve/context.js';
import {stanceTable} from '../write/contributions.js';
import type {createWriteRuntime} from '../write/index.js';
import {nowIso, turnStateError} from '../write/store.js';
import {committedOnLine, personOf, placedConstraints, stateOf, type Person} from './situation.js';
import {STAKES_FAMILY, isStakesRoll, stakesView} from './stakes-receipt.js';

const FILE = 'npc-stakes.json', CONTRACT = 'coc.npc-stakes.v1';
/** The turn states a receipt may join (the same two `stanceNow` folds). */
const OPEN_STATES = ['open', 'acting'];
/**
 * The lines a rung carries: the degree of the two outcomes that have one (`nothing` has none), and the permission of a
 * surprise (§143.19) -- its own, and the one a severe roll gives.
 */
const LINED = ['severe', 'escalates', 'surprise', 'severe_surprise'] as const;
const RUNG_KEYS = ['name', 'severe_at_most', 'escalates_at_most', 'surprise_at_most', 'lines', 'note'];
/** The three columns of a rung; each one rises (or stays) from a rung to the next (§143.19). */
const COLUMNS = ['severe_at_most', 'escalates_at_most', 'surprise_at_most'] as const;
/**
 * The shifts the kernel can read, each with the one parameter its comparison takes (null: none). Closed, like the
 * disposition table's conditions: a shift the kernel cannot read is refused when the table loads.
 */
const SHIFT_PARAMETERS: Readonly<Record<string, string | null>> = Object.freeze({
    attacked_this_turn: null,
    attacked_last_turn: null,
    in_fight_with_investigators: null,
    hp_at_most_half: 'hp_fraction_at_most',
    table_clock_past_half: 'clock_fraction_above',
    stance_friendly: 'stance_in',
});

const tableError = (message: string, details: Row = {}) => new RpcError('campaign_not_ready', `npc-stakes: ${message}`,
    {fix: `restore content/rulesets/coc7/rules-json/${FILE}`, details});
/** §143.26: a group needs at least two shifts to mean anything; one alone is a malformed group. */
const GROUP_MIN_SHIFTS = 2;
/** A number from 0 to 1 as the table's JSON reads it (a decimal arrives as the kernel's Python float). */
const fraction = (value: unknown): boolean => numeric(value) && Number(value) >= 0 && Number(value) <= 1;

/**
 * The stakes table, checked whole (§143.8): a rung the die cannot read, a base naming no rung, or a shift the kernel
 * cannot compare is refused before anything is rolled.
 */
export async function stakesTable(context: KernelContext): Promise<Row> {
    const table = row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'rules-json', FILE)));
    if (table.contract_id !== CONTRACT)
        throw tableError(`does not declare ${CONTRACT}`, {declared: table.contract_id ?? null});
    const rungs = array(table.rungs), names: string[] = [];
    if (!rungs.length)
        throw tableError('needs at least one rung');
    let previous: Row | null = null;
    for (const [index, value] of rungs.entries()) {
        const rung = row(value), name = typeof rung.name === 'string' ? rung.name.trim() : '';
        if (!isJsonObject(value) || !name || names.includes(name) || Object.keys(rung).some(key => !RUNG_KEYS.includes(key)))
            throw tableError('every rung is {name, severe_at_most, escalates_at_most, surprise_at_most, lines} with a name of its own', {rung: index});
        const severe = rung.severe_at_most, escalates = rung.escalates_at_most, surprise = rung.surprise_at_most;
        // 1d100: `severe` at most `escalates`, both on the die's faces, and `severe` never certain (spec D9: no rung is sure death).
        if (!Number.isInteger(severe) || !Number.isInteger(escalates) || severe < 0 || severe > escalates || escalates > 100 || severe >= 100)
            throw tableError('a rung reads 1d100: 0 <= severe_at_most <= escalates_at_most <= 100, and severe_at_most below 100', {rung: name});
        // §143.19: the surprise column reads the same die on its own; it need not sit between the other two.
        if (!Number.isInteger(surprise) || surprise < 0 || surprise > 100)
            throw tableError('a rung reads 1d100 for a surprise too: surprise_at_most is an integer from 0 to 100', {rung: name});
        // Every column rises with the rung (§143.19): a higher rung is never less likely to go further, or to surprise.
        const fallen = previous ? COLUMNS.filter(column => rung[column] < previous![column]) : [];
        if (fallen.length)
            throw tableError('rungs run from the least dangerous to the most: no column falls from one rung to the next', {rung: name, after: previous!.name, columns: fallen});
        const lines = row(rung.lines);
        if (!isJsonObject(rung.lines) || Object.keys(lines).some(key => !(LINED as readonly string[]).includes(key))
            || LINED.some(key => typeof lines[key] !== 'string' || !lines[key].trim()))
            throw tableError('a rung has exactly one line each for severe, escalates, surprise and severe_surprise', {rung: name, lines: [...LINED]});
        names.push(name);
        previous = rung;
    }
    const rungNamed = (value: unknown): boolean => typeof value === 'string' && names.includes(value);
    const archetypes = await archetypeIds(context);
    for (const [field, words] of [['base_by_disposition', DISPOSITION_WORDS], ['base_by_archetype', archetypes]] as const) {
        const map = table[field];
        const bad = isJsonObject(map) ? Object.entries(map).filter(([word, rung]) => !words.includes(word) || !rungNamed(rung)).map(([word]) => word) : null;
        if (bad === null || bad.length)
            throw tableError(`${field} maps a closed word to a rung`, {field, words: bad, options: [...words], rungs: names});
    }
    if (!rungNamed(table.default_rung))
        throw tableError('default_rung names a rung', {default_rung: table.default_rung ?? null, rungs: names});
    const shifts = table.shifts;
    if (!isJsonObject(shifts))
        throw tableError('shifts is an object of the shifts the kernel reads', {options: Object.keys(SHIFT_PARAMETERS)});
    // §143.26: the groups a shift may name, each with its English note; a group is declared before it is named.
    const groups = table.shift_groups ?? {};
    if (!isJsonObject(groups) || Object.entries(groups).some(([name, note]) => !name.trim() || typeof note !== 'string' || !note.trim()))
        throw tableError('shift_groups maps a group name to its note', {shift_groups: table.shift_groups ?? null});
    const stances = array((await stanceTable(context)).levels).map(level => string(row(level).value));
    for (const [name, value] of Object.entries(shifts)) {
        const shift = row(value), parameter = Object.hasOwn(SHIFT_PARAMETERS, name) ? SHIFT_PARAMETERS[name] : undefined;
        const allowed = ['step', 'note', 'group', ...(parameter ? [parameter] : [])];
        const bad = parameter === undefined || !isJsonObject(value) || !Number.isInteger(shift.step)
            || Object.keys(shift).some(key => !allowed.includes(key))
            || Object.hasOwn(shift, 'group') && (typeof shift.group !== 'string' || !Object.hasOwn(groups, shift.group))
            || parameter === 'hp_fraction_at_most' && !fraction(shift[parameter])
            || parameter === 'clock_fraction_above' && !fraction(shift[parameter])
            || parameter === 'stance_in' && (!array(shift[parameter]).length || !array(shift[parameter]).every(word => stances.includes(word)));
        if (bad)
            throw tableError(`shift ${name} is {step: <integer>${parameter ? `, ${parameter}` : ''}, group?: <a declared group>} and a shift the kernel reads`,
                {shift: name, options: Object.keys(SHIFT_PARAMETERS), groups: Object.keys(groups), ...(parameter === 'stance_in' ? {stances} : {})});
    }
    // A group moves the rung once, by its largest step: its shifts all move the same way, and there are at least two.
    for (const group of Object.keys(groups)) {
        const steps = Object.values(shifts).map(row).filter(shift => shift.group === group).map(shift => number(shift.step));
        if (steps.length < GROUP_MIN_SHIFTS || steps.some(step => step > 0) && steps.some(step => step < 0))
            throw tableError('a shift group has at least two shifts, all of whose steps move the same way', {group, steps});
    }
    return table;
}

/** The base rung: the combat disposition's (§11.5.3), else the pinned archetype's (§34.10), else the table's default. */
function baseRung(graph: ModuleGraph, world: Row, handle: string, table: Row): Row {
    const disposition = dispositionOf(graph, world, handle)?.disposition;
    const byDisposition = disposition ? row(table.base_by_disposition)[disposition] : undefined;
    if (typeof byDisposition === 'string')
        return {rung: byDisposition, from: 'disposition', word: disposition};
    const archetype = npcProfileOf(graph, world, handle)?.archetype;
    const byArchetype = typeof archetype === 'string' ? row(table.base_by_archetype)[archetype] : undefined;
    if (typeof byArchetype === 'string')
        return {rung: byArchetype, from: 'archetype', word: archetype};
    return {rung: string(table.default_rung), from: 'default'};
}

/**
 * Whether among these receipts (this turn's; §143.26 also last turn's) an attack roll was made against this person (a
 * combat roll whose `combat_action` is `attack` and whose `npc`, the person it was made against, is them) or they lost
 * hit points (an `hp` delta whose `after` is below its `before`). Structure only.
 */
export function attackedThisTurn(receipts: Row[], me: Person): boolean {
    return receipts.some(value => {
        const receipt = row(value);
        if (receipt.kind === 'roll')
            return !isStakesRoll(receipt) && receipt.combat_action === 'attack' && me.is(receipt.npc) && !me.is(receipt.actor);
        if (receipt.kind === 'delta')
            return receipt.resource === 'hp' && me.is(receipt.subject) && typeof receipt.before === 'number'
                && typeof receipt.after === 'number' && receipt.after < receipt.before;
        return false;
    });
}

/** Every threat clock of this table as [where it stands, its segments]: the book's (§136.18) and the table's own (§142.9). */
function tableClocks(graph: ModuleGraph, world: Row): Array<[number, number]> {
    const book = graph.kind('threat').flatMap(threat => array(recordOf(threat).clocks).filter(isJsonObject)
        .map(clock => [clockSegment(world, graph.handle(threat), clock), Math.trunc(number(clock.segments ?? 0))] as [number, number]));
    const minted = tableThreats(world).map(value => [tableThreatSegment(world, string(value.handle)), Math.trunc(number(value.length))] as [number, number]);
    return [...book, ...minted];
}

/**
 * §143.26: whether a fight is running with this person and an investigator among its participants -- the active session
 * is a combat, they are a participant (by handle, as the packet's `state.in_session` reads it) and so is someone of the
 * party. Their side, their turn and whether anyone struck them do not matter: being in the fight is the fact.
 */
export function inFightWithInvestigators(view: SessionView, session: Row | null, me: Person): boolean {
    if (session?.kind !== 'combat' || session.status !== 'active') return false;
    const names = array(session.participants).map(value => string(row(value).name));
    return names.includes(me.handle) && names.some(name => view.isInvestigator(name));
}

/** The facts the shifts compare, as the situation packet reads them. */
interface StakesFacts {
    attacked: boolean; attackedLast: boolean; inFight: boolean;
    hp: number | null; hpMax: number | null; stance: string | null; clocks: Array<[number, number]>;
}
function shiftHolds(name: string, shift: Row, facts: StakesFacts): boolean {
    if (name === 'attacked_this_turn')
        return facts.attacked;
    if (name === 'attacked_last_turn')
        return facts.attackedLast;
    if (name === 'in_fight_with_investigators')
        return facts.inFight;
    if (name === 'hp_at_most_half')
        return facts.hp !== null && facts.hpMax !== null && facts.hpMax > 0 && facts.hp / facts.hpMax <= number(shift.hp_fraction_at_most);
    if (name === 'table_clock_past_half')
        return facts.clocks.some(([at, of]) => of > 0 && at / of > number(shift.clock_fraction_above));
    if (name === 'stance_friendly')
        return facts.stance !== null && array(shift.stance_in).includes(facts.stance);
    return false;
}

/**
 * The move of the shifts that hold (§143.26): a shift of no group adds its step; the shifts of one group add once, the
 * largest step among those that hold (the table's check keeps a group's steps all one way, so it is the largest in size).
 */
export function shiftMove(table: Row, holding: string[]): number {
    const byGroup = new Map<string, number>();
    let move = 0;
    for (const name of holding) {
        const shift = row(row(table.shifts)[name]), step = number(shift.step);
        if (typeof shift.group !== 'string') { move += step; continue; }
        const kept = byGroup.get(shift.group);
        if (kept === undefined || Math.abs(step) > Math.abs(kept)) byGroup.set(shift.group, step);
    }
    return move + [...byGroup.values()].reduce((sum, step) => sum + step, 0);
}

/**
 * The rung this person stands on now: base plus the move of every shift that holds (a group once), clamped to the
 * table's first and last rung. `shifts` names every shift that held, in the table's order.
 */
export function stakesRung(table: Row, base: Row, facts: StakesFacts): {rung: Row; shifts: string[]} {
    const rungs = array(table.rungs).map(row), names = rungs.map(rung => string(rung.name));
    const shifts = Object.entries(row(table.shifts)).filter(([name, shift]) => shiftHolds(name, row(shift), facts)).map(([name]) => name);
    const moved = names.indexOf(string(base.rung)) + shiftMove(table, shifts);
    return {rung: rungs[Math.max(0, Math.min(rungs.length - 1, moved))], shifts};
}

/** What the die says on this rung: at most `severe_at_most` is severe, else at most `escalates_at_most` escalates. */
export function stakesOutcome(rung: Row, roll: number): string {
    return roll <= number(rung.severe_at_most) ? 'severe' : roll <= number(rung.escalates_at_most) ? 'escalates' : 'nothing';
}

/** §143.19: the same roll at most `surprise_at_most` lets this person bring out something no one knew they had. */
export function stakesSurprise(rung: Row, roll: number): boolean {
    return roll <= number(rung.surprise_at_most);
}

/** The permission line of a surprise: the severe one on a severe roll (the thing may be dangerous), else the plain one. */
export function surpriseLine(rung: Row, outcome: string): string {
    return string(row(rung.lines)[outcome === 'severe' ? 'severe_surprise' : 'surprise']);
}

async function factsOf(context: KernelContext, campaign: CampaignSnapshot, graph: ModuleGraph, me: Person): Promise<StakesFacts> {
    const {world, turn, party} = campaign;
    let ledger: Row = {};
    try { ledger = row(await campaign.optional('npc-ledger.json')); } catch { /* An unreadable ledger is an empty one, as for the situation read. */ }
    const stance = stanceNow(graph, ledger, await stanceTable(context), turn, me.handle);
    const view = new SessionView(campaign, graph, party, world), session = view.activeSession();
    const state = stateOf(graph, world, me, session, stance);
    const hp = typeof state.hp === 'number' ? state.hp : null, hpMax = typeof state.hp_max === 'number' ? state.hp_max : null;
    // §143.26: last turn is the newest committed turn before this one on the campaign's line, the record the situation's
    // `happened` reads its earlier sentences from.
    const {previous} = committedOnLine(campaign);
    return {attacked: attackedThisTurn(array(turn.receipts), me), attackedLast: previous !== null && attackedThisTurn(array(previous.receipts), me),
        inFight: inFightWithInvestigators(view, session, me), hp, hpMax, stance, clocks: tableClocks(graph, world)};
}

export function createStakesHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    return {
        'npc.stakes': async (params): Promise<Row> => {
            if (typeof params.name !== 'string' || !params.name.trim())
                throw new RpcError('invalid_params', 'params.name must be a non-empty string', {details: {field: 'name'}});
            const {campaign, module} = await readCampaign(context, params, false, false, {}, true);
            // §87.8: the person's name through the junction, as `npc.situation` reads it (§180.5: a creature actor too).
            const {graph} = module, {world, turn} = campaign, node = actorNode(graph, world, params.name);
            if (!OPEN_STATES.includes(string(turn.state)))
                throw turnStateError(turn, 'npc.stakes', 'roll the stakes during an open turn: after player_input, before the Keeper delivers');
            const me = personOf(graph, world, node);
            // Once per person per turn: a second call answers the receipt already written, and writes nothing.
            const existing = array(turn.receipts).map(row).find(receipt => isStakesRoll(receipt) && me.is(receipt.actor));
            if (existing)
                return {stakes: stakesView(existing)};
            // Prepared means the book preordains this person's reaction (§143.8), not any row of `constraints`.
            if ((await placedConstraints(context, campaign, graph, me)).prepared)
                return {stakes: null, reason: 'prepared'};
            const table = await stakesTable(context), base = baseRung(graph, world, me.handle, table);
            const {rung, shifts} = stakesRung(table, base, await factsOf(context, campaign, graph, me));
            const roll = context.rng.randint(1, 100), outcome = stakesOutcome(rung, roll), surprise = stakesSurprise(rung, roll);
            const line = outcome === 'nothing' ? null : string(row(rung.lines)[outcome]);
            const n = number(turn.turn);
            const receipt: Row = {
                id: `roll:stakes-${me.handle}-t${n}`, kind: 'roll', family: STAKES_FAMILY, call_id: `t${n}-stakes-${me.handle}`,
                actor: me.handle, actor_label: me.label, actor_is_investigator: false,
                rung: string(rung.name), base, shifts, roll, severe_at_most: rung.severe_at_most, escalates_at_most: rung.escalates_at_most,
                surprise_at_most: rung.surprise_at_most, outcome, line, surprise, surprise_line: surprise ? surpriseLine(rung, outcome) : null,
                visibility: 'keeper', at: nowIso(),
            };
            // The campaign lock is held for the whole call, so the turn read here is the one the snapshot read.
            const store = await writer.campaign(params), current = await store.readTurn();
            if (number(current.turn) !== n || !OPEN_STATES.includes(string(current.state)))
                throw turnStateError(current, 'npc.stakes', 'roll the stakes during an open turn: after player_input, before the Keeper delivers');
            await store.writeTurn({...current, receipts: [...array(current.receipts), receipt]});
            return {stakes: stakesView(receipt)};
        },
    };
}
