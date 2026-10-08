/**
 * Contract §204.4: a place the Keeper establishes binds to the book's mention.
 *
 * The book names places its graph does not hold yet (Cold Harvest p21 §6.2: Galena's house, where her body lies, "on the
 * farm's main road"). Reading is windowed and runs behind the table, so a reader rule could not have written that house by
 * the turn the player named it; the Keeper's `establish` is the one moment the system knows the place is needed. After a
 * mint lands, the host asks the book in the background through the source reference read and calls `table.place.bind`
 * with the pages of the excerpts it returned and their words. The binding is the campaign's own file, not `world.json`, for
 * §168.5's reason (a `world.json` write while a turn is open stales that turn's world). On load the bound place cites those
 * pages (`source_refs`), so the brief's window anchors there, and the capsule's `where.book` carries the book's words.
 */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { writeJsonAtomic } from '../fileio.js';
import { withExclusiveLock } from '../locks.js';
import type { ModuleGraph } from './module-graph.js';
import { array, chars, clone, entries, integer, number, row, string, type Row } from './values.js';
import { nowIso } from '../write/store.js';

export const PLACE_BINDINGS_FILE = 'place-bindings.json';
/** The most pages one binding cites, and the most characters of the book's words it keeps (§204.4). */
export const BOUND_PAGES = 4;
export const BOUND_EXCERPT_CHARS = 1200;

const bindingsPath = (context: KernelContext, campaign: string): string => join(context.campaignsRoot, campaign, PLACE_BINDINGS_FILE);

/** The campaign's bindings, `{version, places: {<table entity id>: {place, pages, excerpt, at}}}`; empty when none was written. */
export async function readPlaceBindings(context: KernelContext, campaign: string): Promise<Row> {
    const path = bindingsPath(context, campaign);
    if (!await context.snapshots.pathExists(path)) return { version: 1, places: {} };
    const stored = row(clone(await context.snapshots.readJson(path)));
    return { version: 1, places: row(stored.places) };
}

/** On load: each bound place this graph has cites its pages and carries the book's words (`node.book`). */
export function installPlaceBindings(graph: ModuleGraph, bindings: Row): void {
    for (const [id, value] of entries(row(bindings.places))) {
        const node = graph.nodes.get(id), binding = row(value);
        if (!node || !graph.isTableEntity(node)) continue;
        const pages = array(binding.pages).filter(page => integer(page) && number(page) >= 1).map(number);
        if (!pages.length) continue;
        node.source_refs = pages.map(page => ({ source_id: `pdf:${graph.moduleId}`, pdf_index: page - 1 }));
        node.book = { pages, ...(typeof binding.excerpt === 'string' && binding.excerpt ? { excerpt: binding.excerpt } : {}) };
    }
}

/**
 * `table.place.bind {campaign, place, pages, excerpt}`: `place` names a place this table established; `pages` are 1..4 page
 * numbers of the book (1-based, within its page count when known); `excerpt` the book's words on them, kept to 1,200
 * characters. The first binding stands. Answers `{bound: true, place, pages}` or `{bound: false, reason}`.
 */
export async function bindPlace(context: KernelContext, campaign: string, graph: ModuleGraph, pageCount: number | null, params: Row): Promise<Row> {
    if (Object.keys(params).some(key => !['campaign', 'place', 'pages', 'excerpt'].includes(key)))
        throw new RpcError('invalid_params', 'table.place.bind takes campaign, place, pages and excerpt');
    const pages = array(params.pages);
    if (typeof params.place !== 'string' || !params.place.trim() || !pages.length || pages.length > BOUND_PAGES
        || pages.some(page => !integer(page) || number(page) < 1 || (pageCount !== null && number(page) > pageCount))
        || (params.excerpt !== undefined && typeof params.excerpt !== 'string'))
        throw new RpcError('invalid_params', `place is a name; pages are 1 to ${BOUND_PAGES} page numbers of the book; excerpt is text`);
    const node = graph.find(params.place.trim(), ['scene']);
    if (!node || !graph.isTableEntity(node)) return { bound: false, reason: 'not_a_table_place', place: params.place };
    return withExclusiveLock(context.locks, bindingsPath(context, campaign) + '.lock', async () => {
        const ledger = await readPlaceBindings(context, campaign), places = row(ledger.places), id = string(node.node_id);
        if (places[id]) return { bound: false, reason: 'already_bound', place: graph.handle(node), pages: array(row(places[id]).pages) };
        const kept = [...new Set(pages.map(number))];
        places[id] = { place: graph.handle(node), pages: kept, ...(typeof params.excerpt === 'string' && params.excerpt.trim() ? { excerpt: chars(params.excerpt.trim(), BOUND_EXCERPT_CHARS) } : {}), at: nowIso() };
        await writeJsonAtomic(bindingsPath(context, campaign), { version: 1, places });
        return { bound: true, place: graph.handle(node), pages: kept };
    });
}
