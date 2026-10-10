import {readSourceMetadata} from '../modules/source-state.js';
/**
 * Contract §177.2: the cast reader's methods, for a book read from its PDF.
 *
 * `cast.job` says whether the book still needs its cast, whether the kernel already keeps its text, and which page ranges are
 * still to read; `cast.source` keeps the native text the host extracted (the kernel's own copy, which every submit checks
 * against); `cast.range` writes one range's working directory -- its page files, and the people earlier ranges found, so the
 * same individual joins up across ranges; `cast.submit` checks that range's draft (`checkCastDraft`) and folds the accepted
 * rows into `cast.json` (`mergeCastRows`), `partial` until every range is read, then `complete`. A run that stops resumes at
 * the first range not read. A book with no text layer at all has its cast `unavailable`, and every check falls back to the
 * graph's people (owner's Q2).
 *
 * Ranges keep each reader child small: an agent re-sends its whole context every round, and a 669-page book read by one child
 * would outgrow any context window long before the end.
 *
 * An authored module has no job: its cast is its graph's people, derived at load (§177.1).
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { HandlerGroup } from '../handlers.js';
import { writeJsonAtomic } from '../fileio.js';
import { scopedModuleRoot } from '../modules/campaign-scope.js';
import { validateModuleId } from '../modules/store.js';
import { playsFromReading } from '../modules/bound-source.js';
import { playLanguageOf } from '../read/languages.js';
import { CAST_FILE, CAST_NEXT_FILE, CAST_SOURCE_FILE, CAST_VERSION, moduleSourceSha, storedCast } from '../read/cast.js';
import { passageKey } from '../read/table-people.js';
import { array, integer, number, repr, row, string, type Row } from '../read/values.js';
import { castPageFile, checkCastDraft, mergeCastRows, notesInUse, pageTexts, type CastRowStored } from './draft.js';
import { nowIso } from '../write/store.js';
import type { LockLease } from '../locks.js';

/** Pages one reader child reads (§177.2). */
export const CAST_PAGES_PER_RUN = 40;

export interface CastRange { index: number; first: number; last: number; done: boolean }

/** The ranges of a book's text: windows of `CAST_PAGES_PER_RUN` pages, each holding at least one page with text. */
export function castRanges(pages: Map<number, string>, pageCount: number, done: ReadonlySet<number> = new Set()): CastRange[] {
    const out: CastRange[] = [];
    for (let first = 1, index = 0; first <= pageCount; first += CAST_PAGES_PER_RUN, index += 1) {
        const last = Math.min(pageCount, first + CAST_PAGES_PER_RUN - 1);
        let text = false;
        for (let page = first; page <= last && !text; page++) text = !!(pages.get(page) ?? '').trim();
        if (text) out.push({ index, first, last, done: done.has(index) });
    }
    return out;
}

export function createCastRuntime(context: KernelContext): { handlers: HandlerGroup; close(): Promise<void> } {
    const held = new Map<string, { token: string; sha: string; lock: LockLease }>();
    let closed = false;
    async function locate(params: Row): Promise<{ id: string; dir: string; meta: Row; sha: string; campaign?: string }> {
        const id = validateModuleId(params.module_id), campaign = typeof params.campaign === 'string' && params.campaign ? params.campaign : undefined;
        const scoped = campaign !== undefined ? await scopedModuleRoot(context, campaign, id) : null;
        const dir = join(scoped ?? context.moduleRoot ?? join(context.stateRoot, 'modules'), id);
        const metaPath = join(dir, 'module.json');
        const meta = row(await readSourceMetadata(dir,context.stateRoot,context.locks));
        return { id, dir, meta, sha: moduleSourceSha(meta), ...(campaign ? { campaign } : {}) };
    }
    const jobIdOf = (sha: string) => `cast:${sha.slice(0, 12)}`;
    const workOf = (dir: string, sha: string) => join(dir, 'work', `cast-${sha.slice(0, 12)}`);
    const rangeDir = (dir: string, sha: string, token: string, index: number) => join(workOf(dir, sha), `run-${token}`, `range-${String(index).padStart(3, '0')}`);
    const pageCount = (meta: Row): number => number(meta.page_count || row(meta.source_document).page_count || 0);
    async function readOptional(path: string): Promise<unknown> {
        if (!await context.snapshots.pathExists(path)) return null;
        try { return await context.snapshots.readJson(path); } catch { return null; }
    }
    const stored = async (dir: string, sha: string): Promise<Row | null> => storedCast(await readOptional(join(dir, CAST_FILE)), sha);
    // §177.16: what a read in progress has kept -- `cast.next.json` (an older `cast.json` keeps serving the checks meanwhile), or
    // a current-version `cast.json` still partial (written before the staging file existed).
    const inProgress = async (dir: string, sha: string): Promise<Row | null> => {
        const current = await stored(dir, sha);
        return current?.state === 'partial' ? current : storedCast(await readOptional(join(dir, CAST_NEXT_FILE)), sha);
    };
    async function source(dir: string, sha: string): Promise<Map<number, string> | null> {
        const kept = row(await readOptional(join(dir, CAST_SOURCE_FILE)));
        return kept.source_sha256 === sha ? pageTexts(kept.pages) : null;
    }
    const doneOf = (kept: Row | null): Set<number> => new Set(array(kept?.ranges_done).filter(integer).map(Number));
    async function languageOf(campaign: string | undefined): Promise<string> {
        if (campaign) {
            const campaignFile = join(context.campaignsRoot, campaign, 'campaign.json');
            if (await context.snapshots.pathExists(campaignFile)) return playLanguageOf(context, row(await context.snapshots.readJson(campaignFile)));
        }
        return playLanguageOf(context, {});
    }
    function sameJob(params: Row, sha: string): void {
        if (!sha) throw new RpcError('invalid_params', 'this module has no bound PDF', { fix: 'ask cast.job first; an authored module has no cast job' });
        if (params.job_id !== jobIdOf(sha))
            throw new RpcError('invalid_params', `job ${repr(params.job_id)} is not this book's cast job`, { fix: 'ask cast.job again and use the job it gives' });
    }
    function owner(params: Row, dir: string, sha: string): string {
        const lease = held.get(dir);
        if (closed || !lease || lease.sha !== sha || params.lease !== lease.token)
            throw new RpcError('invalid_params', 'this kernel does not own that cast reader lease', {
                details: { reason: 'cast_lease_lost' }, fix: 'claim cast.job again; do not submit or retry the old reader' });
        return lease.token;
    }
    async function rangeOf(dir: string, sha: string, meta: Row, params: Row): Promise<{ pages: Map<number, string>; range: CastRange; kept: Row | null }> {
        const pages = await source(dir, sha);
        if (!pages) throw new RpcError('invalid_params', 'the kernel keeps no text of this book yet', { fix: 'send cast.source first' });
        const kept = await inProgress(dir, sha);
        const range = castRanges(pages, pageCount(meta), doneOf(kept)).find(value => value.index === params.index);
        if (!range) throw new RpcError('invalid_params', `range ${repr(params.index)} is not one of this book's`, { fix: 'use an index cast.job or cast.source listed' });
        return { pages, range, kept };
    }
    const handlers: HandlerGroup = Object.freeze({
        'cast.job': async (params): Promise<Row> => {
            const { id, dir, meta, sha, campaign } = await locate(params);
            if (!Object.keys(meta).length) return { job_id: null, reason: 'no_module' };
            // A starter plays from its authored graph even when a PDF is bound beside it (owner's Q4: out of scope).
            if (!sha || !pageCount(meta) || !playsFromReading(meta)) return { job_id: null, reason: 'authored' };
            const settled = await stored(dir, sha);
            if (settled && settled.state !== 'partial') return { job_id: null, state: string(settled.state) };
            let claim: { token: string; sha: string; lock: LockLease } | undefined;
            if (params.claim === true) {
                if (closed) throw new RpcError('invalid_params', 'this cast reader runtime is closed');
                const lock = await context.locks.acquire(join(dir, '.cast-reader.lock'), 'exclusive', { nonblocking: true, createParents: true });
                if (!lock) return { job_id: null, state: 'busy', reason: 'reader_owned' };
                if (closed) { await lock.release(); throw new RpcError('invalid_params', 'this cast reader runtime is closed'); }
                claim = { token: randomUUID(), sha, lock };
                held.set(dir, claim);
            }
            try {
                // Another process may have completed the table between the first query and this claim.
                const latest = claim ? await stored(dir, sha) : settled;
                if (latest && latest.state !== 'partial') {
                    if (claim) { held.delete(dir); await claim.lock.release(); }
                    return { job_id: null, state: string(latest.state) };
                }
                const kept = await inProgress(dir, sha), pages = await source(dir, sha);
                return { job_id: jobIdOf(sha), module_id: id, page_count: pageCount(meta), play_language: await languageOf(campaign),
                    ...(claim ? { lease: claim.token } : {}),
                    ...(pages ? { source: 'kept', ranges: castRanges(pages, pageCount(meta), doneOf(kept)) as unknown as Row[] } : { source: 'needed' }) };
            } catch (error) {
                if (claim) { held.delete(dir); await claim.lock.release(); }
                throw error;
            }
        },
        'cast.release': async (params): Promise<Row> => {
            const { dir } = await locate(params), lease = held.get(dir);
            if (!lease || params.lease !== lease.token || params.job_id !== jobIdOf(lease.sha)) return { released: false };
            held.delete(dir);
            await lease.lock.release();
            return { released: true };
        },
        'cast.source': async (params): Promise<Row> => {
            const { dir, meta, sha } = await locate(params);
            sameJob(params, sha);
            owner(params, dir, sha);
            const count = pageCount(meta), pages: Row[] = [];
            for (const raw of array(params.pages)) {
                const entry = row(raw);
                if (!Number.isSafeInteger(entry.page) || entry.page < 1 || entry.page > count || typeof entry.text !== 'string')
                    throw new RpcError('invalid_params', 'pages are [{page, text}] with physical pages of this book', { details: { field: 'pages' } });
                pages.push({ page: entry.page, text: entry.text });
            }
            // Owner's Q2: a book with no text layer has no cast; the checks fall back to the graph's people.
            if (!pages.some(page => string(page.text).trim())) {
                await writeJsonAtomic(join(dir, CAST_FILE), { version: CAST_VERSION, source_sha256: sha, state: 'unavailable', reason: 'no_text_layer', people: [], at: nowIso() });
                return { state: 'unavailable', reason: 'no_text_layer' };
            }
            await writeJsonAtomic(join(dir, CAST_SOURCE_FILE), { version: CAST_VERSION, source_sha256: sha, pages });
            return { state: 'ready', ranges: castRanges(pageTexts(pages), count, doneOf(await inProgress(dir, sha))) as unknown as Row[] };
        },
        'cast.range': async (params): Promise<Row> => {
            const { dir, meta, sha, campaign } = await locate(params);
            sameJob(params, sha);
            const token = owner(params, dir, sha);
            const { pages, range, kept } = await rangeOf(dir, sha, meta, params);
            const cwd = rangeDir(dir, sha, token, range.index), folder = join(cwd, 'pages');
            await mkdir(folder, { recursive: true });
            const written: number[] = [];
            for (let page = range.first; page <= range.last; page++) {
                const text = pages.get(page) ?? '';
                if (!text.trim()) continue;
                await writeFile(join(folder, castPageFile(page)), text);
                written.push(page);
            }
            const known = array(kept?.people).map(person => ({ book: array(row(person).book), play: array(row(person).play), notes: array(row(person).notes) }));
            // §177.16: what the game's own notes already wrote about these pages, so a rendering they use joins `notes`.
            const graphFile = string(meta.graph_file), graph = graphFile ? await readOptional(join(dir, graphFile)) : null;
            const notes = graph ? notesInUse(graph, range.first, range.last) : [], cut = graph ? notesInUse(graph, range.first, range.last, Infinity).length - notes.length : 0;
            await writeJsonAtomic(join(cwd, 'task.json'), { job_id: jobIdOf(sha), purpose: 'cast', page_count: pageCount(meta), play_language: await languageOf(campaign),
                range: { index: range.index, first: range.first, last: range.last }, pages_with_text: written, known_cast: known,
                ...(notes.length ? { notes_in_use: notes } : {}),
                // §177.2: no `draft` file is named: the reader hands its draft to `submit_cast`, and the host writes draft.json here.
                page_files: 'pages/page-NNNN.txt (zero-padded to four digits)' });
            return { cwd, index: range.index, first: range.first, last: range.last, pages_with_text: written.length, known: known.length, notes_in_use: notes.length,
                ...(cut ? { notes_in_use_cut: cut } : {}) };
        },
        'cast.submit': async (params): Promise<Row> => {
            const { dir, meta, sha } = await locate(params);
            sameJob(params, sha);
            const token = owner(params, dir, sha);
            const { pages, range, kept } = await rangeOf(dir, sha, meta, params);
            let draft: unknown;
            try { draft = await context.snapshots.readJson(join(rangeDir(dir, sha, token, range.index), 'draft.json')); }
            catch { throw new RpcError('invalid_params', 'the cast reader left no readable draft.json', { details: { reason: 'no_draft' } }); }
            const before = array(kept?.people) as unknown as CastRowStored[];
            const known = new Set(before.flatMap(person => array(person.book).map(name => passageKey(name))));
            const checked = checkCastDraft(draft, pages, pageCount(meta), { range: { first: range.first, last: range.last }, known });
            if (checked.error) throw new RpcError('invalid_params', checked.error, { details: { reason: 'draft_shape' } });
            const people = mergeCastRows(before, checked.people);
            const done = [...new Set([...doneOf(kept), range.index])].sort((a, b) => a - b);
            const all = castRanges(pages, pageCount(meta)).map(value => value.index);
            const state = all.every(index => done.includes(index)) ? 'complete' : 'partial';
            // §177.16: a range of a read in progress goes to `cast.next.json`; the complete table replaces `cast.json` at once, so an
            // older table of this file serves the checks until then.
            const table = { version: CAST_VERSION, source_sha256: sha, state, people: people as unknown as Row[], ranges_done: done, ranges_total: all.length, at: nowIso() };
            if (state === 'complete') {
                await writeJsonAtomic(join(dir, CAST_FILE), table);
                await rm(join(dir, CAST_NEXT_FILE), { force: true });
            } else await writeJsonAtomic(join(dir, CAST_NEXT_FILE), table);
            return { state, people: people.length, accepted: checked.people.length, refused: checked.refused as unknown as Row[], ranges_done: done.length, ranges_total: all.length };
        },
    });
    return { handlers, async close() {
        closed = true;
        const leases = [...held.values()]; held.clear();
        const results = await Promise.allSettled(leases.map(lease => lease.lock.release()));
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    } };
}
