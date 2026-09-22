/** A reusable library publication seeds one independently writable campaign source. */
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { sha256File, writeJsonAtomic } from '../fileio.js';
import { jsonDigest, parsePythonJson } from '../json.js';
import { withOptionalExclusiveLock } from '../locks.js';
import { array, clone, normalize, number, repr, row, type Row } from '../read/values.js';
import { SOURCE_ANSWER_PROTOCOL, checkSourceAnswer, sourceAnswerResult } from './source-answer.js';
import { ModuleStore, validateModuleId } from './store.js';
import { childPath, inside, resolvedPath } from './paths.js';

export function moduleContext(context: KernelContext, campaign: string): KernelContext {
    if (typeof campaign !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(campaign))
        throw new RpcError('invalid_params', 'campaign must be a short slug');
    return { ...context, moduleRoot: join(context.stateRoot, 'module-campaigns', campaign, 'modules') };
}

/** The campaign's private module root, or null until its first private write forks it.
 *  Reads follow the shared library until then, so a book that finishes reading after the
 *  campaign exists still reaches it (contract 22.6). */
export async function scopedModuleRoot(context: KernelContext, campaign: string, moduleId: string): Promise<string | null> {
    const scoped = moduleContext(context, campaign), id = validateModuleId(moduleId);
    const store = new ModuleStore(scoped), destination = store.moduleDir(id);
    const scopeRoot = join(context.stateRoot, 'module-campaigns');
    if (await resolvedPath(destination) !== join(await resolvedPath(scopeRoot), campaign, 'modules', id))
        throw new RpcError('invalid_params', 'campaign module path redirects outside its own scope');
    const campaignFile = join(context.campaignsRoot, campaign, 'campaign.json');
    if (await context.snapshots.isFile(campaignFile)) {
        const meta = row(await context.snapshots.readJson(campaignFile));
        if (meta.module_id !== id)
            throw new RpcError('invalid_params', 'the requested module does not belong to this campaign');
    }
    if (!await store.exists(id)) {
        // A private directory without its binding is a damaged workspace, not a campaign that
        // never forked; it may not silently fall back to the shared library. The seed lock makes
        // the verdict final, so a publication that just finished is never mistaken for damage.
        if (await context.snapshots.pathExists(store.moduleDir(id))) {
            await withOptionalExclusiveLock(context.locks, join(scoped.moduleRoot!, `.seed-${id}.lock`), async () => {
                if (await store.exists(id)) return;
                throw new RpcError('campaign_not_ready', 'the private source workspace for this campaign is incomplete', {
                    fix: 'inspect the incomplete private workspace and repair or remove it before this campaign reads again',
                    details: { reason: 'module_scope_incomplete', campaign, module_id: id },
                });
            });
            return scopedModuleRoot(context, campaign, id);
        }
        const libraryJson = join(context.stateRoot, 'modules', id, 'module.json');
        if (await context.snapshots.pathExists(libraryJson)) {
            const shared = row(await context.snapshots.readJson(libraryJson));
            if (shared.id !== id)
                throw new RpcError('invalid_params', 'the shared module metadata names another module');
        }
        return null;
    }
    const meta = await store.module(id);
    if (meta.id !== id || meta.campaign_scope !== campaign)
        throw new RpcError('invalid_params', 'the private module belongs to a different campaign scope');
    return scoped.moduleRoot!;
}

export async function ensureCampaignModule(context: KernelContext, campaign: string, moduleId: string): Promise<KernelContext> {
    const scoped = moduleContext(context, campaign), id = validateModuleId(moduleId);
    const destination = new ModuleStore(scoped).moduleDir(id);
    const existing = async () => await scopedModuleRoot(context, campaign, id) !== null;
    if (await existing()) return scoped;
    // The seed lock lives outside the atomically published directory. It also protects setup
    // scopes that precede campaign.json, so two kernel processes cannot publish different seeds.
    return withOptionalExclusiveLock(context.locks, join(scoped.moduleRoot!, `.seed-${id}.lock`), async () => {
        if (await existing()) return scoped;
        const libraryContext = { ...context, moduleRoot: join(context.stateRoot, 'modules') };
        const library = new ModuleStore(libraryContext), source = library.moduleDir(id);
        if (!await library.exists(id) && await context.snapshots.isFile(join(context.content, 'starters', id, 'module-graph.json'))) {
            // registerStarter takes the shared registry lock itself and re-reads inside it; a lost
            // race is tolerated because the winner's registration is the one this fork wanted.
            try { if (!await library.exists(id)) await library.register(id); }
            catch (error) { if (!await library.exists(id)) throw error; }
        }
        return withOptionalExclusiveLock(context.locks, join(source, '.metadata.lock'), async () => {
            const meta = await library.module(id), graph = await library.readGraph(id);
            // Reads follow the shared library until a campaign forks; a fork without a published
            // generation would be a private workspace with nothing to play.
            if (graph === null)
                throw new RpcError('campaign_not_ready', `module ${repr(id)} has no published graph to fork`, {
                    fix: 'finish the source preparation for this book before this campaign reads it',
                    details: { reason: 'module_graph_missing', module_id: id },
                });
            const temporary = join(scoped.moduleRoot!, `.seed-${id}-${randomUUID()}`);
            await mkdir(temporary, { recursive: true });
            try {
                const copied = new Set<string>();
                const copy = async (name: unknown, required = false): Promise<boolean> => {
                    if (typeof name !== 'string' || !name) return false;
                    if (copied.has(name)) return true;
                    const from = childPath(source, name), to = childPath(temporary, name);
                    if (!inside(await resolvedPath(source), await resolvedPath(from)))
                        throw new RpcError('invalid_params', 'a source artifact escapes the module library');
                    if (!await context.snapshots.isFile(from)) {
                        if (required) throw new RpcError('campaign_not_ready', 'the source artifact needed for the campaign seed is missing', { details: { artifact: name } });
                        return false;
                    }
                    await mkdir(dirname(to), { recursive: true });
                    // Reflinks where supported, independent files elsewhere. Never mutable hard links.
                    await copyFile(from, to, constants.COPYFILE_FICLONE);
                    copied.add(name);
                    return true;
                };
                // The published graph and its manifest are the hard requirements. The original PDF,
                // index, guidance and asset bytes are copied when present: a published generation
                // stays playable after the source document is gone, and a legacy starter may
                // reference an author image that never shipped.
                const graphFile = relative(source, await library.graphPath(id, meta));
                await copy(graphFile, true);
                await copy(join(dirname(graphFile), 'module-graph-manifest.json'), true);
                await copy(join(dirname(graphFile), 'assets.json'));
                for (const asset of await library.assets(id)) await copy(asset.path);
                for (const node of array(graph.nodes)) await copy(row(node.properties).asset_ref);
                await copy(row(meta.source_document).path);
                const indexCopied = await copy(meta.index_file || 'sections.json');
                await copy('assets.json');
                // Accepted guidance is keyed by source/scene/language, not by a running reader lease.
                for (const key of Object.keys(row(meta.character_guidance)))
                    await copy(join('character-guidance', key, 'accepted.json'));
                const acceptedAnswers: Row = {}, answerQueue = await library.queue(id);
                let invalidAnswers = 0;
                for (const cacheKey of Object.keys(row(row(meta.reading).answers)).sort()) {
                    const accepted = row(row(row(meta.reading).answers)[cacheKey]);
                    let focus: string, question: string, draftPath: string, reviewPath: string, answerDraft: Row;
                    try {
                        if (accepted.protocol !== SOURCE_ANSWER_PROTOCOL || accepted.source_sha256 !== row(meta.source_document).file_sha256
                            || accepted.context_generation !== (meta.generation ?? 0) || typeof accepted.draft !== 'string' || typeof accepted.review !== 'string'
                            || typeof accepted.draft_sha256 !== 'string' || typeof accepted.review_sha256 !== 'string') throw new Error('answer binding');
                        focus = typeof accepted.focus === 'string' && accepted.focus.trim() ? accepted.focus : '';
                        question = typeof accepted.question === 'string' && accepted.question.trim() ? accepted.question : '';
                        if (!focus || !question) {
                            const historical = answerQueue.filter(job => job.key === cacheKey && job.purpose === 'answer' && job.state === 'completed');
                            if (historical.length !== 1 || typeof historical[0].focus !== 'string' || !historical[0].focus.trim()
                                || typeof historical[0].question !== 'string' || !historical[0].question.trim()) throw new Error('answer attribution');
                            focus = historical[0].focus; question = historical[0].question;
                        }
                        const expectedKey = jsonDigest([row(meta.source_document).file_sha256, 'answer', '', normalize(focus), question, [],
                            SOURCE_ANSWER_PROTOCOL, meta.generation ?? 0]);
                        if (expectedKey !== cacheKey) throw new Error('answer identity');
                        draftPath = childPath(source, accepted.draft); reviewPath = childPath(source, accepted.review);
                        if (!inside(await resolvedPath(source), await resolvedPath(draftPath)) || !inside(await resolvedPath(source), await resolvedPath(reviewPath))
                            || !await context.snapshots.isFile(draftPath) || !await context.snapshots.isFile(reviewPath)
                            || await sha256File(draftPath) !== accepted.draft_sha256 || await sha256File(reviewPath) !== accepted.review_sha256)
                            throw new Error('answer integrity');
                        answerDraft = checkSourceAnswer(row(parsePythonJson(new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(await readFile(draftPath)))),
                            {source:{page_count:number(row(meta.source_document).page_count)}});
                    } catch { invalidAnswers++; continue; }
                    const targetRoot=join('source-answers',cacheKey),targetDraft=join(targetRoot,'draft.json'),targetReview=join(targetRoot,'review.json');
                    const copyExact=async(from:string,to:string,expected:string)=>{
                        const destination=childPath(temporary,to);await mkdir(dirname(destination),{recursive:true});
                        await copyFile(from,destination,constants.COPYFILE_FICLONE);
                        if(await sha256File(destination)!==expected)throw new RpcError('campaign_not_ready','A copied accepted source answer changed during campaign seed',
                            {details:{reason:'source_answer_copy_integrity'}});
                    };
                    await copyExact(draftPath,targetDraft,accepted.draft_sha256);await copyExact(reviewPath,targetReview,accepted.review_sha256);
                    acceptedAnswers[cacheKey]={protocol:SOURCE_ANSWER_PROTOCOL,source_sha256:accepted.source_sha256,
                        context_generation:accepted.context_generation,focus,question,draft:targetDraft,review:targetReview,
                        draft_sha256:accepted.draft_sha256,review_sha256:accepted.review_sha256,result:sourceAnswerResult(answerDraft,id)};
                }
                const privateMeta = clone(meta);
                if (privateMeta.reading) {
                    privateMeta.reading.completed = {};
                    privateMeta.reading.answers = acceptedAnswers;
                    privateMeta.reading.answer_seed = {copied:Object.keys(acceptedAnswers).length,invalid:invalidAnswers};
                }
                // A missing index may not keep claiming a complete one: the campaign could not
                // resolve its sections, and only a real index publication can say otherwise.
                if (!indexCopied && privateMeta.reading) {
                    privateMeta.reading.index_complete = false;
                    delete privateMeta.index_file;
                }
                privateMeta.campaign_scope = campaign;
                privateMeta.source_generation = meta.generation ?? 0;
                await writeJsonAtomic(join(temporary, 'deepen-queue.json'), []);
                await writeJsonAtomic(join(temporary, 'module.json'), privateMeta);
                // Publication is one atomic rename; a failed or interrupted fork leaves no
                // readable half-workspace and no staging directory behind.
                await mkdir(dirname(destination), { recursive: true });
                try { await rename(temporary, destination); }
                catch (error) {
                    // A lock-less race lost publication to another writer; its validated seed stands.
                    await rm(temporary, { recursive: true, force: true });
                    if (!await existing()) throw error;
                }
                return scoped;
            } catch (error) {
                await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
                throw error;
            }
        });
    });
}
