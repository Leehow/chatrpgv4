/**
 * Contract §185 (owner ruling 2026-10-06, docs/specs/name-free-handles.md): name-free handles.
 *
 * A reader-built book mints node ids from the book's words, and `handle()` used to strip the kind prefix, so a handle was a
 * name as a slug (`book-4-robert-taylor`). §176.5 hid it with a request-wide text substitution, which also rewrote the
 * identifiers the Keeper copies back. A new campaign on a reader-built book is `name-free` instead (`campaign.json.handles`):
 * - the handle lane writes a descriptive handle per node into the book's `handles.json` in the shared library, first writer
 *   wins, checked against the book's own cast (`handles.submit`);
 * - the campaign takes those handles into `world.node_handles` at a safe moment (`foldNodeHandles`), and an entry never
 *   changes once written;
 * - a node not folded yet shows its interim handle (`interimHandle`), which needs no write and stays resolvable.
 * A campaign on an authored starter pack, and every campaign without the field, is `legacy` and keeps the slug handles.
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { writeJsonAtomic } from '../fileio.js';
import { parsePythonJson } from '../json.js';
import { withOptionalExclusiveLock } from '../locks.js';
import { namePieces, occurs } from '../journal/naming.js';
import { scopedModuleRoot } from '../modules/campaign-scope.js';
import { bookCast } from './cast.js';
import type { ModuleGraph, NodeHandles } from './module-graph.js';
import { array, chars, entries, normalize, repr, row, words, type Row } from './values.js';
import { nowIso } from '../write/store.js';

/** A string field, or '' when absent: `values.string` renders absence as "None". */
const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** The book's handle file in its module directory (§185.5). */
export const HANDLES_FILE = 'handles.json';
/** The nodes one `handles.job` asks for; the next job asks for the rest. */
export const HANDLES_PER_JOB = 32;
/** The longest handle `handles.submit` accepts, in characters. */
export const HANDLE_LIMIT = 48;
/** Where a node's summary is cut in the job. */
export const HANDLE_SUMMARY_LIMIT = 240;
/** §185.5's shape: lowercase ASCII kebab-case. Identifier syntax, not a judgment of meaning. */
const HANDLE_SHAPE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const INTERIM_SHAPE = /^(.+)-[0-9a-f]{6}$/;

export type HandleScheme = 'name-free' | 'legacy';
/** §185.1: a campaign's scheme; absent (every campaign created before §185) is legacy. */
export const handleScheme = (meta: Row): HandleScheme => meta.handles === 'name-free' ? 'name-free' : 'legacy';

/** `world.node_handles` as a map; entries that are not strings are not handles. */
export function nodeHandleMap(world: Row): Map<string, string> {
    return new Map(entries(row(world.node_handles)).flatMap(([id, handle]) => typeof handle === 'string' && handle ? [[id, handle] as [string, string]] : []));
}

/**
 * §185.4: the map a campaign's graph is built with -- its `world.node_handles` when the campaign is name-free, null when it is
 * legacy or has no `campaign.json` yet. `world` is the caller's (a transaction may hold one newer than the disk's); without it
 * the saved world is read.
 */
export async function campaignNodeHandles(context: KernelContext, campaign: string, world?: Row): Promise<NodeHandles | null> {
    const directory = join(context.campaignsRoot, campaign), meta = join(directory, 'campaign.json');
    if (!await context.snapshots.isFile(meta) || handleScheme(row(await context.snapshots.readJson(meta))) !== 'name-free')
        return null;
    if (world === undefined)
        world = await context.snapshots.isFile(join(directory, 'world.json')) ? row(await context.snapshots.readJson(join(directory, 'world.json'))) : {};
    return nodeHandleMap(world);
}

/**
 * Where the book's `handles.json` lives: the shared library's module directory, so every campaign on the book reuses what the
 * lane wrote (§185.5, the §184 traffic ruling). A module that exists in a campaign's scope alone keeps it there.
 */
export async function handlesDirectory(context: KernelContext, campaign: string, moduleId: string): Promise<string> {
    const library = join(context.stateRoot, 'modules', moduleId);
    if (await context.snapshots.pathExists(join(library, 'module.json')))
        return library;
    return join(await scopedModuleRoot(context, campaign, moduleId) ?? join(context.stateRoot, 'modules'), moduleId);
}

/** The book's `handles.json`: `{nodes: {<node_id>: {handle, at} | {given_up: true, at}}}`; empty when absent or unreadable. */
export async function readHandles(context: KernelContext, directory: string): Promise<Row> {
    const path = join(directory, HANDLES_FILE);
    try {
        return await context.snapshots.pathExists(path) ? { nodes: { ...row(row(await context.snapshots.readJson(path)).nodes) } } : { nodes: {} };
    }
    catch {
        return { nodes: {} };
    }
}

/** The nodes of the served graph the book has, in the graph's order (never a table's or an adaptation's). */
export function bookNodes(graph: ModuleGraph): Row[] {
    return array(graph.raw.nodes).filter(node => graph.isBookNode(node));
}

/** §185.5's `avoid`: every form of every cast person, told or untold (book, play and notes renderings), with their pieces. */
export function castForms(graph: ModuleGraph): string[] {
    return namePieces(bookCast(graph).flatMap(person => person.names));
}

const storedHandle = (entry: unknown): string => text(row(entry).handle);

/** §185.6.1: one node a fold mapped -- from the interim handle it showed until then to its final handle. */
export interface HandleMove { node_id: string; from: string; to: string }

/**
 * §185.6: take the book's handles into `world.node_handles` for every book node of the served graph not mapped yet:
 * - a handle `handles.json` holds that is free here (no table name, adaptation name or other mapped handle has its
 *   normalized form): that handle;
 * - a node given up, or whose handle is not free here: `<kind>-<n>`, the next ordinal of its kind nothing here answers to;
 * - otherwise nothing: the node keeps its interim handle until a later fold.
 * Returns the moves (none when the world is unchanged); the caller rewrites the campaign's stored references (§185.6.1),
 * writes the world and reloads the graph, whose handles it built with the old map.
 */
export function foldNodeHandles(graph: ModuleGraph, world: Row, stored: Row): HandleMove[] {
    if (!graph.nameFree) return [];
    const map: Row = { ...row(world.node_handles) }, settled = row(stored.nodes);
    const used = new Set([...graph.tableNames.values(), ...graph.tableEntityNames.values(), ...graph.tableCreatureNames.values(),
        ...graph.semanticNames.values(), ...Object.values(map).map(text)].map(normalize).filter(Boolean));
    const ordinal = (kind: string): string => {
        for (let n = 1; ; n++) {
            const candidate = `${kind || 'node'}-${n}`, key = normalize(candidate);
            if (!used.has(key) && !graph.names.has(key)) return candidate;
        }
    };
    const moves: HandleMove[] = [];
    for (const node of bookNodes(graph)) {
        const id = String(node.node_id);
        if (Object.hasOwn(map, id) || !Object.hasOwn(settled, id)) continue;
        const entry = row(settled[id]), handle = storedHandle(entry);
        if (!handle && entry.given_up !== true) continue;
        const value = handle && !used.has(normalize(handle)) ? handle : ordinal(graph.bookKind(node));
        map[id] = value;
        used.add(normalize(value));
        moves.push({ node_id: id, from: graph.interimHandle(node), to: value });
    }
    if (moves.length) world.node_handles = map;
    return moves;
}

/**
 * §185.6.1: in place, every object key and every string value exactly equal to a moved interim handle becomes the final one.
 * Never a substring: a composite string (`clue:<interim>-t3`, `intent:<interim>:<digest>`) stays, and resolves through the
 * interim handle, an input key forever. A key whose final form is already present keeps that entry, written under the
 * current handle. Key order is kept. Returns whether anything changed.
 */
export function rewriteHandles(value: unknown, moves: ReadonlyMap<string, string>): boolean {
    if (Array.isArray(value)) {
        let changed = false;
        for (let index = 0; index < value.length; index++) {
            const item = value[index];
            if (typeof item === 'string' && moves.has(item)) { value[index] = moves.get(item)!; changed = true; }
            else if (rewriteHandles(item, moves)) changed = true;
        }
        return changed;
    }
    if (!value || typeof value !== 'object') return false;
    const object = value as Row;
    let changed = false;
    for (const key of Object.keys(object)) {
        const item = object[key];
        if (typeof item === 'string' && moves.has(item)) { object[key] = moves.get(item)!; changed = true; }
        else if (rewriteHandles(item, moves)) changed = true;
    }
    if (Object.keys(object).some(key => moves.has(key))) {
        const kept = Object.entries(object);
        for (const key of Object.keys(object)) delete object[key];
        for (const [key, item] of kept) {
            const renamed = moves.get(key);
            if (renamed === undefined) object[key] = item;
            else if (!kept.some(([other]) => other === renamed)) object[renamed] = item;
        }
        changed = true;
    }
    return changed;
}

/**
 * §185.6.1: the campaign's mutable state files a fold rewrites, found by walking its directory: every `.json` file but the
 * append-only history and the lanes' job packets. Not rewritten: `turns/` (the turn records), `memory/`, any `jobs/`
 * folder (a lane's request and answer, echoed back by id), dot-entries (the narrate journal, git), every `.jsonl` log
 * (transcript, events, telemetry, notes, rulings), and the names in `skip` the caller holds in memory and writes itself.
 */
export async function rewriteCampaignFiles(directory: string, moves: ReadonlyMap<string, string>, skip: ReadonlySet<string> = new Set()): Promise<Map<string, Row>> {
    const rewritten = new Map<string, Row>();
    const walk = async (relative: string): Promise<void> => {
        let names: Dirent[];
        try { names = await readdir(join(directory, relative), { withFileTypes: true }); }
        catch { return; }
        for (const entry of names) {
            const path = relative ? join(relative, entry.name) : entry.name;
            if (entry.name.startsWith('.') || skip.has(path)) continue;
            if (entry.isDirectory()) {
                if (HISTORY_FOLDERS.has(entry.name) && (!relative || entry.name === 'jobs')) continue;
                await walk(path);
            }
            else if (entry.isFile() && entry.name.endsWith('.json')) {
                let value: unknown;
                try { value = parsePythonJson(await readFile(join(directory, path), 'utf8')); }
                catch { continue; }
                if (rewriteHandles(value, moves)) {
                    await writeJsonAtomic(join(directory, path), value as Row);
                    rewritten.set(path, value as Row);
                }
            }
        }
    };
    await walk('');
    return rewritten;
}
/** Folders whose files are history (top level: `turns`, `memory`) or lane job packets (`jobs`, at any depth). */
const HISTORY_FOLDERS: ReadonlySet<string> = new Set(['turns', 'memory', 'jobs']);

/** The lane's instruction (§185.5), in the system language. */
export function handleInstruction(): string {
    return [
        'Give each node below a handle: the short English phrase the game will use to refer to this thing.',
        `Write it in lowercase ASCII kebab-case (letters and digits, words joined by single hyphens, starting with a letter), at most ${HANDLE_LIMIT} characters.`,
        'Say what the thing is, from its kind, name and summary: \'bar-owner-pencil-mustache\', \'book-hidden-under-gift-shop-counter\'.',
        'Never spell a name, a nickname or any part of a name of anyone, in any spelling, translation or transliteration: none of the forms listed under avoid.',
        'Never a handle listed under taken, never one you give another node here, and never a kind followed by six hex digits.',
    ].join(' ');
}

/**
 * §185.5 (NFH-03): the book's nodes nearest the table first, so the first job names what the Keeper is shown first. From
 * each scene in `seeds` (the active scene, or the opening a book offers): the scene, the people standing there (`present`,
 * world state, then the graph's `present-in`), the clues discoverable at it, what it depicts or holds, the places it occurs
 * at; then each scene routed from a seed, and the people there; then every other book node in the graph's order. Graph
 * relations and world state only: nothing is judged by what it says.
 */
export function nearTableFirst(graph: ModuleGraph, seeds: readonly Row[], present: (scene: Row) => readonly Row[] = () => []): Row[] {
    const order: Row[] = [], seen = new Set<string>();
    const add = (node: Row | null | undefined): void => {
        const id = node ? String(node.node_id) : '';
        if (!node || seen.has(id) || !graph.isBookNode(node)) return;
        seen.add(id);
        order.push(node);
    };
    const people = (scene: Row): void => {
        for (const node of present(scene)) add(node);
        for (const id of graph.sceneNpcIds(scene)) add(graph.nodes.get(id));
    };
    const exits: Row[] = [];
    for (const scene of seeds) {
        add(scene);
        people(scene);
        for (const id of graph.sceneClueIds(scene)) add(graph.nodes.get(id));
        for (const node of graph.sceneAssetNodes(scene)) add(node);
        for (const id of graph.placesOutward(scene).slice(1)) add(graph.nodes.get(id));
        for (const exit of graph.sceneExits(scene)) {
            const next = graph.sceneByHandle(String(exit.to));
            if (next) exits.push(next);
        }
    }
    for (const scene of exits) add(scene);
    for (const scene of exits) people(scene);
    for (const node of bookNodes(graph)) add(node);
    return order;
}

/**
 * `handles.job`'s packet (§185.5): up to HANDLES_PER_JOB book nodes `handles.json` neither names nor gave up, in `order`
 * (`nearTableFirst`), or the graph's order when the caller has none.
 */
export function handlesJob(campaign: string, graph: ModuleGraph, stored: Row, order: readonly Row[] = bookNodes(graph)): Row {
    const settled = row(stored.nodes);
    // §192.3: a node another stands for is named by that node; its own id and interim handle stay input keys, never asked.
    const wanting = order.filter(node => !Object.hasOwn(settled, String(node.node_id)) && !graph.isVariant(node));
    if (!wanting.length) return { job_id: null };
    const nodes = wanting.slice(0, HANDLES_PER_JOB).map(node => ({ id: String(node.node_id), kind: graph.bookKind(node), name: text(node.name),
        summary: chars(words(text(node.summary)), HANDLE_SUMMARY_LIMIT) }));
    const job_id = `handles:${campaign}:${createHash('sha256').update(nodes.map(node => node.id).join('\n')).digest('hex').slice(0, 12)}`;
    return { job_id, nodes, avoid: castForms(graph), taken: [...new Set(Object.values(settled).map(storedHandle).filter(Boolean))], instruction: handleInstruction() };
}

interface Refusal { reason: string; message: string }

/** Why `handle` cannot be node `id`'s (§185.5), or null; the reasons are the contract's closed set, in its order. */
function handleRefusal(graph: ModuleGraph, id: string, handle: unknown, settled: Row, forms: readonly string[], kinds: ReadonlySet<string>, batch: ReadonlySet<string>): Refusal | null {
    const node = graph.nodes.get(id);
    if (!node || !graph.isBookNode(node))
        return { reason: 'unknown_entity', message: `${repr(id)} is no node of this campaign's book graph` };
    if (Object.hasOwn(settled, id))
        return { reason: 'settled', message: `${repr(id)} already has a handle or was given up` };
    if (typeof handle !== 'string' || handle.length > HANDLE_LIMIT || !HANDLE_SHAPE.test(handle))
        return { reason: 'shape', message: `a handle is lowercase ASCII kebab-case (letters and digits joined by single hyphens, starting with a letter) of at most ${HANDLE_LIMIT} characters` };
    const key = normalize(handle);
    const carried = forms.find(form => normalize(form) && occurs(key, normalize(form)));
    if (carried !== undefined)
        return { reason: 'carries_name', message: `${repr(handle)} carries ${repr(carried)}, a form of a name in the book's cast; describe the thing without any name` };
    const interim = INTERIM_SHAPE.exec(handle);
    if (interim && kinds.has(interim[1]!))
        return { reason: 'interim_shape', message: `${repr(handle)} has the form of an interim handle, a kind and six hex digits` };
    const others = [...(graph.names.get(key) ?? [])].some(other => other !== id)
        || entries(settled).some(([other, entry]) => other !== id && normalize(storedHandle(entry)) === key);
    if (others || batch.has(key))
        return { reason: 'taken', message: `${repr(handle)} already names another node of this book` };
    return null;
}

/**
 * `handles.submit` (§185.5): each entry checked on its own, the accepted ones and the given-up ids written to the book's
 * `handles.json` under the library module's lock. An entry already present is never overwritten: the first writer wins, and the
 * file is read again inside the lock, so a campaign that wrote first is never overruled by one that checked earlier.
 */
export async function submitHandles(context: KernelContext, directory: string, graph: ModuleGraph, entriesIn: unknown, givenUpIn: unknown): Promise<Row> {
    const forms = castForms(graph), kinds = new Set([...graph.byKind.keys(), ...bookNodes(graph).map(node => graph.bookKind(node))]);
    return withOptionalExclusiveLock(context.locks, join(directory, '.metadata.lock'), async () => {
        const stored = await readHandles(context, directory), settled = row(stored.nodes);
        const written: Row[] = [], refused: Row[] = [], batch = new Set<string>();
        for (const raw of array(entriesIn)) {
            const entry = row(raw), id = text(entry.id).trim(), handle = entry.handle;
            const why = handleRefusal(graph, id, handle, settled, forms, kinds, batch);
            if (why) { refused.push({ id, handle: typeof handle === 'string' ? handle : null, ...why }); continue; }
            settled[id] = { handle, at: nowIso() };
            batch.add(normalize(handle));
            written.push({ id, handle });
        }
        for (const raw of array(givenUpIn)) {
            const id = text(raw).trim(), node = graph.nodes.get(id);
            if (!node || !graph.isBookNode(node)) { refused.push({ id, handle: null, reason: 'unknown_entity', message: `${repr(id)} is no node of this campaign's book graph` }); continue; }
            if (Object.hasOwn(settled, id)) { refused.push({ id, handle: null, reason: 'settled', message: `${repr(id)} already has a handle or was given up` }); continue; }
            settled[id] = { given_up: true, at: nowIso() };
            written.push({ id, given_up: true });
        }
        if (written.length) await writeJsonAtomic(join(directory, HANDLES_FILE), { nodes: settled });
        return { written, refused };
    });
}
