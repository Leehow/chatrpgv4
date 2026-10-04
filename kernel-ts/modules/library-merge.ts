/**
 * §179.5: a fork that is not the library's lineage gives back its readings one by one. Each reading the library lacks is
 * replayed through the library's own publication -- `module.read.finish` on a library job that carries the fork job's
 * identity, or `module.reference.materialize` for a source place -- so every check a library reading passes applies to it.
 * No model is called.
 */
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { writeJsonAtomic } from '../fileio.js';
import { compareUnicode, isJsonObject } from '../json.js';
import { withOptionalExclusiveLock, type LockLease } from '../locks.js';
import { array, number, row, string, truth, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { playsFromReading } from './bound-source.js';
import { moduleContext } from './campaign-scope.js';
import { readingBudget } from './chapters.js';
import { childPath, inside, resolvedPath } from './paths.js';
import { placeScene } from './reference.js';
import { validateReferencePacket } from './reference-contract.js';
import { ModuleStore, validateModuleId } from './store.js';

/** The library's own reading publication, which the merge replays a fork's reading through. */
export interface LibraryPublication {
    /** `module.read.finish` of the library's Reading. */
    finish(params: Row): Promise<Row>;
    /** `module.reference.materialize` of the library's Reading. */
    publishReferencePlace(params: Row): Promise<Row>;
    /** The fields of a fork job that the library job replaying its reading carries (the reading's identity and markers). */
    identity(job: Row): Row;
}

/** Where a fork's attempt is copied in the library: `work/merged/<campaign>/<fork job id>/`, never a `work/read-N` ordinal. */
export const MERGED_ROOT = join('work', 'merged');
/**
 * The rule of a merged library job whose merge stopped before its finish answered (a killed kernel). It is the one failure
 * the next merge of that reading replays again; a refusal by the library's checks is final.
 */
export const MERGE_INTERRUPTED = 'merge_interrupted';
/** The artifacts a reading's finish reads from its attempt; a fork attempt without them cannot be replayed. */
const ATTEMPT_ARTIFACTS = ['packet.json', 'draft.json', 'review.json', 'observations.json'];
/** A place's merge that the library refused writes its reason here, inside the merged copy; it is not replayed again. */
const PLACE_REFUSAL = 'merge-refusal.json';
/** At most this many `skipped` rows ride on one result (a telemetry row); the rest are counted in `skipped_truncated`. */
const SKIPPED_LIMIT = 64;
/** A path segment the merge writes: a fork job id or a work directory name. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 1000);
/** §179.5: a merged library job (`merged_from`) that the library refused; it is evidence, not one of the library's own asks. */
export function refusedMerge(job: Row): boolean { return isJsonObject(job.merged_from) && job.state === 'failed'; }
/** The queue as the module's own read-ahead, build and requests judge it: without the merges the library refused. */
export function ownAsks(queue: Row[]): Row[] { return queue.filter(job => !refusedMerge(job)); }

type Reading = { kind: 'reading'; key: string; job: Row; attempt: string };
type Place = { kind: 'place'; key: string; work: string; place: Row };
type Skip = { key: string; reason: string; detail?: string };
type Candidate = Reading | Place;

/**
 * §179.5: publish into the library, one at a time and in the order the fork published them, the fork's readings whose key
 * the library's `reading.materials` lacks. Called by the fork's publication when §179.1's lineage test answered
 * `library_advanced`, and by the campaign's read-ahead to continue a backlog, under the fork's metadata lock; the merge
 * takes the library's metadata lock per step and never holds it across the library's own finish, which takes it itself.
 * Bounded per call: a replay starts only while the call has run less than `reading.merge_budget_ms`, and the first always
 * starts. Returns `{state: "merged", merged, skipped, library_generation, remaining, partial?}`, `{state: "skipped", reason}`
 * (`nothing_new`, or `already_present` when this publication's own reading is one the library already holds) or
 * `{state: "failed", detail}`; it never throws, because a merge failure never fails the fork's publication. `published` is
 * the key of the reading this publication wrote, when it wrote one.
 */
export async function mergeForkReadings(context: KernelContext, campaign: string, moduleId: string, library: LibraryPublication,
    published?: string): Promise<Row> {
    try { return await merge(context, campaign, moduleId, library, published); }
    catch (error) { return { state: 'failed', detail: messageOf(error) }; }
}

async function merge(context: KernelContext, campaign: string, moduleId: string, library: LibraryPublication, published?: string): Promise<Row> {
    const began = Date.now(), skipped = (reason: string): Row => ({ state: 'skipped', reason });
    const id = validateModuleId(moduleId), fork = new ModuleStore(moduleContext(context, campaign));
    const store = new ModuleStore({ ...context, moduleRoot: join(context.stateRoot, 'modules') });
    if (!await fork.exists(id)) return skipped('not_a_fork');
    const forkMeta = await fork.module(id);
    if (forkMeta.campaign_scope !== campaign) return skipped('not_a_fork');
    if (!await store.exists(id)) return skipped('library_missing');
    // The caller holds the fork's metadata lock, so the fork's module, queue and graph read here stay as they are.
    const forkQueue = await fork.queue(id), forkDir = await resolvedPath(fork.moduleDir(id)), own = ownRows(forkMeta, forkQueue);
    const lock = join(store.moduleDir(id), '.metadata.lock');
    const places = placeAttempts(context, forkDir);
    const plan = await withOptionalExclusiveLock(context.locks, lock, async (): Promise<Row | { candidates: Candidate[]; skips: Skip[]; present: boolean }> => {
        const meta = await store.module(id);
        if (!playsFromReading(meta)) return skipped('starter');
        const sha = row(meta.source_document).file_sha256;
        if (meta.id !== id || typeof sha !== 'string' || !sha || sha !== row(forkMeta.source_document).file_sha256) return skipped('source_mismatch');
        const held = heldKeys(meta), graph = await store.readGraph(id), ready = readyNodes(meta), queue = await store.queue(id);
        const candidates: Candidate[] = [], skips: Skip[] = [];
        for (const material of own) {
            if (held.has(material.key)) continue;
            const found = await classify(context, material, forkQueue, forkDir, places, Number(forkMeta.page_count ?? meta.page_count), string(sha));
            if ('reason' in found) { skips.push(found); continue; }
            // A place the library already holds under its own scene (its name, an alias or its id) is the library's.
            if (found.kind === 'place') {
                const scene = placeScene(graph, { id: string(found.place.id), name: string(found.place.name) });
                if (scene && ready.has(scene.node_id)) continue;
            }
            // A reading the library refused before is reported, never started again: with the per-call budget, a refusal at
            // the head of the backlog would otherwise take every call's one replay and stall the rest.
            const refused = await priorRefusal(context, await mergedDir({ store, id, campaign }, found.kind === 'reading' ? found.job.job_id : basename(found.work)),
                found.kind === 'reading' ? queue.filter(job => row(job.merged_from).campaign === campaign && row(job.merged_from).job_id === found.job.job_id) : null);
            if (refused !== null) { skips.push({ key: found.key, reason: 'refused', detail: refused }); continue; }
            candidates.push(found);
        }
        return { candidates, skips, present: typeof published === 'string' && held.has(published) && own.some(material => material.key === published) };
    });
    if (!('candidates' in plan)) return plan as Row;
    const { candidates, skips, present } = plan;
    if (!candidates.length && !skips.length) return skipped(present ? 'already_present' : 'nothing_new');
    const out: Skip[] = present ? [{ key: published!, reason: 'already_present' }] : [];
    let merged = 0, started = 0;
    const forkGraph = await fork.readGraph(id), env = { context, campaign, id, store, library, lock, forkDir, forkGraph };
    const budget = (await readingBudget(context)).mergeBudgetMs;
    for (const candidate of candidates) {
        // Bounded per call: the first replay always starts, a later one only while the call is inside its budget.
        if (started > 0 && Date.now() - began >= budget) break;
        started++;
        const skip = candidate.kind === 'reading' ? await replayReading(env, candidate) : await replayPlace(env, candidate);
        if (skip) out.push(skip); else merged++;
    }
    out.push(...skips);
    const remaining = candidates.length - started;
    return { state: 'merged', merged, skipped: out.slice(0, SKIPPED_LIMIT), ...(out.length > SKIPPED_LIMIT ? { skipped_truncated: out.length - SKIPPED_LIMIT } : {}),
        library_generation: (await store.module(id)).generation ?? 0, remaining, ...(remaining > 0 ? { partial: true } : {}) };
}

/**
 * Why a reading's earlier merge is final, or null: a merged library job of it that the library refused (a failure whose rule
 * is not `merge_interrupted`), or a place's refusal written in its copy. `jobs` are the library's merged jobs of the fork
 * job, or null for a place.
 */
async function priorRefusal(context: KernelContext, target: string, jobs: Row[] | null): Promise<string | null> {
    if (jobs) {
        const refused = [...jobs].reverse().find(job => job.state === 'failed' && row(job.refusal).rule !== MERGE_INTERRUPTED);
        return refused ? string(refused.detail ?? '').slice(0, 500) : null;
    }
    const file = join(target, PLACE_REFUSAL);
    return await context.snapshots.isFile(file) ? string(row(await context.snapshots.readJson(file)).message ?? '').slice(0, 500) : null;
}

const heldKeys = (meta: Row): Set<unknown> => new Set(array(row(meta.reading).materials).map(material => row(material).key));
const readyNodes = (meta: Row): Set<unknown> => new Set(array(row(meta.reading).materials).flatMap(material => array(row(material).node_ids)));

/**
 * The fork's own readings, in the order it published them: the material rows its queue has a job for, or that it
 * published after its seed (a row's `generation` is the fork generation its publication wrote). A row the fork was seeded
 * with is the library's. One row per key, the first.
 */
function ownRows(meta: Row, queue: Row[]): Row[] {
    const asked = new Set(queue.map(job => job.key).filter(key => typeof key === 'string'));
    const base = number(meta.source_generation), seen = new Set<string>(), out: Row[] = [];
    const rows = array(row(meta.reading).materials).map((material, index) => ({ material: row(material), index }))
        .filter(({ material }) => typeof material.key === 'string' && (asked.has(material.key) || number(material.generation) > base))
        .sort((a, b) => number(a.material.generation) - number(b.material.generation) || a.index - b.index);
    for (const { material } of rows)
        if (!seen.has(material.key)) { seen.add(material.key); out.push(material); }
    return out;
}

/** The fork job whose completion published `material`, with its attempt directory, or the reason it is not merged. */
async function classify(context: KernelContext, material: Row, queue: Row[], forkDir: string, places: () => Promise<Map<string, string>>,
    pageCount: number, sha: string): Promise<Candidate | Skip> {
    const key = string(material.key);
    if (key.startsWith('source-place:')) {
        const work = (await places()).get(basename(dirname(string(material.packet_file))));
        if (!work) return { key, reason: 'artifacts_missing' };
        try {
            const packet = validateReferencePacket(JSON.parse(await readFile(join(work, 'source-reference.json'), 'utf8')), pageCount, sha);
            if (!packet.places?.length) return { key, reason: 'artifacts_missing' };
            return { kind: 'place', key, work, place: { id: packet.places[0].id, name: packet.places[0].name } };
        } catch { return { key, reason: 'artifacts_missing' }; }
    }
    // A settled-unusable focus (§22.3.3, §107.1) was written by a failed reading, never by a completed one.
    if (material.status === 'unusable') return { key, reason: 'settled' };
    if (material.purpose === 'answer') return { key, reason: 'consultation_private' };
    if (['guidance', 'reference-context'].includes(string(material.purpose))) return { key, reason: 'guidance_private' };
    const jobs = queue.filter(job => job.key === key);
    // A queued job that found its material already published completes with `reused_generation`; it published nothing.
    const publishers = jobs.filter(job => job.state === 'completed' && !Object.hasOwn(job, 'reused_generation') && row(job.result).state !== 'settled')
        .sort((a, b) => compareUnicode(string(a.finished_at ?? ''), string(b.finished_at ?? '')));
    if (!publishers.length) return { key, reason: jobs.some(job => job.state === 'completed') ? 'settled' : 'artifacts_missing' };
    for (const job of publishers) {
        if (job.purpose === 'answer') return { key, reason: 'consultation_private' };
        if (job.purpose === 'guidance') return { key, reason: 'guidance_private' };
        if (isJsonObject(job.visual_identity)) return { key, reason: 'identity_review' };
        if (typeof job.work_dir !== 'string' || typeof job.job_id !== 'string' || !SEGMENT.test(job.job_id)) continue;
        const attempt = await resolvedPath(job.work_dir);
        if (!inside(forkDir, attempt) || attempt === forkDir) continue;
        let complete = true;
        for (const name of ATTEMPT_ARTIFACTS) if (!await context.snapshots.isFile(join(attempt, name))) { complete = false; break; }
        if (complete) return { kind: 'reading', key, job, attempt };
    }
    return { key, reason: 'artifacts_missing' };
}

/**
 * The fork's source-place attempts by the digest their receipt names: a place row's `packet_file` is
 * `source-references/<receipt packet digest>/packet.json`, and its attempt is the work directory whose receipt and
 * `materialize_place` task produced it. Scanned once per merge, and only when a place is to be merged.
 */
function placeAttempts(context: KernelContext, forkDir: string): () => Promise<Map<string, string>> {
    let scanned: Promise<Map<string, string>> | undefined;
    return () => scanned ??= (async () => {
        const out = new Map<string, string>(), root = join(forkDir, 'work');
        if (!await context.snapshots.isDirectory(root)) return out;
        for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => compareUnicode(a.name, b.name))) {
            if (!entry.isDirectory() || !SEGMENT.test(entry.name)) continue;
            const work = join(root, entry.name), receiptPath = join(work, 'source-reference-complete.json'), taskPath = join(work, 'task.json');
            if (!await context.snapshots.isFile(receiptPath) || !await context.snapshots.isFile(taskPath)) continue;
            try {
                const receipt = row(await context.snapshots.readJson(receiptPath)), task = row(await context.snapshots.readJson(taskPath));
                if (receipt.kind === 'excerpts' && task.materialize_place === true && typeof receipt.packet_sha256 === 'string' && !out.has(receipt.packet_sha256))
                    out.set(receipt.packet_sha256, work);
            } catch { /* an unreadable attempt is not one a place came from */ }
        }
        return out;
    })();
}

/** Every regular file under `from`, copied to the same relative path under `to` (reflinks where supported). */
async function copyTree(from: string, to: string): Promise<void> {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
        const source = join(from, entry.name), target = join(to, entry.name);
        if (entry.isDirectory()) await copyTree(source, target);
        // A link may name a file outside the attempt; a device or socket is not reading evidence.
        else if (entry.isFile()) await copyFile(source, target, constants.COPYFILE_FICLONE);
    }
}

type Env = { context: KernelContext; campaign: string; id: string; store: ModuleStore; library: LibraryPublication; lock: string;
    forkDir: string; forkGraph: Row | null };

/** The directory a fork artifact is copied to in the library, contained in `work/merged/<campaign>/`. */
async function mergedDir(env: Pick<Env, 'store' | 'id' | 'campaign'>, name: string): Promise<string> {
    const root = await resolvedPath(join(env.store.moduleDir(env.id), MERGED_ROOT, env.campaign)), target = join(root, name);
    if (!SEGMENT.test(name) || !inside(root, await resolvedPath(target)))
        throw new RpcError('invalid_params', 'a merged reading escapes the library work directory', { details: { artifact: name } });
    return target;
}

/** The newest identity review the fork's attempt wrote (`identity/<round>/identity-review.json`), as a path in the copy. */
async function identityReview(context: KernelContext, attempt: string, target: string): Promise<string | undefined> {
    const root = join(attempt, 'identity');
    if (!await context.snapshots.isDirectory(root)) return undefined;
    let newest: { path: string; at: number } | undefined;
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const file = join(root, entry.name, 'identity-review.json');
        if (!entry.isDirectory() || !await context.snapshots.isFile(file)) continue;
        const at = (await stat(file)).mtimeMs;
        if (!newest || at > newest.at) newest = { path: file, at };
    }
    return newest ? join(target, relative(attempt, newest.path)) : undefined;
}

/**
 * The rendered assets of the draft's nodes, as the fork graph names them (`asset_ref` with `asset_digest`), each as a file
 * in the merged copy: a PNG inside the attempt is already there; one an earlier reading rendered is copied in beside it.
 */
async function carriedAssets(env: Env, attempt: string, target: string): Promise<Row[]> {
    const draft = row(await env.context.snapshots.readJson(join(attempt, 'draft.json')));
    const drafted = new Set(array(draft.nodes).map(node => row(node).node_id)), out: Row[] = [];
    for (const node of array(env.forkGraph?.nodes)) {
        const properties = row(row(node).properties);
        if (!drafted.has(node.node_id) || typeof node.node_id !== 'string' || !SEGMENT.test(node.node_id)
            || typeof properties.asset_ref !== 'string' || !properties.asset_ref || typeof properties.asset_digest !== 'string') continue;
        const from = await resolvedPath(childPath(env.forkDir, properties.asset_ref));
        if (!inside(env.forkDir, from) || !await env.context.snapshots.isFile(from)) continue;
        let path: string;
        if (inside(attempt, from)) path = join(target, relative(attempt, from));
        else {
            path = join(target, 'graph-assets', `${node.node_id}.png`);
            await mkdir(dirname(path), { recursive: true });
            await copyFile(from, path, constants.COPYFILE_FICLONE);
        }
        out.push({ node_id: node.node_id, path, sha256: properties.asset_digest });
    }
    return out;
}

/** An exclusive job lock, so a library claim's probe sees the replay as a live attempt; null where the host has no locks. */
async function jobLock(context: KernelContext, path: string): Promise<LockLease | null | 'busy'> {
    try { return await context.locks.acquire(path, 'exclusive', { nonblocking: true }) ?? 'busy'; }
    catch (error) { if (error instanceof RpcError && error.code === 'not_implemented') return null; throw error; }
}

/**
 * One fork reading through the library's own finish. Under the library's metadata lock: the attempt is copied to
 * `work/merged/<campaign>/<fork job id>/` and a running library job with a fresh lease is written; then, outside that
 * lock, the library's finish publishes it or refuses it. A refusal fails that job (kept as evidence) and is final.
 * Returns null when the reading was published, else why not.
 */
async function replayReading(env: Env, candidate: Reading): Promise<Skip | null> {
    const { context, campaign, id, store, library, lock } = env, { key, job: forkJob, attempt } = candidate;
    const from = { campaign, job_id: forkJob.job_id };
    const target = await mergedDir(env, forkJob.job_id);
    const staged = await withOptionalExclusiveLock(context.locks, lock, async (): Promise<Skip | { jobId: string; lease: string; held: LockLease | null; assets: Row[] }> => {
        const meta = await store.module(id);
        if (heldKeys(meta).has(key)) return { key, reason: 'already_present' };
        const queue = await store.queue(id), earlier = queue.filter(job => row(job.merged_from).campaign === campaign && row(job.merged_from).job_id === forkJob.job_id);
        if (earlier.some(job => job.state === 'completed')) return { key, reason: 'already_present' };
        const refused = await priorRefusal(context, target, earlier);
        if (refused !== null) return { key, reason: 'refused', detail: refused };
        // The fork's metadata lock is held, so no other merge of this campaign runs: a running replay of it was interrupted.
        for (const job of earlier.filter(job => job.state === 'running'))
            Object.assign(job, { state: 'failed', detail: 'the merge that replayed this reading was interrupted', refusal: { message: 'the merge that replayed this reading was interrupted', rule: MERGE_INTERRUPTED }, finished_at: nowIso() });
        await copyTree(attempt, target);
        const assets = await carriedAssets(env, attempt, target);
        const completed = row(row(meta.reading).completed);
        let ordinal = queue.length + 1;
        while (queue.some(job => job.job_id === `read-${ordinal}`) || Object.hasOwn(completed, `read-${ordinal}`)) ordinal++;
        const jobId = `read-${ordinal}`, held = await jobLock(context, join(store.moduleDir(id), `.job-${jobId}.lock`));
        if (held === 'busy') { await store.writeQueue(id, queue); return { key, reason: 'refused', detail: 'the library job lock is held elsewhere' }; }
        const at = nowIso(), lease = randomUUID().replaceAll('-', '');
        // `running` with a lease that only this merge knows, its job lock held until the finish answers: no library reader
        // claims it, and a claim that finds it unheld fails it as interrupted.
        queue.push({ job_id: jobId, ...library.identity(forkJob), foreground: false, state: 'running', owner: 'merge', attempts: 1, lease, lock_version: 2,
            work_dir: await resolvedPath(target), at, class_at: new Date().toISOString(), claimed_at: at, merged_from: from });
        try { await store.writeQueue(id, queue); }
        catch (error) { await held?.release(); throw error; }
        return { jobId, lease, held, assets };
    });
    if ('reason' in staged) return staged;
    const { jobId, lease, held, assets } = staged;
    try {
        const review = await identityReview(context, attempt, target);
        await library.finish({ module_id: id, job_id: jobId, lease, outcome: 'completed', draft_path: join(target, 'draft.json'), review_path: join(target, 'review.json'),
            ...(review ? { identity_review_path: review } : {}), ...(assets.length ? { assets } : {}) });
        return null;
    } catch (error) {
        const refusal: Row = { message: messageOf(error) };
        const details = error instanceof RpcError ? row(error.details) : {};
        for (const field of ['path', 'rule', 'reason']) if (typeof details[field] === 'string' && details[field]) refusal[field] = details[field].slice(0, 500);
        const published = await withOptionalExclusiveLock(context.locks, lock, async (): Promise<boolean> => {
            const meta = await store.module(id), queue = await store.queue(id), job = queue.find(entry => entry.job_id === jobId && entry.lease === lease);
            const committed = row(row(meta.reading).completed)[jobId];
            // A finish that committed and then failed to write its queue did publish; the queue says so too.
            if (truth(committed)) {
                if (job && job.state !== 'completed') { Object.assign(job, { state: 'completed', result: committed, finished_at: job.finished_at ?? nowIso() }); await store.writeQueue(id, queue); }
                return true;
            }
            if (job && job.state === 'running') {
                Object.assign(job, { state: 'failed', detail: refusal.message, refusal, finished_at: nowIso() });
                await store.writeQueue(id, queue);
            }
            return false;
        });
        return published ? null : { key, reason: 'refused', detail: string(refusal.message).slice(0, 500) };
    } finally { await held?.release(); }
}

/**
 * One fork source place through the library's own `module.reference.materialize`, from a copy of the fork's place attempt in
 * `work/merged/<campaign>/<attempt>/`. A refusal is written beside the copy and is final. Returns null when published.
 */
async function replayPlace(env: Env, candidate: Place): Promise<Skip | null> {
    const { context, id, store, library, lock } = env, { key, work, place } = candidate;
    const target = await mergedDir(env, basename(work)), refusalFile = join(target, PLACE_REFUSAL);
    const staged = await withOptionalExclusiveLock(context.locks, lock, async (): Promise<Skip | null> => {
        const meta = await store.module(id);
        if (heldKeys(meta).has(key)) return { key, reason: 'already_present' };
        const scene = placeScene(await store.readGraph(id), { id: string(place.id), name: string(place.name) });
        if (scene && readyNodes(meta).has(scene.node_id)) return { key, reason: 'already_present' };
        const refused = await priorRefusal(context, target, null);
        if (refused !== null) return { key, reason: 'refused', detail: refused };
        await copyTree(work, target);
        return null;
    });
    if (staged) return staged;
    try {
        const result = await library.publishReferencePlace({ module_id: id, work_dir: target });
        if (result.state === 'ready' && !truth(result.reused)) return null;
        if (truth(result.reused)) return { key, reason: 'already_present' };
        throw new RpcError('invalid_params', `the source place was not published: ${string(result.state)}`);
    } catch (error) {
        const message = messageOf(error);
        await writeJsonAtomic(refusalFile, { message, at: nowIso() });
        return { key, reason: 'refused', detail: message.slice(0, 500) };
    }
}
