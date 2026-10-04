/**
 * Contract §143.3 (docs/specs/npc-acts-first.md D3, ticket 03): `npc.act.options {campaign, name, produce?}` -- the ways
 * this person's act can be settled right now, each with the closed options of its parameters.
 *
 * The host binds a generated act (§143.2) to one of these ways by one closed Jev question (§143.3); nothing here reads
 * the act, and nothing here decides what the person does. Every way is an existing kernel path -- a fight action of
 * the running combat, the first blow (§142.11), a chase (§11.5), the person's own check (§142.6), a coercion (§142.13),
 * a clock (§142.9), a person walking on (§87), a stance or a leave (`apply npc`), or the intention alone (§142.2) --
 * and every option is data the kernel already holds: the session's own targets and weapons, the stat block's skills and
 * the table's pins, the four social skills of the rule, the table's and the book's clocks, the stance ledger's words.
 * No number is invented; a difficulty is the rule's default where the path takes one (§135.28).
 *
 * `acted_on` is structure, not meaning: this turn's receipts that were done to this person (a roll made against them,
 * their resources or conditions changed, a thing taken from or given to them, money exchanged with them), and an
 * investigator who fled while they stood in the same scene. A receipt of their own act (its `intent` names them) or
 * their own roll is not something done to them. `conversation` (§143.20) is structure too: whether they took part, on
 * the newest committed turn in the scene the investigators are still in, or earlier in this one, by an act or an
 * intention of theirs or a line the speech markers attributed to them (`conversationOf`, `situation.ts`).
 *
 * With `produce: true` (the host asks only when the generated act brings out something no one knew this person had --
 * `produces`, allowed by a surprise of the stakes die, §143.19, spec D10) the result also lists `produce`: every record
 * of the rulebook's price list (`equipment.json`), the module's era first (§143.30), one option per record (`value` its `price_id`,
 * `label` the book's name, `category`, and `weapon` -- its `weapons.json` profile -- when the record is a weapon). It
 * replaces D9's weapons-only `draw` list (ticket 20): what a person brings out is anything the book prices.
 */
import { isImpressionRoll } from '../mods/impression-receipt.js';
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {fleeBlockers} from '../combat/flee-footing.js';
import {npcNode, npcsPresent, personLabel} from '../read/capsule.js';
import {readCampaign} from '../read/handlers.js';
import {playLanguageOf} from '../read/languages.js';
import {moduleDeclaration, type ModuleGraph} from '../read/module-graph.js';
import {threatSymptoms} from '../read/pacing.js';
import {SessionView, active} from '../read/session-view.js';
import {array, entries, integer, normalize, number, row, string, truth, type Row} from '../read/values.js';
import {stanceNow} from '../combat/standing.js';
import {npcProfileOf} from '../resolve/context.js';
import {COERCION_SKILLS} from '../resolve/coercion.js';
import {stanceTable} from '../write/contributions.js';
import {committedOnLine, conversationOf, entryNow, intentHistory, personOf, type Person} from './situation.js';
import {INTENT_TEXT_LIMIT, intentRef, isSettled} from './intents.js';

/** The ways, in the order the result lists them (contract §143.3's closed vocabulary). */
export const ACT_WAYS: readonly string[] = Object.freeze(['attack', 'flee', 'first_blow', 'pursue', 'check', 'coercion', 'clock', 'walk_on', 'stance', 'leave', 'intention_only']);

interface Option { value: string; label: string; [extra: string]: unknown }
const option = (value: string, label: string, extra: Row = {}): Option => ({value, label: label || value, ...extra});
const once = (options: Option[]): Option[] => {
    const seen = new Set<string>();
    return options.filter(entry => entry.value && !seen.has(entry.value) && (seen.add(entry.value), true));
};

/** This turn's receipts done to this person, by receipt id and the closed kind of what was done. */
export function actedOn(me: Person, turn: Row, party: Row[], here: boolean): Row[] {
    const out: Row[] = [];
    const investigator = (id: unknown) => party.some(sheet => normalize(string(sheet.id)) === normalize(string(id)) || normalize(string(sheet.name)) === normalize(string(id)));
    for (const value of array(turn.receipts)) {
        const receipt = row(value), id = string(receipt.id);
        // Their own act (a stamp naming them) and their own roll are what they did, not what was done to them.
        if (me.is(row(receipt.intent).npc) || me.is(receipt.actor)) continue;
        // An impression observes this meeting; it is not an action performed against the NPC.
        // Its typed result guides the Keeper's ordinary reply without starting another author.
        if (isImpressionRoll(receipt)) continue;
        let kind: string | null = null;
        if (receipt.kind === 'roll' && me.is(receipt.npc)) kind = 'roll_against';
        else if (receipt.kind === 'delta' && me.is(receipt.subject)) kind = 'delta';
        else if (receipt.kind === 'condition' && me.is(receipt.subject)) kind = 'condition';
        else if (receipt.kind === 'item' && (me.is(receipt.from) || me.is(receipt.subject))) kind = 'item';
        else if (receipt.kind === 'cash' && me.is(receipt.with)) kind = 'cash';
        // Ticket 03: an investigator who flees is a person acted on by it -- whether to go after them is theirs.
        else if (receipt.kind === 'condition' && here && investigator(receipt.subject) && array(receipt.gained).map(string).includes('fled')) kind = 'fled_from';
        if (kind) out.push({receipt: id || null, kind});
    }
    return out;
}

/** The skills their numbers or the table's pins give them, highest first (a label carries the value). */
function skillOptions(graph: ModuleGraph, world: Row, node: Row, handle: string, ledger: Row, receipts: Row[]): Option[] {
    const values = new Map<string, number>();
    const put = (name: unknown, value: unknown) => {
        if (typeof name === 'string' && name.trim() && integer(value) && !values.has(name.trim())) values.set(name.trim(), number(value));
    };
    // The table's pins first (§34.10's `skill`), newest first, as the resolve reads them.
    for (const receipt of [...receipts].reverse())
        if (receipt.kind === 'npc' && receipt.npc === node.node_id && isJsonObject(receipt.skill)) put(receipt.skill.name, receipt.skill.value);
    for (const [name, pinned] of entries(row(row(ledger[string(node.node_id)]).skills))) put(name, row(pinned).value);
    for (const [name, value] of entries(row(npcProfileOf(graph, world, handle)?.skills))) put(name, value);
    return [...values].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name, value]) => option(name, `${name} ${value}`));
}

function weaponLabel(catalog: Row, weapon: unknown): Option | null {
    const id = isJsonObject(weapon) ? string(weapon.weapon_id) : string(weapon);
    if (!id) return null;
    const entry = row(catalog[id]), own = isJsonObject(weapon) ? weapon : {};
    return option(id, string(own.name || own.label || entry.display_name || entry.name) || id);
}

/**
 * §143.19: the rulebook's price list, one option per record. A record whose `entity_ref` names a `weapons.json` profile
 * carries it as `weapon` (the host draws it through §143.3's `_draws`); every other record is an object the kernel
 * places in the person's hands (`_produces`, `apply/draw.ts`).
 *
 * §143.30 (ticket 32): what a surprise brings out is not held to the module's era -- the top rung may be anachronistic,
 * and the thing should still find its rules. The module era's records come first, in the book's order; then every other
 * era's record whose name no earlier option has (the kernel's name normalization), so the module's era is preferred.
 */
async function produceCatalog(context: KernelContext, graph: ModuleGraph): Promise<Option[]> {
    const read = async (name: string): Promise<Row> => {
        try { return row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'rules-json', name))); } catch { return {}; }
    };
    const [equipment, weapons] = await Promise.all([read('equipment.json'), read('weapons.json')]);
    const profiles = row(weapons.weapons), era = string(moduleDeclaration(graph.moduleNode).era);
    const ofEra = (record: Row): boolean => !era || !string(record.era) || string(record.era) === era;
    const records = array(equipment.records).map(row).filter(record => string(record.price_id) && string(record.name));
    const named = new Set(records.filter(ofEra).map(record => normalize(record.name)));
    const others = records.filter(record => !ofEra(record) && !named.has(normalize(record.name)) && (named.add(normalize(record.name)), true));
    const out: Option[] = [];
    for (const record of [...records.filter(ofEra), ...others]) {
        const ref = row(record.entity_ref), profile = string(ref.entity_id);
        const weapon = ref.kind === 'weapon' && Object.hasOwn(profiles, profile) ? {weapon: profile} : {};
        out.push(option(string(record.price_id), string(record.name), {category: string(record.category) || null, ...weapon}));
    }
    return once(out);
}

export function createActOptionsHandlers(context: KernelContext): HandlerGroup {
    return {
        'npc.act.options': async params => {
            if (typeof params.name !== 'string' || !params.name.trim())
                throw new RpcError('invalid_params', 'params.name must be a non-empty string', {details: {field: 'name'}});
            if (params.act != null && (typeof params.act !== 'string' || !params.act.trim() || Array.from(params.act.trim()).length > INTENT_TEXT_LIMIT))
                throw new RpcError('invalid_params', `params.act is one line of at most ${INTENT_TEXT_LIMIT} characters, or absent`, {details: {field: 'act'}});
            if (params.produce != null && typeof params.produce !== 'boolean')
                throw new RpcError('invalid_params', 'params.produce is true, false or absent', {details: {field: 'produce'}});
            const {campaign, module} = await readCampaign(context, params, false, false, {}, true);
            // §87.8: the person's name through the junction, as `npc.situation` reads it.
            const {graph} = module, {world, turn, party} = campaign, node = npcNode(graph, world, params.name);
            const me = personOf(graph, world, node), handle = me.handle;
            const place = typeof row(world.npc_presence)[handle] === 'string' ? string(row(world.npc_presence)[handle]) : null;
            const here = place !== null && place === world.active_scene;
            const view = new SessionView(campaign, graph, party, world);
            const combat = active(view.combat) ? row(view.combat) : null, chase = active(view.chase) ? row(view.chase) : null;
            const fighter = combat ? row(array(combat.participants).find(value => string(row(value).actor_id) === handle)) : {};
            const inChase = !!chase && array(chase.participants).some(value => string(row(value).actor_id) === handle || string(row(value).name) === handle);
            const inCombat = Object.keys(fighter).length > 0, inSession = inCombat || inChase;
            const myTurn = inCombat && !isJsonObject(combat!.pending_attack) && view.combatTurnOf(combat!) === handle;
            let ledger: Row = {};
            try { ledger = row(await campaign.optional('npc-ledger.json')); } catch { /* an unreadable ledger reads as empty, as for look */ }
            const records = [...campaign.records.flatMap(record => array(record.receipts)), ...array(turn.receipts)].map(row);
            const label = (id: string): string => {
                const sheet = party.find(value => string(value.id) === id);
                if (sheet) return personLabel(world, id, string(sheet.name || id));
                const other = graph.find(id, ['npc']);
                return other ? personLabel(world, graph.handle(other), graph.displayName(other)) : id;
            };
            const investigators = (here ? party : []).map(sheet => option(string(sheet.id), personLabel(world, string(sheet.id), string(sheet.name || sheet.id))));
            const profile = npcProfileOf(graph, world, handle);
            const ways: Row[] = [];
            const way = (name: string, params: Record<string, Option[]> = {}) => ways.push({way: name, params});
            if (inCombat && myTurn) {
                // The running fight's own lists (§11.5): opponents who can still fight, the weapons in their hands.
                const catalog = row(combat!.weapon_catalog), weapons = once(array(fighter.weapons).map(value => weaponLabel(catalog, value)).filter((value): value is Option => !!value));
                const targets = view.combatTargets(combat!, handle).map(id => option(id, label(id)));
                if (targets.length) way('attack', {target: targets, weapon: weapons.length ? weapons : [option('unarmed', string(row(catalog.unarmed).display_name) || 'unarmed')]});
                // §143.9: a person the ruleset's flight rules block (held, unconscious...) cannot flee, so it is not a way.
                const fleeTable = campaign.standingTables?.flee;
                if (!fleeTable || !fleeBlockers(fighter, fleeTable).length) way('flee');
            }
            if (!inSession && here && profile) {
                // §142.11: outside a fight, a person present with a stat block may strike the first blow at an investigator.
                const catalog = await (async () => { try { return row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'rules-json', 'weapons.json'))).weapons; } catch { return {}; } })();
                const weapons = once([...array(profile.weapons).map(value => weaponLabel(row(catalog), value)).filter((value): value is Option => !!value),
                    option('unarmed', string(row(row(catalog).unarmed).display_name) || 'unarmed')]);
                if (investigators.length) way('first_blow', {target: investigators, weapon: weapons});
                // Ticket 03: an investigator fled this turn and no chase runs -- going after them is this person's act.
                const fled = actedOn(me, turn, party, here).filter(entry => entry.kind === 'fled_from')
                    .map(entry => string(row(array(turn.receipts).find(value => string(row(value).id) === entry.receipt)).subject));
                const quarry = investigators.filter(entry => fled.includes(entry.value));
                if (quarry.length && !chase) way('pursue', {target: quarry});
            }
            const skills = skillOptions(graph, world, node, handle, ledger, records);
            if (skills.length) way('check', {skill: skills});
            if (investigators.length) way('coercion', {skill: COERCION_SKILLS.map(skill => option(skill, skill)), investigator: investigators});
            if (place) {
                const scene = graph.find(place, ['scene']);
                const clocks = scene ? threatSymptoms(graph, world, scene, npcsPresent(graph, world, scene)).filter(entry => truth(entry.next)).map(entry => entry.minted === true
                    ? option(`table:${string(entry.threat)}`, `${string(entry.name)} (${string(entry.state)})`, {write: {name: string(entry.name)}})
                    : option(`${string(entry.threat)}:${string(entry.clock)}`, `${string(entry.threat)} ${string(entry.clock)} (${string(entry.state)})`, {write: {name: string(entry.threat), clock: string(entry.clock)}})) : [];
                if (clocks.length) way('clock', {clock: once(clocks)});
            }
            if (!inSession && place) {
                // §87: someone the table knows who is not here comes in -- a person in a scene this one opens onto, or a
                // person this table established who stands nowhere now. Their name is a known one: nobody is invented.
                const scene = graph.find(place, ['scene']);
                const next = new Set(scene ? graph.sceneExits(scene).map(exit => graph.find(string(exit.to), ['scene'])).filter((value): value is Row => !!value).map(value => graph.handle(value)) : []);
                const presence = row(world.npc_presence), known = entries(presence).filter(([id, at]) => id !== handle && next.has(string(at))).map(([id]) => id);
                const standing = array(world.table_people).map(row).filter(person => !person.replaced_by).map(person => graph.find(string(person.name), ['npc']))
                    .filter((value): value is Row => !!value).map(value => graph.handle(value)).filter(id => id !== handle && !Object.hasOwn(presence, id));
                const people = once([...known, ...standing].map(id => option(id, label(id))));
                if (people.length) way('walk_on', {name: people});
            }
            const table = await stanceTable(context), stance = stanceNow(graph, ledger, table, turn, handle);
            // §143.5: the act's identity as an intention of this person (§142.1). The same line as one still under way is
            // that intention continued; the same line as a settled one is a new attempt, so it is a new line -- the turn is
            // appended, because a settled intention is not tried again (§142.2) and the kernel never reads what it means.
            let act: Row | null = null;
            if (typeof params.act === 'string') {
                const rows = intentHistory(entryNow(graph, ledger, table, turn, node));
                let line = params.act.trim(), ref = intentRef(handle, line);
                const known = rows.find(entry => entry.ref === ref);
                if (known && isSettled(known.status)) { line = `${line} (turn ${number(turn.turn)})`; ref = intentRef(handle, line); }
                act = {line, ref, continues: known && !isSettled(known.status) ? {ref: known.ref, status: known.status, since_turn: known.since_turn, turn: known.turn} : null};
            }
            const words = array(table.levels).map(level => string(row(level).value)).filter(word => word && word !== stance);
            if (words.length) way('stance', {stance: words.map(word => option(word, word))});
            if (!inSession && place) way('leave');
            way('intention_only');
            return {
                npc: {handle, name: graph.displayName(node)},
                // The act is written in the campaign's play language (§143.2); the host reads it here with the options.
                play_language: await playLanguageOf(context, campaign.meta),
                place, in_session: inSession, my_turn: myTurn,
                acted_on: actedOn(me, turn, party, here),
                // §143.20: whether they are in the conversation where the investigators stand (the host's third trigger).
                conversation: conversationOf(graph, world, me, turn, committedOnLine(campaign).previous),
                ...(act ? {act} : {}),
                ways: ways as unknown as Row[],
                ...(params.produce === true ? {produce: await produceCatalog(context, graph) as unknown as Row[]} : {}),
            };
        },
    };
}
