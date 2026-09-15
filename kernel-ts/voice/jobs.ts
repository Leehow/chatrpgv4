/** The npc-voice lane's job packets and the one write it makes (contract §40.5): a closed packet per
 *  person the source leaves silent, a shape-only check of two lines, and a write into the package's
 *  own §28.7 namespace so the book is never touched and the word dies with the package. No model
 *  call here, no table mapping anyone to a way of speaking. */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { readNpcLedger } from '../write/contributions.js';
import { FAILURE_REASONS, committedRecords } from '../memory/jobs.js';
import { array, clone, integer, number, repr, row, string, truth, type Row } from '../read/values.js';
export const MOD = 'npc-voice';
export const KEY = 'sample_lines';
export const LABEL = 'sounds like';
export const BUDGET = { lines: 2, max_chars: 120 };
const DOCUMENT_BYTES = 4096;
export const jobId = (campaign: string, handle: string) => `voice:${campaign}:${handle}`;
const INSTRUCTION = 'Write exactly two lines this person would say aloud, in the play language: one at ease, brushing off a ' +
    'stranger\'s first question; one under strain, pressed on the thing they hide. Talk, not prose: the words of this ' +
    'person\'s trade, class, schooling, era and place, with the oaths, slang, half sentences or mannered turns that mouth ' +
    'would produce; when coarse_language is false, no profanity. The book\'s voice, if given, governs. A line a person of ' +
    'another class or trade could say the same way is a failure, and so is a line that reads like writing. Same thought, ' +
    'two mouths: mocking messy hair, a coarse labourer swears at it and a respectable man asks whether that is a hen ' +
    'coop on your head. No numbers, no rules, no names of things the player has not discovered: hides is who they are, ' +
    'not what they say aloud. Answer {"sample_lines": ["…", "…"]} and nothing else.';
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
const established = (world: Row, node: Row): boolean => truth(row(row(row(row(row(row(world.mods).state)[MOD]).dossier)[string(node.node_id)])[KEY]).value);
/** A person needs lines when the package is on, the source gives none and none is established (§40.5). */
export function needsLines(graph: ModuleGraph, world: Row, node: Row): boolean {
    return !!packageState(world) && !truth(graph.npcProfile(node)[KEY]) && !established(world, node);
}
function npcNode(graph: ModuleGraph, value: any): Row | null {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const node = graph.nodes.get(value) || graph.find(value, ['npc']);
    return node?.node_kind === 'npc' ? node : null;
}
/** The next person needing lines, in §40.5 order: present in the latest committed record, then met, then
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
/** The closed packet: the Keeper-side dossier as present[] shows it, the person's own documents bounded, the setting. */
export function buildPacket(campaign: CampaignWriter, graph: ModuleGraph, world: Row, node: Row, language: string, dossier: Row): Row {
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
        npc, documents, budget: { ...BUDGET }, instruction: INSTRUCTION };
}
export async function openJob(campaign: CampaignWriter, handle: string, packet: Row): Promise<Row> {
    const existing = await readJob(campaign, handle);
    if (!existing || !['done'].includes(string(existing.status)))
        await writeJob(campaign, handle, { job_id: packet.job_id, npc: handle, status: 'open', opened_at: nowIso(), packet });
    return packet;
}
/** Shape only (§40.5): two strings, 1–120 characters trimmed, distinct, no brace pair, no line break. */
export function validateLines(value: any): [string, string] {
    const fix = 'exactly two spoken lines, each one line of 1-120 characters, different from each other, no {{ in them';
    if (!Array.isArray(value) || value.length !== BUDGET.lines)
        throw new RpcError('invalid_params', `sample_lines must be a list of ${BUDGET.lines} lines`, { fix, details: { field: 'sample_lines' } });
    const lines = value.map((line, index) => {
        if (typeof line !== 'string' || !line.trim() || Array.from(line.trim()).length > BUDGET.max_chars || /\n|\{\{/.test(line))
            throw new RpcError('invalid_params', `sample_lines[${index}] must be one line of 1-${BUDGET.max_chars} characters without braces`, { fix, details: { field: 'sample_lines', index } });
        return line.trim();
    });
    if (lines[0] === lines[1])
        throw new RpcError('invalid_params', 'the two sample lines must differ', { fix, details: { field: 'sample_lines' } });
    return [lines[0], lines[1]];
}
/** The one write: into the package's §28.7 namespace, never the graph. Idempotent by digest. */
export async function submit(campaign: CampaignWriter, graph: ModuleGraph, world: Row, job: Row, value: any, turn: number): Promise<[Row, boolean]> {
    const handle = string(job.npc), digest = jsonDigest(value ?? null);
    if (job.status === 'done') {
        if (job.lines_sha256 === digest)
            return [clone(row(job.result)), true];
        throw new RpcError('idempotency_conflict', `job ${string(job.job_id)} already completed with different lines`, { fix: 'a completed job is final; nothing to resubmit', details: { job_id: job.job_id } });
    }
    const node = graph.npc(handle);
    const authored = graph.npcProfile(node)[KEY];
    if (truth(authored))
        throw new RpcError('invalid_params', `the source already gives ${graph.displayName(node)} ${KEY}`, { fix: 'the book\'s own lines stand; the lane fills only where the source is silent', details: { field: 'sample_lines', actor: handle, authored_value: authored } });
    if (!packageState(world))
        throw new RpcError('invalid_params', `${MOD} is not enabled on this campaign`, { fix: 'enable the package before establishing its words', details: { mod: MOD } });
    const lines = validateLines(value);
    const state = ((world.mods.state ??= {})[MOD] ??= {}), dossier = (state.dossier ??= {}), recorded = (dossier[string(node.node_id)] ??= {});
    recorded[KEY] = { value: lines, label: LABEL, turn, mod: MOD };
    await campaign.writeWorld(world);
    const result = { job_id: string(job.job_id), npc: handle, name: graph.displayName(node), sample_lines: lines };
    await writeJob(campaign, handle, { ...job, status: 'done', lines_sha256: digest, result, completed_at: nowIso() });
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
