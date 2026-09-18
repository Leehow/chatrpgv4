/** The npc-voice lane's RPCs (contract §40.7), sharing the campaign writer and its lock like the journal. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import { playLanguageOf } from '../read/languages.js';
import { npcView } from '../read/capsule.js';
import { array, number, repr, row, string, type Row } from '../read/values.js';
import { createWriteRuntime } from '../write/index.js';
import { readNpcLedger } from '../write/contributions.js';
import { KEYS, buildPacket, fail, investigatorIdentity, nextPerson, openJob, parseJobId, readJob, submit } from './jobs.js';
/** The lane instruction is authored content (`content/setup/npc-voice.md`, §40.7); the packet carries it whole.
 *  Until 1.1.0 nothing read the file and the model saw only the kernel's short fallback passage. */
async function laneInstruction(context: KernelContext): Promise<string | undefined> {
    try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(join(context.content, 'setup', 'npc-voice.md')));
        return text.trim() || undefined;
    }
    catch {
        return undefined;
    }
}
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
            const handle = graph.handle(node), said = (await campaign.records()).flatMap((record: Row) => array(record.speech).filter(line => row(row(line).who).npc === handle).map(line => string(row(line).text)));
            const packet = buildPacket(campaign, graph, snapshot.world, node, await playLanguageOf(context, snapshot.meta), dossier, await laneInstruction(context), said, await investigatorIdentity(campaign, snapshot.world));
            return openJob(campaign, graph.handle(node), packet);
        },
        'voice.submit': async (params) => {
            const { campaign, snapshot, module } = await load(params), handle = parseJobId(campaign, params.job_id);
            const job = await readJob(campaign, handle);
            if (!job)
                throw new RpcError('invalid_params', `no voice job for ${handle}`, { fix: 'call voice.job first', details: { job_id: params.job_id ?? null } });
            const turn = number(row(await campaign.readTurn()).turn);
            const [result, replayed] = await submit(campaign, module.graph, snapshot.world, job, params.voice, turn, params.reason);
            if (replayed)
                return { ...result, replayed: true };
            await campaign.appendEvent(turn, { type: 'dossier-established', data: { npc: handle, keys: [...KEYS] } });
            return result;
        },
        'voice.fail': async (params) => {
            const { campaign } = await load(params), handle = parseJobId(campaign, params.job_id);
            return fail(campaign, await readJob(campaign, handle), string(params.job_id), handle, params.reason, params.detail);
        }
    });
}
