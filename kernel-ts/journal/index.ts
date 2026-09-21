/** The player-side NPC journal lane shares the campaign writer and its lock, like the memory lane. */
import {join} from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import { playLanguageOf } from '../read/languages.js';
import { integer, number, repr, row, string, type Row } from '../read/values.js';
import { createWriteRuntime } from '../write/index.js';
import { committedRecords } from '../memory/jobs.js';
import { buildJob, defaultJobTurn, fail, openJob, parseJobId, readJob, submit, JOURNAL_REFERENCE_PROTOCOL } from './jobs.js';
export function createJournalHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
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
        const module = await loadCampaignModule(context, string(snapshot.meta.module_id), snapshot.world, campaign.id);
        snapshot.jsonFiles.set('world.json', snapshot.world);
        if (!Object.hasOwn(snapshot.world, 'scene_trail'))
            await writer.read.repairLegacyTrail!(snapshot);
        return { campaign, snapshot, module };
    }
    async function jobFor(loaded: Awaited<ReturnType<typeof load>>, id: any, allowCreate=true): Promise<[
        Row | null,
        number
    ]> {
        const { campaign, snapshot, module } = loaded, turn = parseJobId(campaign, id);
        let job = await readJob(campaign, string(id));
        if(!job&&await campaign.context.snapshots.pathExists(campaign.path(join('npc-journal/jobs',string(id)+'.json'))))
            throw new RpcError('invalid_params','The retained journal job is unreadable; preserve it for inspection',{details:{reason:'journal_reference_stale'}});
        if (!job && allowCreate && (await committedRecords(campaign)).has(turn)) {
            await openJob(campaign, await buildJob(campaign, module.graph, await playLanguageOf(context, snapshot.meta), turn, await campaign.party(), snapshot.world));
            job = await readJob(campaign, string(id));
        }
        return [job, turn];
    }
    return Object.freeze({
        'journal.job': async (params) => {
            if(params.mode!==undefined&&(typeof params.mode!=='string'||!['referenced','legacy'].includes(params.mode))) throw new RpcError('invalid_params','Journal mode must be referenced or legacy');
            const { campaign, snapshot, module } = await load(params);
            let turn = params.turn;
            if (turn == null) {
                turn = await defaultJobTurn(campaign);
                if (turn == null)
                    return { job_id: null, turn: null };
            }
            else if (!integer(turn) || number(turn) < 0)
                throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
            return openJob(campaign, await buildJob(campaign, module.graph, await playLanguageOf(context, snapshot.meta), number(turn), await campaign.party(), snapshot.world,{referenced:params.mode==='referenced'}));
        },
        'journal.submit': async (params) => {
            if(params.protocol!==undefined&&params.protocol!==JOURNAL_REFERENCE_PROTOCOL) throw new RpcError('invalid_params','Unsupported journal submission protocol');
            const loaded = await load(params), [job, turn] = await jobFor(loaded, params.job_id,params.protocol!==JOURNAL_REFERENCE_PROTOCOL);
            if (!job)
                throw new RpcError('invalid_params', `no journal job for turn ${turn}`, { fix: 'call journal.job first', details: { job_id: params.job_id ?? null } });
            if(job.protocol===JOURNAL_REFERENCE_PROTOCOL
                ? params.protocol!==JOURNAL_REFERENCE_PROTOCOL||params.selection_binding!==job.selection_binding
                : params.protocol!==undefined||params.selection_binding!==undefined)
                throw new RpcError('invalid_params','The submission protocol or identity binding differs from its pinned journal job');
            const [result, replayed] = await submit(loaded.campaign, job, params.entries);
            if (replayed)
                return { ...result, replayed: true };
            await loaded.campaign.appendEvent(turn, { type: 'journal-written', data: { job_id: result.job_id, turn, entries: result.entries } });
            return result;
        },
        'journal.fail': async (params) => {
            if(params.protocol!==undefined&&params.protocol!==JOURNAL_REFERENCE_PROTOCOL) throw new RpcError('invalid_params','Unsupported journal failure protocol');
            const loaded = await load(params), [job, turn] = await jobFor(loaded, params.job_id,params.protocol!==JOURNAL_REFERENCE_PROTOCOL);
            if(job&&(job.protocol===JOURNAL_REFERENCE_PROTOCOL
                ? params.protocol!==JOURNAL_REFERENCE_PROTOCOL||params.selection_binding!==job.selection_binding
                : params.protocol!==undefined||params.selection_binding!==undefined))
                throw new RpcError('invalid_params','The failure belongs to another journal protocol or identity binding');
            return fail(loaded.campaign, job, string(params.job_id), turn, params.reason, params.detail);
        }
    });
}
