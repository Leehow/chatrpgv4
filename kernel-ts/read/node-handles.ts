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
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { writeJsonAtomic } from '../fileio.js';
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

/**
 * §185.6: take the book's handles into `world.node_handles` for every book node of the served graph not mapped yet:
 * - a handle `handles.json` holds that is free here (no table name, adaptation name or other mapped handle has its
 *   normalized form): that handle;
 * - a node given up, or whose handle is not free here: `<kind>-<n>`, the next ordinal of its kind nothing here answers to;
 * - otherwise nothing: the node keeps its interim handle until a later fold.
 * Returns whether the world changed; the caller writes it, and reloads the graph, whose handles it built with the old map.
 */
export function foldNodeHandles(graph: ModuleGraph, world: Row, stored: Row): boolean {
    if (!graph.nameFree) return false;
    const map: Row = { ...row(world.node_handles) }, settled = row(stored.nodes);
    const used = new Set([...graph.tableNames.values(), ...graph.tableEntityNames.values(), ...graph.tableCreatureNames.values(),
        ...graph.semanticNames.values(), ...Object.values(map).map(text)].map(normalize).filter(Boolean));
    const ordinal = (kind: string): string => {
        for (let n = 1; ; n++) {
            const candidate = `${kind || 'node'}-${n}`, key = normalize(candidate);
            if (!used.has(key) && !graph.names.has(key)) return candidate;
        }
    };
    let changed = false;
    for (const node of bookNodes(graph)) {
        const id = String(node.node_id);
        if (Object.hasOwn(map, id) || !Object.hasOwn(settled, id)) continue;
        const entry = row(settled[id]), handle = storedHandle(entry);
        if (!handle && entry.given_up !== true) continue;
        const value = handle && !used.has(normalize(handle)) ? handle : ordinal(graph.bookKind(node));
        map[id] = value;
        used.add(normalize(value));
        changed = true;
    }
    if (changed) world.node_handles = map;
    return changed;
}

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

/** `handles.job`'s packet (§185.5): up to HANDLES_PER_JOB book nodes `handles.json` neither names nor gave up. */
export function handlesJob(campaign: string, graph: ModuleGraph, stored: Row): Row {
    const settled = row(stored.nodes);
    const wanting = bookNodes(graph).filter(node => !Object.hasOwn(settled, String(node.node_id)));
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
