/** One persisted source queue; native descriptor leases own publication attempts. */
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { internalError, RpcError } from '../errors.js';
import { sha256File, writeJsonAtomic } from '../fileio.js';
import { compareUnicode, isJsonObject, jsonDigest, parsePythonJson } from '../json.js';
import { withExclusiveLock, type LockLease } from '../locks.js';
import type {KernelContext} from '../context.js';
import {CampaignSnapshot,loadCampaignModule} from '../read/campaign.js';
import {sourceRevision} from '../read/context.js';
import {activeMods} from '../read/mods.js';
import {assertSourcePreparationRequest,type SourcePreparationRequest} from '../../runtime/jev/source-preparation.ts';
import type {SourcePublicationAdvance} from '../../runtime/jev/read-set.ts';
import { ModuleGraph } from '../read/module-graph.js';
import { mapsDepictingScene } from '../read/maps.js';
import { array, clone, equal, integer, normalize, number, repr, row, sorted, string, truth, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { endings } from '../write/source.js';
import { validSourceLanguage, vocabulary } from './contract.js';
import { childPath, inside, resolvedPath } from './paths.js';
import { ModuleStore, validateModuleId } from './store.js';
import { applyOpeningChoice, assembleVisual, attachMapCandidates, checkDraft, checkReview, reject, resolveStartScene } from './visual.js';
import { pageSpans } from './transcription.js';
const object = (value: any): boolean => isJsonObject(value);
import { SOURCE_ANSWER_PROTOCOL, checkSourceAnswer, checkSourceAnswerReview, sourceAnswerResult } from './source-answer.js';
const PURPOSES = ['index', 'skeleton', 'guidance', 'opening', 'detail', 'answer'];
/**
 * §22.3.1: what stopped a failed reading, as the host recorded it in findings.json -- the refused field's
 * pointer, the gate's message and its stable rule. Only those strings, bounded; anything else is dropped
 * rather than refused, so a malformed record never keeps a failed job from being released.
 */
function refusalOf(value: any): Row | null {
    if (!isJsonObject(value) || typeof value.message !== 'string' || !value.message.trim()) return null;
    const out: Row = { message: value.message.slice(0, 1000) };
    for (const key of ['path', 'rule', 'reason'])
        if (typeof value[key] === 'string' && value[key]) out[key] = value[key].slice(0, 500);
    return out;
}
/** §22.2.1: the purposes that read graph material of a named focus, one reading of a focus at a time. */
const FOCUSED = ['opening', 'detail'];
const uuid = (): string => randomUUID().replaceAll('-', '');
type PublicationLease = {
    handles: LockLease[];
    moduleId: string;
    jobId: string;
    token: string;
};
export function sourcePreparationScopeMatches(current:Row,expected:Row):boolean {
    return ['campaign','worldline','loop','audience'].every(key=>current[key]===expected[key]);
}
export interface OwnedSourcePreparation {request:SourcePreparationRequest;currentRevision:string}
/** Uses the capsule's one source revision algorithm, including its current active package set. */
export async function sourcePreparationSnapshot(context:KernelContext,campaignId:string,moduleId:string,
    publication?:{meta:Row;graph:Row}):Promise<Row> {
    const campaign=await CampaignSnapshot.open(context,campaignId);
    if(campaign.meta.module_id!==moduleId)throw new RpcError('needs','The source module no longer belongs to this campaign',{details:{reason:'source_preparation_stale'}});
    let module=await loadCampaignModule(context,moduleId,campaign.world,campaignId);
    if(publication) {
        const meta=publication.meta;
        if(module.adapted||meta.id!==moduleId||meta.campaign_scope!==campaignId||typeof meta.graph_digest!=='string'||!Number.isSafeInteger(meta.generation))
            throw new RpcError('needs','The candidate publication does not belong to this source owner',{details:{reason:'source_preparation_stale'}});
        // writeGraph has created and hashed this immutable generation, but module.json still points at the old one.
        module={...module,meta,generation:meta.generation,graph:new ModuleGraph(moduleId,publication.graph,meta.graph_digest,module.graph.dossier)};
    }
    const active=await activeMods(context,campaign.world);
    const capsule={mods:{active:active.map(mod=>({id:mod.id}))}},revision=await sourceRevision(campaign,module,capsule),worldline=string(campaign.meta.active_worldline||'main');
    if(typeof revision.task_source_revision!=='string')throw new RpcError('needs','The source revision is unavailable',{details:{reason:'source_preparation_stale'}});
    let forkOriginRevision=revision.task_source_revision;
    if(module.meta.campaign_scope===campaignId) {const {campaign_scope:_scope,source_generation:_generation,...seedMeta}=module.meta;forkOriginRevision=(await sourceRevision(campaign,{...module,meta:seedMeta},capsule)).task_source_revision;}
    return {revision:revision.task_source_revision,forkOriginRevision,turn:campaign.turn.turn,status:campaign.meta.status,
        scope:{campaign:campaignId,worldline,loop:number(row(row(campaign.meta.worldlines)[worldline]).loop),audience:'keeper'}};
}
export class Reading {
    private readonly leases = new Map<string, PublicationLease>();
    private closed = false;
    private closePromise?: Promise<void>;
    constructor(readonly store: ModuleStore) { }
    private key(mid: string, job: string): string { return `${mid}/${job}`; }
    private ensureIndexJob(meta: Row, queue: Row[]): boolean {
        if (meta.source !== 'pdf' || !truth(meta.reading_version) || truth(row(meta.reading).index_complete)
            || queue.some(job => job.purpose === 'index')) return false;
        const source = row(meta.source_document), key = jsonDigest([source.file_sha256, 'index', '', '', '', []]);
        queue.push({ job_id: `read-${queue.length + 1}`, key, purpose: 'index', focus: '', question: '', pages: [], foreground: false, state: 'queued', attempts: 0, at: nowIso() });
        return true;
    }
    private owned(): void { if (this.closed)
        throw new RpcError('invalid_params', 'this reading attempt no longer owns publication'); }
    private mutex<T>(mid: string, action: () => Promise<T>): Promise<T> {
        this.owned();
        return withExclusiveLock(this.store.context.locks, join(this.store.moduleDir(mid), '.metadata.lock'), async () => { this.owned(); return action(); });
    }
    static initialState(): Row { return { state: 'indexing', index_complete: false, viewed_pages: [], materials: [], missing: [] }; }
    async contained(root: string, value: any): Promise<string> {
        if (typeof value !== 'string')
            reject('a path must be a string');
        const path = await resolvedPath(value);
        if (!inside(await resolvedPath(root), path) || !await this.store.context.snapshots.isFile(path))
            reject('the artifact must exist inside the current reading attempt');
        return path;
    }
    async bind(params: Row): Promise<Row> {
        this.owned();
        const source = params.source;
        if (!object(source) || !integer(source.page_count) || number(source.page_count) < 1)
            throw new RpcError('invalid_params', 'source needs path, file_sha256 and a positive page_count');
        const path = await resolvedPath(string(truth(source.path) ? source.path : ''));
        if (!await this.store.context.snapshots.isFile(path) || await sha256File(path) !== source.file_sha256)
            throw new RpcError('invalid_params', 'the original PDF bytes do not match source.file_sha256', { fix: 'inspect the original PDF again with the host page reader' });
        const title = string(truth(params.title) ? params.title : basename(path, extname(path)));
        return withExclusiveLock(this.store.context.locks, join(this.store.root, '.registry.lock'), async () => {
            this.owned();
            for (const mid of await this.store.ids()) {
                if ((await this.store.module(mid)).file_sha256 !== source.file_sha256)
                    continue;
                return this.mutex(mid, async () => {
                    const meta = await this.store.module(mid), destination = join(this.store.moduleDir(mid), 'source.pdf');
                    const exists = await this.store.context.snapshots.isFile(destination), corrupted = exists && await sha256File(destination) !== source.file_sha256;
                    if (!truth(meta.source_document) || !exists || corrupted) {
                        if (path !== await resolvedPath(destination)) {
                            const temporary = join(dirname(destination), `source-copy-${uuid()}.pdf`);
                            await copyFile(path, temporary);
                            if (await sha256File(temporary) !== source.file_sha256)
                                throw new RpcError('invalid_params', 'source changed during restoration');
                            if (corrupted)
                                await rename(destination, join(dirname(destination), `source-corrupt-${uuid()}.pdf`));
                            await rename(temporary, destination);
                        }
                        if (!truth(meta.source_document)) {
                            const graph = await this.store.readGraph(mid), queue = this.store.queuePath(mid);
                            if (await this.store.context.snapshots.pathExists(queue))
                                await rename(queue, join(dirname(queue), `legacy-queue-${uuid()}.json`));
                            await this.store.writeQueue(mid, []);
                            meta.reading = Reading.initialState();
                            if (truth(graph))
                                meta.reading.materials = [{ purpose: 'detail', verification: 'legacy', node_ids: array(graph!.nodes).map(n => n.node_id), generation: meta.generation ?? 0 }];
                        }
                        Object.assign(meta, { reading_version: 1, source_document: { path: 'source.pdf', file_sha256: source.file_sha256, page_count: source.page_count } });
                        meta.page_count = source.page_count;
                        await this.store.writeModule(meta);
                    }
                    return { module_id: mid, replayed: true };
                });
            }
            let mid: string;
            if (truth(params.module_id)) {
                mid = validateModuleId(params.module_id);
                if (await this.store.context.snapshots.pathExists(this.store.moduleDir(mid)))
                    throw new RpcError('invalid_params', 'this module id belongs to a different source', { fix: 'omit module_id to register a new module' });
            }
            else {
                let ordinal = 1;
                while (await this.store.context.snapshots.pathExists(this.store.moduleDir(`book-${ordinal}`)))
                    ordinal++;
                mid = `book-${ordinal}`;
            }
            const directory = this.store.moduleDir(mid);
            await mkdir(dirname(directory), { recursive: true });
            await mkdir(directory);
            await copyFile(path, join(directory, 'source.pdf'));
            if (await sha256File(join(directory, 'source.pdf')) !== source.file_sha256)
                throw new RpcError('invalid_params', 'source changed during registration');
            const meta = {
                id: mid, title, source: 'pdf', reading_version: 1,
                source_document: { path: 'source.pdf', file_sha256: source.file_sha256, page_count: source.page_count },
                file_sha256: source.file_sha256, page_count: source.page_count, languages: truth(params.language) ? [params.language] : [],
                generation: 0, status: 'registered', created_at: nowIso(), opening_ready: false, reading: Reading.initialState(),
            };
            await this.store.writeSections(mid, []);
            await this.store.writeQueue(mid, []);
            await this.store.writeModule(meta);
            return { module_id: mid, replayed: false };
        });
    }
    async source(meta: Row): Promise<Row> {
        const source = meta.source_document;
        const missing = (message: string): never => { throw new RpcError('needs', message, { fix: 'bind the matching original PDF with module.source.bind', details: { reason: 'needs_source' } }); };
        // Contract §127.2: a module that never came from a document (a built-in starter) has nothing
        // to bind. Its refusal names the reads that do work instead of an instruction the Keeper
        // cannot carry out, and an error's fix is executed literally.
        if (!object(source) && meta.source !== 'pdf')
            throw new RpcError('needs', 'this module has no original source document: its authored graph is the whole source', {
                fix: 'read what the module authored instead: lookup kind=module with a name or the exact handles already in your capsule (several handles may share one query),'
                    + ' or look focus=npc name=<person>, focus=scene or focus=clues; there is no document to consult or bind for this module',
                details: { reason: 'no_source_document' } });
        if (!object(source))
            missing('the original PDF is required for further reading');
        let path = childPath(this.store.moduleDir(meta.id), source.path);
        if (!await this.store.context.snapshots.isFile(path))
            missing('the original PDF is unavailable for further reading');
        path = await this.contained(this.store.moduleDir(meta.id), path);
        if (await sha256File(path) !== source.file_sha256)
            throw new RpcError('invalid_params', 'the registered original PDF was modified', { fix: 'supply the matching original source' });
        return { ...source, path };
    }
    async materialReady(mid: string, name: string): Promise<boolean> {
        const meta = await this.store.module(mid);
        if (!truth(meta.reading_version))
            return this.store.context.snapshots.pathExists(await this.store.graphPath(mid));
        const graph = await this.store.readGraph(mid) || {}, key = normalize(name);
        const matched = array(graph.nodes).filter(node => [node.node_id, node.node_id.startsWith(node.node_kind + '-') ? node.node_id.slice(node.node_kind.length + 1) : node.node_id, node.name ?? '', ...array(node.aliases)].some(value => normalize(value) === key)).map(node => node.node_id);
        const ready = new Set(array(row(meta.reading).materials).flatMap(material => array(material.node_ids)));
        return matched.length > 0 && matched.every(id => ready.has(id));
    }
    async openingReady(mid: string, focus = ''): Promise<boolean> {
        const meta = await this.store.module(mid);
        if (!focus)
            return truth(meta.opening_ready);
        const graph = await this.store.readGraph(mid) || {}, contract = await this.store.contract(), chosen = resolveStartScene(graph, focus, contract);
        if (chosen === null || !await this.materialReady(mid, chosen))
            return false;
        // Readiness is the snapshot taken at publication (§90.4): nothing re-judges a book that is
        // already installed, so a rule that arrived after the opening was published cannot revoke it.
        // The roll-up answers for the book's own start; a chosen scene the book was published ready
        // on answers from that publication. Only a scene neither has met is derived here.
        const snapshot = row(meta.opening).start_scene === chosen ? row(meta.opening) : row(row(meta.prepared_openings)[chosen]);
        if (Object.hasOwn(snapshot, 'opening_ready'))
            return truth(snapshot.opening_ready);
        applyOpeningChoice(graph, chosen, contract);
        return truth((await this.store.opening(graph)).opening_ready);
    }
    async requireMapMaterial(graph: ModuleGraph, params: Row): Promise<void> {
        const requested = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : 'the current location';
        const bounded = requested.slice(0, 160);
        const hasMap = [...graph.nodes.values()].some((node: Row) => array(node.properties?.map_regions).length > 0);
        if (hasMap) return;
        // An adapted campaign plays a pinned source: it neither inherits later library publications
        // nor reads new material into the pinned view. New map material enters through a reviewed
        // rebase, so the shared library is never consulted here.
        if (graph.materialOverride)
            throw new RpcError('needs', `the pinned source has no prepared map for ${bounded}`, {
                fix: 'prepare and review the source material as an adaptation rebase before showing this map',
                details: { reason: 'adaptation_material_missing', focus: bounded },
            });
        const mid = graph.moduleId, meta = await this.store.module(mid);
        if (meta.source !== 'pdf') return;
        const ready = array(meta.reading?.materials).some(material => material.material === 'map' && normalize(material.focus ?? '') === normalize(bounded));
        if (ready) return;
        const candidates = array(meta.reading?.map_candidates).filter(candidate =>
            !params.name || normalize(candidate.name) === normalize(params.name) || normalize(candidate.focus ?? '') === normalize(params.name));
        const pages = [...new Set(candidates.flatMap(candidate => array(candidate.pages).map(number)).filter(page => page > 0))].sort((a, b) => a - b);
        const question = `Identify the source-backed map material needed to orient investigators at ${bounded}; extract only independently revealable map regions and safe place correspondence.`;
        throw new RpcError('needs', `the map material for ${bounded} is not prepared`, {
            fix: 'read the required map material before retrying this unchanged look',
            details: { reason: 'material_pending', read: { purpose: 'detail', material: 'map', focus: bounded, question, ...(pages.length ? { pages } : {}) } },
        });
    }
    async requireArrivalMapMaterial(graph: ModuleGraph, scene: Row): Promise<void> {
        if (mapsDepictingScene(graph, scene).length) return;
        const candidates = array(row(scene.properties).map_candidates);
        if (!candidates.length) return;
        const focus = graph.handle(scene), names = candidates.map(candidate => string(row(candidate).name)).filter(Boolean);
        const pages = [...new Set(candidates.flatMap(candidate => array(row(candidate).pages).filter(integer).map(number)))].filter(page => page > 0).sort((a, b) => a - b);
        if (!pages.length) return;
        if (graph.materialOverride)
            throw new RpcError('needs', `the pinned source has no prepared map for ${focus}`, {
                fix: 'prepare and review the source material as an adaptation rebase before showing this map',
                details: { reason: 'adaptation_material_missing', focus },
            });
        const meta = await this.store.module(graph.moduleId);
        if (meta.source !== 'pdf') return;
        const ready = array(meta.reading?.materials).some(material => material.material === 'map' && normalize(material.focus ?? '') === normalize(focus));
        if (ready) return;
        const question = `Prepare the source-backed map${names.length === 1 ? ` ${names[0]}` : names.length ? `s ${names.join(', ')}` : ''} that depicts ${graph.displayName(scene)}; extract only independently revealable regions and safe place correspondence.`;
        throw new RpcError('needs', `the map material for ${focus} is not prepared`, {
            fix: 'read the required map material before retrying this unchanged move',
            details: { reason: 'material_pending', read: { purpose: 'detail', material: 'map', focus, question, pages } },
        });
    }
    async requireMaterial(graph: ModuleGraph, names: any[]): Promise<void> {
        if (graph.materialOverride) {
            for (const name of names) if (typeof name === 'string' && graph.find(name) && graph.materialOverride(name) !== 'ready')
                throw new RpcError('needs', 'The pinned source material is not prepared; read the source and prepare a reviewed rebase', {details: {reason: 'adaptation_material_missing', focus: name}});
            return;
        }
        const mid = graph.moduleId;
        if (!await this.store.exists(mid) || !truth((await this.store.module(mid)).reading_version))
            return;
        const indexed = new Set((await this.store.sections(mid)).flatMap(section => [section.name ?? '', ...array(section.entities)]).filter(value => typeof value === 'string').map(normalize));
        for (const name of names) {
            if (typeof name !== 'string' || !name || await this.materialReady(mid, name))
                continue;
            const node = graph.find(name);
            if (node === null && !indexed.has(normalize(name)))
                continue;
            const focus = node ? graph.handle(node) : name;
            throw new RpcError('needs', `the source material for ${repr(focus)} is not prepared`, {
                fix: 'read the required material before retrying this unchanged action',
                details: { reason: 'material_pending', read: { purpose: 'detail', focus } },
            });
        }
    }
    async queueAdjacentReading(graph: ModuleGraph, scene: Row): Promise<string[]> {
        if (graph.materialOverride) return [];
        const mid = graph.moduleId, queued: string[] = [];
        if (!await this.store.exists(mid) || !truth((await this.store.module(mid)).reading_version))
            return queued;
        for (const exit of graph.sceneExits(scene)) {
            if (await this.materialReady(mid, graph.scene(exit.to).node_id))
                continue;
            let reply: Row;
            try {
                reply = await this.request({ module_id: mid, purpose: 'detail', focus: exit.to });
            }
            catch (error) {
                if (!(error instanceof RpcError) && !(error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string' && typeof (error as NodeJS.ErrnoException).syscall === 'string'))
                    throw error;
                const formatted = error instanceof RpcError ? error.message : internalError(error).message;
                const detail = error instanceof RpcError ? formatted : formatted.slice(formatted.indexOf(': ') + 2);
                await this.store.appendBuildLog(mid, { event: 'prefetch-unavailable', detail });
                return queued;
            }
            if (truth(reply.job_id))
                queued.push(reply.job_id);
        }
        return queued;
    }
    /** Maintain source-backed routes without interpreting page order or the scene's prose. */
    async queueAheadReading(params: Row): Promise<Row> {
        const mid = validateModuleId(params.module_id), queued: string[] = [];
        if (!await this.store.exists(mid)) return { queued };
        const meta = await this.store.module(mid), reading = row(meta.reading);
        if (!truth(meta.reading_version)) return { queued };
        const ask = async (request: Row): Promise<Row | null> => {
            try {
                const reply = await this.request({ module_id: mid, foreground: false, ...request });
                if (truth(reply.job_id) && ['queued', 'reading'].includes(string(reply.state))) queued.push(string(reply.job_id));
                return reply;
            }
            catch (error) {
                if (!(error instanceof RpcError)) throw error;
                await this.store.appendBuildLog(mid, { event: 'read-ahead-unavailable', focus: string(request.focus ?? ''), detail: error.message });
                return null;
            }
        };
        if (!truth(reading.index_complete)) await ask({ purpose: 'index', focus: '' });
        if (!await this.store.readGraph(mid)) return { queued, reason: 'index' };
        const graph = await this.store.graph(mid);
        let scene: Row;
        try { scene = truth(params.focus) ? graph.scene(string(params.focus)) : graph.startScene(); }
        catch (error) { if (!(error instanceof RpcError)) throw error; return { queued, reason: 'no_scene' }; }
        const exits = graph.sceneExits(scene);
        const isEntrance = (await this.store.candidates(graph.raw)).some(candidate => candidate.node_id === scene.node_id || candidate.scene_id === graph.handle(scene));
        let wayOn: Row | null = null;
        if (!exits.length && isEntrance && !endings(graph.raw).ids.includes(string(scene.node_id))) {
            const reply = await ask({ purpose: 'opening', focus: graph.handle(scene), repair: 'way_on' });
            if (reply) wayOn = { scene: string(scene.node_id), state: reply.state, job_id: reply.job_id ?? null };
        }
        queued.push(...await this.queueAdjacentReading(graph, scene));
        return { queued: [...new Set(queued)], scene: scene.node_id, ...(wayOn ? { way_on: wayOn } : {}) };
    }
    async peekAnswer(params: Row): Promise<Row> {
        const mid = validateModuleId(params.module_id), meta = await this.store.module(mid);
        if (typeof params.question !== 'string' || !params.question || typeof (params.focus ?? '') !== 'string')
            throw new RpcError('invalid_params', 'A source answer cache lookup requires question and optional focus');
        const source = row(meta.source_document);
        if (typeof source.file_sha256 !== 'string') return {cached: false};
        const cacheKey = jsonDigest([source.file_sha256, 'answer', '', normalize(params.focus ?? ''), params.question, [], SOURCE_ANSWER_PROTOCOL, meta.generation ?? 0]);
        const accepted = row(row(row(meta.reading).answers)[cacheKey]);
        if (!accepted.draft || accepted.source_sha256 !== source.file_sha256 || !equal(accepted.context_generation, meta.generation ?? 0)) return {cached: false};
        const draftPath = await this.contained(this.store.moduleDir(mid), join(this.store.moduleDir(mid), accepted.draft));
        const reviewPath = await this.contained(this.store.moduleDir(mid), join(this.store.moduleDir(mid), accepted.review));
        const [draftBytes, reviewBytes] = await Promise.all([readFile(draftPath), readFile(reviewPath)]);
        const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
        if (hash(draftBytes) !== accepted.draft_sha256 || hash(reviewBytes) !== accepted.review_sha256)
            throw new RpcError('needs', 'Retained source answer evidence changed', {details: {reason: 'source_answer_integrity'}});
        const draft = row(parsePythonJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(draftBytes)));
        const current = await this.store.module(mid);
        if (!equal(current.generation ?? 0, meta.generation ?? 0) || row(current.source_document).file_sha256 !== source.file_sha256)
            throw new RpcError('needs', 'Source changed during cache lookup', {details: {reason: 'source_context_changed'}});
        return {cached: true, source_answer: {...sourceAnswerResult(draft, mid), derivation: 'checked_summary'}, evidence: {
            resource: `source-answer:${mid}:${cacheKey}`, revision: accepted.draft_sha256, accepted_revision: accepted.draft_sha256,
            derived: true, record: draft, source_sha256: source.file_sha256,
        }};
    }
    /** Host-only bounded catalogue of accepted source answers plus the bound original source. */
    async materialSnapshot(params: Row): Promise<Row> {
        if (Object.keys(params).some(key => !['campaign', 'module_id', 'answer_limit', 'answer_cursor'].includes(key)))
            throw new RpcError('invalid_params', 'Source material snapshot accepts campaign, module_id, answer_limit and answer_cursor');
        const mid = validateModuleId(params.module_id), limit = params.answer_limit ?? 16, cursor = params.answer_cursor ?? 0;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 || !Number.isSafeInteger(cursor) || cursor < 0)
            throw new RpcError('invalid_params', 'answer_limit must be 1-64 and answer_cursor a nonnegative integer');
        const meta = await this.store.module(mid), source = row(meta.source_document);
        if (source.path !== 'source.pdf' || typeof source.file_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.file_sha256)
            || !Number.isSafeInteger(source.page_count) || source.page_count < 1)
            throw new RpcError('needs', 'This module has no valid bound original PDF', {details: {reason: 'source_unavailable'}});
        const snapshotRevision = jsonDigest({source, generation: meta.generation ?? 0, graph_digest: meta.graph_digest ?? null});
        const queue = await this.store.queue(mid), accepted = row(row(meta.reading).answers), acceptedDigest = jsonDigest(accepted),
            seedDigest = jsonDigest(row(row(meta.reading).answer_seed)),
            answerJobs = (rows:Row[]) => rows.filter(job => job.purpose === 'answer').map(job => Object.fromEntries(
                ['job_id', 'key', 'purpose', 'focus', 'question', 'state'].map(key => [key, job[key] ?? null]))),
            queueDigest = jsonDigest(answerJobs(queue)), checked: Row[] = [], revisionRows: Row[] = [];
        let invalid = number(row(meta.reading).answer_seed?.invalid);
        for (const cacheKey of Object.keys(accepted).sort(compareUnicode)) {
            const record = row(accepted[cacheKey]), base = {key: cacheKey, source_sha256: record.source_sha256 ?? null,
                context_generation: record.context_generation ?? null, draft_sha256: record.draft_sha256 ?? null, review_sha256: record.review_sha256 ?? null};
            let draftActual = 'unavailable', reviewActual = 'unavailable', resolvedFocus: string | null = null,
                resolvedQuestion: string | null = null, valid = false;
            try {
                if (record.source_sha256 !== source.file_sha256 || !equal(record.context_generation, meta.generation ?? 0)
                    || typeof record.draft !== 'string' || typeof record.review !== 'string'
                    || typeof record.draft_sha256 !== 'string' || typeof record.review_sha256 !== 'string') throw new Error('invalid binding');
                const draftPath = await this.contained(this.store.moduleDir(mid), join(this.store.moduleDir(mid), record.draft));
                const reviewPath = await this.contained(this.store.moduleDir(mid), join(this.store.moduleDir(mid), record.review));
                draftActual = await sha256File(draftPath); reviewActual = await sha256File(reviewPath);
                if (draftActual !== record.draft_sha256 || reviewActual !== record.review_sha256) throw new Error('integrity');
                let focus = typeof record.focus === 'string' && record.focus.trim() ? record.focus : undefined;
                let question = typeof record.question === 'string' && record.question.trim() ? record.question : undefined;
                if (!focus || !question) {
                    const historical = queue.filter(job => job.key === cacheKey && job.purpose === 'answer' && job.state === 'completed');
                    if (historical.length !== 1 || typeof historical[0].focus !== 'string' || !historical[0].focus.trim()
                        || typeof historical[0].question !== 'string' || !historical[0].question.trim()) throw new Error('unattributed');
                    focus = historical[0].focus; question = historical[0].question;
                }
                const expectedKey = jsonDigest([source.file_sha256, 'answer', '', normalize(focus), question, [], SOURCE_ANSWER_PROTOCOL, meta.generation ?? 0]);
                if (expectedKey !== cacheKey) throw new Error('answer identity mismatch');
                resolvedFocus = focus; resolvedQuestion = question;
                const draft = checkSourceAnswer(row(parsePythonJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await readFile(draftPath)))),
                    {source: {page_count: source.page_count}});
                const answer = sourceAnswerResult(draft, mid);
                checked.push({key: cacheKey, focus, question, ...answer, evidence: {resource: `source-answer:${mid}:${cacheKey}`,
                    revision: record.draft_sha256, accepted_revision: record.draft_sha256, derived: true, record: draft,
                    source_sha256: source.file_sha256}});
                valid = true;
            } catch { invalid++; }
            revisionRows.push({...base, draft_actual: draftActual, review_actual: reviewActual, valid,
                focus: resolvedFocus, question: resolvedQuestion});
        }
        const current = await this.store.module(mid), currentSource = row(current.source_document), currentQueue = await this.store.queue(mid);
        if (jsonDigest({source: currentSource, generation: current.generation ?? 0, graph_digest: current.graph_digest ?? null}) !== snapshotRevision
            || jsonDigest(row(row(current.reading).answers)) !== acceptedDigest || jsonDigest(row(row(current.reading).answer_seed)) !== seedDigest
            || jsonDigest(answerJobs(currentQueue)) !== queueDigest)
            throw new RpcError('needs', 'Source changed during material snapshot', {details: {reason: 'source_context_changed'}});
        const answerRevision = jsonDigest({source_sha256: source.file_sha256, generation: meta.generation ?? 0, seed_invalid: number(row(meta.reading).answer_seed?.invalid), answers: revisionRows});
        const page = checked.slice(cursor, cursor + limit), next = cursor + page.length < checked.length ? cursor + page.length : null;
        return {version: 1, module_id: mid, generation: meta.generation ?? 0,
            revision: snapshotRevision,
            pdf: join(this.store.moduleDir(mid), 'source.pdf'), file_sha256: source.file_sha256, page_count: source.page_count,
            answers_revision: answerRevision, checked_answers: page, checked_answers_omitted: checked.length - page.length,
            checked_answers_invalid: invalid, next};
    }
    /**
     * §22.2.1: which focus a reading reads, by structure: the graph nodes a focus names by id, handle, name
     * or alias (the match `materialReady` uses), else the normalized focus itself. Two foci are one focus
     * when those sets meet; an empty focus is its own identity, as the spelled comparison had it.
     */
    private async focusIdentity(mid: string): Promise<(focus: any) => Set<string>> {
        const nodes = array(row(await this.store.readGraph(mid)).nodes);
        return (focus: any) => {
            const key = normalize(string(focus ?? ''));
            const ids = key ? nodes.filter(node => typeof node.node_id === 'string' && [node.node_id,
                node.node_id.startsWith(node.node_kind + '-') ? node.node_id.slice(node.node_kind.length + 1) : node.node_id,
                node.name ?? '', ...array(node.aliases)].some(value => typeof value === 'string' && normalize(value) === key)).map(node => `node:${node.node_id}`) : [];
            return new Set(ids.length ? ids : [`name:${key}`]);
        };
    }
    private static meet(a: Set<string>, b: Set<string>): boolean { return [...a].some(id => b.has(id)); }
    async request(params: Row, preparation?:OwnedSourcePreparation): Promise<Row> {
        const mid = validateModuleId(params.module_id), purpose = params.purpose;
        if (!PURPOSES.includes(purpose))
            throw new RpcError('invalid_params', `purpose must be one of ${repr(PURPOSES)}`);
        // A repair asks the reader for one named thing on top of a completed reading (§90.3, thin-book-play B0);
        // it is its own reading identity, so the completed one neither answers for it nor blocks it.
        const repair = params.repair;
        if (repair !== undefined && (repair !== 'way_on' || purpose !== 'opening'))
            throw new RpcError('invalid_params', 'repair is way_on, and only on an opening reading');
        return this.mutex(mid, async () => {
            const meta = await this.store.module(mid);
            if(preparation) {
                assertSourcePreparationRequest(preparation.request);
                const replay=[...await this.store.queue(mid)].reverse().find(job=>row(row(job.task_preparation).request).authority?.token===preparation.request.authority.token);
                const committed=replay?row(row(meta.reading).completed)[replay.job_id]:undefined;
                if(row(committed)._task_source_advance)return {...committed,replayed:true};
            }
            if (Object.hasOwn(params, 'context_generation')) {
                if (purpose !== 'answer' || !integer(params.context_generation) || number(params.context_generation) < 0)
                    throw new RpcError('invalid_params', 'context_generation is a nonnegative answer-wait generation');
                if (!equal(params.context_generation, meta.generation ?? 0))
                    throw new RpcError('needs', 'source context changed while this consultation was waiting', {
                        fix: 'on a later player turn, repeat lookup kind=source source_mode=answer with the exact focus and question; this wait did not start another reading',
                        details: { reason: 'source_context_changed', read: { purpose: 'answer', source_mode: 'answer', focus: params.focus, question: params.question } },
                    });
            }
            // A cached ready result cannot authorize consuming an altered published generation.
            if (purpose !== 'index') await this.store.readGraph(mid);
            if (!Object.hasOwn(meta, 'reading'))
                meta.reading = Reading.initialState();
            const reading = meta.reading;
            let focus = truth(params.focus) ? params.focus : '';
            const question = truth(params.question) ? params.question : '';
            if (purpose === 'opening' && !truth(focus) && truth(meta.opening_choice))
                focus = meta.opening_choice.start_scene;
            const material = params.material;
            if (material !== undefined && material !== 'map')
                throw new RpcError('invalid_params', 'material must be map when supplied');
            if (material !== undefined && purpose !== 'detail')
                throw new RpcError('invalid_params', 'material is only supported for detail readings');
            if (typeof focus !== 'string' || typeof question !== 'string')
                throw new RpcError('invalid_params', 'focus and question must be strings');
            if (purpose === 'detail' && !focus.trim())
                throw new RpcError('invalid_params', 'a detail reading needs a named focus', { fix: 'pass the entity or place as focus, and the unresolved question when known' });
            if (purpose === 'answer' && (!focus.trim() || !question.trim()))
                throw new RpcError('invalid_params', 'a source consultation needs a named focus and a nonempty question');
            const result = { generation: meta.generation ?? 0, missing: [] }, guidanceKey = params.guidance_key;
            if (purpose === 'guidance') {
                // Any tag-shaped play_language is accepted (contract section 23); membership is never checked.
                if (typeof guidanceKey !== 'string' || guidanceKey.length !== 64 || !/^[a-f0-9]{64}$/.test(guidanceKey) || !validSourceLanguage(params.play_language) || !Array.isArray(params.occupations))
                    throw new RpcError('invalid_params', 'guidance needs a host fingerprint, a tag-shaped play_language and an occupation catalog');
                const accepted = row(meta.character_guidance)[guidanceKey];
                if (truth(accepted))
                    return { ...result, state: 'ready', setup_ready: true, guidance_key: guidanceKey, ...accepted };
            }
            if (purpose === 'skeleton' && truth(await this.store.readGraph(mid)) ||
                purpose === 'opening' && !repair && await this.openingReady(mid, focus) ||
                purpose === 'detail' && !question && await this.materialReady(mid, focus) ||
                purpose === 'index' && truth(reading.index_complete))
                return { ...result, state: 'ready' };
            const source = await this.source(meta), pages: number[] = material === 'map'
                ? [...new Set(array(row(reading).map_candidates).flatMap((candidate: Row) => array(candidate.pages).map(number)))].filter(page => page >= 1 && page <= source.page_count).sort((a, b) => a - b)
                : [];
            const identity: any[] = [source.file_sha256, purpose, material ?? '', normalize(focus), question, pages];
            if (purpose === 'guidance')
                identity.push(guidanceKey);
            if (repair)
                identity.push('repair', repair);
            if (purpose === 'answer') identity.push(SOURCE_ANSWER_PROTOCOL, meta.generation ?? 0);
            const key = jsonDigest(identity);
            if (purpose === 'answer') {
                const accepted = row(reading.answers)[key];
                if (accepted) {
                    const draftPath = await this.contained(this.store.moduleDir(mid), join(this.store.moduleDir(mid), accepted.draft));
                    const reviewPath = await this.contained(this.store.moduleDir(mid), join(this.store.moduleDir(mid), accepted.review));
                    if (await sha256File(draftPath) !== accepted.draft_sha256 || await sha256File(reviewPath) !== accepted.review_sha256)
                        throw new RpcError('needs', 'retained source answer evidence changed', { details: { reason: 'source_answer_integrity' } });
                    return { ...result, state: 'ready', source_answer: accepted.result };
                }
            }
            if (purpose === 'detail' && array(reading.materials).some(material => material.key === key))
                return { ...result, state: 'ready' };
            const queue = await this.store.queue(mid), existing = [...queue].reverse().find(job => job.key === key);
            // §22.2.1: a focus already being read is not read again until that reading settles; this request
            // attaches to the reading in flight and is judged afresh once it has settled.
            // An owned source preparation keeps the job identity it binds (§22.4 answer/prepare ownership).
            let settling: Row | undefined;
            if (!preparation && !(existing && ['queued', 'running'].includes(existing.state)) && FOCUSED.includes(purpose) && focus.trim()) {
                const identity = await this.focusIdentity(mid), wanted = identity(focus);
                settling = queue.find(job => job.state === 'running' && FOCUSED.includes(job.purpose) && Reading.meet(identity(job.focus), wanted));
            }
            if (settling) {
                if (truth(params.foreground) && !truth(settling.foreground)) {
                    settling.foreground = true;
                    await this.store.writeQueue(mid, queue);
                }
                return { ...result, state: settling.state === 'running' ? 'reading' : 'queued', job_id: settling.job_id, attached: true };
            }
            if (existing) {
                if (['queued', 'running'].includes(existing.state)) {
                    let boundPreparation=false;
                    if(preparation&&!equal(existing.task_preparation,preparation)) {
                        // Prefetch can enqueue an exact reading before any owner has claimed it.
                        // Bind only that untouched queue entry; another worker's attempt is never adopted.
                        if(existing.state!=='queued'||existing.task_preparation!==undefined||existing.attempts!==0
                            ||existing.owner!==undefined||existing.lease!==undefined||existing.work_dir!==undefined)
                            throw new RpcError('needs','This source job does not belong to this pending operation',{details:{reason:'source_preparation_foreign_job'}});
                        existing.task_preparation=clone(preparation);
                        boundPreparation=true;
                    }
                    if (truth(params.foreground)) {
                        existing.foreground = true;
                    }
                    if(boundPreparation||truth(params.foreground))await this.store.writeQueue(mid,queue);
                    return { ...result, state: existing.state === 'running' ? 'reading' : 'queued', job_id: existing.job_id };
                }
                if (existing.state === 'completed') {
                    if (purpose === 'answer') throw new RpcError('needs', 'the completed source answer has no accepted evidence', { details: { reason: 'source_answer_integrity' } });
                    // A refusal names what is missing (§46.1); a completed reading that still answers
                    // nothing is the snapshot's own list, and an empty one is not a refusal at all.
                    const missing = array(row(meta.opening).missing);
                    if (!missing.length)
                        return { ...result, state: 'ready' };
                    return { ...result, state: 'blocked', missing, opening: meta.opening ?? null, fix: 'choose an authored opening, then request preparation again' };
                }
                if (!truth(params.retry))
                    return { ...result, state: 'blocked', missing: [existing.detail ?? 'reading failed'], ...(existing.refusal ? { refusal: existing.refusal } : {}), fix: 'request the same reading with retry: true' };
            }
            const job: Row = { job_id: `read-${queue.length + 1}`, key, purpose, ...(material ? { material } : {}), ...(repair ? { repair } : {}), focus, question, pages, foreground: truth(params.foreground), state: 'queued', attempts: 0, at: nowIso() };
            if(preparation)job.task_preparation=clone(preparation);
            if (purpose === 'answer') job.context_generation = meta.generation ?? 0;
            // The repair extends the reading it repairs: the reader starts from that draft, not from nothing.
            if (repair && !existing) {
                // The reading it extends is the one on this scene, or the book's own opening read with no focus.
                const completedReading = (jobs: Row[]) => [...jobs].reverse().find(job => job.purpose === purpose && job.state === 'completed' && truth(job.work_dir) && (normalize(job.focus ?? '') === normalize(focus) || !string(job.focus ?? '').trim()));
                let done = completedReading(queue);
                // A campaign's fork starts with an empty queue; the reading it repairs was published in the shared library.
                if (!done) {
                    const libraryRoot = join(this.store.context.stateRoot, 'modules');
                    if (libraryRoot !== this.store.root) {
                        const library = new ModuleStore({ ...this.store.context, moduleRoot: libraryRoot });
                        if (await library.exists(mid)) done = completedReading(await library.queue(mid));
                    }
                }
                if (done) job.resume_from = done.work_dir;
            }
            if (purpose === 'guidance')
                for (const key of ['guidance_key', 'play_language', 'occupations'])
                    job[key] = params[key];
            if (truth(existing?.work_dir))
                job.resume_from = existing!.work_dir;
            queue.push(job);
            await this.store.writeQueue(mid, queue);
            return { ...result, state: 'queued', job_id: job.job_id };
        });
    }
    /**
     * Contract §61. `foreground` is a claim that a turn is blocked on this reading, and it is
     * what reserves the single foreground lease in `claim`. Promotion had a writer -- every foreground
     * `request` for a job already queued or running sets it -- and nothing ever unset it, so the lease
     * stayed reserved for a wait that had already ended. The host calls this when the last waiter for
     * a reading leaves without cancelling it: the job keeps running and its material still lands
     * (§47), but the foreground lane goes back to whichever turn is actually blocked. Idempotent:
     * a finished job, an unknown one and an already-background one all answer the same way.
     */
    async unwait(params: Row): Promise<Row> {
        const mid = validateModuleId(params.module_id), jobId = params.job_id;
        if (typeof jobId !== 'string' || !jobId)
            throw new RpcError('invalid_params', 'params.job_id is required');
        return this.mutex(mid, async () => {
            const queue = await this.store.queue(mid), job = queue.find(entry => entry.job_id === jobId);
            if (job && ['queued', 'running'].includes(string(job.state)) && truth(job.foreground)) {
                job.foreground = false;
                await this.store.writeQueue(mid, queue);
            }
            return { job_id: jobId, foreground: false };
        });
    }
    async claim(params: Row): Promise<Row> {
        const mid = validateModuleId(params.module_id), directory = this.store.moduleDir(mid);
        return this.mutex(mid, async () => {
            const meta = await this.store.module(mid), source = await this.source(meta), queue = await this.store.queue(mid), active: Row[] = [];
            this.ensureIndexJob(meta, queue);
            for (const stale of queue) {
                const committed = row(row(meta.reading).completed)[stale.job_id];
                if (truth(committed)) {
                    Object.assign(stale, { state: 'completed', result: committed });
                    await this.release(mid, stale.job_id);
                }
                if (stale.state === 'running') {
                    if (this.leases.has(this.key(mid, stale.job_id))) {
                        active.push(stale);
                        continue;
                    }
                    const probe = await this.store.context.locks.acquire(join(directory, equal(stale.lock_version, 2) ? `.job-${stale.job_id}.lock` : '.reader.lock'), 'exclusive', { nonblocking: true });
                    if (probe === null) {
                        active.push(stale);
                        continue;
                    }
                    await probe.release();
                    stale.state = 'queued';
                }
                if (stale.state === 'queued' && (stale.purpose === 'index' && truth(meta.reading.index_complete) ||
                    stale.purpose === 'opening' && await this.openingReady(mid, stale.focus ?? '') ||
                    stale.purpose === 'detail' && !truth(stale.question) && await this.materialReady(mid, stale.focus))) {
                    Object.assign(stale, { state: 'completed', finished_at: nowIso(), reused_generation: meta.generation ?? 0, result: { state: 'ready', generation: meta.generation ?? 0, opening_ready: truth(meta.opening_ready) } });
                }
            }
            const purposePriority = (job: Row): number => job.purpose === 'opening' ? 0 : job.purpose === 'index' ? 2 : 1;
            const pending = queue.filter(job => job.state === 'queued').sort((a, b) =>
                Number(!truth(a.foreground)) - Number(!truth(b.foreground)) ||
                purposePriority(a) - purposePriority(b) || compareUnicode(a.at, b.at));
            if (active.length >= 3) {
                await this.store.writeQueue(mid, queue);
                return { job_id: null };
            }
            const identity = pending.length && active.length ? await this.focusIdentity(mid) : () => new Set<string>();
            for (const job of pending) {
                if (job.purpose === 'answer' && !equal(job.context_generation, meta.generation ?? 0)) {
                    Object.assign(job, { state: 'failed', detail: 'source context changed; request a fresh consultation' });
                    continue;
                }
                const foreground = truth(job.foreground);
                if (active.filter(other => truth(other.foreground) === foreground).length >= (foreground ? 1 : 2)
                    // §22.2.1: never two readings of one focus at once, by the focus's identity rather than its spelling.
                    || active.some(other => Reading.meet(identity(other.focus), identity(job.focus))))
                    continue;
                const shared = await this.store.context.locks.acquire(join(directory, '.reader.lock'), 'shared', { nonblocking: true });
                if (!shared)
                    continue;
                let individual: LockLease | null;
                try {
                    individual = await this.store.context.locks.acquire(join(directory, `.job-${job.job_id}.lock`), 'exclusive', { nonblocking: true });
                }
                catch (error) {
                    await shared.release();
                    throw error;
                }
                if (!individual) {
                    await shared.release();
                    continue;
                }
                const handles = [shared, individual];
                try {
                    this.owned();
                    const preparation=job.task_preparation as OwnedSourcePreparation|undefined;
                    if(preparation) {
                        const current=await sourcePreparationSnapshot(this.store.context,preparation.request.authority.campaign,mid);
                        if(current.revision!==preparation.currentRevision||!sourcePreparationScopeMatches(current.scope,preparation.request.authority.scope)||current.turn!==preparation.request.authority.turn)
                            throw new RpcError('needs','Source context changed before its owned preparation claim',{details:{reason:'source_preparation_stale'}});
                    }
                    if (truth(job.work_dir))
                        job.resume_from = job.work_dir;
                    Object.assign(job, { state: 'running', owner: string(truth(params.owner) ? params.owner : 'host'), lease: uuid(), lock_version: 2, attempts: number(job.attempts) + 1, base_generation: meta.generation ?? 0 });
                    let work = join(directory, 'work', job.job_id, `attempt-${job.attempts}`);
                    while (await this.store.context.snapshots.pathExists(work)) {
                        job.attempts++;
                        work = join(directory, 'work', job.job_id, `attempt-${job.attempts}`);
                    }
                    await mkdir(dirname(work), { recursive: true });
                    await mkdir(work);
                    job.work_dir = await resolvedPath(work);
                    await this.store.writeQueue(mid, queue);
                    this.owned();
                    this.leases.set(this.key(mid, job.job_id), { handles, moduleId: mid, jobId: job.job_id, token: job.lease });
                    const graph = job.purpose === 'index' ? {} : await this.store.readGraph(mid) || {};
                    const ready = new Set(array(row(meta.reading).materials).flatMap(material => array(material.node_ids)));
                    let known: Row[] = array(graph.nodes).map(node => ({
                        ...Object.fromEntries(['node_id', 'node_kind', 'name', 'aliases', 'summary', 'properties', 'visibility'].filter(key => Object.hasOwn(node, key)).map(key => [key, node[key]])),
                        source_refs: array(node.source_refs).filter(ref => integer(ref.pdf_index)).map(ref => ({ page: number(ref.pdf_index) + 1, ...(Object.hasOwn(ref, 'box') ? { box: ref.box } : {}) })),
                        ready: ready.has(node.node_id),
                    }));
                    if (!known.length)
                        known = [{ node_id: `module-${mid}`, node_kind: 'module', name: meta.title, ready: false }];
                    const contract = await this.store.contract(), contributed = await this.store.buildVocabulary();
                    // Contract 28.2: the reader is asked for what the installed packages contribute now, and
                    // the module keeps the union of every key it was ever asked for -- a key extracted under
                    // an earlier package must still be readable when that package is gone.
                    const recorded = new Map(array(row(meta.vocabulary).actor_profile_keys).map(entry => [string(row(entry).key), row(entry)]));
                    const added = array(contributed.actor_profile_keys).filter(entry => !recorded.has(string(entry.key)));
                    if (added.length && job.purpose !== 'answer') {
                        for (const entry of added)
                            recorded.set(string(entry.key), entry);
                        meta.vocabulary = { actor_profile_keys: [...recorded.values()] };
                        await this.store.writeModule(meta);
                        if(preparation) {preparation.currentRevision=(await sourcePreparationSnapshot(this.store.context,preparation.request.authority.campaign,mid)).revision;await this.store.writeQueue(mid,queue);}
                    }
                    const {task_preparation:_privatePreparation,...visibleJob}=job;
                    const packet = { ...visibleJob, module_id: mid, source, concurrency: 3, index: job.purpose === 'index' ? [] : await this.store.sections(mid), known_nodes: known, known_claims: graph.claims ?? [], field_spans: pageSpans(graph.field_spans), vocabulary: vocabulary(contract, contributed), coverage_domains: [...array(contract.graph.coverage_domains)] };
                    await writeJsonAtomic(join(work, 'packet.json'), packet);
                    this.owned();
                    return packet;
                }
                catch (error) {
                    for (const handle of handles)
                        await handle.release();
                    this.leases.delete(this.key(mid, job.job_id));
                    throw error;
                }
            }
            await this.store.writeQueue(mid, queue);
            return { job_id: null };
        });
    }
    async finish(params: Row): Promise<Row> {
        const mid = validateModuleId(params.module_id);
        return this.mutex(mid, async () => {
            const meta = await this.store.module(mid), queue = await this.store.queue(mid), job = queue.find(job => job.job_id === params.job_id);
            if (!job)
                throw new RpcError('invalid_params', 'unknown reading job');
            // Completion is idempotent for this attempt, not for a same-named job in
            // another campaign. The persisted token also authorizes a cold replay.
            if (typeof params.lease !== 'string' || !params.lease || job.lease !== params.lease)
                throw new RpcError('invalid_params', 'this reading attempt no longer owns publication');
            const committed = row(row(meta.reading).completed)[job.job_id];
            if (truth(committed)) {
                Object.assign(job, { state: 'completed', result: committed });
                await this.store.writeQueue(mid, queue);
                await this.release(mid, job.job_id);
                return { ...committed, replayed: true };
            }
            if (job.state === 'completed')
                return { ...job.result, replayed: true };
            const lease = this.leases.get(this.key(mid, job.job_id));
            // The persisted token is the cold-replay authority. A hot owner also has native lock
            // handles in `leases`; after a kernel restart those handles are necessarily gone while
            // the host reader may still be finishing the exact same attempt. Accept that finish only
            // while the persisted job is still running with the same token. If recovery has requeued
            // or reclaimed it, state/token changed and the old attempt remains rejected.
            if (lease
                ? lease.jobId !== job.job_id || lease.token !== params.lease || job.lease !== params.lease
                : job.state !== 'running' || job.lease !== params.lease)
                throw new RpcError('invalid_params', 'this reading attempt no longer owns publication');
            const outcome = params.outcome;
            if (!['completed', 'failed', 'cancelled'].includes(outcome))
                throw new RpcError('invalid_params', 'outcome must be completed, failed or cancelled');
            if (outcome !== 'completed') {
                const refusal = refusalOf(params.refusal);
                Object.assign(job, { state: outcome, detail: string(truth(params.detail) ? params.detail : outcome), ...(refusal ? { refusal } : {}), finished_at: nowIso() });
                await this.store.writeQueue(mid, queue);
                await this.release(mid, job.job_id);
                return { state: outcome };
            }
            const preparation=job.task_preparation as OwnedSourcePreparation|undefined;
            if(preparation) {
                const current=await sourcePreparationSnapshot(this.store.context,preparation.request.authority.campaign,mid);
                if(job.purpose!=='detail'||current.revision!==preparation.currentRevision||!sourcePreparationScopeMatches(current.scope,preparation.request.authority.scope)||current.turn!==preparation.request.authority.turn)
                    throw new RpcError('needs','Source context changed before its owned publication',{details:{reason:'source_preparation_stale'}});
            }
            const work = job.work_dir, packet = clone(row(await this.store.context.snapshots.readJson(join(work, 'packet.json'))));
            const observations = row(await this.store.context.snapshots.readJson(await this.contained(work, join(work, 'observations.json'))));
            if (observations.file_sha256 !== meta.source_document.file_sha256)
                reject('reader observations do not belong to the registered source');
            const seen = new Set(array(observations.read_pages));
            const draft = clone(await this.store.context.snapshots.readJson(await this.contained(work, params.draft_path)));
            let guidance: Row | null = null, opening: Row | null = null, publicationGraph:Row|undefined;
            if (job.purpose === 'index')
                await this.finishIndex(mid, meta, job, draft, new Set(array(observations.full_pages)));
            else if (job.purpose === 'answer') {
                if (!equal(job.context_generation, meta.generation ?? 0) || !equal(packet.base_generation, meta.generation ?? 0))
                    throw new RpcError('needs', 'source context changed while the answer was being checked', { fix: 'request the same consultation against the current source context', details: { reason: 'source_context_changed' } });
                const source = await this.source(meta);
                if (source.file_sha256 !== packet.source.file_sha256) reject('answer source identity changed');
                if (array(params.assets).length) reject('source consultations cannot publish assets');
                const answer = checkSourceAnswer(draft, packet, seen), draftPath = await this.contained(work, params.draft_path);
                const reviewPath = await this.contained(work, params.review_path), review = row(await this.store.context.snapshots.readJson(reviewPath));
                const draftDigest = await sha256File(draftPath);
                if (review.draft_sha256 !== draftDigest) reject('the answer candidate does not match its independent review');
                checkSourceAnswerReview(answer, review, packet, new Set(array(observations.review_pages)));
                const result = { state: 'ready', generation: meta.generation ?? 0, source_answer: sourceAnswerResult(answer, mid) };
                meta.reading.answers ??= {};
                meta.reading.answers[job.key] = { protocol: SOURCE_ANSWER_PROTOCOL, source_sha256: source.file_sha256, context_generation: meta.generation ?? 0,
                    focus: job.focus, question: job.question,
                    draft: relative(this.store.moduleDir(mid), draftPath), review: relative(this.store.moduleDir(mid), reviewPath),
                    draft_sha256: draftDigest, review_sha256: await sha256File(reviewPath), result: result.source_answer };
                meta.reading.completed ??= {};
                meta.reading.completed[job.job_id] = result;
                Object.assign(job, { state: 'completed', result, finished_at: nowIso() });
                this.owned();
                await this.store.writeModule(meta);
                await this.store.writeQueue(mid, queue);
                await this.release(mid, job.job_id);
                return result;
            }
            else {
                const contract = await this.store.contract(), filled = checkDraft(draft, packet, contract, seen);
                const reviewPath = await this.contained(work, params.review_path), review = clone(await this.store.context.snapshots.readJson(reviewPath));
                checkReview(row(draft), filled, review, number(meta.page_count), new Set(array(observations.review_pages)));
                const retranscribed: Row[] = [];
                const graph = assembleVisual(await this.store.readGraph(mid), filled, meta, contract, retranscribed);
                if (job.purpose === 'guidance')
                    guidance = await this.checkGuidance(work, graph, row(review));
                const assets = truth(params.assets) ? params.assets : [];
                if (!Array.isArray(assets) || assets.some(asset => !object(asset)))
                    reject('assets must be an array of host-rendered asset records');
                for (const asset of assets) {
                    const node = graph.nodes.find((node: Row) => node.node_id === asset.node_id), path = await this.contained(work, asset.path);
                    const privateMapSource = node && array(graph.nodes).some(map => array(row(map.properties).map_regions).some(region => row(region).source_asset === node.node_id && row(region).safe_after_redactions === true && truth(row(region).redactions)));
                    if (!node || !['handout', 'asset'].includes(node.node_kind) || (!privateMapSource && !['player-safe', 'revealable'].includes(node.visibility)) || !truth(row(node.properties).image_sources) || (await stat(path)).size > 20 * 1024 * 1024 || await sha256File(path) !== asset.sha256 || !(await readFile(path)).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
                        reject('the rendered asset does not match its reviewed source declaration');
                    Object.assign(node.properties, { asset_ref: relative(await resolvedPath(this.store.moduleDir(mid)), path), media_type: 'image/png', asset_digest: asset.sha256 });
                }
                let checkedGraph = graph;
                if (job.purpose === 'opening' && truth(job.focus)) {
                    const chosen = resolveStartScene(graph, job.focus, contract);
                    if (chosen === null)
                        reject('the requested opening is not an authored entrance');
                    checkedGraph = clone(graph);
                    applyOpeningChoice(checkedGraph, chosen, contract);
                }
                opening = await this.store.opening(checkedGraph);
                const prepared = new Set(array(meta.reading.materials).flatMap(material => array(material.node_ids)));
                for (const id of filled.ready_nodes)
                    prepared.add(id);
                if (truth(opening.opening_ready) && !prepared.has(opening.start_scene)) {
                    opening.opening_ready = false;
                    opening.missing.push('start_scene_material');
                }
                if (job.purpose === 'opening' && !truth(opening.opening_ready) && !truth(opening.choice))
                    reject(`the opening is not playable: ${repr(opening.missing ?? null)} ${repr(opening.findings ?? null)}`
                        // Contract section NN. A refusal's `fix` is executed literally, so this one says what to
                        // add and what not to touch: a vague instruction has made a reader delete correct work.
                        + (array(opening.missing).includes('way_on')
                            ? '. This opening publishes no way on from ' + repr(opening.start_scene) + '. Keep every node and claim already in this draft'
                                + ' exactly as it is, including ready_nodes, and add only what the pages state: either the relation the book gives from'
                                + ' this scene to the place it leads to (route-to, play-precedes, may-lead-to, alternative-to or hands-off-to) together with'
                                + ' the target scene node the book names for it, or, when the book ends in this scene, is_final on this scene. Do not invent'
                                + ' a destination the pages do not name, and do not remove anything to satisfy this.'
                            : ''));
                if (['skeleton', 'guidance'].includes(job.purpose))
                    opening.opening_ready = false;
                if (job.purpose === 'opening' && truth(opening.opening_ready)) {
                    meta.prepared_openings ??= {};
                    meta.prepared_openings[opening.start_scene] = opening;
                }
                const defaultOpening = await this.store.opening(graph);
                defaultOpening.opening_ready = truth(defaultOpening.opening_ready) && prepared.has(defaultOpening.start_scene);
                meta.opening = defaultOpening;
                meta.opening_ready = defaultOpening.opening_ready;
                meta.reading.state = meta.opening_ready ? 'ready' : ['skeleton', 'guidance'].includes(job.purpose) ? 'preparing' : 'blocked';
                meta.reading.viewed_pages = [...new Set([...array(meta.reading.viewed_pages).map(number), ...[...seen].map(page => page - 1)])].sort((a, b) => a - b);
                // §22.3.1: a reviewed re-transcription of the same span replaced a published value; the record stays.
                if (retranscribed.length)
                    meta.reading.retranscriptions = [...array(meta.reading.retranscriptions),
                        ...retranscribed.map(item => ({ ...item, job_id: job.job_id, generation: number(meta.generation) + 1 }))];
                meta.reading.materials.push({ key: job.key, purpose: job.purpose, ...(job.material ? { material: job.material } : {}), focus: job.focus, question: job.question, node_ids: filled.ready_nodes, generation: number(meta.generation) + 1 });
                meta.status = meta.opening_ready ? 'installed' : 'assembled';
                this.owned();
                await this.store.writeGraph(meta, graph);
                publicationGraph=graph;
                if (guidance) {
                    const key = job.guidance_key, accepted = join(this.store.moduleDir(mid), 'character-guidance', key, 'accepted.json');
                    await writeJsonAtomic(accepted, { fingerprint: key, approved: true, guidance, draft_sha256: await sha256File(join(work, 'draft.json')), source_sha256: meta.file_sha256, review: relative(this.store.moduleDir(mid), reviewPath), at: nowIso() });
                    meta.character_guidance ??= {};
                    meta.character_guidance[key] = { scene: guidance.scene, play_language: job.play_language };
                }
            }
            const result: Row = { state: truth(meta.opening_ready) ? 'ready' : meta.reading.state, generation: meta.generation ?? 0, opening_ready: meta.opening_ready ?? false };
            if (job.purpose === 'guidance') {
                if (guidance)
                    Object.assign(result, { state: 'ready', setup_ready: true, guidance_key: job.guidance_key, scene: guidance.scene });
                else
                    Object.assign(result, { state: 'blocked', setup_ready: false, opening: meta.opening });
            }
            else if (job.purpose === 'opening' && truth(opening!.opening_ready))
                Object.assign(result, { state: 'ready', opening_ready: true, scene: job.focus });
            Object.assign(job, { state: 'completed', result, finished_at: nowIso() });
            meta.reading.completed ??= {};
            meta.reading.completed[job.job_id] = result;
            this.owned();
            if(preparation) {
                if(!publicationGraph)throw new RpcError('needs','The owned source completion has no candidate graph',{details:{reason:'source_preparation_stale'}});
                const after=await sourcePreparationSnapshot(this.store.context,preparation.request.authority.campaign,mid,{meta,graph:publicationGraph});
                const authority=preparation.request.authority;
                if(after.revision===authority.from||!sourcePreparationScopeMatches(after.scope,authority.scope)||after.turn!==authority.turn)
                    throw new RpcError('needs','The accepted publication has no exact current source advance',{details:{reason:'source_preparation_stale'}});
                const advance:SourcePublicationAdvance={...clone(authority),jobId:job.job_id,lease:job.lease,to:after.revision,
                    publicationId:jsonDigest([authority.token,job.job_id,job.lease,authority.from,after.revision])};
                result._task_source_advance=advance;
            }
            // The graph pointer, completion and exact operation-bound advance become durable together.
            this.owned();
            await this.store.writeModule(meta);
            await this.store.writeQueue(mid, queue);
            await this.release(mid, job.job_id);
            return result;
        });
    }
    private async checkGuidance(work: string, graph: Row, review: Row): Promise<Row | null> {
        const path = await this.contained(work, join(work, 'guidance.json'));
        if ((await stat(path)).size > 64 * 1024)
            reject('guidance exceeds its file limit');
        const guidance: any = clone(await this.store.context.snapshots.readJson(path)), approval = row(review.guidance);
        if (approval.approved !== true || !equal(approval.issues, []) || approval.draft_sha256 !== await sha256File(join(work, 'draft.json')) || approval.guidance_sha256 !== await sha256File(path))
            reject('guidance review must approve the exact source shard and guidance pair');
        if (equal(guidance, { needs_choice: true })) {
            if ((await this.store.candidates(graph)).length < 2)
                reject('a guidance choice requires multiple authored entrances');
            return null;
        }
        const fields = ['opening', 'advice', 'scene', 'guide', 'handoff'];
        if (!object(guidance) || !equal(sorted(Object.keys(guidance)), sorted(fields)) || fields.some(key => typeof guidance[key] !== 'string' || Array.from(guidance[key]).length > 4000 || key !== 'guide' && !guidance[key].trim()))
            reject('guidance needs five bounded strings');
        const chosen = resolveStartScene(graph, guidance.scene, await this.store.contract());
        if (chosen === null)
            reject('guidance must name an authored entrance');
        if (guidance.guide) {
            const actors = new Set(array(graph.nodes).filter(node => node.node_kind === 'npc' && normalize(node.name) === normalize(guidance.guide)).map(node => node.node_id));
            if (!array(graph.claims).some(claim => actors.has(claim.subject_id) && claim.predicate === 'present-in' && row(claim.object).node_id === chosen))
                reject('the guidance person must be present at the selected opening');
        }
        return guidance;
    }
    private async finishIndex(mid: string, meta: Row, job: Row, draft: any, seen: Set<number>): Promise<void> {
        if (!object(draft) || !Array.isArray(draft.sections))
            reject('index draft needs a sections array');
        if (Object.hasOwn(draft, 'map_candidates')) {
            if (!Array.isArray(draft.map_candidates)) reject('map_candidates must be a list');
            for (const candidate of draft.map_candidates) {
                if (!object(candidate) || typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.focus !== 'string' || !candidate.focus.trim()
                    || !Array.isArray(candidate.pages) || !candidate.pages.length || candidate.pages.some((page: any) => !integer(page) || page < 1 || page > number(meta.page_count)))
                    reject('map candidates need a name, exact place focus and physical page numbers in the original PDF');
            }
        }
        if (!seen.size)
            reject('index pages were not viewed as full page images: []');
        const sections = truth(meta.index_file) ? await this.store.sections(mid) : [], unreferenced: string[] = [];
        for (const raw of draft.sections) {
            const item = clone(raw);
            if (!object(item) || typeof item.name !== 'string' || !Array.isArray(item.pages) || !item.pages.length)
                reject('index sections need name and physical page ranges');
            const ranges: number[][] = [];
            for (const pair of item.pages) {
                if (!Array.isArray(pair) || pair.length !== 2 || pair.some(v => !integer(v)) || !(1 <= number(pair[0]) && number(pair[0]) <= number(pair[1]) && number(pair[1]) <= number(meta.page_count)))
                    reject('index page ranges must lie in the original PDF');
                const evidence = array(item.source_refs).map(ref => ref.page ?? null);
                if (evidence.length) {
                    if (evidence.some(page => page === null || !seen.has(number(page))))
                        reject('navigation references must have been viewed');
                }
                else {
                    for (let page = number(pair[0]); page <= number(pair[1]); page++)
                        if (!seen.has(page)) { if (!unreferenced.includes(item.name)) unreferenced.push(item.name); break; }
                }
                ranges.push([number(pair[0]) - 1, number(pair[1]) - 1]);
            }
            for (const key of ['topics', 'entities'])
                if (Object.hasOwn(item, key) && (!Array.isArray(item[key]) || item[key].some((value: any) => typeof value !== 'string')))
                    reject(`index ${key} must be a list of names`);
            const state = Object.hasOwn(item, 'state') ? item.state : 'indexed';
            if (!['indexed', 'unreadable'].includes(state))
                reject('index state must be indexed or unreadable');
            Object.assign(item, { pages: ranges, state });
            sections.push(item);
        }
        // A refusal names the rows it is about, and its fix is executed literally by the reader (§90.3):
        // a whole-draft refusal made a reader rewrite twenty-one good sections, or give up.
        if (unreferenced.length)
            throw new RpcError('invalid_params', `unseen navigation ranges need an observed source reference: ${unreferenced.map(name => repr(name)).join(', ')}`, {
                fix: `add source_refs naming the observed contents or heading page you took each range from to these sections only: ${unreferenced.join('; ')}. Keep every other section exactly as it is and submit the same draft again`,
                details: { reason: 'reading_failed', path: '/sections', sections: unreferenced },
            });
        if (seen.has(1) && !validSourceLanguage(draft.language))
            reject('identify the source language using a BCP 47 tag');
        const indexPath = join(job.work_dir, 'index.json');
        const minPage = (item: Row) => Math.min(...item.pages.map((pair: number[]) => pair[0]));
        await writeJsonAtomic(indexPath, sections.sort((a, b) => minPage(a) - minPage(b) || compareUnicode(a.name, b.name)));
        meta.index_file = relative(await resolvedPath(this.store.moduleDir(mid)), indexPath);
        if (Array.isArray(draft.map_candidates))
            meta.reading.map_candidates = draft.map_candidates.map((candidate: Row) => ({ name: candidate.name.trim(), focus: candidate.focus.trim(), pages: [...new Set(candidate.pages.map(number))].sort((a: unknown, b: unknown) => number(a) - number(b)) }));
        const graph = await this.store.readGraph(mid);
        if (graph && attachMapCandidates(graph, array(meta.reading.map_candidates), mid))
            await this.store.writeGraph(meta, graph);
        if (seen.has(1) && typeof draft.title === 'string' && draft.title.trim())
            meta.title = draft.title.trim();
        if (seen.has(1) && typeof draft.language === 'string' && draft.language.trim())
            meta.languages = [draft.language.trim()];
        meta.reading.viewed_pages = [...new Set([...array(meta.reading.viewed_pages).map(number), ...[...seen].map(page => page - 1)])].sort((a, b) => a - b);
        meta.reading.index_complete = true;
        meta.reading.state = 'preparing';
    }
    async chooseOpening(params: Row): Promise<Row> {
        const mid = validateModuleId(params.module_id);
        return this.mutex(mid, async () => {
            const meta = await this.store.module(mid), graph = await this.store.readGraph(mid);
            if (meta.source !== 'pdf')
                throw new RpcError('invalid_params', "a starter's opening is defined by its content graph");
            if (!truth(graph))
                throw new RpcError('campaign_not_ready', 'read the source before choosing its opening');
            const contract = await this.store.contract(), candidates = await this.store.candidates(graph!), chosen = resolveStartScene(graph!, string(truth(params.scene) ? params.scene : ''), contract);
            if (chosen === null)
                throw new RpcError('needs_choice', 'choose one of the authored openings', { fix: 'use a scene from details.candidates', details: { candidates } });
            applyOpeningChoice(graph!, chosen, contract);
            const opening = await this.store.opening(graph!);
            meta.opening_choice = { start_scene: chosen, at: nowIso() };
            meta.opening = opening;
            meta.opening_ready = truth(opening.opening_ready) && (!truth(meta.reading_version) || await this.materialReady(mid, chosen));
            if (truth(meta.reading_version))
                meta.reading.state = meta.opening_ready ? 'ready' : 'preparing';
            if (meta.opening_ready)
                meta.status = 'installed';
            await this.store.writeGraph(meta, graph!);
            await this.store.writeModule(meta);
            return { module_id: mid, opening_ready: meta.opening_ready, opening, start_scene: chosen, generation: meta.generation };
        });
    }
    async release(mid: string, jobId?: string): Promise<void> {
        for (const [key, lease] of this.leases) {
            if (lease.moduleId !== mid || jobId !== undefined && lease.jobId !== jobId)
                continue;
            this.leases.delete(key);
            for (const handle of lease.handles)
                await handle.release();
        }
    }
    async close(): Promise<void> {
        this.closed = true;
        this.closePromise ??= (async () => {
            for (const lease of [...this.leases.values()])
                await this.release(lease.moduleId, lease.jobId);
        })();
        await this.closePromise;
    }
}
