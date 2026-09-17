/** One persisted source queue; native descriptor leases own publication attempts. */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { internalError, RpcError } from '../errors.js';
import { sha256File, writeJsonAtomic } from '../fileio.js';
import { compareUnicode, isJsonObject, jsonDigest } from '../json.js';
import { withExclusiveLock, type LockLease } from '../locks.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, clone, equal, integer, normalize, number, repr, row, sorted, string, truth, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { validSourceLanguage, vocabulary } from './contract.js';
import { childPath, inside, resolvedPath } from './paths.js';
import { ModuleStore, validateModuleId } from './store.js';
import { applyOpeningChoice, assembleVisual, checkDraft, checkReview, reject, resolveStartScene } from './visual.js';
const object = (value: any): boolean => isJsonObject(value);
const PURPOSES = ['index', 'skeleton', 'guidance', 'opening', 'detail'];
const uuid = (): string => randomUUID().replaceAll('-', '');
type PublicationLease = {
    handles: LockLease[];
    moduleId: string;
    jobId: string;
    token: string;
};
export class Reading {
    private readonly leases = new Map<string, PublicationLease>();
    private closed = false;
    private closePromise?: Promise<void>;
    constructor(readonly store: ModuleStore) { }
    private key(mid: string, job: string): string { return `${mid}/${job}`; }
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
    async request(params: Row): Promise<Row> {
        const mid = validateModuleId(params.module_id), purpose = params.purpose;
        if (!PURPOSES.includes(purpose))
            throw new RpcError('invalid_params', `purpose must be one of ${repr(PURPOSES)}`);
        return this.mutex(mid, async () => {
            const meta = await this.store.module(mid);
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
                purpose === 'opening' && await this.openingReady(mid, focus) ||
                purpose === 'detail' && !question && await this.materialReady(mid, focus) ||
                purpose === 'index' && truth(reading.index_complete))
                return { ...result, state: 'ready' };
            const source = await this.source(meta), pages: number[] = material === 'map'
                ? [...new Set(array(row(reading).map_candidates).flatMap((candidate: Row) => array(candidate.pages).map(number)))].filter(page => page >= 1 && page <= source.page_count).sort((a, b) => a - b)
                : [];
            const identity: any[] = [source.file_sha256, purpose, material ?? '', normalize(focus), question, pages];
            if (purpose === 'guidance')
                identity.push(guidanceKey);
            const key = jsonDigest(identity);
            if (purpose === 'detail' && array(reading.materials).some(material => material.key === key))
                return { ...result, state: 'ready' };
            const queue = await this.store.queue(mid), existing = [...queue].reverse().find(job => job.key === key);
            if (existing) {
                if (['queued', 'running'].includes(existing.state)) {
                    if (truth(params.foreground)) {
                        existing.foreground = true;
                        await this.store.writeQueue(mid, queue);
                    }
                    return { ...result, state: existing.state === 'running' ? 'reading' : 'queued', job_id: existing.job_id };
                }
                if (existing.state === 'completed') {
                    // A refusal names what is missing (§46.1); a completed reading that still answers
                    // nothing is the snapshot's own list, and an empty one is not a refusal at all.
                    const missing = array(row(meta.opening).missing);
                    if (!missing.length)
                        return { ...result, state: 'ready' };
                    return { ...result, state: 'blocked', missing, opening: meta.opening ?? null, fix: 'choose an authored opening, then request preparation again' };
                }
                if (!truth(params.retry))
                    return { ...result, state: 'blocked', missing: [existing.detail ?? 'reading failed'], fix: 'request the same reading with retry: true' };
            }
            const job: Row = { job_id: `read-${queue.length + 1}`, key, purpose, ...(material ? { material } : {}), focus, question, pages, foreground: truth(params.foreground), state: 'queued', attempts: 0, at: nowIso() };
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
            const pending = queue.filter(job => job.state === 'queued').sort((a, b) => Number(!truth(a.foreground)) - Number(!truth(b.foreground)) || Number(a.purpose !== 'opening') - Number(b.purpose !== 'opening') || compareUnicode(a.at, b.at));
            if (active.length >= 3) {
                await this.store.writeQueue(mid, queue);
                return { job_id: null };
            }
            for (const job of pending) {
                const foreground = truth(job.foreground);
                if (active.filter(other => truth(other.foreground) === foreground).length >= (foreground ? 1 : 2)
                    || active.some(other => normalize(other.focus ?? '') === normalize(job.focus ?? '')))
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
                    if (added.length) {
                        for (const entry of added)
                            recorded.set(string(entry.key), entry);
                        meta.vocabulary = { actor_profile_keys: [...recorded.values()] };
                        await this.store.writeModule(meta);
                    }
                    const packet = { ...job, module_id: mid, source, concurrency: 3, index: job.purpose === 'index' ? [] : await this.store.sections(mid), known_nodes: known, known_claims: graph.claims ?? [], vocabulary: vocabulary(contract, contributed), coverage_domains: [...array(contract.graph.coverage_domains)] };
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
            if (!lease || lease.jobId !== job.job_id || lease.token !== params.lease || job.lease !== params.lease)
                throw new RpcError('invalid_params', 'this reading attempt no longer owns publication');
            const outcome = params.outcome;
            if (!['completed', 'failed', 'cancelled'].includes(outcome))
                throw new RpcError('invalid_params', 'outcome must be completed, failed or cancelled');
            if (outcome !== 'completed') {
                Object.assign(job, { state: outcome, detail: string(truth(params.detail) ? params.detail : outcome), finished_at: nowIso() });
                await this.store.writeQueue(mid, queue);
                await this.release(mid, job.job_id);
                return { state: outcome };
            }
            const work = job.work_dir, packet = clone(row(await this.store.context.snapshots.readJson(join(work, 'packet.json'))));
            const observations = row(await this.store.context.snapshots.readJson(await this.contained(work, join(work, 'observations.json'))));
            if (observations.file_sha256 !== meta.source_document.file_sha256)
                reject('reader observations do not belong to the registered source');
            const seen = new Set(array(observations.read_pages));
            const draft = clone(await this.store.context.snapshots.readJson(await this.contained(work, params.draft_path)));
            let guidance: Row | null = null, opening: Row | null = null;
            if (job.purpose === 'index')
                await this.finishIndex(mid, meta, job, draft, new Set(array(observations.full_pages)));
            else {
                const contract = await this.store.contract(), filled = checkDraft(draft, packet, contract, seen);
                const reviewPath = await this.contained(work, params.review_path), review = clone(await this.store.context.snapshots.readJson(reviewPath));
                checkReview(row(draft), filled, review, number(meta.page_count), new Set(array(observations.review_pages)));
                const graph = assembleVisual(await this.store.readGraph(mid), filled, meta, contract);
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
                meta.reading.materials.push({ key: job.key, purpose: job.purpose, ...(job.material ? { material: job.material } : {}), focus: job.focus, question: job.question, node_ids: filled.ready_nodes, generation: number(meta.generation) + 1 });
                meta.status = meta.opening_ready ? 'installed' : 'assembled';
                this.owned();
                await this.store.writeGraph(meta, graph);
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
                if (!object(candidate) || typeof candidate.name !== 'string' || !candidate.name.trim() || !Array.isArray(candidate.pages) || !candidate.pages.length || candidate.pages.some((page: any) => !integer(page) || page < 1 || page > number(meta.page_count)))
                    reject('map candidates need a name and physical page numbers in the original PDF');
            }
        }
        if (!seen.size)
            reject('index pages were not viewed as full page images: []');
        const sections = truth(meta.index_file) ? await this.store.sections(mid) : [];
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
                        if (!seen.has(page))
                            reject('unseen navigation ranges need an observed source reference');
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
        if (seen.has(1) && !validSourceLanguage(draft.language))
            reject('identify the source language using a BCP 47 tag');
        const indexPath = join(job.work_dir, 'index.json');
        const minPage = (item: Row) => Math.min(...item.pages.map((pair: number[]) => pair[0]));
        await writeJsonAtomic(indexPath, sections.sort((a, b) => minPage(a) - minPage(b) || compareUnicode(a.name, b.name)));
        meta.index_file = relative(await resolvedPath(this.store.moduleDir(mid)), indexPath);
        if (Array.isArray(draft.map_candidates))
            meta.reading.map_candidates = draft.map_candidates.map((candidate: Row) => ({ name: candidate.name.trim(), pages: [...new Set(candidate.pages.map(number))].sort((a: unknown, b: unknown) => number(a) - number(b)), ...(typeof candidate.focus === 'string' && candidate.focus.trim() ? { focus: candidate.focus.trim() } : {}) }));
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
