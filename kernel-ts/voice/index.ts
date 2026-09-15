/** The npc-voice lane's RPCs (contract §40.5), sharing the campaign writer and its lock like the journal. */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import { playLanguageOf } from '../read/languages.js';
import { npcView } from '../read/capsule.js';
import { number, repr, row, string, type Row } from '../read/values.js';
import { createWriteRuntime } from '../write/index.js';
import { readNpcLedger } from '../write/contributions.js';
import { buildPacket, fail, nextPerson, openJob, parseJobId, readJob, submit } from './jobs.js';
export function createVoiceHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    async function load(params: Row) {
        const campaign = await writer.campaign(params), snapshot = new CampaignSnapshot(context, campaign.id);
        snapshot.meta = await campaign.readCampaign();
        snapshot.jsonFiles.set('campaign.json', snapshot.meta);
        if (snapshot.meta.status !== 'active')
            throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(snapshot.meta.status)}`, { details: { status: snapshot.meta.status } });
        snapshot.world = await campaign.readWorld();
        const module = await loadCampaignModule(context, string(snapshot.meta.module_id), snapshot.world, campaign.id);
        snapshot.jsonFiles.set('world.json', snapshot.world);
        return { campaign, snapshot, module };
    }
    return Object.freeze({
        'voice.job': async (params) => {
            const { campaign, snapshot, module } = await load(params), graph = module.graph;
            const node = await nextPerson(campaign, graph, snapshot.world, params.backfill === true);
            if (!node)
                return { job_id: null };
            const ledger = await readNpcLedger(campaign), dossier = npcView(graph, snapshot.world, node, ledger);
            const packet = buildPacket(campaign, graph, snapshot.world, node, await playLanguageOf(context, snapshot.meta), dossier);
            return openJob(campaign, graph.handle(node), packet);
        },
        'voice.submit': async (params) => {
            const { campaign, snapshot, module } = await load(params), handle = parseJobId(campaign, params.job_id);
            const job = await readJob(campaign, handle);
            if (!job)
                throw new RpcError('invalid_params', `no voice job for ${handle}`, { fix: 'call voice.job first', details: { job_id: params.job_id ?? null } });
            const turn = number(row(await campaign.readTurn()).turn);
            const [result, replayed] = await submit(campaign, module.graph, snapshot.world, job, params.sample_lines, turn, params.reason);
            if (replayed)
                return { ...result, replayed: true };
            await campaign.appendEvent(turn, { type: 'dossier-established', data: { npc: handle, keys: ['sample_lines'] } });
            return result;
        },
        'voice.fail': async (params) => {
            const { campaign } = await load(params), handle = parseJobId(campaign, params.job_id);
            return fail(campaign, await readJob(campaign, handle), string(params.job_id), handle, params.reason, params.detail);
        }
    });
}
