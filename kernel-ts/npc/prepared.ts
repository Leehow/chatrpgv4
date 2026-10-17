/** Prepared personality results enter core world state only before a new player turn. */
import {join} from 'node:path';
import {jsonDigest} from '../json.js';
import {row,string,number,type Row} from '../read/values.js';
import type {ModuleGraph} from '../read/module-graph.js';
import type {CampaignWriter} from '../write/store.js';
import {nowIso} from '../write/store.js';
import {personalitySourceRevision,personalityView} from './material.js';

export async function adoptPreparedPersonalities(campaign:CampaignWriter,world:Row,graph:ModuleGraph,meta:Row,turn:number):Promise<boolean> {
    const worldline=string(meta.active_worldline||'main'),scope={worldline,loop:number(row(row(meta.worldlines)[worldline]).loop)};
    let changed=false;
    const completed:Row[]=[];
    for (const job of await campaign.files(join('npc','jobs'))) {
        if (job.kind!=='personality'||job.status!=='prepared') continue;
        const node=graph.nodes.get(string(job.npc)),prepared=row(job.prepared),entry=row(row(world.npc_character)[string(job.npc)]);
        if (row(entry.personality).job_id===job.job_id) {completed.push(job);continue;}
        if (!node||!graph.isPerson(node)||jsonDigest(scope)!==jsonDigest(job.scope)
            ||personalitySourceRevision(graph,node)!==job.source_revision||!prepared.description) continue;
        if (Object.keys(row(entry.personality)).length||personalityView(graph,world,node)) continue;
        (world.npc_character??={})[string(job.npc)]={...entry,personality:{...prepared,accepted_at:nowIso(),accepted_turn:turn}};
        changed=true;
        completed.push(job);
    }
    // Accept first, then finish secondary job views; a crash is repaired from the immutable world entry.
    if (changed) await campaign.writeWorld(world);
    for (const job of completed) await campaign.write(join('npc','jobs',string(job.job_id).slice(4)+'.json'),
        {...job,status:'done',completed_at:row(row(world.npc_character)[string(job.npc)]).personality.accepted_at});
    return changed;
}
