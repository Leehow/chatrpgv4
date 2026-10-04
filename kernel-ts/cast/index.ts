/**
 * Contract §177.2: the cast reader's three methods, for a PDF book.
 *
 * `cast.job` says whether the book still needs its cast and where the reader works; `cast.source` keeps the native text the
 * host extracted (the kernel's own copy, which `cast.submit` checks against) and writes the reader's page files; `cast.submit`
 * checks the reader's draft against that copy (`checkCastDraft`) and writes `cast.json` beside the module. A book with no
 * text layer at all has its cast `unavailable`, and every check falls back to the graph's people (owner's Q2).
 *
 * An authored module has no job: its cast is its graph's people, derived at load (§177.1).
 */
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { HandlerGroup } from '../handlers.js';
import { writeJsonAtomic } from '../fileio.js';
import { scopedModuleRoot } from '../modules/campaign-scope.js';
import { validateModuleId } from '../modules/store.js';
import { playsFromReading } from '../modules/bound-source.js';
import { playLanguageOf } from '../read/languages.js';
import { CAST_FILE, CAST_SOURCE_FILE, CAST_VERSION, moduleSourceSha, storedCast } from '../read/cast.js';
import { array, number, repr, row, string, type Row } from '../read/values.js';
import { castPageFile, checkCastDraft, pageTexts } from './draft.js';
import { nowIso } from '../write/store.js';

export function createCastHandlers(context: KernelContext): HandlerGroup {
    async function locate(params: Row): Promise<{ id: string; dir: string; meta: Row; sha: string; campaign?: string }> {
        const id = validateModuleId(params.module_id), campaign = typeof params.campaign === 'string' && params.campaign ? params.campaign : undefined;
        const scoped = campaign !== undefined ? await scopedModuleRoot(context, campaign, id) : null;
        const dir = join(scoped ?? context.moduleRoot ?? join(context.stateRoot, 'modules'), id);
        const metaPath = join(dir, 'module.json');
        const meta = await context.snapshots.pathExists(metaPath) ? row(await context.snapshots.readJson(metaPath)) : {};
        return { id, dir, meta, sha: moduleSourceSha(meta), ...(campaign ? { campaign } : {}) };
    }
    const jobIdOf = (sha: string) => `cast:${sha.slice(0, 12)}`;
    const workOf = (dir: string, sha: string) => join(dir, 'work', `cast-${sha.slice(0, 12)}`);
    async function stored(dir: string, sha: string): Promise<Row | null> {
        const path = join(dir, CAST_FILE);
        if (!await context.snapshots.pathExists(path)) return null;
        try { return storedCast(await context.snapshots.readJson(path), sha); } catch { return null; }
    }
    function sameJob(params: Row, sha: string): void {
        if (params.job_id !== jobIdOf(sha))
            throw new RpcError('invalid_params', `job ${repr(params.job_id)} is not this book's cast job`, { fix: 'ask cast.job again and use the job it gives' });
    }
    const pageCount = (meta: Row): number => number(meta.page_count || row(meta.source_document).page_count || 0);
    return Object.freeze({
        'cast.job': async (params): Promise<Row> => {
            const { id, dir, meta, sha, campaign } = await locate(params);
            if (!Object.keys(meta).length) return { job_id: null, reason: 'no_module' };
            // A starter plays from its authored graph even when a PDF is bound beside it (owner's Q4: out of scope).
            if (!sha || !pageCount(meta) || !playsFromReading(meta)) return { job_id: null, reason: 'authored' };
            const done = await stored(dir, sha);
            if (done) return { job_id: null, state: string(done.state) };
            let language = await playLanguageOf(context, {});
            if (campaign) {
                const campaignFile = join(context.campaignsRoot, campaign, 'campaign.json');
                if (await context.snapshots.pathExists(campaignFile)) language = await playLanguageOf(context, row(await context.snapshots.readJson(campaignFile)));
            }
            return { job_id: jobIdOf(sha), module_id: id, page_count: pageCount(meta), play_language: language, cwd: workOf(dir, sha) };
        },
        'cast.source': async (params): Promise<Row> => {
            const { dir, meta, sha } = await locate(params);
            if (!sha) throw new RpcError('invalid_params', 'this module has no bound PDF', { fix: 'ask cast.job first; an authored module has no cast job' });
            sameJob(params, sha);
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
            const cwd = workOf(dir, sha), folder = join(cwd, 'pages');
            await mkdir(folder, { recursive: true });
            const written: number[] = [];
            for (const page of pages) {
                if (!string(page.text).trim()) continue;
                await writeFile(join(folder, castPageFile(page.page)), page.text);
                written.push(page.page);
            }
            const language = typeof params.play_language === 'string' && params.play_language ? params.play_language : await playLanguageOf(context, {});
            await writeJsonAtomic(join(cwd, 'task.json'), { job_id: jobIdOf(sha), purpose: 'cast', page_count: count, play_language: language,
                pages_with_text: written, page_files: 'pages/page-NNNN.txt (zero-padded to four digits)', draft: 'draft.json' });
            return { state: 'ready', cwd, pages_with_text: written.length };
        },
        'cast.submit': async (params): Promise<Row> => {
            const { dir, meta, sha } = await locate(params);
            if (!sha) throw new RpcError('invalid_params', 'this module has no bound PDF');
            sameJob(params, sha);
            const sourcePath = join(dir, CAST_SOURCE_FILE);
            const source = await context.snapshots.pathExists(sourcePath) ? row(await context.snapshots.readJson(sourcePath)) : {};
            if (source.source_sha256 !== sha) throw new RpcError('invalid_params', 'the cast source text is missing or of another file', { fix: 'send cast.source again' });
            const draftPath = join(workOf(dir, sha), 'draft.json');
            let draft: unknown;
            try { draft = await context.snapshots.readJson(draftPath); }
            catch { throw new RpcError('invalid_params', 'the cast reader left no readable draft.json', { details: { reason: 'no_draft' } }); }
            const checked = checkCastDraft(draft, pageTexts(source.pages), pageCount(meta));
            if (checked.error) throw new RpcError('invalid_params', checked.error, { details: { reason: 'draft_shape' } });
            await writeJsonAtomic(join(dir, CAST_FILE), { version: CAST_VERSION, source_sha256: sha, state: 'complete', people: checked.people as unknown as Row[],
                refused: checked.refused.length, at: nowIso() });
            return { state: 'complete', people: checked.people.length, refused: checked.refused as unknown as Row[] };
        },
    });
}
