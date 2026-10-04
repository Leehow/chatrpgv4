/**
 * Contract §143.1 (docs/specs/npc-acts-first.md D1, ticket 01): `npc.situation {campaign, name}` -- what one person
 * faces right now, for the step that generates what they do next (§143.2).
 *
 * Facts only. Who they are is `npcPerspective`'s rows; what just happened to them is composed by code from the receipts
 * of this turn and the last; their body, their stance, what is at hand, what they already set out to do and how it went,
 * and what the book and the active Mods require of them; and, when `npc.stakes` rolled for them this turn, that die's
 * rung, outcome and degree line, and whether it allows a surprise with its permission line (§143.8, §143.19: read from
 * its receipt, never rolled here). Nothing here reads what a line
 * means, chooses a verb from content or advises: each clause is worded by its receipt's kind and fields, and the
 * engine's closed words (a level, a combat action, a resource, a condition, a stance) are quoted as they are. Nothing is
 * written.
 */
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import type {CampaignSnapshot} from '../read/campaign.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {actorNode, creatureWhat, creatureWords, jsonSize, npcsPresent, personLabel, sceneLabel} from '../read/capsule.js';
import {readCampaign} from '../read/handlers.js';
import {canonicalMemoryReceipts, withPromiseFulfillment} from '../read/memory.js';
import {committedOnLine, stillWhereItClosed} from '../read/exchange.js';
import {recordOf, type ModuleGraph} from '../read/module-graph.js';
import {activeMods, contactRows} from '../read/mods.js';
import {capsuleRow, obligationNodes, sceneObligations} from '../read/obligations.js';
import {SessionView} from '../read/session-view.js';
import {array, chars, clone, normalize, number, row, string, values, type Row} from '../read/values.js';
import {stanceNow} from '../combat/standing.js';
import {npcProfileOf} from '../resolve/context.js';
import {emptyLedgerEntry, foldNpcTurn, stanceTable} from '../write/contributions.js';
import {intentsOf, isSettled, receiptGenerated} from './intents.js';
import {npcPerspective} from './perspective.js';
import {isStakesRoll, stakesView} from './stakes-receipt.js';

/** The packet's size bound when `host-budgets.json` names none (`npc_situation.max_bytes`). */
export const SITUATION_MAX_BYTES = 6144;
/** One composed sentence, and a Keeper's `why` inside one, in code points. */
const SENTENCE_MAX = 400, WHY_MAX = 160, ELLIPSIS = '...';
/** The turn states whose receipts the committed ledger has not folded yet (as `stanceNow` reads them). */
const OPEN_STATES = ['open', 'acting'];

// Absent is empty: `string()` renders null as Python's "None", which an opening turn with no player words once put in the
// packet as the investigator's declaration (`declared: "None"`, found 2026-09-26 when §143.21's reading widened).
const flat = (value: unknown): string => (value == null ? '' : string(value)).replace(/\s+/g, ' ').trim();
function clip(value: unknown, max: number): string {
    const text = flat(value), points = Array.from(text);
    return points.length <= max ? text : `${points.slice(0, Math.max(0, max - ELLIPSIS.length)).join('')}${ELLIPSIS}`;
}
const because = (receipt: Row): string => typeof receipt.why === 'string' && receipt.why.trim() ? ` (why: ${clip(receipt.why, WHY_MAX)})` : '';
const once = (names: string[]): string[] => {
    const seen = new Set<string>();
    return names.filter(name => {
        const key = normalize(name);
        if (!name || !key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

/** Who a receipt field may name this person by: handle, node id, the book's names, the table's label (§79). */
export interface Person { node: Row; handle: string; label: string; is(value: unknown): boolean }
export function personOf(graph: ModuleGraph, world: Row, node: Row): Person {
    const handle = graph.handle(node), label = personLabel(world, handle, graph.displayName(node));
    const keys = new Set([handle, string(node.node_id), graph.displayName(node), label, ...graph.nameKeys(node)].filter(Boolean).map(normalize));
    return {node, handle, label, is: value => typeof value === 'string' && keys.has(normalize(value))};
}

/**
 * §143.14: a receipt that settles one of this person's intentions `abandoned` says they gave it up -- the table's own
 * act repeated with no result (`why: repeated`, §143.5), or the Keeper's overrule (D7) -- so the next act is generated
 * knowing that thread was put down, not only that a row's status changed. Worded by the stamp's outcome, never by the
 * line's words; the line is quoted as it is.
 */
const LINE_MAX = 200;
function gaveUp(receipt: Row, me: Person): string | null {
    const intent = row(receipt.intent);
    return intent.outcome === 'abandoned' && me.is(intent.npc) && typeof intent.text === 'string' && intent.text.trim()
        ? `${me.label} gave up "${clip(intent.text, LINE_MAX)}" without doing it` : null;
}

/** The one clause a receipt of this person's contributes, or null when the receipt is not about them. */
function clause(receipt: Row, me: Person, world: Row): string | null {
    // The stakes die (§143.8) is not something done to or by this person; the packet carries it as `stakes`.
    if (isStakesRoll(receipt)) return null;
    const done = kindClause(receipt, me, world), gave = gaveUp(receipt, me);
    if (!gave) return done;
    // The intention variant has no clause of its own, so the writer's why rides on the giving up.
    return done ? `${done}; ${gave}` : `${gave}${because(receipt)}`;
}

/** The clause a receipt's own kind and fields make, or null when the receipt is not about them. */
function kindClause(receipt: Row, me: Person, world: Row): string | null {
    const kind = receipt.kind;
    if (kind === 'roll') {
        const own = me.is(receipt.actor);
        if (!own && !me.is(receipt.npc)) return null;
        const skill = string(receipt.skill_label || receipt.skill || 'a roll');
        const action = typeof receipt.combat_action === 'string' && receipt.combat_action ? ` (${receipt.combat_action})` : '';
        const result = typeof receipt.level === 'string' && receipt.level ? receipt.level
            : receipt.total != null ? string(receipt.total) : receipt.passed === true ? 'passed' : receipt.passed === false ? 'failed' : 'rolled';
        if (own) {
            const coercion = row(receipt.coercion), pressed = typeof coercion.investigator === 'string'
                ? `, ${coercion.pressed === true ? 'pressing' : 'failing to press'} ${personLabel(world, coercion.investigator, coercion.investigator)}` : '';
            return `${me.label} rolled ${skill}${action}: ${result}${pressed}`;
        }
        const actor = string(receipt.actor_label || personLabel(world, string(receipt.actor), string(receipt.actor)) || 'someone');
        return `${actor} rolled ${skill}${action} against ${me.label}: ${result}`;
    }
    if (kind === 'delta') {
        if (!me.is(receipt.subject)) return null;
        return `${me.label}'s ${string(receipt.resource)} ${string(receipt.before)} -> ${string(receipt.after)}${because(receipt)}`;
    }
    if (kind === 'condition') {
        if (!me.is(receipt.subject)) return null;
        const gained = array(receipt.gained).map(string), lost = array(receipt.lost).map(string);
        const parts = [...(gained.length ? [`gained ${gained.join(', ')}`] : []), ...(lost.length ? [`lost ${lost.join(', ')}`] : [])];
        return parts.length ? `${me.label} ${parts.join(' and ')}${because(receipt)}` : null;
    }
    if (kind === 'item') {
        const from = me.is(receipt.from), to = me.is(receipt.subject);
        if (!from && !to) return null;
        const quantity = Number.isInteger(receipt.quantity) && receipt.quantity !== 1 ? `${receipt.quantity} x ` : '';
        const thing = `${quantity}${string(receipt.label || receipt.name)}`, handover = typeof receipt.handover === 'string' && receipt.handover ? ` (${receipt.handover})` : '';
        const holder = string(receipt.subject_label || receipt.subject);
        return from ? `${thing} went from ${me.label} to ${holder}${handover}${because(receipt)}`
            : `${thing} went ${receipt.from ? `from ${string(receipt.from)} ` : ''}to ${me.label}${handover}${because(receipt)}`;
    }
    if (kind === 'cash') {
        if (!me.is(receipt.with)) return null;
        const who = string(receipt.subject_label || receipt.subject), currency = string(receipt.currency);
        if(receipt.settlement==='quote')return `${me.label} quoted ${string(receipt.purchase_amount)} ${currency} to ${who}; no payment or object transfer${because(receipt)}`;
        if(receipt.settlement==='living_standard')return `${who} settled ${string(receipt.purchase_amount)} ${currency} within living standard, with ${me.label}${because(receipt)}`;
        if(receipt.purchase_amount!==undefined&&receipt.settlement==='cash')return `${who} bought for ${string(receipt.purchase_amount)} ${currency} from ${me.label}; cash changed ${string(receipt.delta)} for cumulative daily spending${because(receipt)}`;
        if (receipt.settlement === 'spending_level')
            return `${who} spent ${string(receipt.purchase_amount)} ${currency} at spending level, with ${me.label}${because(receipt)}`;
        const delta = string(receipt.delta), signed = number(receipt.delta) > 0 ? `+${delta}` : delta;
        return `${who}'s cash ${signed} ${currency}, with ${me.label}${because(receipt)}`;
    }
    if (kind === 'npc') {
        if (!me.is(receipt.npc) && !me.is(receipt.handle)) return null;
        const set = ([['stance', 'stance'], ['disposition', 'combat disposition'], ['action', 'standing action']] as const)
            .filter(([field]) => typeof receipt[field] === 'string' && receipt[field]).map(([field, word]) => `${me.label}'s ${word} set to ${receipt[field]}`);
        return set.length ? `${set.join('; ')}${because(receipt)}` : null;
    }
    return null;
}

/**
 * §143.21 (ticket 22): what the host read about the player's words and this person -- the optional inputs of
 * `npc.situation`. `addressed`: the declaration was said to them -- the scan passes false only when the compile named
 * someone else (as amended 2026-09-26: named, in the conversation, or acted on with no one named all hear it). `declaredBeforeMove`: the declaration was put before a move of this turn brought the
 * investigator to where they are, so it was said somewhere else. Absent, the declaration is theirs, as §143.1 had it.
 * §143.23 (ticket 24): `namedNoOne`: the compile named no one present (its addressee `none`, `unclear`, below the gate,
 * or no compile), so whether the words were said to this person is the generator's to judge; the declaration they
 * hear says it was said to no one by name.
 */
export interface Heard { addressed?: boolean; declaredBeforeMove?: boolean; namedNoOne?: boolean }

/**
 * The last `happened` item (§143.1, §143.21, §143.23), or null. The player's declaration when it was said to this
 * person -- `declared (to no one by name)` when the compile named no one present, so the generator judges whether it was
 * said to them; when it was said before a move brought the investigator here, one host sentence that the investigator
 * has just arrived (the words were said elsewhere, to someone else, and are not theirs); otherwise nothing -- the
 * receipts already say what was done to them, and a line said to another person is not something that happened to this
 * one. `addressed: false` outranks `namedNoOne`: a named other is evidence, a name missing is not.
 */
export function closingSentence(me: Person, world: Row, party: Row[], turn: Row, heard: Heard = {}): string | null {
    const who = party.length === 1 ? personLabel(world, string(party[0].id), string(party[0].name || party[0].id)) : 'an investigator';
    if (heard.declaredBeforeMove === true) return clip(`${who} (investigator) has just arrived where ${me.label} is`, SENTENCE_MAX);
    const said = flat(turn.player_text);
    if (!said || heard.addressed === false) return null;
    const lead = `${who} (investigator) ${heard.namedNoOne === true ? 'declared (to no one by name)' : 'declared'}: `;
    return `${lead}"${clip(said, Math.max(ELLIPSIS.length + 1, SENTENCE_MAX - Array.from(lead).length - 2))}"`;
}

/**
 * `happened`: one sentence per call over the receipts of the newest committed turn before this one and of this turn,
 * then the closing sentence (`closingSentence`: the player's declaration said to them, or the investigator's arrival),
 * always last.
 */
export function happenedSentences(me: Person, world: Row, party: Row[], turn: Row, previous: Row | null, heard: Heard = {}): string[] {
    const seen = new Set<string>(), groups = new Map<string, {turn: number; clauses: string[]}>();
    const windows: Array<[number, Row[]]> = [...(previous ? [[number(previous.turn), array(previous.receipts)] as [number, Row[]]] : []), [number(turn.turn), array(turn.receipts)]];
    for (const [n, receipts] of windows)
        for (const value of receipts) {
            const receipt = row(value), id = string(receipt.id);
            if (id && seen.has(id)) continue;
            if (id) seen.add(id);
            const text = clause(receipt, me, world);
            if (!text) continue;
            const key = `${n}\0${string(receipt.call_id) || id}`;
            const group = groups.get(key) ?? {turn: n, clauses: []};
            group.clauses.push(text);
            groups.set(key, group);
        }
    const sentences = [...groups.values()].map(group => clip(`turn ${group.turn}: ${group.clauses.join('; ')}`, SENTENCE_MAX));
    const closing = closingSentence(me, world, party, turn, heard);
    if (closing) sentences.push(closing);
    return sentences;
}

/** The committed turn records on the campaign's current line, and the newest of them before this turn (§143.23 moved it to
 *  `read/exchange.ts`, which `table.status` reads it through too). */
export {committedOnLine};

/**
 * §143.20 (ticket 21): whether this person is in the conversation the investigators are having where they stand -- the
 * host's third trigger, beside a receipt done to them and the compile's addressee (§143.4). They took part in it on the
 * newest committed turn or earlier in this one: an act or an intention of theirs (a receipt whose `intent` names them --
 * the table's generated act, `act`, or anyone else's writing of what they set out to do, `intention`), or a spoken line
 * the delivery's speech markers attributed to them (the committed record's `speech`, `who.npc`, §40.3/§128 -- read by
 * the same name matching as every receipt field here). The newest committed turn counts only while the investigators
 * are still where it closed: its record's scene is the active scene and this person was among its `present`; leaving
 * that scene ends the conversation. This turn counts while they stand in the active scene. `order` is the position of
 * their latest part in that turn (the receipts in order, the delivery's lines after them), for ranking several people.
 * Structure only: nothing reads what anyone said or did.
 */
export function conversationOf(graph: ModuleGraph, world: Row, me: Person, turn: Row, previous: Row | null): {turn: number; order: number; by: string[]} | null {
    const active = string(world.active_scene);
    if (!active || string(row(world.npc_presence)[me.handle]) !== active) return null;
    const took = (record: Row): {turn: number; order: number; by: string[]} | null => {
        const receipts = array(record.receipts).map(row), by = new Set<string>();
        let order = -1;
        receipts.forEach((receipt, index) => {
            const intent = row(receipt.intent);
            if (typeof intent.ref !== 'string' || !me.is(intent.npc)) return;
            by.add(receiptGenerated(receipt) ? 'act' : 'intention');
            order = index;
        });
        array(record.speech).map(row).forEach((line, index) => {
            if (!me.is(row(line.who).npc)) return;
            by.add('speech');
            order = receipts.length + index;
        });
        return by.size ? {turn: number(record.turn), order, by: [...by]} : null;
    };
    // §143.23: the same "still where it closed" test `table.status`'s `last_exchange` reads.
    const stillThere = stillWhereItClosed(graph, world, previous) && array(row(previous!.world).present).some(name => me.is(name));
    return took(turn) ?? (stillThere ? took(previous!) : null);
}

/** The person's ledger entry as it folds now: the committed ledger with an open turn's receipts folded onto a copy. */
export function entryNow(graph: ModuleGraph, ledger: Row, table: Row, turn: Row, node: Row): Row {
    const entry = row(ledger[node.node_id]);
    if (!OPEN_STATES.includes(string(turn.state)) || !array(turn.receipts).length) return entry;
    const scratch: Row = Object.keys(entry).length ? {[node.node_id]: {...emptyLedgerEntry(), ...clone(entry)}} : {};
    foldNpcTurn(scratch, graph, {turn: turn.turn, receipts: turn.receipts}, table);
    return row(scratch[node.node_id]);
}

/**
 * `done`: every intention in `intentsView`'s row shape and order -- under way first, then settled, each newest first --
 * without the card's cap of three settled rows (the byte budget bounds this section), and a later row of the same turn
 * counts as the newer one.
 */
export function intentHistory(entry: Row): Row[] {
    const all = intentsOf(entry).map((item, index) => ({item, index}))
        .sort((a, b) => number(b.item.last_turn) - number(a.item.last_turn) || b.index - a.index).map(({item}) => item);
    return [...all.filter(item => !isSettled(item.status)), ...all.filter(item => isSettled(item.status))]
        .map(item => ({ref: item.ref, intent: item.text, status: item.status, since_turn: item.since_turn ?? null, turn: item.last_turn ?? null,
            // §143.6: a row the table's own act opened says so, as the card does.
            ...(item.generated === true ? {by: 'table'} : {})}));
}

export function stateOf(graph: ModuleGraph, world: Row, me: Person, session: Row | null, stance: string | null): Row {
    const participant = session?.status === 'active' ? array(session.participants).map(row).find(value => value.name === me.handle) : undefined;
    const profile = npcProfileOf(graph, world, me.handle), derived = row(profile?.derived);
    const hpOf = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const inSession = participant !== undefined;
    const hp = inSession && hpOf(participant!.hp) !== null ? hpOf(participant!.hp) : profile ? hpOf(profile.hp_current) ?? hpOf(derived.HP) : null;
    const hpMax = inSession && hpOf(participant!.hp_max) !== null ? hpOf(participant!.hp_max) : profile ? hpOf(derived.HP) : null;
    const conditions = once([...array(participant?.conditions), ...array(row(row(world.npc_resources)[me.handle]).conditions)].map(string));
    return {hp, hp_max: hpMax, conditions, stance, in_session: inSession, my_turn: inSession && session!.turn_of === me.handle};
}

function atHand(graph: ModuleGraph, world: Row, party: Row[], me: Person, place: Row | null): Row {
    const instances = values(row(row(world.objects).instances)).map(row);
    const profile = npcProfileOf(graph, world, me.handle);
    // §143.19: a weapon the table's act of this person brought out (`world.npc_weapons`) is theirs with or without a stat
    // block; with one, `npcProfileOf` already lays it over the profile's weapons.
    const drawn = profile ? [] : array(row(world.npc_weapons)[me.handle]).map(weapon => string(row(weapon).name || row(weapon).weapon_id));
    const holdings = once([
        ...array(profile?.weapons).map(weapon => isJsonObject(weapon) ? string(weapon.name || weapon.weapon_id) : string(weapon)),
        ...drawn,
        ...instances.filter(item => row(item.owner).kind === 'npc' && row(item.owner).id === me.handle).map(item => string(item.name)),
    ]);
    if (!place) return {holdings, objects: [], exits: [], present: []};
    const here = graph.handle(place);
    const objects = once([
        ...instances.filter(item => row(item.owner).kind === 'scene' && row(item.owner).id === here).map(item => string(item.name)),
        ...graph.scenePlaces(place).map(item => string(item.name)),
    ]);
    const exits = once(graph.sceneExits(place).map(exit => {
        const to = graph.find(string(exit.to), ['scene']);
        return to ? sceneLabel(graph, world, to) : string(exit.to);
    }));
    const present = once([
        ...(here === world.active_scene ? party.map(sheet => personLabel(world, string(sheet.id), string(sheet.name || sheet.id))) : []),
        ...npcsPresent(graph, world, place).filter(node => node.node_id !== me.node.node_id)
            .map(node => personLabel(world, graph.handle(node), graph.displayName(node))),
    ]);
    return {holdings, objects, exits, present};
}

/**
 * §143.29 (ticket 30, table D2: the copper badge brought out on turn 6 was shown again on turns 9, 14 and 15): what an
 * earlier act of this person brought out that they still hold -- its name as `holdings` has it, the turn it came out,
 * and, when that act named its row, the row's `ref` and where it stands now (`status`, from `done` before any cut) -- so
 * the generation step, and the bind batch that carries `at_hand` (§143.5's `same`, §143.27's `produces_known`), read
 * that showing it again is not something new. Read from what the writes recorded (`_draws` on the drawn weapon,
 * `_produces` on the instance's `brought_out`), never from a name. Newest first.
 */
export function broughtOut(world: Row, me: Person, done: Row[]): Row[] {
    const status = new Map(done.map(entry => [string(entry.ref), string(entry.status)]));
    const origin = (name: string, turn: unknown, ref: unknown): Row => ({name, turn: typeof turn === 'number' ? turn : null,
        ...(typeof ref === 'string' && ref ? {ref, ...(status.has(ref) ? {status: status.get(ref)} : {})} : {})});
    const weapons = array(row(world.npc_weapons)[me.handle]).map(row)
        .map(weapon => origin(string(weapon.name || weapon.weapon_id), weapon.turn, weapon.ref));
    const things = values(row(row(world.objects).instances)).map(row)
        .filter(item => row(item.owner).kind === 'npc' && row(item.owner).id === me.handle && row(item.brought_out).by === me.handle)
        .map(item => origin(string(item.name), row(item.brought_out).turn, row(item.brought_out).ref));
    return [...weapons, ...things].map((entry, index) => ({entry, index}))
        .sort((a, b) => number(b.entry.turn ?? -1) - number(a.entry.turn ?? -1) || b.index - a.index).map(({entry}) => entry);
}

/** How many things `table_brought_out` lists at most, newest first (§143.30). */
export const TABLE_BROUGHT_OUT_MAX = 12;

/**
 * §143.30 (ticket 32; the D10 probe's eighteen revolvers): everything anyone's act at this table has brought out, whoever
 * holds it now -- the drawn weapons of every person (`world.npc_weapons`) and every object instance marked
 * `brought_out` (§143.29) -- by name, who brought it out (their table label) and the turn, newest first, at most
 * `TABLE_BROUGHT_OUT_MAX`. The generator reads it so that the top rung's surprise is not a kind of thing the table has
 * already seen; whether two things are of one kind is the generator's judgement, never compared here.
 */
export function tableBroughtOut(graph: ModuleGraph, world: Row): Row[] {
    const labelOf = (handle: string): string => {
        const node = graph.find(handle, ['npc']);
        return node ? personLabel(world, graph.handle(node), graph.displayName(node)) : handle;
    };
    const origin = (name: string, by: string, turn: unknown): Row => ({name, by: labelOf(by), turn: typeof turn === 'number' ? turn : null});
    const weapons = Object.entries(row(world.npc_weapons)).flatMap(([handle, list]) => array(list).map(row)
        .map(weapon => origin(string(weapon.name || weapon.weapon_id), handle, weapon.turn)));
    const things = values(row(row(world.objects).instances)).map(row).filter(item => isJsonObject(item.brought_out))
        .map(item => origin(string(item.name), string(row(item.brought_out).by), row(item.brought_out).turn));
    return [...weapons, ...things].filter(entry => entry.name).map((entry, index) => ({entry, index}))
        .sort((a, b) => number(b.entry.turn ?? -1) - number(a.entry.turn ?? -1) || b.index - a.index)
        .slice(0, TABLE_BROUGHT_OUT_MAX).map(({entry}) => entry);
}

/** The stated obligations of their scene (§134.9), as issued, that name this person: as `who`, as the person of the
 *  next step, or among the people the obligation guards. */
function obligationsNaming(graph: ModuleGraph, world: Row, me: Person, place: Row | null, receipts: Row[], active: Row[]): Row[] {
    if (!place || !obligationNodes(graph, place).length) return [];
    return sceneObligations(graph, world, place, {
        receipts, modChecks: active.flatMap(mod => array(row(mod.contributes).checks).map(check => ({mod: string(mod.id), check})))})
        .filter(obligation => [obligation.who, row(obligation.next).person, ...array(row(row(obligation.trigger).guards).people)].some(name => me.is(name)));
}

function constraintsOf(graph: ModuleGraph, world: Row, party: Row[], me: Person, place: Row | null, named: Row[], active: Row[]): string[] {
    if (!place) return [];
    const result: string[] = [];
    for (const obligation of named) {
        const capsule = capsuleRow(obligation);
        result.push(`scene obligation ${string(capsule.name)} (${string(capsule.state)}): ${string(capsule.cue)}`);
    }
    if (graph.handle(place) === world.active_scene)
        for (const contact of contactRows(graph, world, party, active, [me.node]).contacts)
            result.push(`Mod check ${string(contact.decision)} between ${string(contact.actor)} and ${me.label} is still to come: ${string(contact.when)}`);
    return result;
}

/**
 * The budget (§143.1): while the packet is over `maxBytes`, cut in order -- at_hand's objects, exits;
 * the oldest of `table_brought_out` (§143.30); at_hand's brought_out (§143.29), holdings, present; the oldest `done` rows but never the newest (`history`); the oldest own utterances; the oldest
 * `happened` sentences but never the closing one (the player's declaration, or the arrival that stands in for it,
 * §143.21); who's relationships and commitments; canonical context excerpts; then constraints last. Each section cut
 * is named once in `truncated`. A packet that lost constraints cannot authorize an NPC act.
 */
export function fitSituation(packet: Row, maxBytes: number, declared: boolean): void {
    const truncated: string[] = packet.truncated, over = () => jsonSize(packet) > maxBytes;
    const cut = (name: string) => { if (!truncated.includes(name)) truncated.push(name); };
    for (const key of ['objects', 'exits', 'table_brought_out', 'brought_out', 'holdings', 'present']) {
        const list = key === 'table_brought_out' ? packet.table_brought_out : packet.at_hand[key];
        while (over() && Array.isArray(list) && list.length) { list.pop(); cut(key === 'table_brought_out' ? key : 'at_hand'); }
    }
    while (over() && packet.done.length > 1) { packet.done.pop(); cut('history'); }
    while (over() && packet.recent_speech.length) { packet.recent_speech.shift(); cut('recent_speech'); }
    while (over() && packet.happened.length > (declared ? 1 : 0)) { packet.happened.shift(); cut('happened'); }
    for (const key of ['relationships', 'commitments'])
        while (over() && Array.isArray(packet.who[key]) && packet.who[key].length) { packet.who[key].pop(); cut('who'); }
    for (const key of ['scene', 'previous_narration']) {
        while (over() && typeof packet.canonical_context?.[key] === 'string' && packet.canonical_context[key].length > 80) {
            packet.canonical_context[key] = clip(packet.canonical_context[key], Math.floor(Array.from(packet.canonical_context[key]).length / 2));
            cut('canonical_context');
        }
    }
    while (over() && packet.constraints.length) { packet.constraints.pop(); cut('constraints'); }
}

/**
 * §143.8: whether the book prepared this person's reaction -- a stated obligation of their scene, not yet settled or
 * waived, whose `who` is this person and whose reaction the book preordains (`reaction: "preordained"`, §134.5). The
 * only thing that keeps the stakes die from rolling. A Mod's first-contact row and an obligation that is plot rather
 * than a reaction stay in `constraints` for the generator and prepare nothing.
 */
export function preordainedReaction(named: Row[], me: Person): boolean {
    return named.some(obligation => obligation.reaction === 'preordained' && me.is(obligation.who) && ['open', 'blocked'].includes(string(obligation.state)));
}

/**
 * Where this person is placed, the rows the book and the active Mods hold for them now (the packet's `constraints`),
 * and whether one of them is a reaction the book preordains (`prepared`, §143.8). One computation for the packet and
 * for the stakes die.
 */
export async function placedConstraints(context: KernelContext, campaign: CampaignSnapshot, graph: ModuleGraph, me: Person): Promise<{place: Row | null; constraints: string[]; prepared: boolean}> {
    const {world, party} = campaign;
    const at = row(world.npc_presence)[me.handle], place = typeof at === 'string' ? graph.find(at, ['scene']) : null;
    const active = await activeMods(context, world);
    const allReceipts = [...campaign.records.flatMap(record => array(record.receipts)), ...array(campaign.turn.receipts)].map(row);
    const named = obligationsNaming(graph, world, me, place, allReceipts, active);
    return {place, constraints: constraintsOf(graph, world, party, me, place, named, active), prepared: preordainedReaction(named, me)};
}

/** This turn's stakes receipt for this person, as the generation step reads it (§143.8); null when none was rolled. */
export function stakesOf(turn: Row, me: Person): Row | null {
    const receipt = array(turn.receipts).map(row).find(value => isStakesRoll(value) && me.is(value.actor));
    return receipt ? stakesView(receipt) : null;
}

async function situationBudget(context: KernelContext): Promise<number> {
    try {
        const budgets = row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'host-budgets.json')));
        const value = row(budgets.npc_situation).max_bytes;
        return Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65536 ? value as number : SITUATION_MAX_BYTES;
    } catch {
        return SITUATION_MAX_BYTES;
    }
}

/** §180.3, §180.5: what the act author reads of a creature -- what the book says it is, its words (`habits`, §180.8:
 *  the book's under the words its module bound, else what an enabled package established at the table) and the Keeper's
 *  note, each when stated. Its personality is never read: a creature has none. */
function creatureMaterial(graph: ModuleGraph, world: Row, node: Row): Row {
    const what = creatureWhat(node), note = recordOf(node).keeper_note;
    return {...(what ? {what} : {}), ...creatureWords(graph, world, node), ...(typeof note === 'string' && note.trim() ? {keeper_note: note} : {})};
}

export function createSituationHandlers(context: KernelContext): HandlerGroup {
    return {
        'npc.situation': async params => {
            if (typeof params.name !== 'string' || !params.name.trim())
                throw new RpcError('invalid_params', 'params.name must be a non-empty string', {details: {field: 'name'}});
            // §143.21, §143.23: what the host read about the player's words and this person, all optional booleans.
            for (const field of ['addressed', 'declared_before_move', 'named_no_one'])
                if (params[field] != null && typeof params[field] !== 'boolean')
                    throw new RpcError('invalid_params', `params.${field} is true, false or absent`, {details: {field}});
            const heard: Heard = {...(typeof params.addressed === 'boolean' ? {addressed: params.addressed} : {}),
                ...(typeof params.declared_before_move === 'boolean' ? {declaredBeforeMove: params.declared_before_move} : {}),
                ...(typeof params.named_no_one === 'boolean' ? {namedNoOne: params.named_no_one} : {})};
            const {campaign, module} = await readCampaign(context, params, false, false, {}, true);
            // §87.8: the book's names, then the table's word (§79), then the graph's refusal -- the junction every entrance
            // that takes a person's name reads, as `npc.perspective` and `npc.job` do.
            // §180.5: a creature that states a stat block acts too; its material is a body's (`who` below).
            const {graph} = module, {world, turn, party} = campaign, node = actorNode(graph, world, params.name);
            const me = personOf(graph, world, node), person = graph.isPerson(node);
            const {scope, records, previous} = committedOnLine(campaign);
            let ledger: Row = {};
            try { ledger = row(await campaign.optional('npc-ledger.json')); } catch { /* A missing or unreadable ledger is an empty one here, as for look. */ }
            const table = await stanceTable(context);
            const memory = withPromiseFulfillment(await campaign.log('memory/candidates.jsonl'),
                {campaign: campaign.id, world, receipts: canonicalMemoryReceipts(records, array(turn.receipts))});
            // §180.3: a person's perspective (personality, goals, fears, commitments, relationships, speech) is a person's;
            // a creature has none of it.
            const view = person ? row(npcPerspective(graph, world, node, memory, records, scope).view) : {};
            const session = new SessionView(campaign, graph, party, world).activeSession();
            const {place, constraints} = await placedConstraints(context, campaign, graph, me);
            const happened = happenedSentences(me, world, party, turn, previous, heard);
            const done = intentHistory(entryNow(graph, ledger, table, turn, node));
            // §143.29: what an earlier act of theirs brought out, present only when there is something.
            const brought = broughtOut(world, me, done);
            // §143.30: what anyone at this table has brought out, present only when there is something.
            const seen = tableBroughtOut(graph, world);
            const packet: Row = {
                npc: {handle: me.handle, name: graph.displayName(node), kind: person ? 'npc' : 'creature'},
                canonical_context: {
                    scene: place ? chars(graph.summary(place), 1600) : '',
                    previous_narration: chars(string(previous?.rendered_text ?? ''), 2000),
                    player_declaration: string(row(turn.player_input).text ?? turn.player_text ?? ''),
                },
                // §180.3: the act author's material -- a person's personality and the rest of their perspective; for a
                // creature, what the book says it is, its habits and the Keeper's note.
                who: person ? {personality: view.personality ?? null, goals: view.goals ?? null, fears: view.fears ?? null,
                    commitments: view.commitments ?? [], relationships: view.relationships ?? []} : creatureMaterial(graph, world, node),
                happened,
                state: stateOf(graph, world, me, session, stanceNow(graph, ledger, table, turn, me.handle)),
                at_hand: {...atHand(graph, world, party, me, place), ...(brought.length ? {brought_out: brought} : {})},
                ...(seen.length ? {table_brought_out: seen} : {}),
                done,
                recent_speech: array(view.recent_speech).map(line => `turn ${string(row(line).turn)}: ${flat(row(line).statement)}`),
                constraints,
                stakes: stakesOf(turn, me),
                truncated: [],
            };
            fitSituation(packet, await situationBudget(context), closingSentence(me, world, party, turn, heard) !== null);
            return packet;
        },
    };
}
