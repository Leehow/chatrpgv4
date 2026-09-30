/**
 * Contract §158: what the player was told and the ledger lacks.
 *
 * Delivered prose is the past (owner ruling 2026-09-29). When a delivery reached the player without the receipt
 * that should have carried it, the state is owed: it did happen, and the ledger is brought forward to it. The post
 * continuity review names owed state in structure (§158.2); this module turns an accepted report into owed rows,
 * keeps the campaign's owed ledger (`owed.json`), and says which rows the ledger already agrees with.
 *
 * Nothing here reads prose. A row comes only from the reviewer's structured answer; the kernel checks that its
 * quote is in the delivered text, that its scene, person or band exists, and nothing else.
 *
 * The ledger is its own campaign file, not a `world.json` key: the review writes after the turn it read has
 * closed, usually while the next turn is open, and a `world.json` write there would stale that turn's world
 * revision (§158.3).
 */
import { cashDecimal } from '../apply/cash.js';
import { jsonDigest } from '../json.js';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { personNode } from '../read/capsule.js';
import { locateExcerpt } from '../read/excerpt.js';
import { queuedDefinition } from '../mods/queue.js';
import { findNamedObject } from '../read/mods.js';
import { array, chars, clone, number, row, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { bandRows } from '../rules/bands.js';
import { ROUTE_TRAVEL_FIELD, ROUTE_TRAVEL_ROWS } from '../modules/route-travel.js';
import { writeJsonAtomic } from '../fileio.js';
import { stripMarkers } from '../write/text.js';

export const OWED_FILE = 'owed.json';
/** The kinds a report may name (§158.2); objects may also arrive through `missing`. */
export const OWED_KINDS: readonly string[] = Object.freeze(['move', 'time', 'npc', 'cash', 'object']);
export const OWED_PRESENCE: readonly string[] = Object.freeze(['here', 'away']);
/** A journey with no road between two parts of one place (§138.9's exit `adjacent`). */
export const TRAVEL_ADJACENT = 'adjacent';
/** At most this many rows stay open; the oldest is closed `dropped` past it. */
const OPEN_KEPT = 16;
/** The closed list is a trail for the operator, bounded. */
const CLOSED_KEPT = 32;

export interface OwedLedger { open: Row[]; closed: Row[] }

export function owedLedger(value: unknown): OwedLedger {
    const stored = row(value);
    return { open: array(stored.open).map(row).filter(entry => typeof entry.name === 'string'), closed: array(stored.closed).map(row) };
}
function ledgerPath(context: KernelContext, campaign: string): string {
    return join(context.campaignsRoot, campaign, OWED_FILE);
}
export async function readOwed(context: KernelContext, campaign: string): Promise<OwedLedger> {
    const path = ledgerPath(context, campaign);
    if (!await context.snapshots.pathExists(path))
        return { open: [], closed: [] };
    return owedLedger(clone(await context.snapshots.readJson(path)));
}
export async function writeOwed(context: KernelContext, campaign: string, ledger: OwedLedger): Promise<void> {
    await writeJsonAtomic(ledgerPath(context, campaign), { open: ledger.open, closed: ledger.closed.slice(-CLOSED_KEPT) });
}

/** Upgrade an older unresolved equipment row from exact current ownership, without rewriting its identity. */
export function resolveOwedEquipment(ledger: OwedLedger, party: readonly Row[]): OwedLedger {
    return {...ledger,open:ledger.open.map(entry=>{
        if (entry.kind !== 'object' || entry.effect || row(entry.object).category !== 'item') return entry;
        const name=text(row(entry.object).name),matches=party.flatMap(owner=>array(owner.equipment)
            .filter(value=>(typeof value === 'string'?value:row(value).name)===name&&!row(value).object_id).map(()=>owner));
        if (matches.length !== 1) return entry;
        const owner=matches[0];
        return {...entry,object:{...row(entry.object),owner:owner.name},owner_id:owner.id,equipment_basis:true,
            effect:{kind:'object',name,definition:name,to:owner.name,adopt:name}};
    })};
}

/** The closed rows a report may choose from (§158.2): travel bands for a move, time bands for time beyond it. */
export async function owedBands(kernel: KernelContext): Promise<{ travel: string[]; time: string[]; travelMinutes: Map<string, number> }> {
    const travel = await bandRows(kernel, ROUTE_TRAVEL_FIELD), time = await bandRows(kernel, 'time.band');
    return {
        travel: [TRAVEL_ADJACENT, ...travel.map(entry => entry.handle)],
        time: time.map(entry => entry.handle).filter(handle => !ROUTE_TRAVEL_ROWS.includes(handle)),
        travelMinutes: new Map<string, number>([[TRAVEL_ADJACENT, 0], ...travel.map(entry => [entry.handle, number(entry.default)] as [string, number])])
    };
}

function sceneOf(graph: ModuleGraph, name: unknown): Row | null {
    if (typeof name !== 'string' || !name.trim())
        return null;
    try { return graph.scene(name.trim()); }
    catch { return null; }
}
/** A string, or '' for anything else: `values.string` renders absence as "None", which must never become a name. */
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const normalized = (value: unknown) => text(value).normalize('NFKC').trim().toLowerCase();

/** One line of English that names what a row owes, for the capsule and the warning row. */
function describe(graph: ModuleGraph, effect: Row): string {
    if (effect.kind === 'move') {
        const scene = sceneOf(graph, effect.to);
        const where = scene ? `${graph.displayName(scene)} (${graph.handle(scene)})` : `a new place, ${text(effect.to)}`;
        return chars(`arrival at ${where}, via: ${text(effect.via)}`, 200);
    }
    if (effect.kind === 'time')
        return `time that passed beyond any journey: ${text(effect.band)}`;
    if (effect.kind === 'cash') return `${text(effect.subject)}: cash ${String(effect.delta)} ${text(effect.currency)}`;
    const person = personNode(graph, {}, text(effect.name));
    const who = person ? graph.displayName(person) : text(effect.name);
    return chars(effect.to === 'away' ? `${who} is gone from the scene` : `${who} is present at ${text(effect.to)}`, 200);
}

/**
 * The accepted report's owed entries and missing objects as rows (§158.3). `record` is the delivered turn the
 * review read; `world` is the campaign world now (it resolves table-established people and places).
 */
export async function projectOwed(kernel: KernelContext, graph: ModuleGraph, world: Row, record: Row, accepted: Row, job: string, taken: Iterable<string> = [], party: Row[] = []):
    Promise<{ rows: Row[]; dropped: Row[] }> {
    const rendered = text(record.rendered_text || ''), turn = number(record.turn), at = nowIso();
    const rows: Row[] = [], dropped: Row[] = [], used = new Set(taken);
    const nextName = () => {
        let index = 1;
        while (used.has(`t${turn}-owed-${index}`)) index++;
        const name = `t${turn}-owed-${index}`;
        used.add(name);
        return name;
    };
    const add = (kind: string, effect: Row | null, quote: string | null, what: string, extra: Row = {}) =>
        rows.push({ name: nextName(), turn, kind, effect, quote, what, ...extra, job, at });
    const entries = array(accepted.owed).map((entry, index) => ({ entry: row(entry), index }));
    // Moves first: a person "here" is where the prose put the party, so the told position must be known.
    entries.sort((a, b) => Number(a.entry.kind !== 'move') - Number(b.entry.kind !== 'move') || a.index - b.index);
    let told: string | null = null;
    const delivered = text(row(row(record.world).scene).name) || text(world.active_scene);
    const bands = entries.length ? await owedBands(kernel) : null;
    for (const { entry, index } of entries) {
        const kind = text(entry.kind), drop = (reason: string) => dropped.push({ index, kind, reason });
        // The review selected a sentence of the candidate, markers and say tokens included; the player read it without
        // them. The quote is that sentence as delivered, located in `rendered_text` (§158.3).
        const quote = locateExcerpt(rendered, typeof entry.quote === 'string' ? stripMarkers(entry.quote) : entry.quote);
        if (!quote) { drop('quote_not_delivered'); continue; }
        if (kind === 'move') {
            const minutes = bands!.travelMinutes.get(text(entry.travel)), via = chars(text(entry.via), 300);
            if (minutes === undefined) { drop('unknown_band'); continue; }
            const scene = sceneOf(graph, entry.to) ?? (typeof entry.to === 'string' && entry.to.trim() ? null : sceneOf(graph, entry.place));
            if (scene) {
                const effect = { kind: 'move', to: graph.handle(scene), via, travel_minutes: minutes };
                told = effect.to;
                add(kind, effect, quote, describe(graph, effect), { travel: entry.travel });
            }
            else if (typeof entry.to === 'string' && entry.to.trim()) drop('unknown_scene');
            else if (typeof entry.place === 'string' && entry.place.trim() && typeof entry.summary === 'string' && entry.summary.trim()) {
                const place = entry.place.trim();
                if (graph.find(place)) { drop('place_names_another_entity'); continue; }
                const effect = { kind: 'move', to: place, establish: { summary: chars(entry.summary, 700) }, via, travel_minutes: minutes };
                told = place;
                add(kind, effect, quote, describe(graph, effect), { travel: entry.travel });
            }
            else drop('unknown_scene');
        }
        else if (kind === 'time') {
            if (!bands!.time.includes(text(entry.band))) { drop('unknown_band'); continue; }
            const effect = { kind: 'time', band: text(entry.band) };
            add(kind, effect, quote, describe(graph, effect));
        }
        else if (kind === 'npc') {
            const person = typeof entry.person === 'string' && entry.person.trim() ? personNode(graph, world, entry.person.trim()) : null;
            if (!person || !OWED_PRESENCE.includes(text(entry.presence))) { drop(person ? 'unknown_presence' : 'unknown_person'); continue; }
            const effect = { kind: 'npc', name: graph.handle(person), to: entry.presence === 'away' ? 'away' : told ?? delivered };
            add(kind, effect, quote, describe(graph, effect));
        }
        else if (kind === 'object') {
            const owner = party.find(person => person.name === entry.owner || person.id === entry.owner);
            if (!owner || entry.category !== 'item' || !text(entry.name).trim() || !Number.isInteger(entry.quantity) || Number(entry.quantity) < 1 || Number(entry.quantity) > 10000) { drop('unresolved_object'); continue; }
            const name = text(entry.name).trim();
            const equipment = array(owner.equipment).filter(value => (typeof value === 'string' ? value : row(value).name) === name && !row(value).object_id);
            if (equipment.length > 1) { drop('ambiguous_equipment'); continue; }
            const effect = {kind:'object',name,definition:name,to:owner.name,...(equipment.length === 1 ? {adopt:name} : {quantity:entry.quantity})};
            add(kind,effect,quote,name,{object:{name,category:'item',owner:owner.name}, owner_id:owner.id});
        }
        else if (kind === 'cash') {
            const subject = party.find(person => person.name === entry.subject || person.id === entry.subject);
            if (!subject) { drop('unknown_subject'); continue; }
            if (!cashDecimal(entry.delta) || cashDecimal(entry.delta)!.coefficient === 0n || !text(entry.currency).trim()) { drop('invalid_cash'); continue; }
            const other = entry.with == null ? null : personNode(graph, world, text(entry.with));
            if (entry.with != null && !other) { drop('unknown_person'); continue; }
            const effect: Row = {kind:'cash',subject:subject.name,delta:entry.delta,currency:entry.currency,settlement:'cash',source:other ? 'quote' : 'found',
                ...(other ? {with:graph.handle(other)} : {})};
            add(kind,effect,quote,describe(graph,effect));
        }
        else drop('unknown_kind');
    }
    // §158.7: exact unmanaged equipment supplies the owner of a missing item.
    for (const missing of array(accepted.missing).map(row)) {
        const name = text(missing.name).trim();
        if (!name) continue;
        const matches = party.flatMap(owner => array(owner.equipment).filter(value => (typeof value === 'string' ? value : row(value).name) === name && !row(value).object_id).map(() => owner));
        const owner = matches.length === 1 && missing.category === 'item' ? matches[0] : null;
        // Sheet ownership is exact evidence, not a semantic inference from the reviewer's instruction.
        const effect = owner ? {kind:'object',name,definition:name,to:owner.name,adopt:name} : null;
        add('object',effect,null,chars(name,200),{object:{name,category:text(missing.category),...(owner?{owner:owner.name}: {})},
            ...(owner?{owner_id:owner.id,equipment_basis:true}: {})});
    }
    return { rows, dropped };
}

/** Two rows about the same thing: the later one is the told state (§158.3). Time never replaces time. */
function sameSubject(a: Row, b: Row): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'move') return true;
    if (a.kind === 'npc') return row(a.effect).name === row(b.effect).name;
    if (a.kind === 'object') return normalized(row(a.object).name) === normalized(row(b.object).name) && normalized(row(a.object).owner) === normalized(row(b.object).owner);
    return false;
}
export function mergeOwed(ledger: OwedLedger, rows: Row[], at: string): OwedLedger {
    let open = [...ledger.open];
    const closed = [...ledger.closed];
    for (const entry of rows) {
        if (open.some(existing => existing.name === entry.name)) continue;
        // A checked occurrence is a debt once, even if its review is replayed after landing.
        if (entry.kind === 'cash' && [...open, ...closed].some(existing => existing.kind === 'cash' && existing.turn === entry.turn
            && existing.quote === entry.quote && jsonDigest(existing.effect) === jsonDigest(entry.effect))) continue;
        const replaced = open.filter(existing => sameSubject(existing, entry));
        if (entry.kind === 'object' && replaced.some(existing => existing.effect || !entry.effect)) continue;
        open = open.filter(existing => !replaced.includes(existing));
        closed.push(...replaced.map(existing => ({ name: existing.name, turn: existing.turn, kind: existing.kind, how: 'superseded', by: entry.name, at })));
        open.push(entry);
    }
    while (open.length > OPEN_KEPT) {
        const oldest = open.shift()!;
        closed.push({ name: oldest.name, turn: oldest.turn, kind: oldest.kind, how: 'dropped', at });
    }
    return { open, closed };
}

/** The ledger already agrees with this row (§158.3): the row is closed, never shown. Time is never implied. */
export function owedSatisfied(graph: ModuleGraph, world: Row, entry: Row): boolean {
    const effect = row(entry.effect);
    if (entry.kind === 'move') {
        const scene = sceneOf(graph, effect.to);
        return !!scene && graph.handle(scene) === text(world.active_scene);
    }
    if (entry.kind === 'npc') {
        const presence = row(world.npc_presence), name = text(effect.name);
        if (effect.to === 'away') return !Object.hasOwn(presence, name);
        const scene = sceneOf(graph, effect.to);
        return !!scene && presence[name] === graph.handle(scene);
    }
    if (entry.kind === 'object') {
        try {
            const instance = findNamedObject(row(row(world.objects).instances), row(entry.object).name);
            return !!instance && !!entry.owner_id && row(instance.owner).id === entry.owner_id && row(instance.owner).kind === 'investigator';
        } catch { return false; }
    }
    return false;
}
/** Open rows the ledger still lacks; the rest move to `closed` as `satisfied`. */
export function closeSatisfied(graph: ModuleGraph, world: Row, ledger: OwedLedger, at: string): { ledger: OwedLedger; closed: Row[] } {
    const done = ledger.open.filter(entry => owedSatisfied(graph, world, entry));
    if (!done.length) return { ledger, closed: [] };
    const closed = done.map(entry => ({ name: entry.name, turn: entry.turn, kind: entry.kind, how: 'satisfied', at }));
    return { ledger: { open: ledger.open.filter(entry => !done.includes(entry)), closed: [...ledger.closed, ...closed] }, closed };
}
/** A rewind or a confluence is a new told position; every open row closes with its reason (§158.3). */
export async function closeAllOwed(context: KernelContext, campaign: string, how: 'rewound' | 'merged'): Promise<number> {
    const ledger = await readOwed(context, campaign);
    if (!ledger.open.length) return 0;
    const at = nowIso();
    await writeOwed(context, campaign, { open: [], closed: [...ledger.closed, ...ledger.open.map(entry => ({ name: entry.name, turn: entry.turn, kind: entry.kind, how, at }))] });
    return ledger.open.length;
}
/** Every name the ledger has ever used, so a second review of one turn never reuses a row's name. */
export function owedNames(ledger: OwedLedger): Set<string> {
    return new Set([...ledger.open, ...ledger.closed].map(entry => text(entry.name)).filter(Boolean));
}

/**
 * A fork at an earlier commit (§15 `table.branch`, or a fork naming `from.commit`) checks out that commit's own
 * ledger. The review of the fork turn itself writes after that turn's commit, so its rows are on the source line's
 * working record and not yet in the commit: they are the fork turn's told state, and they go with the line.
 */
export async function owedOfTurn(campaign: { readTurnRecord(turn: number): Promise<Row | null> }, turn: number): Promise<Row[]> {
    if (!(turn > 0)) return [];
    return array((await campaign.readTurnRecord(turn))?.owed).map(row).filter(entry => typeof entry.name === 'string' && entry.kind !== undefined);
}
export async function carryOwed(context: KernelContext, campaign: string, rows: Row[]): Promise<number> {
    if (!rows.length) return 0;
    const ledger = await readOwed(context, campaign), known = owedNames(ledger), carried = rows.filter(entry => !known.has(text(entry.name)));
    if (!carried.length) return 0;
    await writeOwed(context, campaign, mergeOwed(ledger, carried, nowIso()));
    return carried.length;
}

/**
 * The capsule's `owed` section (§158.4): what the player was told and the ledger still lacks, newest told first
 * within each kind's order (move, npc, time, cash, object). `clerk` requires a resolvable effect.
 */
export function capsuleOwed(graph: ModuleGraph, world: Row, stored: unknown, party: readonly Row[] = []): Row[] {
    const order = ['move', 'npc', 'time', 'cash', 'object'];
    return resolveOwedEquipment(owedLedger(stored),party).open.filter(entry => !owedSatisfied(graph, world, entry))
        .sort((a, b) => order.indexOf(text(a.kind)) - order.indexOf(text(b.kind)) || number(b.turn) - number(a.turn))
        .map(entry => {
            let known = false, ambiguous = false;
            if (entry.kind === 'object') {
                try { known = !!findNamedObject(row(row(world.objects).definitions),row(entry.effect).definition); } catch { ambiguous = true; }
            }
            return { name: entry.name, turn: entry.turn, kind: entry.kind, what: entry.what, quote: entry.quote ?? null,
            ...(entry.effect ? { effect: entry.effect } : {}),
            ...(entry.kind === 'object' && entry.effect && !queuedDefinition(world,row(entry.effect).definition)
                && !known && !ambiguous
                ? {prepare:{kind:'define',name:row(entry.effect).definition,category:'item',description:entry.quote || text(row(entry.object).name)}} : {}),
            clerk: !!entry.effect && !ambiguous && !(entry.kind === 'object' && queuedDefinition(world,row(entry.effect).definition)?.adopt) }; });
}
