/**
 * Contract §139.1 (docs/specs/npc-acts-first.md D1, ticket 01): `npc.situation {campaign, name}` -- what one person
 * faces right now, for the step that generates what they do next (§139.2).
 *
 * Facts only. Who they are is `npcPerspective`'s rows; what just happened to them is composed by code from the receipts
 * of this turn and the last; their body, their stance, what is at hand, what they already set out to do and how it went,
 * and what the book and the active Mods require of them; and, when `npc.stakes` rolled for them this turn, that die's
 * rung, outcome and degree line (§139.8: read from its receipt, never rolled here). Nothing here reads what a line
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
import {jsonSize, npcsPresent, personLabel, sceneLabel} from '../read/capsule.js';
import {readCampaign} from '../read/handlers.js';
import {canonicalMemoryReceipts, withPromiseFulfillment} from '../read/memory.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {activeMods, contactRows} from '../read/mods.js';
import {capsuleRow, obligationNodes, sceneObligations} from '../read/obligations.js';
import {SessionView} from '../read/session-view.js';
import {array, clone, normalize, number, row, string, truth, values, type Row} from '../read/values.js';
import {stanceNow} from '../combat/standing.js';
import {npcProfileOf} from '../resolve/context.js';
import {emptyLedgerEntry, foldNpcTurn, stanceTable} from '../write/contributions.js';
import {intentsOf, isSettled} from './intents.js';
import {npcPerspective} from './perspective.js';
import {isStakesRoll, stakesView} from './stakes-receipt.js';

/** The packet's size bound when `host-budgets.json` names none (`npc_situation.max_bytes`). */
export const SITUATION_MAX_BYTES = 6144;
/** One composed sentence, and a Keeper's `why` inside one, in code points. */
const SENTENCE_MAX = 400, WHY_MAX = 160, ELLIPSIS = '...';
/** The turn states whose receipts the committed ledger has not folded yet (as `stanceNow` reads them). */
const OPEN_STATES = ['open', 'acting'];

const flat = (value: unknown): string => string(value).replace(/\s+/g, ' ').trim();
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
/** A record on this campaign's current line (the same test `npcPerspective` reads records under). */
function onLine(value: Row, scope: Row): boolean {
    return value.superseded_by == null && value.status !== 'superseded'
        && (value.worldline == null || scope.worldline == null || value.worldline === scope.worldline)
        && (value.loop == null || scope.loop == null || number(value.loop) === number(scope.loop));
}

/** Who a receipt field may name this person by: handle, node id, the book's names, the table's label (§79). */
export interface Person { node: Row; handle: string; label: string; is(value: unknown): boolean }
export function personOf(graph: ModuleGraph, world: Row, node: Row): Person {
    const handle = graph.handle(node), label = personLabel(world, handle, graph.displayName(node));
    const keys = new Set([handle, string(node.node_id), graph.displayName(node), label, ...graph.nameKeys(node)].filter(Boolean).map(normalize));
    return {node, handle, label, is: value => typeof value === 'string' && keys.has(normalize(value))};
}

/**
 * §139.14: a receipt that settles one of this person's intentions `abandoned` says they gave it up -- the table's own
 * act repeated with no result (`why: repeated`, §139.5), or the Keeper's overrule (D7) -- so the next act is generated
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
    // The stakes die (§139.8) is not something done to or by this person; the packet carries it as `stakes`.
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
 * `happened`: one sentence per call over the receipts of the newest committed turn before this one and of this turn,
 * then the player's declaration of this turn, always last.
 */
export function happenedSentences(me: Person, world: Row, party: Row[], turn: Row, previous: Row | null): string[] {
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
    const said = flat(turn.player_text);
    if (said) {
        const who = party.length === 1 ? personLabel(world, string(party[0].id), string(party[0].name || party[0].id)) : 'an investigator';
        const frame = `${who} (investigator) declared: ""`;
        sentences.push(`${who} (investigator) declared: "${clip(said, Math.max(ELLIPSIS.length + 1, SENTENCE_MAX - Array.from(frame).length))}"`);
    }
    return sentences;
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
            // §139.6: a row the table's own act opened says so, as the card does.
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
    const holdings = once([
        ...array(profile?.weapons).map(weapon => isJsonObject(weapon) ? string(weapon.name || weapon.weapon_id) : string(weapon)),
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
 * The budget (§139.1): while the packet is over `maxBytes`, cut in order -- constraints; at_hand's objects, exits,
 * holdings, present; the oldest `done` rows but never the newest (`history`); the oldest own utterances; the oldest
 * `happened` sentences but never the player's declaration; who's relationships and commitments. Each section cut is
 * named once in `truncated`, in the order cut.
 */
export function fitSituation(packet: Row, maxBytes: number, declared: boolean): void {
    const truncated: string[] = packet.truncated, over = () => jsonSize(packet) > maxBytes;
    const cut = (name: string) => { if (!truncated.includes(name)) truncated.push(name); };
    while (over() && packet.constraints.length) { packet.constraints.pop(); cut('constraints'); }
    for (const key of ['objects', 'exits', 'holdings', 'present'])
        while (over() && packet.at_hand[key].length) { packet.at_hand[key].pop(); cut('at_hand'); }
    while (over() && packet.done.length > 1) { packet.done.pop(); cut('history'); }
    while (over() && packet.recent_speech.length) { packet.recent_speech.shift(); cut('recent_speech'); }
    while (over() && packet.happened.length > (declared ? 1 : 0)) { packet.happened.shift(); cut('happened'); }
    for (const key of ['relationships', 'commitments'])
        while (over() && Array.isArray(packet.who[key]) && packet.who[key].length) { packet.who[key].pop(); cut('who'); }
}

/**
 * §139.8: whether the book prepared this person's reaction -- a stated obligation of their scene, not yet settled or
 * waived, whose `who` is this person and whose reaction the book preordains (`reaction: "preordained"`, §134.5). The
 * only thing that keeps the stakes die from rolling. A Mod's first-contact row and an obligation that is plot rather
 * than a reaction stay in `constraints` for the generator and prepare nothing.
 */
export function preordainedReaction(named: Row[], me: Person): boolean {
    return named.some(obligation => obligation.reaction === 'preordained' && me.is(obligation.who) && ['open', 'blocked'].includes(string(obligation.state)));
}

/**
 * Where this person is placed, the rows the book and the active Mods hold for them now (the packet's `constraints`),
 * and whether one of them is a reaction the book preordains (`prepared`, §139.8). One computation for the packet and
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

/** This turn's stakes receipt for this person, as the generation step reads it (§139.8); null when none was rolled. */
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

export function createSituationHandlers(context: KernelContext): HandlerGroup {
    return {
        'npc.situation': async params => {
            if (typeof params.name !== 'string' || !params.name.trim())
                throw new RpcError('invalid_params', 'params.name must be a non-empty string', {details: {field: 'name'}});
            const {campaign, module} = await readCampaign(context, params, false, false, {}, true);
            const {graph} = module, {world, turn, party} = campaign, node = graph.npc(params.name);
            const me = personOf(graph, world, node);
            const worldline = string(campaign.meta.active_worldline || 'main');
            const scope = {worldline, loop: number(row(row(campaign.meta.worldlines)[worldline]).loop)};
            const records = campaign.records.filter(record => truth(record.commit) && onLine(record, scope));
            const previous = records.filter(record => number(record.turn) < number(turn.turn)).sort((a, b) => number(b.turn) - number(a.turn))[0] ?? null;
            let ledger: Row = {};
            try { ledger = row(await campaign.optional('npc-ledger.json')); } catch { /* A missing or unreadable ledger is an empty one here, as for look. */ }
            const table = await stanceTable(context);
            const memory = withPromiseFulfillment(await campaign.log('memory/candidates.jsonl'),
                {campaign: campaign.id, world, receipts: canonicalMemoryReceipts(records, array(turn.receipts))});
            const view = row(npcPerspective(graph, world, node, memory, records, scope).view);
            const session = new SessionView(campaign, graph, party, world).activeSession();
            const {place, constraints} = await placedConstraints(context, campaign, graph, me);
            const happened = happenedSentences(me, world, party, turn, previous);
            const packet: Row = {
                npc: {handle: me.handle, name: graph.displayName(node)},
                who: {personality: view.personality ?? null, goals: view.goals ?? null, fears: view.fears ?? null,
                    commitments: view.commitments ?? [], relationships: view.relationships ?? []},
                happened,
                state: stateOf(graph, world, me, session, stanceNow(graph, ledger, table, turn, me.handle)),
                at_hand: atHand(graph, world, party, me, place),
                done: intentHistory(entryNow(graph, ledger, table, turn, node)),
                recent_speech: array(view.recent_speech).map(line => `turn ${string(row(line).turn)}: ${flat(row(line).statement)}`),
                constraints,
                stakes: stakesOf(turn, me),
                truncated: [],
            };
            fitSituation(packet, await situationBudget(context), Boolean(flat(turn.player_text)));
            return packet;
        },
    };
}
