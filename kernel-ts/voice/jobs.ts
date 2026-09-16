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
import { FAILURE_REASONS, committedRecords } from '../memory/jobs.js';
import { array, clone, entries, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
export const MOD = 'npc-voice';
export const MASK_KEY = 'voice_mask';
export const EXCHANGES_KEY = 'exchanges';
/** The two words, in the order the manifest contributes them and the event names them. */
export const KEYS = [MASK_KEY, EXCHANGES_KEY] as const;
export const LABELS: Readonly<Record<string, string>> = Object.freeze({ [MASK_KEY]: 'mask', [EXCHANGES_KEY]: 'in exchange' });
/** The 1.0.x word; a record of it is deleted the moment the person is re-established under the two words. */
const LEGACY_KEY = 'sample_lines';
export const BUDGET = { mask_chars: 200, exchanges: 3, max_chars: 200 };
const DOCUMENT_BYTES = 4096;
const TAKEN_MASKS = 12;
export const jobId = (campaign: string, handle: string) => `voice:${campaign}:${handle}`;
/** The fallback when `content/setup/npc-voice.md` cannot be read; the file is the instruction (§40.7). */
const INSTRUCTION = 'Write how this person is heard, in the play language. First a mask, one line: what they call themselves ' +
    'and the person they are talking to, one sentence-ending habit, the level of their words (their trade, their schooling), ' +
    'one pet phrase. One or two markers a listener could name, not five; different from every mask in taken_masks; register, ' +
    'never a dialect caricature. Then three exchanges, each one line: what a stranger says, an arrow, what this person says ' +
    'back wearing the mask -- mundane talk that answers the words just said and leaves the stranger something to say next, ' +
    'never an aphorism. Same thought, two mouths: mocking messy hair, a coarse labourer swears at it and a respectable man ' +
    'asks whether that is a hen coop on your head. The book\'s voice, if given, governs. No numbers, no rules, no name of ' +
    'any other person, nothing the player has not discovered: hides is who they are, not what they say aloud. ' +
    'Answer {"voice": {"mask": "…", "exchanges": ["…", "…", "…"]}} and nothing else.';
export function parseJobId(campaign: CampaignWriter, value: any): string {
    const found = typeof value === 'string' ? /^voice:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):(.+)$/.exec(value) : null;
    if (!found || found[1] !== campaign.id)
        throw new RpcError('invalid_params', 'job_id must be the voice:<campaign>:<handle> that voice.job returned', { details: { job_id: value ?? null } });
    return found[2];
}
const jobPath = (handle: string) => join('npc-voice/jobs', handle.replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
export async function readJob(campaign: CampaignWriter, handle: string): Promise<Row | null> {
    try {
        const value = await campaign.context.snapshots.readJson(campaign.path(jobPath(handle)));
        return isJsonObject(value) ? clone(value) : null;
    }
    catch {
        return null;
    }
}
const writeJob = (campaign: CampaignWriter, handle: string, value: Row) => campaign.write(jobPath(handle), value);
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
export const SILENT_REASON = 'does_not_speak';
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
/** The next person needing a voice, in §40.5 order: present in the latest committed record, then met, then
 *  (with backfill) everyone else the graph names. */
export async function nextPerson(campaign: CampaignWriter, graph: ModuleGraph, world: Row, backfill: boolean): Promise<Row | null> {
    if (!packageState(world))
        return null;
    const ordered: Row[] = [], seen = new Set<string>();
    const take = (node: Row | null) => {
        if (node && !seen.has(string(node.node_id))) { seen.add(string(node.node_id)); ordered.push(node); }
    };
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
        if (needsLines(graph, world, node) && (await readJob(campaign, graph.handle(node)))?.status !== 'done')
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
/** The closed packet: the Keeper-side dossier as present[] shows it, the person's own documents bounded, the setting. */
export function buildPacket(campaign: CampaignWriter, graph: ModuleGraph, world: Row, node: Row, language: string, dossier: Row, instruction: string = INSTRUCTION): Row {
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
    return { job_id: jobId(campaign.id, handle), play_language: language,
        module: { title: graph.title(), ...(typeof era === 'string' && era.trim() ? { era } : {}) },
        coarse_language: row(lock.settings).coarse_language !== false,
        npc, documents, taken_masks: takenMasks(graph, world, node), budget: { ...BUDGET }, instruction };
}
export async function openJob(campaign: CampaignWriter, handle: string, packet: Row): Promise<Row> {
    const existing = await readJob(campaign, handle);
    if (!existing || !['done'].includes(string(existing.status)))
        await writeJob(campaign, handle, { job_id: packet.job_id, npc: handle, status: 'open', opened_at: nowIso(), packet });
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
