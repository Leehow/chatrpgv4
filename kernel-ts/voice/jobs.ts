/** The npc-voice lane's job packets and the one write it makes (contract §40.7): a closed packet per
 *  person the source leaves silent, a shape-only check of a mask and three exchanges, and a write into
 *  the package's own §28.7 namespace so the book is never touched and the words die with the package.
 *  No model call here, no table mapping anyone to a way of speaking. */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { readNpcLedger } from '../write/contributions.js';
import { personRecord, APPEARANCE_CHARS } from '../read/capsule.js';
import { FAILURE_REASONS, committedRecords } from '../memory/jobs.js';
import { array, chars, clone, entries, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
import {MOD, MASK_KEY, EXCHANGES_KEY, KEYS, LEGACY_KEY, LABELS, SILENT_REASON} from './fields.js';
export {MOD, MASK_KEY, EXCHANGES_KEY, KEYS, LABELS, SILENT_REASON} from './fields.js';
/** The 1.0.x word; a record of it is deleted the moment the person is re-established under the two words. */
export const BUDGET = { mask_chars: 200, exchanges: 3, max_chars: 200 };
const DOCUMENT_BYTES = 4096;
const TAKEN_MASKS = 12;
export const jobId = (campaign: string, handle: string, generation: Row | null = null) => `voice:${campaign}:${handle}${generation ? `@${generation.digest}` : ''}`;
/** Version-1 locks keep their original identity and storage. New identities come only from the lock. */
export function generationOf(world: Row): Row | null {
    const lock = packageState(world);
    return lock && number(lock.state_version) >= 2 ? { version: lock.version, digest: lock.digest, state_version: lock.state_version } : null;
}
/** The fallback when `content/setup/npc-voice.md` cannot be read; the file is the instruction (§40.7). */
/** The last lines this person spoke at this table that ride in the packet (§113 D). */
const SAID_LINES = 8;
const INSTRUCTION = 'Write how this person is heard, in the play language. First a mask, one line describing register and flexible ' +
    'habits of address, wording or sentence endings, distinct from taken_masks without a dialect caricature. Do not require a ' +
    'catchphrase, topic, refusal, abruptness or a marker in every sentence. Then three varied exchanges, each one line: what ' +
    'someone says, an arrow, and this person answering those actual words in natural connected speech. The first is ordinary ' +
    'first contact, not a mandatory brush-off. Courtesy, uncertainty, agreement and direct answers fit every register. Vary ' +
    'the responses, not three versions of an agenda; examples illustrate a voice, never a phrase bank or a script to recite. ' +
    'Let the situation decide cooperation, emotion and length. The book\'s voice and facts govern. The investigator block is ' +
    'the listener: respect the given sex and address, invent no name or relationship, and use only supplied visible facts ' +
    'for an address term. Where those facts do not settle the language\'s form, use wording that fits anyone. Never leak ' +
    'secrets, undiscovered facts, other people\'s names or rules: hides informs the person, not what they say aloud. ' +
    'Lines under said were already spoken at this table: do not copy them or recycle example wording when a topic returns. ' +
    'Answer {"voice": {"mask": "…", "exchanges": ["…", "…", "…"]}}; only a source that says the person does not speak ' +
    'permits {"voice": null, "reason": "does_not_speak"}.';
export function parseJobId(campaign: CampaignWriter, value: any, world: Row): { handle: string; generation: Row | null } {
    const found = typeof value === 'string' ? /^voice:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([^@]+)(?:@([a-f0-9]{64}))?$/.exec(value) : null;
    const generation = generationOf(world), lock = row(row(row(world.mods).active)[MOD]);
    if (!found || found[1] !== campaign.id || (found[3] ? !generation || found[3] !== generation.digest : number(lock.state_version) >= 2))
        throw new RpcError('invalid_params', 'job_id must identify the current voice generation returned by voice.job', { details: { job_id: value ?? null } });
    return { handle: found[2], generation };
}
/** Check before idempotent replay too: stale results may never establish current words. */
export function assertJobGeneration(campaign: CampaignWriter, world: Row, job: Row): void {
    const { handle, generation } = parseJobId(campaign, job.job_id, world);
    const matches = (value: any): boolean => {
        const stored = row(value);
        return stored.version === generation?.version && stored.digest === generation?.digest &&
            integer(stored.state_version) && number(stored.state_version) === number(generation?.state_version);
    };
    if (handle !== job.npc || (generation ? !matches(job.generation) || !matches(row(job.packet).generation) || row(job.packet).job_id !== job.job_id : job.generation != null))
        throw new RpcError('invalid_params', 'voice job generation does not match the current enabled package lock', { details: { job_id: job.job_id } });
}
const jobPath = (handle: string, generation: Row | null = null) => join('npc-voice/jobs', ...(generation ? ['v2', string(generation.digest)] : []), handle.replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
export async function readJob(campaign: CampaignWriter, handle: string, generation: Row | null = null): Promise<Row | null> {
    try {
        const value = await campaign.context.snapshots.readJson(campaign.path(jobPath(handle, generation)));
        return isJsonObject(value) ? clone(value) : null;
    }
    catch {
        return null;
    }
}
const writeJob = (campaign: CampaignWriter, handle: string, value: Row) => campaign.write(jobPath(handle, value.generation ?? null), value);
/** The package's lock and settings, or null when it is not on: the lane has nothing to do then. */
export function packageState(world: Row): Row | null {
    const lock = row(row(row(world.mods).active)[MOD]);
    return truth(lock.enabled) ? lock : null;
}
const namespace = (world: Row): Row => row(row(row(row(world.mods).state)[MOD]).dossier);
/** Established is a record under the exchanges key, lines or the `does_not_speak` answer: either way the person is settled. */
const established = (world: Row, node: Row): boolean => Object.hasOwn(row(namespace(world)[string(node.node_id)]), EXCHANGES_KEY);
/** The book's word stands (§28.7): a person whose speech the book prints under either key is never written. */
const authored = (graph: ModuleGraph, node: Row): boolean => KEYS.some(key => truth(graph.npcProfile(node)[key]));
/** A person needs a voice when the package is on, the source gives none and none is established (§40.7). */
export function needsLines(graph: ModuleGraph, world: Row, node: Row): boolean {
    return !!packageState(world) && !authored(graph, node) && !established(world, node);
}
function npcNode(graph: ModuleGraph, value: any): Row | null {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const node = graph.nodes.get(value) || graph.find(value, ['npc']);
    return node?.node_kind === 'npc' ? node : null;
}
/** The next person needing a voice, in §40.5/§40.7 order: on stage right now (so the opening's drain writes
 *  the start scene's people before the first player turn -- on the real module the employer's first two
 *  answers came before his mask), then present in the latest committed record, then met, then (with
 *  backfill) everyone else the graph names. */
export async function nextPerson(campaign: CampaignWriter, graph: ModuleGraph, world: Row, backfill: boolean): Promise<Row | null> {
    if (!packageState(world))
        return null;
    const ordered: Row[] = [], seen = new Set<string>();
    const take = (node: Row | null) => {
        if (node && !seen.has(string(node.node_id))) { seen.add(string(node.node_id)); ordered.push(node); }
    };
    const here = string(world.active_scene);
    for (const [handle, at] of entries(row(world.npc_presence)))
        if (here && at === here)
            take(npcNode(graph, handle));
    const committed = await committedRecords(campaign), latest = Math.max(-1, ...committed.keys());
    if (latest >= 0)
        for (const name of array(row(row(committed.get(latest)).world).present))
            take(npcNode(graph, name));
    const ledger = await readNpcLedger(campaign);
    for (const [id, item] of Object.entries(ledger))
        if (truth(row(row(item).turns_present).count))
            take(npcNode(graph, id));
    if (backfill)
        for (const node of graph.nodes.values())
            if (node.node_kind === 'npc')
                take(node);
    for (const node of ordered)
        if (needsLines(graph, world, node) && (await readJob(campaign, graph.handle(node), generationOf(world)))?.status !== 'done')
            return node;
    return null;
}
/** The masks other people of this campaign already wear -- the book's and the table's -- so the lane can keep
 *  this one apart from them. Masks only: no name travels with them. */
export function takenMasks(graph: ModuleGraph, world: Row, node: Row): string[] {
    const masks: string[] = [], seen = new Set<string>();
    const add = (value: any) => {
        const first = Array.isArray(value) ? value[0] : value, mask = typeof first === 'string' ? first.trim() : '';
        if (mask && !seen.has(mask)) { seen.add(mask); masks.push(mask); }
    };
    for (const other of graph.nodes.values())
        if (other.node_kind === 'npc' && other.node_id !== node.node_id)
            add(graph.npcProfile(other)[MASK_KEY]);
    for (const [id, words] of entries(namespace(world)))
        if (id !== string(node.node_id))
            add(row(row(words)[MASK_KEY]).value);
    return masks.slice(0, TAKEN_MASKS);
}
/** Who the mask is written for (contract §118, §119): the facts an address term in that mask has to fit -- the
 *  sheet's free-text `sex` (§117, the value the Keeper owes), the word this table calls them to their face (§79),
 *  and what can be seen of them (§119), so a person with no name for them can still be named out of what is
 *  visible. The investigator the capsule's `known.investigator` carries, and never a name: a mask says how someone
 *  talks, and an address term built from a name is one this person has not been introduced to. */
export async function investigatorIdentity(campaign: CampaignWriter, world: Row): Promise<Row | null> {
    const sheet = (await campaign.party())[0];
    const sex = typeof sheet?.sex === 'string' ? sheet.sex.trim() : '';
    const address = string(personRecord(world, string(sheet?.id)).address || '').trim();
    const written = string(row(row(sheet).backstory).personal_description || '').trim();
    const appearance = written ? chars(written, APPEARANCE_CHARS) : '';
    if (!sex && !address && !appearance)
        return null;
    return { ...(sex ? { sex } : {}), ...(address ? { address } : {}), ...(appearance ? { appearance } : {}) };
}
/** The closed packet: the Keeper-side dossier as present[] shows it, the person's own documents bounded, the setting. */
export function buildPacket(campaign: CampaignWriter, graph: ModuleGraph, world: Row, node: Row, language: string, dossier: Row, instruction: string = INSTRUCTION, said: string[] = [], investigator: Row | null = null): Row {
    const handle = graph.handle(node), lock = packageState(world) ?? {};
    const documents: string[] = [];
    let bytes = 0;
    for (const document of array(row(row(node.properties).runtime_projection).documents)) {
        const text = string(row(document).text || row(document).content || '');
        if (!text.trim())
            continue;
        const take = text.slice(0, Math.max(0, DOCUMENT_BYTES - bytes));
        if (!take)
            break;
        documents.push(take);
        bytes += take.length;
    }
    const npc: Row = { handle, name: graph.displayName(node) };
    for (const key of ['role', 'wants', 'fears', 'hides', 'voice', 'speaks'])
        if (truth(dossier[key]))
            npc[key] = dossier[key];
    const lies = graph.npcWouldSay(node);
    if (lies.length)
        npc.would_lie_about = lies.slice(0, 3);
    const deflect = array(recordOf(node).deflect_lines).map(string).filter(Boolean);
    if (deflect.length)
        npc.deflect_lines = deflect.slice(0, 3);
    const knowledge = graph.authoredLines(node, 'knowledge');
    if (knowledge.length)
        npc.knowledge = knowledge.slice(0, 3);
    const era = recordOf(graph.moduleNode ?? null).era ?? recordOf(graph.moduleNode ?? null).period ?? null;
    const generation = generationOf(world);
    return { job_id: jobId(campaign.id, handle, generation), ...(generation ? { generation } : {}), play_language: language,
        module: { title: graph.title(), ...(typeof era === 'string' && era.trim() ? { era } : {}) },
        coarse_language: row(lock.settings).coarse_language !== false,
        npc, documents, taken_masks: takenMasks(graph, world, node), said: said.slice(-SAID_LINES), budget: { ...BUDGET }, instruction,
        ...(investigator ? { investigator } : {}) };
}
export async function openJob(campaign: CampaignWriter, handle: string, packet: Row): Promise<Row> {
    const existing = await readJob(campaign, handle, packet.generation ?? null);
    if (!existing || !['done'].includes(string(existing.status)))
        await writeJob(campaign, handle, { job_id: packet.job_id, ...(packet.generation ? { generation: clone(packet.generation) } : {}), npc: handle, status: 'open', opened_at: nowIso(), packet });
    return packet;
}
const FIX = `a mask of one line (1-${BUDGET.mask_chars} characters) and exactly ${BUDGET.exchanges} exchanges, each one line of 1-${BUDGET.max_chars} characters, different from each other, no {{ in any of them`;
function oneLine(value: any, max: number, field: string, index?: number): string {
    if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max || /\n|\{\{/.test(value))
        throw new RpcError('invalid_params', `${field}${index == null ? '' : `[${index}]`} must be one line of 1-${max} characters without braces`, { fix: FIX, details: { field, ...(index == null ? {} : { index }) } });
    return value.trim();
}
/** Shape only (§40.7): a mask of one bounded line and three distinct bounded exchanges, no brace pair, no line break. */
export function validateVoice(value: any): { mask: string; exchanges: string[] } {
    if (!isJsonObject(value) || Object.keys(value).some(key => !['mask', 'exchanges'].includes(key)))
        throw new RpcError('invalid_params', 'voice must be {mask, exchanges}', { fix: FIX, details: { field: 'voice' } });
    const mask = oneLine(value.mask, BUDGET.mask_chars, 'voice.mask');
    if (!Array.isArray(value.exchanges) || value.exchanges.length !== BUDGET.exchanges)
        throw new RpcError('invalid_params', `voice.exchanges must be a list of ${BUDGET.exchanges} lines`, { fix: FIX, details: { field: 'voice.exchanges' } });
    const exchanges = value.exchanges.map((line: any, index: number) => oneLine(line, BUDGET.max_chars, 'voice.exchanges', index));
    if (new Set(exchanges).size !== exchanges.length)
        throw new RpcError('invalid_params', 'the exchanges must differ from each other', { fix: FIX, details: { field: 'voice.exchanges' } });
    return { mask, exchanges };
}
/** The one write: into the package's §28.7 namespace, never the graph. Idempotent by digest. */
export async function submit(campaign: CampaignWriter, graph: ModuleGraph, world: Row, job: Row, value: any, turn: number, reason?: any): Promise<[Row, boolean]> {
    assertJobGeneration(campaign, world, job);
    const handle = string(job.npc), digest = jsonDigest(value === null ? { reason: reason ?? null } : value ?? null);
    if (job.status === 'done') {
        if (job.voice_sha256 === digest)
            return [clone(row(job.result)), true];
        throw new RpcError('idempotency_conflict', `job ${string(job.job_id)} already completed with a different voice`, { fix: 'a completed job is final; nothing to resubmit', details: { job_id: job.job_id } });
    }
    const node = graph.npc(handle);
    for (const key of KEYS)
        if (truth(graph.npcProfile(node)[key]))
            throw new RpcError('invalid_params', `the source already gives ${graph.displayName(node)} ${key}`, { fix: 'the book\'s own words stand; the lane fills only where the source is silent', details: { field: 'voice', actor: handle, key, authored_value: graph.npcProfile(node)[key] } });
    if (!packageState(world))
        throw new RpcError('invalid_params', `${MOD} is not enabled on this campaign`, { fix: 'enable the package before establishing its words', details: { mod: MOD } });
    // §40.5: a person the book says does not speak (a swarm, a haunt that acts through knocks) has no
    // voice to write; the lane says so and the person is settled without one. The read side skips a
    // null value, so nothing reaches the capsule, and `nextPerson` never offers them again.
    const silent = value === null && reason === SILENT_REASON;
    if (value === null && !silent)
        throw new RpcError('invalid_params', `voice null needs reason ${repr(SILENT_REASON)}`, { fix: `answer {"voice": null, "reason": "${SILENT_REASON}"} only for someone the book says does not speak`, details: { field: 'reason' } });
    const voice = silent ? null : validateVoice(value);
    const state = ((world.mods.state ??= {})[MOD] ??= {}), dossier = (state.dossier ??= {}), recorded = (dossier[string(node.node_id)] ??= {});
    const values: Record<string, string[] | null> = { [MASK_KEY]: voice ? [voice.mask] : null, [EXCHANGES_KEY]: voice ? voice.exchanges : null };
    for (const key of KEYS)
        recorded[key] = { value: values[key], label: LABELS[key], turn, mod: MOD, shape: 'lines', ...(silent ? { reason: SILENT_REASON } : {}) };
    delete recorded[LEGACY_KEY];
    await campaign.writeWorld(world);
    const result = { job_id: string(job.job_id), npc: handle, name: graph.displayName(node), voice, ...(silent ? { reason: SILENT_REASON } : {}) };
    await writeJob(campaign, handle, { ...job, status: 'done', voice_sha256: digest, result, completed_at: nowIso() });
    return [result, false];
}
export async function fail(campaign: CampaignWriter, job: Row | null, id: string, handle: string, reason: any, detail: any): Promise<Row> {
    if (!FAILURE_REASONS.includes(reason))
        throw new RpcError('invalid_params', `reason ${repr(reason)} is not a failure reason`, { fix: `one of: ${FAILURE_REASONS.join(', ')}` });
    if (job && job.status !== 'done')
        await writeJob(campaign, handle, { ...job, status: 'failed', failed_at: nowIso(), reason, detail: detail ?? null });
    return { job_id: id, npc: handle, status: 'failed', reason };
}
export const isTurn = (value: any): boolean => integer(value) && number(value) >= 0;
