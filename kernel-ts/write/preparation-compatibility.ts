/** A legacy exposed artifact may survive only an exact, closed background-preparation witness. */
import {join} from 'node:path';
import {isJsonObject,jsonDigest} from '../json.js';
import {array,clone,row,string,number,type Row} from '../read/values.js';
import {taskWorldRevision} from '../read/context.js';
import {PERSON_WORLD_MAPS,tablePersonId} from '../read/table-people.js';
import type {CampaignSnapshot,LoadedModule} from '../read/campaign.js';

export async function preparationCompatibility(snapshot:CampaignSnapshot,module:LoadedModule,evidence:Row):Promise<Row|null> {
    if (!['keeper','isolated-expression'].includes(evidence.author)) return null;
    const packet=string(evidence.packet),stream=row(evidence.stream),expected=row(evidence.context),context=snapshot.context;
    if (!/^[a-f0-9]{64}$/.test(packet)||stream.delivery_id!==packet) return null;
    const directory=join(context.stateRoot,'delivery-writes',packet),acceptedPath=join(directory,'accepted.json'),journalPath=join(directory,'delivery.jsonl');
    if (!await context.snapshots.isFile(acceptedPath)||!await context.snapshots.isFile(journalPath)) return null;
    const accepted=row(await context.snapshots.readJson(acceptedPath)),frames=await context.snapshots.readJsonl(journalPath);
    const first=row(frames[0]),last=row(frames.at(-1));
    const comparison={...evidence};
    // The existing host may add this already validated binding after resolving public name/price tokens.
    if (!Object.hasOwn(row(accepted.evidence),'input_text')) delete comparison.input_text;
    if (jsonDigest(accepted.evidence)!==jsonDigest(comparison)||row(accepted.artifact).text!==evidence.artifact_text
        ||first.attempt_id!==stream.attempt_id||first.delivery_id!==packet||first.campaign!==snapshot.id
        ||first.turn!==snapshot.turn.turn||first.worldline!==expected.worldline||first.loop!==expected.loop
        ||!Number.isFinite(first.timestamp)||last.status==='completed'||!frames.some(frame=>row(frame).event==='delta')
        ||frames.some((value,index)=>{const frame=row(value);return frame.version!==1||frame.sequence!==index+1
            ||frame.attempt_id!==first.attempt_id||frame.delivery_id!==packet||frame.campaign!==snapshot.id
            ||frame.turn!==expected.turn||frame.worldline!==expected.worldline||frame.loop!==expected.loop;})
        ||frames.filter(value=>row(value).event==='delta').map(value=>row(value).delta).join('')!==evidence.artifact_text) return null;
    const changes:((world:Row)=>void)[]=[];
    // These jobs can add a portrayal supplement, never a fictional event or mechanical effect.
    for (const [npc,value] of Object.entries(row(snapshot.world.npc_character))) {
        const personality=row(row(value).personality),id=string(personality.job_id),at=Date.parse(string(personality.accepted_at));
        if (personality.origin!=='table_supplement'||personality.accepted_turn!==snapshot.turn.turn
            ||!Number.isFinite(at)||at<=number(first.timestamp)||!/^npc:[a-f0-9]{64}$/.test(id)) continue;
        const path=join(snapshot.dir,'npc','jobs',id.slice(4)+'.json');
        if (!await context.snapshots.isFile(path)) continue;
        const job=row(await context.snapshots.readJson(path));
        if (job.kind!=='personality'||job.status!=='done'||job.npc!==npc||job.completed_at!==personality.accepted_at
            ||job.source_revision!==personality.source_revision||jsonDigest(job.scope)!==jsonDigest(personality.scope)
            ||jsonDigest(job.scope)!==jsonDigest({worldline:expected.worldline,loop:expected.loop})
            ||jsonDigest(job.result)!==jsonDigest(personality.result)
            ||personality.content_digest!==jsonDigest({description:personality.description})) continue;
        changes.push(world=>{const entry=row(row(world.npc_character)[npc]);delete entry.personality;
            if (!Object.keys(entry).length) delete world.npc_character[npc];});
    }
    for (const [index,value] of array(snapshot.world.table_people).entries()) {
        const person=row(value),handle=string(person.replaced_by),name=string(person.name).trim(),node=module.graph.find(handle,['npc']);
        if (!isJsonObject(person.from_passage)||!name||!handle||!node||module.graph.isTablePerson(node)) continue;
        changes.push(world=>{
            delete world.table_people[index].replaced_by;
            for (const [from,to] of [[name,handle],[tablePersonId(name),string(node.node_id)]]) {
                if (from===to) continue;
                for (const key of PERSON_WORLD_MAPS) {
                    const map=world[key];
                    if (isJsonObject(map)&&Object.hasOwn(map,to)&&!Object.hasOwn(map,from)) {map[from]=map[to];delete map[to];}
                }
            }
        });
    }
    if (!changes.length||changes.length>8) return null;
    for (let mask=1;mask<(1<<changes.length);mask++) {
        const world=clone(snapshot.world);
        for(let index=0;index<changes.length;index++) if(mask&(1<<index)) changes[index](world);
        if (taskWorldRevision(world,snapshot.party,snapshot.turn.receipts,snapshot.turn.pending_choice)===expected.world_revision)
            return {reason:'background_preparation_compatible',differences:mask.toString(2).replaceAll('0','').length,
                expected:expected.world_revision,actual:taskWorldRevision(snapshot.world,snapshot.party,snapshot.turn.receipts,snapshot.turn.pending_choice)};
    }
    return null;
}
