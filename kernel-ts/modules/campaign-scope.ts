import {readSourceMetadata} from './source-state.js';
/** A reusable library publication seeds one independently writable campaign source. */
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { sha256File, writeJsonAtomic } from '../fileio.js';
import { canonicalJson, isJsonObject, jsonDigest, parsePythonJson } from '../json.js';
import { withOptionalExclusiveLock } from '../locks.js';
import { recordOf } from '../read/module-graph.js';
import { array, clone, equal, normalize, number, repr, row, truth, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { playsFromReading } from './bound-source.js';
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
        const sharedMeta = await readSourceMetadata(join(context.stateRoot,'modules',id),context.stateRoot,context.locks);
        if (sharedMeta) {
            const shared = sharedMeta;
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
                if(row(meta.source_reference).packet_file)await copy(row(meta.source_reference).packet_file,true);
                for(const material of array(row(meta.reading).materials))if(material.packet_file)await copy(material.packet_file,true);
                const indexCopied = await copy(meta.index_file || 'sections.json');
                await copy('assets.json');
                // Accepted guidance is keyed by source/scene/language, not by a running reader lease.
                for (const key of Object.keys(row(meta.character_guidance)))
                    {await copy(join('character-guidance', key, 'accepted.json'));await copy(join('character-guidance',key,'public.json'));}
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
                        draft_sha256:accepted.draft_sha256,review_sha256:accepted.review_sha256,result:sourceAnswerResult(answerDraft,id,row(accepted.result),row(parsePythonJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(reviewPath)))))};
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

/**
 * §184.1: the `module.json` fields the library adopts from the fork it follows. The index (`index_file` with
 * `reading.index_complete`) travels as a pair, below. `reading.map_candidates` is the index's own output, read beside
 * `index_file` by the map gate and by every assembly, so it travels with the index rows it came from. §182.2: a short
 * book's `build_complete` travels too, so every later fork starts complete. §192.1: `identity`, the answered same-name pairs,
 * travels with the nodes it answers for, so the library never raises them again.
 */
const ADOPTED_READING = ['materials', 'scene_index', 'visual_scans', 'visual_candidates', 'visual_identity', 'identity', 'missing', 'retranscriptions',
    'resolved_source_needs', 'source_need_dispositions', 'viewed_pages', 'map_candidates', 'build_complete'];
const ADOPTED_MODULE = ['prepared_openings', 'character_guidance', 'source_reference', 'vocabulary', 'languages'];
/**
 * §184.1: where a fork's artifact lands in the library when the library has no file of its own at that path. Work
 * directories are named by ordinal job id (`work/read-N/attempt-M`), and those ordinals collide between the library and
 * every fork, so a fork's file is never written into a library work directory.
 */
const SYNCED_ROOT = 'synced';

async function copyAtomic(from: string, to: string): Promise<void> {
    await mkdir(dirname(to), { recursive: true });
    const temporary = `${to}.sync-${randomUUID()}`;
    try { await copyFile(from, temporary, constants.COPYFILE_FICLONE); await rename(temporary, to); }
    catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}
const withoutGeneration = (material: Row): string => {
    const { generation: _generation, ...rest } = row(material);
    return canonicalJson(rest);
};

/**
 * §184.1: the library follows the leading fork. A campaign fork's accepted reading is source material, so after the
 * fork publishes, the library adopts it as one new library publication -- when the library's head is this fork's lineage.
 * Returns `{state: "published", library_generation}`, `{state: "skipped", reason}` or `{state: "failed", detail}`; it
 * never throws, because a sync failure never fails the fork's publication.
 *
 * The caller holds the fork's `.metadata.lock` (its Reading mutex): the fork's `library_sync` record is written under it.
 * This takes the library module's `.metadata.lock` second. Lock order: a fork publication holds fork metadata, then
 * library metadata; a fork seeding (`ensureCampaignModule`) holds the campaign's `.seed-<id>.lock`, then library
 * metadata; a library publication holds only library metadata. No holder of the library's metadata lock waits on any
 * fork's metadata or seed lock, so the order has no cycle.
 */
export async function syncLibraryFromCampaign(context: KernelContext, campaign: string, moduleId: string): Promise<Row> {
    try { return await followFork(context, campaign, moduleId); }
    catch (error) { return { state: 'failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1000) }; }
}

/**
 * §184.1's lineage test on the two module records, or the reason it fails: `not_a_fork`, `starter`, `source_mismatch`,
 * `library_advanced`; null when the library's head is this fork's lineage.
 */
function lineageRefusal(campaign: string, id: string, forkMeta: Row, libraryMeta: Row): string | null {
    if (forkMeta.id !== id || forkMeta.campaign_scope !== campaign) return 'not_a_fork';
    if (!playsFromReading(libraryMeta)) return 'starter';
    const sha = row(libraryMeta.source_document).file_sha256;
    if (libraryMeta.id !== id || typeof sha !== 'string' || !sha || sha !== row(forkMeta.source_document).file_sha256) return 'source_mismatch';
    const head = row(libraryMeta.synced_from), generation = libraryMeta.generation ?? 0;
    // The library's head is this fork's lineage when the fork was seeded from that very generation (nothing was
    // published since, by any fork or by the library itself), or when that generation is the one this campaign last
    // published there. Which campaign the library followed before does not matter: a campaign created after another
    // one's publication forks the deeper library and leads from it. A head anyone else wrote after the fork's base ends
    // the lineage (§184.4).
    const lineage = equal(generation, forkMeta.source_generation ?? null)
        || head.campaign === campaign && equal(head.library_generation, generation);
    return lineage ? null : 'library_advanced';
}

/**
 * §184.5 (bounded per call): whether this campaign's fork is the library's lineage, decided as a publication decides it,
 * without publishing: `lineage`, or the reason it is not (`not_a_fork`, `library_missing`, `starter`, `source_mismatch`,
 * `library_advanced`). The campaign's read-ahead continues a merge backlog only on `library_advanced`.
 */
export async function libraryLineage(context: KernelContext, campaign: string, moduleId: string): Promise<string> {
    const id = validateModuleId(moduleId), fork = new ModuleStore(moduleContext(context, campaign));
    const library = new ModuleStore({ ...context, moduleRoot: join(context.stateRoot, 'modules') });
    if (!await fork.exists(id) || (await fork.module(id)).campaign_scope !== campaign) return 'not_a_fork';
    if (!await library.exists(id)) return 'library_missing';
    return withOptionalExclusiveLock(context.locks, join(library.moduleDir(id), '.metadata.lock'),
        async () => lineageRefusal(campaign, id, await fork.module(id), await library.module(id)) ?? 'lineage');
}

/**
 * §192.5: the live campaigns whose fork of `moduleId` is the library's lineage by §184.1's test against `libraryMeta` (the
 * library's record as the caller read it under the library module's metadata lock). A fork is live while its campaign is: a
 * fork left behind by a campaign that no longer exists holds nothing. The repair writes the library itself only when this is
 * empty; otherwise the library takes the repair from that fork's own publication, so no lineage ends (§184.1, §184.4).
 */
export async function lineageHolders(context: KernelContext, moduleId: string, libraryMeta: Row): Promise<string[]> {
    const id = validateModuleId(moduleId), root = join(context.stateRoot, 'module-campaigns'), holders: string[] = [];
    let campaigns: string[];
    try { campaigns = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); }
    catch { return []; }
    for (const campaign of campaigns) {
        let fork: ModuleStore;
        try { fork = new ModuleStore(moduleContext(context, campaign)); }
        catch { continue; }
        if (!await fork.exists(id) || !await context.snapshots.pathExists(join(context.campaignsRoot, campaign, 'campaign.json'))) continue;
        let forkMeta: Row;
        try { forkMeta = await fork.module(id); }
        catch { continue; }
        if (lineageRefusal(campaign, id, forkMeta, libraryMeta) === null) holders.push(campaign);
    }
    return holders;
}

async function followFork(context: KernelContext, campaign: string, moduleId: string): Promise<Row> {
    const skipped = (reason: string): Row => ({ state: 'skipped', reason });
    const id = validateModuleId(moduleId), fork = new ModuleStore(moduleContext(context, campaign));
    const library = new ModuleStore({ ...context, moduleRoot: join(context.stateRoot, 'modules') });
    if (!await fork.exists(id) || (await fork.module(id)).campaign_scope !== campaign) return skipped('not_a_fork');
    if (!await library.exists(id)) return skipped('library_missing');
    const outcome = await withOptionalExclusiveLock(context.locks, join(library.moduleDir(id), '.metadata.lock'), async (): Promise<Row> => {
        // Eligibility is decided on what is current inside the lock (§184.1, "the lineage test").
        const forkMeta = await fork.module(id), libraryMeta = await library.module(id);
        const refusal = lineageRefusal(campaign, id, forkMeta, libraryMeta);
        if (refusal !== null) return skipped(refusal);
        const generation = libraryMeta.generation ?? 0;
        const forkGraph = await fork.readGraph(id), libraryGraph = await library.readGraph(id);
        if (!forkGraph) return skipped('nothing_new');

        // Where each fork artifact lives in the library. A path the library references now holds the library's own bytes,
        // which the fork copied when it was seeded (and, under the lineage test, nobody has replaced since); every other
        // artifact is carried under `synced/<campaign>/`, the fork's relative path kept, and is never written over.
        const forkDir = fork.moduleDir(id), libraryDir = library.moduleDir(id);
        const forkRoot = await resolvedPath(forkDir), libraryRoot = await resolvedPath(libraryDir);
        const local = async (root: string, resolvedRoot: string, name: string): Promise<string | null> => {
            const path = await resolvedPath(childPath(root, name));
            return inside(resolvedRoot, path) ? relative(resolvedRoot, path) : null;
        };
        const known = new Set<string>();
        const remember = async (name: unknown): Promise<void> => {
            if (typeof name !== 'string' || !name) return;
            const tail = await local(libraryDir, libraryRoot, name);
            if (tail !== null) known.add(tail);
        };
        for (const node of array(libraryGraph?.nodes)) await remember(row(row(node).properties).asset_ref);
        for (const asset of await library.assets(id)) await remember(asset.path);
        await remember(libraryMeta.index_file);
        await remember(row(libraryMeta.source_reference).packet_file);
        for (const material of array(row(libraryMeta.reading).materials)) await remember(row(material).packet_file);
        const copies = new Map<string, string>(), placed = new Map<string, string>();
        const place = async (name: any): Promise<any> => {
            if (typeof name !== 'string' || !name) return name;
            const tail = await local(forkDir, forkRoot, name);
            if (tail === null) throw new RpcError('invalid_params', 'a campaign source artifact escapes its workspace', { details: { artifact: name } });
            const hit = placed.get(tail);
            if (hit !== undefined) return hit;
            const from = join(forkRoot, tail);
            // A reference to a file the fork does not have carries nothing; it stays as the fork wrote it.
            if (!await context.snapshots.isFile(from)) return name;
            let target = tail;
            if (!known.has(tail) || !await context.snapshots.isFile(join(libraryRoot, tail))) {
                target = join(SYNCED_ROOT, campaign, tail);
                if (!inside(libraryRoot, await resolvedPath(join(libraryRoot, target))))
                    throw new RpcError('invalid_params', 'a synced source artifact escapes the module library', { details: { artifact: target } });
                if (!await context.snapshots.isFile(join(libraryRoot, target))) copies.set(target, from);
            }
            placed.set(tail, target);
            return target;
        };

        // The graph, with the campaign's opening choice removed (§22.6: the library never stores a table's opening):
        // `entry_scene_ids` and every scene record's `is_start` keep the library's own current values, and a scene the
        // library did not have gets `is_start: false`. `applyOpeningChoice` writes nothing else that is the choice.
        const graph = clone(forkGraph);
        if (libraryGraph && Object.hasOwn(libraryGraph, 'entry_scene_ids')) graph.entry_scene_ids = clone(libraryGraph.entry_scene_ids);
        else delete graph.entry_scene_ids;
        const libraryNodes = new Map(array(libraryGraph?.nodes).map(node => [row(node).node_id, row(node)]));
        for (const node of array(graph.nodes)) {
            const properties = row(row(node).properties), record = row(properties.runtime_projection).record;
            if (node.node_kind === 'scene' && isJsonObject(record) && truth(record)) {
                const before = libraryNodes.get(node.node_id);
                record.is_start = before ? recordOf(before).is_start === true : false;
            }
            if (typeof properties.asset_ref === 'string') properties.asset_ref = await place(properties.asset_ref);
        }
        // The fork's asset registry names no file the graph does not (writeGraph derives the library's registry from
        // the graph); a legacy entry that does is carried all the same.
        for (const asset of await fork.assets(id)) await place(asset.path);
        // Anything adopted is one new library generation, so every row new to the library is numbered at or below its head.
        const graphChanged = !equal(graph, libraryGraph), target = number(generation) + 1;

        // module.json: the reading state, never the campaign's private fields (§184.1, "what stays private").
        const next = clone(libraryMeta), forkReading = row(forkMeta.reading), libraryReading = row(libraryMeta.reading);
        next.reading = isJsonObject(next.reading) ? next.reading : {};
        for (const field of ADOPTED_READING)
            if (Object.hasOwn(forkReading, field)) next.reading[field] = clone(forkReading[field]);
        for (const field of ADOPTED_MODULE)
            if (Object.hasOwn(forkMeta, field)) next[field] = clone(forkMeta[field]);
        // A fork seeded without the library's index file (§22.6) has no index to give, and does not unset the library's.
        if (truth(forkReading.index_complete) && typeof forkMeta.index_file === 'string' && forkMeta.index_file) {
            next.index_file = await place(forkMeta.index_file);
            next.reading.index_complete = true;
        }
        if (isJsonObject(next.source_reference) && typeof next.source_reference.packet_file === 'string')
            next.source_reference.packet_file = await place(next.source_reference.packet_file);
        for (const material of array(next.reading.materials))
            if (isJsonObject(material) && typeof material.packet_file === 'string') material.packet_file = await place(material.packet_file);
        // A row's `generation` is this module's own numbering, which the read-ahead and the focus check compare with the
        // module's generation: a row the library already holds keeps its own, a row new to the library is published in
        // the library generation this adoption writes.
        const held = new Map<string, Row[]>();
        for (const material of array(libraryReading.materials)) {
            const key = withoutGeneration(material);
            held.set(key, [...held.get(key) ?? [], material]);
        }
        next.reading.materials = array(next.reading.materials).map(material => {
            const own = held.get(withoutGeneration(material))?.shift();
            return own ? clone(own) : isJsonObject(material) && Object.hasOwn(material, 'generation') ? { ...material, generation: target } : material;
        });
        // Accepted guidance is found by its key (`character-guidance/<key>/`), not by a pointer: same path, newest bytes.
        const guidance: Array<[string, string]> = [];
        for (const key of Object.keys(row(forkMeta.character_guidance))) {
            for (const file of ['accepted.json', 'public.json']) {
                const name = join('character-guidance', key, file), tail = await local(forkDir, forkRoot, name);
                if (tail === null || tail !== name || !inside(libraryRoot, await resolvedPath(join(libraryRoot, name))))
                    throw new RpcError('invalid_params', 'a guidance artifact escapes its module', { details: { artifact: name } });
                const from = join(forkRoot, name), to = join(libraryRoot, name);
                if (!await context.snapshots.isFile(from)) continue;
                if (await context.snapshots.isFile(to) && (await readFile(from)).equals(await readFile(to))) continue;
                guidance.push([name, from]);
            }
        }
        const metaChanged = ADOPTED_READING.some(field => !equal(next.reading[field], libraryReading[field]))
            || ADOPTED_MODULE.some(field => !equal(next[field], libraryMeta[field]))
            || !equal(next.index_file, libraryMeta.index_file) || !equal(next.reading.index_complete, libraryReading.index_complete);
        if (!graphChanged && !metaChanged && !guidance.length) return skipped('nothing_new');

        // Publication: the artifacts first (none is referenced yet, or each replaces an accepted file atomically), then
        // the one graph writer for a new generation, then the one atomic metadata write that makes it the library's head.
        for (const [to, from] of copies) await copyAtomic(from, join(libraryRoot, to));
        for (const [to, from] of guidance) await copyAtomic(from, join(libraryRoot, to));
        await library.writeGraph(next, graph);
        // Readiness is recomputed on the adopted graph the way a reading's own finish does it (§22.2).
        const prepared = new Set(array(next.reading.materials).flatMap(material => array(row(material).node_ids)));
        const opening = await library.opening(graph);
        opening.opening_ready = truth(opening.opening_ready) && prepared.has(opening.start_scene);
        next.opening = opening;
        next.opening_ready = opening.opening_ready;
        next.status = opening.opening_ready ? 'installed' : 'assembled';
        // The fork's `ready` may be its opening choice; without the choice the library is ready only on its own opening.
        const state = forkReading.state;
        next.reading.state = opening.opening_ready ? 'ready'
            : state === undefined || state === 'ready' ? (next.source_reference ? 'preparing' : 'blocked') : state;
        const at = nowIso(), forkGeneration = forkMeta.generation ?? 0;
        next.synced_from = { campaign, fork_generation: forkGeneration, library_generation: next.generation ?? 0, at };
        await library.writeModule(next);
        return { state: 'published', library_generation: next.generation ?? 0, fork_generation: forkGeneration, at };
    });
    if (outcome.state !== 'published') return outcome;
    // The fork's own record, after the library commit. The lineage test reads `synced_from` on the library, so a crash
    // between the two writes leaves the lineage intact.
    const forkMeta = await fork.module(id);
    forkMeta.library_sync = { library_generation: outcome.library_generation, fork_generation: outcome.fork_generation, at: outcome.at };
    await fork.writeModule(forkMeta);
    return { state: 'published', library_generation: outcome.library_generation };
}
