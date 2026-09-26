/** The npc-voice lane's RPCs (contract §40.7), sharing the campaign writer and its lock like the journal. The
 *  lane's owner is resolved here, per request, from the campaign's locks and the installed catalog (§40.7 Owner). */
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
import { readModCatalog } from '../read/mods.js';
import { KEYS, assertJobGeneration, buildPacket, fail, investigatorIdentity, nextPerson, openJob, parseJobId, readJob, submit, voiceOwner, type VoiceOwner } from './jobs.js';
/** Contract §40.7 Instruction (2026-09-26): the lane's instruction is the owner package's `contributes.voice_lane`, a
 *  package Markdown file frozen with its version. An owner whose version predates the contribution (npc-voice 1.x,
 *  narration-craft 2.0.0-2.0.1) reads the frozen copy it was written against, `content/compat/npc-voice-lane.md`,
 *  so a saved game keeps its lane. Neither readable: the kernel's short fallback in jobs.ts. */
const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
async function laneInstruction(context: KernelContext, owner: VoiceOwner): Promise<string | undefined> {
    const manifest = row(owner.manifest), path = row(manifest.contributes).voice_lane;
    const files = manifest.files instanceof Map ? manifest.files as ReadonlyMap<string, Uint8Array> : undefined;
    if (typeof path === 'string' && files?.has(path)) {
        try {
            return decode(files.get(path)!).trim() || undefined;
        }
        catch {
            return undefined;
        }
    }
    try {
        return decode(await readFile(join(context.content, 'compat', 'npc-voice-lane.md'))).trim() || undefined;
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
        return { campaign, snapshot, module, owner: voiceOwner(snapshot.world, await readModCatalog(context)) };
    }
    return Object.freeze({
        'voice.job': async (params) => {
            const { campaign, snapshot, module, owner } = await load(params), graph = module.graph;
            const node = await nextPerson(campaign, graph, snapshot.world, owner, params.backfill === true);
            if (!node)
                return { job_id: null };
            const ledger = await readNpcLedger(campaign), dossier = npcView(graph, snapshot.world, node, ledger);
            const handle = graph.handle(node), said = (await campaign.records()).flatMap((record: Row) => array(record.speech).filter(line => row(row(line).who).npc === handle).map(line => string(row(line).text)));
            const packet = buildPacket(campaign, graph, snapshot.world, owner, node, await playLanguageOf(context, snapshot.meta), dossier, await laneInstruction(context, owner), said, await investigatorIdentity(campaign, snapshot.world));
            return openJob(campaign, owner, graph.handle(node), packet);
        },
        'voice.submit': async (params) => {
            const { campaign, snapshot, module, owner } = await load(params), { handle, generation } = parseJobId(campaign, params.job_id, owner);
            const job = await readJob(campaign, owner, handle, generation);
            if (!job)
                throw new RpcError('invalid_params', `no voice job for ${handle}`, { fix: 'call voice.job first', details: { job_id: params.job_id ?? null } });
            const turn = number(row(await campaign.readTurn()).turn);
            const [result, replayed] = await submit(campaign, module.graph, snapshot.world, owner, job, params.voice, turn, params.reason);
            if (replayed)
                return { ...result, replayed: true };
            await campaign.appendEvent(turn, { type: 'dossier-established', data: { npc: handle, keys: [...KEYS] } });
            return result;
        },
        'voice.fail': async (params) => {
            const { campaign, owner } = await load(params), { handle, generation } = parseJobId(campaign, params.job_id, owner);
            const job = await readJob(campaign, owner, handle, generation);
            if (job) assertJobGeneration(campaign, owner, job);
            return fail(campaign, owner, job, string(params.job_id), handle, params.reason, params.detail);
        }
    });
}
