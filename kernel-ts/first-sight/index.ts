/**
 * Contract §168.5: first sight is an obligation with its material (docs/specs/first-sight.md 2.4).
 *
 * Blood Road's first three turns told a new player neither the station nor the three men under its awning, although
 * the book describes both and the capsule carried the description (owner ruling 2026-10-02: what the book describes
 * must be shown, never cut short). A place the party stands in, or a book person present whom the player may see, is
 * owed until a delivery has shown it. The capsule's `first_sight` section carries the book's own words for each one;
 * after a delivery the host's check lane names what the prose left out, and `table.first_sight` records it here.
 *
 * Nothing here reads prose. The check is the fast model's; the kernel keeps the ledger, checks shapes and graph
 * references, and keeps only excerpts that are the book's own words for that item.
 *
 * The ledger is its own campaign file, for the reasons `owed.json` is (§158.3): the check writes after the turn it
 * read has closed, usually while the next turn is open, and a `world.json` write there would stale that turn's world
 * revision. It is committed with the next turn's commit and carried by a fork (`firstSightOfTurn` /
 * `carryFirstSight`).
 */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { jsonSize, npcsPresent, sceneLabel } from '../read/capsule.js';
import { locateExcerpt } from '../read/excerpt.js';
import { array, chars, clone, length, number, repr, row, type Row } from '../read/values.js';
import { writeJsonAtomic } from '../fileio.js';

export const FIRST_SIGHT_FILE = 'first-sight.json';
/** The section's own budget (§168.5): nothing else's budget cuts it. A book's descriptions of a place and three
 *  people in Chinese run past 4096 bytes before JSON, and a description cut short is what the owner ruled out. */
export const FIRST_SIGHT_BUDGET = 8192;
export const FIRST_SIGHT_KINDS: readonly string[] = Object.freeze(['place', 'person']);
/** At most this many items in one `table.first_sight` call, and excerpts per item. */
export const FIRST_SIGHT_ITEMS_MAX = 32, FIRST_SIGHT_MISSING_MAX = 24;
/** An excerpt longer than this is no single detail. */
export const FIRST_SIGHT_EXCERPT_CHARS = 800;
/** Open rows kept; the oldest give way past it. */
const OPEN_KEPT = 64;
/** A cut description keeps at least this many characters. */
const DESCRIBED_FLOOR = 40;

export interface FirstSightLedger { shown: { places: string[]; people: string[] }; open: Row[] }
/** One checked item as the kernel keeps it: its graph handle and the book's words the prose did not show. */
export interface FirstSightResult { kind: string; id: string; missing: string[] }

/** A string, or '' for anything else (`values.string` renders absence as "None"). */
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const shelf = (kind: string): 'places' | 'people' => kind === 'place' ? 'places' : 'people';

export function firstSightLedger(value: unknown): FirstSightLedger {
    const stored = row(value), shown = row(stored.shown);
    const handles = (list: unknown): string[] => [...new Set(array(list).filter((item): item is string => typeof item === 'string' && item !== ''))];
    return {
        shown: { places: handles(shown.places), people: handles(shown.people) },
        open: array(stored.open).map(row).filter(entry => FIRST_SIGHT_KINDS.includes(text(entry.kind)) && text(entry.id) !== ''
            && array(entry.missing).some(item => typeof item === 'string' && item !== ''))
    };
}
function ledgerPath(context: KernelContext, campaign: string): string {
    return join(context.campaignsRoot, campaign, FIRST_SIGHT_FILE);
}
export async function readFirstSight(context: KernelContext, campaign: string): Promise<FirstSightLedger> {
    const path = ledgerPath(context, campaign);
    if (!await context.snapshots.pathExists(path))
        return firstSightLedger({});
    return firstSightLedger(clone(await context.snapshots.readJson(path)));
}
export async function writeFirstSight(context: KernelContext, campaign: string, ledger: FirstSightLedger): Promise<void> {
    await writeJsonAtomic(ledgerPath(context, campaign), { shown: ledger.shown, open: ledger.open });
}

/**
 * The book's own words for a node: the named property, else the node's summary. A summary that only repeats the
 * node's own name describes nothing (the Haunting's scenes are summarised as "scene basement rites"), so it is none.
 */
function bookWords(graph: ModuleGraph, node: Row, property: string, summary = true): string | null {
    const own = text(row(node.properties)[property]).trim() || (summary ? text(node.summary).trim() : '');
    if (!own) return null;
    const names = [text(node.name), graph.displayName(node), graph.handle(node), text(node.node_id)].map(name => name.trim());
    return names.includes(own) ? null : own;
}
/** What the book describes of a place (§168.5): `properties.description`, else the scene's summary. */
export const placeDescribed = (graph: ModuleGraph, scene: Row): string | null => bookWords(graph, scene, 'description');
/**
 * What the book describes of a person: §199.4's first-meeting `properties.appearance` when the reader wrote one, else
 * `properties.biography`, else the summary (§168.5, unchanged for a book read before §199).
 */
export const personDescribed = (graph: ModuleGraph, node: Row): string | null =>
    bookWords(graph, node, 'appearance', false) ?? bookWords(graph, node, 'biography');
/**
 * §199.4 (amends §194.4): what the epithet lane reads of a graph person -- their first-meeting `properties.appearance` only.
 * Never the summary, the Keeper's account of them (TR-F: the victim became "the creature that mutated two families"), and
 * never the biography, which carries what the book reveals later (TR-F2: Maria's tentacles and infection became her word).
 */
export const personAppearance = (graph: ModuleGraph, node: Row): string | null => bookWords(graph, node, 'appearance', false);
/** A book person the player may see on arrival: an `npc` node the book marks `player-safe` (§180.3: never a creature). */
export const seenPerson = (node: Row): boolean => node.node_kind === 'npc' && node.visibility === 'player-safe';

/**
 * The capsule's `first_sight` section, or null when nothing is owed: the active scene while it is not shown, and each
 * book person present whom the player may see and has not been shown. An item with an open row carries what the last
 * check found unshown (`missing`) instead of the whole description.
 */
export function firstSightSection(graph: ModuleGraph, world: Row, scene: Row, stored: unknown): Row | null {
    const ledger = firstSightLedger(stored);
    const item = (kind: string, node: Row, name: string, described: string): Row => {
        const id = graph.handle(node), open = ledger.open.find(entry => entry.kind === kind && entry.id === id);
        return open ? { id, name, missing: array(open.missing).filter(value => typeof value === 'string' && value !== '') } : { id, name, described };
    };
    const section: Row = {}, place = placeDescribed(graph, scene);
    if (place && !ledger.shown.places.includes(graph.handle(scene)))
        section.place = item('place', scene, sceneLabel(graph, world, scene), place);
    const people = npcsPresent(graph, world, scene)
        .filter(node => seenPerson(node) && !ledger.shown.people.includes(graph.handle(node)))
        .flatMap(node => {
            const described = personDescribed(graph, node);
            return described ? [item('person', node, graph.displayName(node), described)] : [];
        });
    if (people.length) section.people = people;
    return Object.keys(section).length ? section : null;
}

/**
 * Fit the section to its budget without losing anyone: the largest item gives up a fifth of its description (or its
 * last excerpt) at a time down to a floor, then the last items keep only their names. Every cut item says `truncated`.
 */
export function fitFirstSight(section: Row, budget = FIRST_SIGHT_BUDGET): boolean {
    const items: Row[] = [...(isJsonObject(section.place) ? [section.place as Row] : []), ...array(section.people).map(row)];
    let cut = false;
    while (jsonSize(section) > budget) {
        const shrinkable = items.filter(entry => typeof entry.described === 'string' && length(entry.described) > DESCRIBED_FLOOR
            || array(entry.missing).length > 1).sort((a, b) => jsonSize(b) - jsonSize(a));
        const largest = shrinkable[0];
        if (largest) {
            if (typeof largest.described === 'string' && length(largest.described) > DESCRIBED_FLOOR)
                largest.described = chars(largest.described, Math.max(DESCRIBED_FLOOR, Math.floor(length(largest.described) * 0.8)));
            else (largest.missing as unknown[]).pop();
            largest.truncated = true;
        }
        else {
            const stub = [...items].reverse().find(entry => entry.described !== undefined || entry.missing !== undefined);
            if (!stub) break;
            delete stub.described;
            delete stub.missing;
            stub.truncated = true;
        }
        cut = true;
    }
    return cut;
}

/** The book's words an item is checked against, by its handle; a reference that names no such item is refused. */
function bookItem(graph: ModuleGraph, kind: string, id: string, index: number): { id: string; book: string } {
    const refuse = () => {
        throw new RpcError('invalid_params', `items[${index}].id ${repr(id)} is no ${kind === 'place' ? 'scene' : 'person'} of this campaign's graph`, {
            fix: 'send the id exactly as the capsule\'s first_sight section gives it', details: { index, kind, id } });
    };
    if (kind === 'place') {
        let scene: Row;
        try { scene = graph.scene(id); }
        catch { return refuse(); }
        return { id: graph.handle(scene), book: placeDescribed(graph, scene) ?? '' };
    }
    const node = graph.find(id, ['npc']);
    if (!node) return refuse();
    return { id: graph.handle(node), book: personDescribed(graph, node) ?? '' };
}

/**
 * `table.first_sight`'s items, checked: closed shapes, graph references, and every excerpt located in that item's own
 * book words (§139's quotation-mark class; the book's own span is kept). An excerpt that is not there is dropped; an
 * item whose every excerpt was dropped is not recorded at all, so a check that could not quote leaves the item owed
 * as it was rather than calling it shown.
 */
export function checkFirstSightItems(graph: ModuleGraph, items: unknown): { results: FirstSightResult[]; dropped: Row[] } {
    if (!Array.isArray(items) || !items.length || items.length > FIRST_SIGHT_ITEMS_MAX)
        throw new RpcError('invalid_params', `params.items must be a list of 1 to ${FIRST_SIGHT_ITEMS_MAX} checked items`,
            { fix: 'send {id, kind, missing} for each item the check answered' });
    const results: FirstSightResult[] = [], dropped: Row[] = [], seen = new Set<string>();
    for (const [index, entry] of items.entries()) {
        if (!isJsonObject(entry))
            throw new RpcError('invalid_params', `items[${index}] must be an object`, { details: { index } });
        const kind = entry.kind, id = entry.id, missing = entry.missing;
        if (!FIRST_SIGHT_KINDS.includes(kind as string))
            throw new RpcError('invalid_params', `items[${index}].kind ${repr(kind)} is not place or person`, { details: { index } });
        if (typeof id !== 'string' || !id.trim())
            throw new RpcError('invalid_params', `items[${index}].id must be the item's handle`, { details: { index } });
        if (!Array.isArray(missing) || missing.length > FIRST_SIGHT_MISSING_MAX
            || missing.some(value => typeof value !== 'string' || !value.trim() || length(value) > FIRST_SIGHT_EXCERPT_CHARS))
            throw new RpcError('invalid_params', `items[${index}].missing must be a list of at most ${FIRST_SIGHT_MISSING_MAX} excerpts of the book`,
                { fix: 'send [] for an item the prose showed, else the excerpts of its described text it did not show', details: { index } });
        const target = bookItem(graph, kind as string, id.trim(), index), key = `${String(kind)}:${target.id}`;
        if (seen.has(key)) {
            dropped.push({ index, kind, id: target.id, reason: 'duplicate_item' });
            continue;
        }
        seen.add(key);
        const kept = [...new Set((missing as string[]).flatMap(excerpt => {
            const located = locateExcerpt(target.book, excerpt);
            return located ? [located] : [];
        }))];
        if (missing.length && !kept.length) {
            dropped.push({ index, kind, id: target.id, reason: 'missing_not_in_book' });
            continue;
        }
        if (kept.length < missing.length)
            dropped.push({ index, kind, id: target.id, reason: 'excerpt_not_in_book', excerpts: missing.length - kept.length });
        results.push({ kind: kind as string, id: target.id, missing: kept });
    }
    return { results, dropped };
}

/**
 * Land checked results on the ledger: an item with nothing missing is shown for good; any other becomes, or replaces,
 * its open row. An older check never replaces a newer open row. The oldest open rows give way past the cap.
 */
export function applyFirstSight(ledger: FirstSightLedger, turn: number, results: readonly FirstSightResult[], at: string): FirstSightLedger {
    const shown = { places: [...ledger.shown.places], people: [...ledger.shown.people] };
    let open = [...ledger.open];
    for (const result of results) {
        const same = (entry: Row) => entry.kind === result.kind && entry.id === result.id;
        if (!result.missing.length) {
            if (!shown[shelf(result.kind)].includes(result.id)) shown[shelf(result.kind)].push(result.id);
            open = open.filter(entry => !same(entry));
            continue;
        }
        if (shown[shelf(result.kind)].includes(result.id) || open.some(entry => same(entry) && number(entry.turn) > turn)) continue;
        // Owed once: an item with an open row from an earlier turn was carried as owed this turn, and this check closes it
        // whatever it still finds. On the installed App's Blood Road table (2026-10-02) a veteran's row shrank by a detail or
        // two a turn -- 8, 4, 3, 2, 1 -- and each turn the Keeper wrote him out again from his hair to his tattoos.
        if (open.some(entry => same(entry) && number(entry.turn) < turn)) {
            if (!shown[shelf(result.kind)].includes(result.id)) shown[shelf(result.kind)].push(result.id);
            open = open.filter(entry => !same(entry));
            continue;
        }
        open = [...open.filter(entry => !same(entry)), { kind: result.kind, id: result.id, missing: [...result.missing], turn, at }];
    }
    return { shown, open: open.slice(-OPEN_KEPT) };
}

/** What a delivered turn's checks recorded, for its own record: one row per item, the latest call's answer kept. */
export function turnFirstSight(previous: unknown, results: readonly FirstSightResult[], at: string): Row[] {
    const rows = array(previous).map(row).filter(entry => !results.some(result => result.kind === entry.kind && result.id === entry.id));
    return [...rows, ...results.map(result => ({ kind: result.kind, id: result.id, missing: [...result.missing], at }))];
}

/**
 * A fork at an earlier commit checks out that commit's ledger. The check of the fork turn itself wrote after that
 * turn's commit, so its results are on the source line's working record and not yet in the commit: they go with the
 * line, read before leaving it (as §158.3's `owedOfTurn` / `carryOwed`).
 */
export async function firstSightOfTurn(campaign: { readTurnRecord(turn: number): Promise<Row | null> }, turn: number): Promise<FirstSightResult[]> {
    if (!(turn >= 0)) return [];
    return array((await campaign.readTurnRecord(turn))?.first_sight).map(row)
        .filter(entry => FIRST_SIGHT_KINDS.includes(text(entry.kind)) && text(entry.id) !== '')
        .map(entry => ({ kind: text(entry.kind), id: text(entry.id), missing: array(entry.missing).filter((value): value is string => typeof value === 'string' && value !== '') }));
}
export async function carryFirstSight(context: KernelContext, campaign: string, turn: number, results: FirstSightResult[], at: string): Promise<number> {
    if (!results.length) return 0;
    await writeFirstSight(context, campaign, applyFirstSight(await readFirstSight(context, campaign), turn, results, at));
    return results.length;
}
