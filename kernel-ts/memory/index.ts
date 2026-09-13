/** Advisory memory lanes and recall share the campaign writer and its lock. */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import { readCampaign, unsupported } from '../read/handlers.js';
import { playLanguageOf } from '../read/languages.js';
import { array, row, number, integer, string, truth, repr, chars, type Row } from '../read/values.js';
import { createWriteRuntime } from '../write/index.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { noteMemory, readNpcLedger } from '../write/contributions.js';
import { buildJob, correctionJob, committedRecords, defaultJobTurn, fail, logs, openJob, parseJobId, readJob, submit } from './jobs.js';
import { history, recallMemory, transcript } from './recall.js';
/** The verifier's finding kinds, `play_language_mismatch` among them: the kernel makes no language refusal of its own (contract section 23). */
const FINDINGS = ['reveal', 'uncommitted_state', 'player_agency', 'play_language_mismatch'];
async function warn(campaign: CampaignWriter, params: Row): Promise<Row> {
    const turn = params.turn, lane = params.lane, findings = params.findings;
    if (!integer(turn) || number(turn) < 0)
        throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
    if (lane !== 'verifier')
        unsupported('lane', lane, ['verifier'], `unknown lane ${repr(lane)}`);
    if (!Array.isArray(findings))
        throw new RpcError('invalid_params', 'params.findings must be a list');
    const record = await campaign.readTurnRecord(number(turn));
    if (!record || record.closed_by !== 'narrate')
        throw new RpcError('invalid_params', `turn ${turn} has no narrate record to anchor findings to`, { details: { turn } });
    const rendered = string(record.rendered_text || ''), accepted: Row[] = [], dropped: Row[] = [];
    for (const [index, finding] of findings.entries()) {
        if (!isJsonObject(finding))
            throw new RpcError('invalid_params', `findings[${index}] must be an object`, { details: { index } });
        const kind = finding.kind, quote = finding.quote;
        if (!FINDINGS.includes(kind as string))
            throw new RpcError('invalid_params', `findings[${index}].kind ${repr(kind)} is not a finding kind`, { fix: `one of ${repr(FINDINGS)}`, details: { index } });
        if (typeof quote !== 'string' || !quote.trim() || !rendered.includes(quote)) {
            dropped.push({ index, kind, reason: 'quote is not a substring of rendered_text' });
            continue;
        }
        if (accepted.length >= 10) {
            dropped.push({ index, kind, reason: 'more than 10 findings' });
            continue;
        }
        accepted.push({ lane, kind, quote: chars(quote, 120), why: chars(string(finding.why || ''), 200), at: nowIso() });
    }
    const warnings = [...array(record.warnings), ...accepted];
    record.warnings = warnings;
    await campaign.writeTurnRecord(record);
    await campaign.telemetry({ lane, turn, ok: true, findings: findings.length, accepted: accepted.length, dropped: dropped.length });
    return { turn, lane, accepted: accepted.length, dropped, warnings: warnings.map(value => ({ kind: value.kind, quote: value.quote, why: value.why })) };
}
export function createMemoryHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    async function load(params: Row) {
        const campaign = await writer.campaign(params), snapshot = new CampaignSnapshot(context, campaign.id);
        snapshot.meta = await campaign.readCampaign();
        snapshot.jsonFiles.set('campaign.json', snapshot.meta);
        if (snapshot.meta.status !== 'active')
            throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(snapshot.meta.status)}`, {
                ...(snapshot.meta.status === 'setting_up' ? { fix: string(row(await context.snapshots.readJson(context.content + '/setup/steps.json')).table_open_fix).replaceAll('{campaign}', campaign.id) } : {}),
                details: { status: snapshot.meta.status }
            });
        snapshot.world = await campaign.readWorld();
        const module = await loadCampaignModule(context, string(snapshot.meta.module_id), snapshot.world);
        snapshot.jsonFiles.set('world.json', snapshot.world);
        if (!Object.hasOwn(snapshot.world, 'scene_trail'))
            await writer.read.repairLegacyTrail!(snapshot);
        return { campaign, snapshot, module };
    }
    async function jobFor(loaded: Awaited<ReturnType<typeof load>>, id: any): Promise<[
        Row | null,
        number
    ]> {
        const { campaign, snapshot, module } = loaded, turn = parseJobId(campaign, id);
        let job = await readJob(campaign, string(id));
        if (!job && (await committedRecords(campaign)).has(turn)) {
            const packet = string(id).startsWith('reconcile:') ? await correctionJob(campaign, module.graph, await campaign.party(), string(id))
                : await buildJob(campaign, module.graph, await playLanguageOf(context, snapshot.meta), turn, await campaign.party(), snapshot.world);
            if (packet) await openJob(campaign, packet);
            job = await readJob(campaign, string(id));
        }
        return [job, turn];
    }
    return Object.freeze({
        'table.warn': async (params) => warn((await load(params)).campaign, params),
        'memory.job': async (params) => {
            const { campaign, snapshot, module } = await load(params);
            if (params.job_id != null) {
                parseJobId(campaign, params.job_id);
                if (!string(params.job_id).startsWith('reconcile:')) throw new RpcError('invalid_params', 'Use turn for an extraction job, or job_id for a retained reconciliation');
                const [job] = await jobFor({campaign, snapshot, module}, params.job_id);
                if (!job?.correction) throw new RpcError('invalid_params', 'No matching correction reconciliation job');
                if (job.worldline !== (snapshot.meta.active_worldline ?? 'main')) throw new RpcError('invalid_params', 'Correction job belongs to another worldline');
                return job.packet;
            }
            let turn = params.turn;
            if (turn == null) {
                turn = await defaultJobTurn(campaign);
                if (turn == null) {
                    const packet = await correctionJob(campaign, module.graph, await campaign.party());
                    return packet ? openJob(campaign, packet) : { job_id: null, turn: null };
                }
            }
            else if (!integer(turn) || number(turn) < 0)
                throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
            return openJob(campaign, await buildJob(campaign, module.graph, await playLanguageOf(context, snapshot.meta), number(turn), await campaign.party(), snapshot.world));
        },
        'memory.submit': async (params) => {
            const loaded = await load(params), { campaign, module } = loaded, [job, turn] = await jobFor(loaded, params.job_id);
            if (!job)
                throw new RpcError('invalid_params', `no extraction job for turn ${turn}`, { fix: 'call memory.job first', details: { job_id: params.job_id ?? null } });
            const [result, replayed] = await submit(campaign, module.graph, await campaign.party(), job, params.candidates, params.story);
            if (replayed)
                return { ...result, replayed: true };
            const written = new Set(array(result.written));
            if (written.size) {
                const rows = (await logs(campaign, 'memory/candidates.jsonl')).filter(value => written.has(string(value.id)));
                if (rows.length) {
                    const ledger = await readNpcLedger(campaign);
                    noteMemory(ledger, module.graph, rows);
                    await campaign.write('npc-ledger.json', ledger);
                }
            }
            if (result.story) await campaign.telemetry({lane: 'story', event: 'assessment', turn,
                status: row(result.story).status, thread: row(result.story).thread,
                bridge_delivered: row(result.story).bridge_delivered});
            await campaign.appendEvent(turn, { type: 'memory-written', data: { job_id: result.job_id, turn, candidates: result.candidates, superseded: array(result.superseded).length } });
            return result;
        },
        'memory.fail': async (params) => {
            const loaded = await load(params), [job, turn] = await jobFor(loaded, params.job_id);
            return fail(loaded.campaign, job, string(params.job_id), turn, params.reason, params.detail);
        },
        'table.recall': async (params) => {
            const { campaign: snapshot, module } = await readCampaign(context, params, false, true, writer.read), what = params.what;
            if (!['history', 'memory', 'transcript'].includes(what as string))
                unsupported('what', what, ['history', 'memory', 'transcript'], `unknown recall kind ${repr(what)}`);
            await writer.read.touchActing!(snapshot);
            const campaign = await writer.campaign(params), current = number(snapshot.turn.turn);
            return what === 'transcript' ? transcript(campaign, current, params) : what === 'history' ? history(campaign, current, params) : recallMemory(campaign, module.graph, snapshot.world, params);
        }
    });
}
