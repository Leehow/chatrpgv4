/**
 * What binding an original document writes on a module (contract §22.1, §14.16): the reading state a
 * source bound after its graph starts from, and a built-in starter's declared window of a book.
 * The kernel checks bytes and declarations here; it never parses a PDF (the host's extractor does).
 */
import { randomUUID } from 'node:crypto';
import { copyFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { sha256File, writeJsonAtomic } from '../fileio.js';
import { array, equal, integer, number, repr, row, truth, type Row } from '../read/values.js';
import { recordOf } from '../read/module-graph.js';
import { childPath, inside } from './paths.js';

/**
 * Whether a module's playable material is published by the visual reading lane (a PDF book): its
 * opening readiness, material gates and read-ahead belong to that lane. A starter bound to a window
 * of its book (§14.16) only consults the document: its graph is authored, installed and ready.
 */
export function playsFromReading(meta: Row): boolean { return truth(meta.reading_version) && meta.source !== 'starter'; }

export const STARTER_SOURCE_CONTRACT = 'coc.starter-source-binding.v1';
const SHA = /^[a-f0-9]{64}$/;

/** A reading lane that has read nothing yet. */
export function freshReadingState(): Row {
    return { state: 'indexing', index_complete: false, viewed_pages: [], materials: [], missing: [] };
}
/** A source bound after its graph existed: the graph already published is ready material, recorded as
 *  `legacy` so it is never mistaken for a visual reading of these pages (§22.5). */
export function boundReadingState(graph: Row | null, generation: number): Row {
    const state = freshReadingState();
    if (graph) state.materials = [{ purpose: 'detail', verification: 'legacy', node_ids: array(graph.nodes).map(node => node.node_id), generation }];
    return state;
}

export interface StarterSourceDeclaration {
    module_id: string;
    source_id: string;
    /** The book's own identity and the window's 0-based `pdf_index` bounds, both inclusive. */
    book: { file_sha256: string; pages: [number, number] };
    /** A window the starter package ships, already extracted. Absent: the user registers the book. */
    built_in?: { path: string; file_sha256: string; page_count: number; file: string };
}

function refuse(id: string, message: string): never {
    throw new RpcError('invalid_params', `starter ${repr(id)} source-binding.json: ${message}`, {
        fix: 'repair content/starters/<id>/source-binding.json (contract §14.16.1)', details: { module: id },
    });
}

/** The starter's `source-binding.json`, validated; null when the starter names no source window. */
export async function starterSourceDeclaration(context: KernelContext, id: string): Promise<StarterSourceDeclaration | null> {
    const folder = join(context.content, 'starters', id), path = join(folder, 'source-binding.json');
    if (!await context.snapshots.isFile(path)) return null;
    const raw = row(await context.snapshots.readJson(path)), book = row(raw.book);
    if (raw.contract_id !== STARTER_SOURCE_CONTRACT || raw.schema_version !== 1) refuse(id, `contract_id must be ${STARTER_SOURCE_CONTRACT}, schema_version 1`);
    if (typeof raw.source_id !== 'string' || !raw.source_id.trim()) refuse(id, 'source_id must name the source the graph cites');
    const pages = array(book.pages);
    if (typeof book.file_sha256 !== 'string' || !SHA.test(book.file_sha256)) refuse(id, 'book.file_sha256 must be the lower-case SHA-256 of the book');
    if (pages.length !== 2 || !pages.every(integer) || number(pages[0]) < 0 || number(pages[1]) < number(pages[0]))
        refuse(id, 'book.pages must be [first, last] 0-based pdf_index, first <= last');
    const declaration: StarterSourceDeclaration = { module_id: id, source_id: raw.source_id,
        book: { file_sha256: book.file_sha256, pages: [number(pages[0]), number(pages[1])] } };
    if (raw.built_in !== undefined) {
        const built = row(raw.built_in), count = number(pages[1]) - number(pages[0]) + 1;
        if (typeof built.path !== 'string' || !built.path) refuse(id, 'built_in.path must name the shipped window');
        const file = childPath(folder, built.path);
        // Lexical containment: a content root may be assembled from symlinked files (tests, packaging).
        if (isAbsolute(built.path) || !inside(resolve(folder), resolve(file))) refuse(id, 'built_in.path escapes the starter package');
        if (typeof built.file_sha256 !== 'string' || !SHA.test(built.file_sha256)) refuse(id, 'built_in.file_sha256 must be the SHA-256 of the shipped window');
        if (built.page_count !== count) refuse(id, `built_in.page_count must be the window's ${count} pages`);
        declaration.built_in = { path: built.path, file_sha256: built.file_sha256, page_count: count, file };
    }
    return declaration;
}

/** Every starter whose declaration names this book (a book may hold several scenarios). */
export async function starterDeclarationsForBook(context: KernelContext, fileSha256: string): Promise<StarterSourceDeclaration[]> {
    const root = join(context.content, 'starters'), found: StarterSourceDeclaration[] = [];
    for (const id of await context.snapshots.sortedChildNames(root, path => context.snapshots.isFile(join(path, 'source-binding.json')))) {
        const declaration = await starterSourceDeclaration(context, id);
        if (declaration?.book.file_sha256 === fileSha256) found.push(declaration);
    }
    return found;
}

/** The graph's own statement of its source must agree with the declaration beside it. */
export function checkDeclarationAgainstGraph(declaration: StarterSourceDeclaration, graph: Row): void {
    const moduleNode = array(graph.nodes).find(node => row(node).node_kind === 'module'), stated = row(row(row(moduleNode).properties).source_binding);
    if (typeof stated.source_id === 'string' && stated.source_id && stated.source_id !== declaration.source_id)
        refuse(declaration.module_id, `source_id ${repr(declaration.source_id)} differs from the graph's ${repr(stated.source_id)}`);
    if (typeof stated.file_sha256 === 'string' && stated.file_sha256 && stated.file_sha256 !== declaration.book.file_sha256)
        refuse(declaration.module_id, "book.file_sha256 differs from the graph's source_binding.file_sha256");
}

/** Scenes whose own source_refs cite the declared window, each with its window-relative pages (0-based). */
function authoredScenes(graph: Row | null, declaration: StarterSourceDeclaration): Array<{ node_id: string; name: string; pages: number[] }> {
    const [first, last] = declaration.book.pages, scenes: Array<{ node_id: string; name: string; pages: number[] }> = [];
    for (const node of array(graph?.nodes)) {
        if (row(node).node_kind !== 'scene') continue;
        const pages = [...new Set(array(node.source_refs).filter(ref => row(ref).source_id === declaration.source_id && integer(ref.pdf_index)
            && number(ref.pdf_index) >= first && number(ref.pdf_index) <= last).map(ref => number(ref.pdf_index) - first))].sort((a, b) => a - b);
        // The name a table calls the scene by: its authored display name, else its handle (as the capsule's `where.scene`).
        const record = recordOf(node), display = typeof record.display_name === 'string' ? record.display_name.trim() : '';
        const name = display || (typeof record.scene_id === 'string' && record.scene_id ? record.scene_id : String(node.node_id).replace(/^scene-/, ''));
        if (pages.length) scenes.push({ node_id: String(node.node_id), name, pages });
    }
    return scenes;
}
/** §22.1 index rows (`pages` 0-based inclusive ranges) for the authored scenes, in page order. */
export function authoredIndex(graph: Row | null, declaration: StarterSourceDeclaration): Row[] {
    const rows = authoredScenes(graph, declaration).map(scene => {
        const ranges: number[][] = [];
        for (const page of scene.pages) {
            const open = ranges.at(-1);
            if (open && open[1] + 1 === page) open[1] = page; else ranges.push([page, page]);
        }
        return { name: scene.name, pages: ranges, topics: [], entities: [], references: [], state: 'indexed' };
    });
    return rows.sort((a, b) => a.pages[0][0] - b.pages[0][0] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The window a bound module's document is, in the declaration's terms. */
export function windowOf(declaration: StarterSourceDeclaration): Row {
    return { source_id: declaration.source_id, file_sha256: declaration.book.file_sha256, pages: [...declaration.book.pages] };
}
export function windowMatches(meta: Row, declaration: StarterSourceDeclaration): boolean {
    return equal(row(row(meta.source_document).window), windowOf(declaration));
}
/** The bound document is on disk with the bytes its binding recorded. */
export async function boundFileIntact(context: KernelContext, folder: string, meta: Row): Promise<boolean> {
    const source = row(meta.source_document);
    if (source.path !== 'source.pdf' || typeof source.file_sha256 !== 'string') return false;
    const path = join(folder, 'source.pdf');
    return await context.snapshots.isFile(path) && await sha256File(path) === source.file_sha256;
}

/**
 * Bind a starter to its window document: the same store an imported module has (`source.pdf`,
 * `reading_version`, `source_document`, a reading state, an index and a queue), with `window`
 * recording which pages of which book it is. Mutates and returns `meta`; the caller writes it.
 * `source` stays `starter`, and the top-level `file_sha256` of an imported book is not written:
 * the starter's identity, catalogue row and bundled guidance fingerprint are its graph's.
 */
export async function bindStarterSource(context: KernelContext, folder: string, meta: Row, declaration: StarterSourceDeclaration,
    file: { path: string; file_sha256: string; page_count: number }, graph: Row | null): Promise<Row> {
    const [first, last] = declaration.book.pages;
    if (file.page_count !== last - first + 1)
        throw new RpcError('invalid_params', `the window of ${repr(declaration.module_id)} has ${last - first + 1} pages, not ${file.page_count}`, {
            details: { reason: 'source_window_mismatch', pages: [first, last] } });
    const destination = join(folder, 'source.pdf');
    if (!(await context.snapshots.isFile(destination) && await sha256File(destination) === file.file_sha256)) {
        const temporary = join(folder, `source-copy-${randomUUID().replaceAll('-', '')}.pdf`);
        try {
            await copyFile(file.path, temporary);
            if (await sha256File(temporary) !== file.file_sha256)
                throw new RpcError('invalid_params', 'the source window changed while it was bound', { details: { reason: 'source_window_mismatch' } });
            // A replaced window is kept beside the new one: reading evidence cites its bytes.
            if (await context.snapshots.isFile(destination))
                await rename(destination, join(folder, `source-replaced-${randomUUID().replaceAll('-', '')}.pdf`));
            await rename(temporary, destination);
        } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    }
    // The authored graph is this window's reading: its scenes are the index, derived by machine from
    // the pages their own source_refs cite (names and page ranges only; no topics are guessed).
    const index = authoredIndex(graph, declaration), indexFile = 'index.json';
    await writeJsonAtomic(join(folder, indexFile), index);
    const queue = join(folder, 'deepen-queue.json');
    if (await context.snapshots.isFile(queue) && array(await context.snapshots.readJson(queue)).length)
        await rename(queue, join(folder, `legacy-queue-${randomUUID().replaceAll('-', '')}.json`));
    await writeJsonAtomic(queue, []);
    if (!await context.snapshots.isFile(join(folder, 'sections.json'))) await writeJsonAtomic(join(folder, 'sections.json'), []);
    const reading = boundReadingState(graph, number(meta.generation));
    // Each indexed scene is prepared (authored) material, so the capsule's `reading` rows say `read`.
    for (const scene of authoredScenes(graph, declaration))
        reading.materials.push({ purpose: 'detail', verification: 'legacy', focus: scene.name, node_ids: [scene.node_id], generation: number(meta.generation) });
    Object.assign(reading, { index_complete: true, index_source: 'authored_graph', state: 'ready' });
    Object.assign(meta, {
        reading_version: 1,
        source_document: { path: 'source.pdf', file_sha256: file.file_sha256, page_count: file.page_count, window: windowOf(declaration) },
        page_count: file.page_count,
        index_file: indexFile,
        reading,
    });
    return meta;
}

/** A human-readable statement of the declared window, for a refusal that has no document to offer. */
export function declaredWindow(declaration: StarterSourceDeclaration): Row {
    return { source_id: declaration.source_id, pdf_index: [...declaration.book.pages], built_in: Boolean(declaration.built_in) };
}

/**
 * Registration's half of §14.16, run on every starter registration: a built-in window is bound from
 * the package; a registered one is carried across a new graph generation (whose metadata starts
 * over) as long as its bytes are still there. Returns the metadata to write, or null for no change.
 * A package that lost its shipped window registers unbound and the source refusal says so; a
 * shipped window whose bytes differ from its declaration is a broken package and is refused.
 */
export async function ensureStarterSource(context: KernelContext, id: string, folder: string, meta: Row, graph: Row, prior: Row | null): Promise<Row | null> {
    const declaration = await starterSourceDeclaration(context, id);
    if (!declaration) return null;
    checkDeclarationAgainstGraph(declaration, graph);
    const present = await context.snapshots.isFile(join(folder, 'source.pdf'));
    if (declaration.built_in) {
        const built = declaration.built_in;
        if (windowMatches(meta, declaration) && row(meta.source_document).file_sha256 === built.file_sha256 && present) return null;
        if (!await context.snapshots.isFile(built.file)) return null;
        if (await sha256File(built.file) !== built.file_sha256)
            refuse(id, `the shipped window ${repr(built.path)} does not have the declared built_in.file_sha256`);
        return bindStarterSource(context, folder, meta, declaration, { path: built.file, file_sha256: built.file_sha256, page_count: built.page_count }, graph);
    }
    if (windowMatches(meta, declaration) && present) return null;
    const carried = row(prior?.source_document);
    if (!prior || !windowMatches(prior, declaration) || !await boundFileIntact(context, folder, prior)) return null;
    return bindStarterSource(context, folder, meta, declaration,
        { path: join(folder, 'source.pdf'), file_sha256: carried.file_sha256, page_count: number(carried.page_count) }, graph);
}
