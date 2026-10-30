/** Background enrichment of exact, already-owned equipment rows. */
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import {RpcError} from '../errors.js';
import {jsonDigest} from '../json.js';
import {loadCampaignModule} from '../read/campaign.js';
import {actor as selectActor} from '../read/handlers.js';
import {unregisteredEquipment} from '../read/mods.js';
import {array, clone, equal, normalize, number, row, string, values, type Row} from '../read/values.js';
import type {createWriteRuntime} from '../write/index.js';
import type {ApplyContext} from '../apply/index.js';
import {commitInventorySheets} from '../apply/inventory.js';
import {stageModEffect} from './stage.js';
import {objectInstance,objectRegistry} from './objects.js';
import {findNamedObject} from '../read/mods.js';
import {initializeDocument,ownershipChanged} from './documents.js';
import {claimedEquipment} from './queue.js';
import {projectInventory, projectSheet} from './projection.js';
import type {ModJobs} from './jobs.js';
import {EQUIPMENT_PREPARATION,SURFACE_VERSION,WRITING_SURFACES,surfaceKey,writingSurfaceOf} from './surface-verdicts.js';
export {EQUIPMENT_PREPARATION,SURFACE_VERSION,WRITING_SURFACES,writingSurfaceOf};

/** Supplied capabilities only: names and descriptive prose never justify model enrichment. */
export function equipmentNeedsPreparation(value: unknown): boolean {
    const item = row(value), present = (field: unknown): boolean => field !== null && field !== undefined && field !== ''
        && (Array.isArray(field) ? field.length > 0 : typeof field !== 'object' || Object.keys(field).length > 0);
    const state = row(item.state);
    return present(item.document) || array(item.traits).length > 0 || array(item.usages).length > 0
        || Object.entries(row(item.parameters)).some(([key,field]) => key !== 'description' && present(field))
        || ['damage_die','damage','base_range_yards','range','uses_per_round','attacks','magazine','ammo','malfunction','skill','adds_damage_bonus','special','charges']
            .some(key => present(item[key]))
        || [item.condition,state.condition].some(condition => present(condition) && condition !== 'intact')
        || [state.ammo,state.charges].some(present);
}

/** Supplied capabilities, or a writing surface the host's question found. */
function eligible(ledger: Row, actor: unknown, value: unknown): boolean {
    return equipmentNeedsPreparation(value) || writingSurfaceOf(ledger,actor,value) !== null;
}

/** A read projection contains status only, never unfinished document text. */
export async function equipmentPreparation(context: KernelContext, campaign: string): Promise<Row> {
    const path = join(context.campaignsRoot, campaign, 'save', EQUIPMENT_PREPARATION);
    return await context.snapshots.pathExists(path) ? row(await context.snapshots.readJson(path)) : {entries:{}};
}

export function equipmentPreparationRows(ledger: Row, sheet: Row, worldline: unknown): Row[] {
    const entries = values(row(ledger.entries)).filter(entry => eligible(ledger,entry.actor,entry.row) && entry.actor === sheet.id && entry.worldline === worldline
        && array(sheet.equipment).some(value => equal(value,entry.row)));
    const recorded = entries.filter(entry => ['pending','failed'].includes(entry.status))
        .map(entry => ({name:entry.name,status:entry.status}));
    return [...recorded,...unregisteredEquipment([sheet]).filter(candidate => eligible(ledger,sheet.id,candidate.row) && !entries.some(entry => equal(entry.row,candidate.row)))
        .map(candidate=>({name:candidate.name,status:'pending'}))];
}

export class EquipmentJobs {
    constructor(readonly writer: ReturnType<typeof createWriteRuntime>, readonly jobs: ModJobs) {}

    async prepare(params: Row): Promise<Row> {
        const campaign = await this.writer.campaign(params), world = await campaign.readWorld(), turn = await campaign.readTurn(),
            meta = await campaign.readCampaign(), party = await campaign.party() as Row[],
            provider = (await this.jobs.contributors(world,turn,'create')).at(-1);
        if (!provider || meta.status !== 'active') return {jobs:[]};
        const ledger = row(await campaign.readSave(EQUIPMENT_PREPARATION) ?? {entries:{}}), entries = row(ledger.entries), prepared: Row[] = [];
        const reserved = new Set([...values(row(row(world.objects).definitions)),...values(row(row(world.objects).instances)),...values(entries)]
            .map(value=>normalize(string(value.instance_name ?? value.name))));
        for (const entry of values(entries)) if (entry.status === 'pending' && entry.worldline === (meta.active_worldline ?? null)) {
            const item = objectInstance(world,entry.instance_name);
            if (item && item.equipment_actor === entry.actor && row(item.owner).id === entry.actor
                && row(row(row(world.objects).definitions)[item.definition]).provenance?.job === entry.job) entry.status = 'ready';
        }
        for (const candidate of unregisteredEquipment(party,claimedEquipment(world))) {
            const actor = selectActor(party,candidate.owner), surface = writingSurfaceOf(ledger,actor.id,candidate.row);
            if (!equipmentNeedsPreparation(candidate.row) && !surface) continue;
            const binding = {actor:actor.id,row:clone(candidate.row),worldline:meta.active_worldline ?? null,...(surface ? {surface} : {})},
                key = jsonDigest([binding,provider.id,provider.digest]);
            let entry = entries[key];
            if (!entry) {
                // Preserve the sheet name where possible; disambiguation uses custody, not a semantic name classifier.
                let name = candidate.name;
                if (reserved.has(normalize(name))) name = `${actor.name}: ${candidate.name}`;
                let suffix = 2;
                const base = name;
                while (reserved.has(normalize(name))) name = `${base} (${suffix++})`;
                reserved.add(normalize(name));
                const carried = `Already carried equipment: ${typeof candidate.row === 'string' ? candidate.row : JSON.stringify(candidate.row)}`;
                // §276: the host's question found a writing surface; its earlier pages are not established, so it starts empty.
                const input = {name,category:'item',description:surface ? `${carried}. A writable carrier (presentation ${surface}): include document with that presentation. `
                    + 'Its earlier pages are not established, so its text starts empty and later writing is appended.' : carried};
                const job = await this.jobs.job({campaign:campaign.id,role:'create',input,_equipment:binding});
                if (!job.enabled) continue;
                entry = entries[key] = {...binding,name:candidate.name,instance_name:name,input,job:job.job,packet:job,status:'pending'};
            }
            if (entry.status === 'pending') prepared.push({...entry.packet,input:entry.input,
                accepted:await this.jobs.context.snapshots.pathExists(join(entry.packet.cwd,'accepted.json'))});
        }
        ledger.entries = entries;
        await campaign.writeSave(EQUIPMENT_PREPARATION,ledger);
        return {jobs:prepared};
    }

    /**
     * §276: plain carried rows no surface verdict covers yet, for the host's Jev question. Rows with supplied capabilities
     * are prepared anyway, and their creator judges writability itself.
     */
    async surfaces(params: Row): Promise<Row> {
        const campaign = await this.writer.campaign(params), world = await campaign.readWorld(), turn = await campaign.readTurn(),
            meta = await campaign.readCampaign(), party = await campaign.party() as Row[];
        if (meta.status !== 'active' || !(await this.jobs.contributors(world,turn,'create')).length) return {version:SURFACE_VERSION,rows:[]};
        const ledger = row(await campaign.readSave(EQUIPMENT_PREPARATION) ?? {}), judged = row(ledger.surfaces);
        const rows = unregisteredEquipment(party,claimedEquipment(world)).flatMap(candidate => {
            const actor = selectActor(party,candidate.owner), id = surfaceKey(actor.id,candidate.row);
            return equipmentNeedsPreparation(candidate.row) || row(judged[id]).version === SURFACE_VERSION ? []
                : [{id,owner:actor.name,name:candidate.name,row:clone(candidate.row)}];
        });
        return {version:SURFACE_VERSION,rows:rows.slice(0,40)};
    }

    /** §276: verdicts for rows `surfaces` lists now; anything else, or an unknown answer, is not kept. */
    async submitSurfaces(params: Row): Promise<Row> {
        if (params.version !== SURFACE_VERSION) return {written:0,status:'stale'};
        const campaign = await this.writer.campaign(params), listed = new Map(array((await this.surfaces(params)).rows).map(value => [value.id,value])),
            party = await campaign.party() as Row[], ledger = row(await campaign.readSave(EQUIPMENT_PREPARATION) ?? {entries:{}}),
            judged = ledger.surfaces = row(ledger.surfaces);
        let written = 0;
        for (const verdict of array(params.verdicts)) {
            const candidate = listed.get(string(row(verdict).id)), surface = string(row(verdict).surface);
            if (!candidate || ![...WRITING_SURFACES,'none'].includes(surface)) continue;
            judged[candidate.id] = {actor:selectActor(party,candidate.owner).id,row:clone(candidate.row),surface,version:SURFACE_VERSION};
            written++;
        }
        if (written) await campaign.writeSave(EQUIPMENT_PREPARATION,{entries:{},...ledger});
        return {written};
    }

    async fail(params: Row): Promise<Row> {
        const campaign = await this.writer.campaign(params), ledger = row(await campaign.readSave(EQUIPMENT_PREPARATION)),
            entry = values(row(ledger.entries)).find(value => value.job === params.job);
        if (entry?.status === 'pending') {
            entry.status = 'failed'; entry.code = typeof params.code === 'string' ? params.code : 'preparation_failed';
            await campaign.writeSave(EQUIPMENT_PREPARATION,ledger);
        }
        return {status:entry?.status ?? 'stale'};
    }

    async retry(params: Row): Promise<Row> {
        const campaign = await this.writer.campaign(params), meta = await campaign.readCampaign(), party = await campaign.party() as Row[],
            actor = selectActor(party,params.actor), ledger = row(await campaign.readSave(EQUIPMENT_PREPARATION));
        const entry = values(row(ledger.entries)).find(value => value.actor === actor.id && value.name === params.name
            && value.worldline === (meta.active_worldline ?? null) && value.status === 'failed'
            && eligible(ledger,value.actor,value.row) && array(actor.equipment).some(item => equal(item,value.row)));
        if (!entry || !array(actor.equipment).some(value => equal(value,entry.row)))
            throw new RpcError('unknown_entity','No failed preparation for this owned equipment row');
        entry.status = 'pending'; delete entry.code;
        await campaign.writeSave(EQUIPMENT_PREPARATION,ledger);
        return {status:'pending'};
    }

    async publish(params: Row): Promise<Row> {
        const transaction = await this.writer.transaction(params,{preload:false}), {campaign,world,turn} = transaction,
            ledger = row(await campaign.readSave(EQUIPMENT_PREPARATION)), entry = values(row(ledger.entries)).find(value => value.job === params.job);
        if (!entry || entry.status === 'ready' || entry.status === 'skipped') return {status:entry?.status ?? 'stale'};
        const meta = await campaign.readCampaign(), party = await campaign.party() as Row[], actor = party.find(value => value.id === entry.actor),
            index = actor ? array(actor.equipment).findIndex(value => equal(value,entry.row)) : -1;
        if (!eligible(ledger,entry.actor,entry.row) || meta.status !== 'active' || entry.worldline !== (meta.active_worldline ?? null) || !actor || index < 0
            || !unregisteredEquipment(party,claimedEquipment(world)).some(value => value.owner === actor.name && equal(value.row,entry.row))) {
            entry.status = 'stale'; await campaign.writeSave(EQUIPMENT_PREPARATION,ledger); return {status:'stale'};
        }
        const accepted = await this.jobs.accept({campaign:campaign.id,job:entry.job});
        if (accepted.skipped === true) {
            entry.status = 'skipped'; await campaign.writeSave(EQUIPMENT_PREPARATION,ledger); return {status:'skipped'};
        }
        const module = await loadCampaignModule(this.jobs.context,string(meta.module_id),world,campaign.id), sheets = new Map<string,Row>(),
            callId = `equipment-${entry.job}`, apply: ApplyContext = {kernel:this.jobs.context,transaction,campaign,world,turn,
                graph:module.graph,module,callId,ordinal:0,mint:base=>`${base}:${entry.job}`,
                settlement:async()=>{throw new RpcError('invalid_params','Equipment preparation cannot settle an action');}};
        // §276: a definition the Keeper already gave this name stands; the carried row adopts it rather than regenerating it.
        const standing = findNamedObject(row(objectRegistry(world).definitions),entry.input.name);
        const defined = standing && standing.placeholder !== true && standing.category === 'item' ? null
            : await stageModEffect(apply,{kind:'define',name:entry.input.name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance},sheets,this.jobs);
        const adopted = await stageModEffect(apply,{kind:'object',name:entry.instance_name,definition:entry.input.name,to:actor.name,adopt:entry.name},sheets,this.jobs);
        const item = objectInstance(world,entry.instance_name)!;
        item.equipment_name = entry.name; item.equipment_actor = entry.actor; item.equipment_row = clone(entry.row);
        if (WRITING_SURFACES.includes(string(entry.surface)) && item.document == null) {
            // Empty is what is on record, not what the pages hold: writing before play is unknown, never blank.
            initializeDocument(item,{presentation:entry.surface,text:''}); item.document.earlier_pages = 'unrecorded'; ownershipChanged(world);
        }
        const staged = sheets.get(string(actor.id))!;
        projectSheet(world,staged);
        const placed = staged.equipment.findIndex((value:Row)=>value?.object_id === item.id);
        const [replacement] = staged.equipment.splice(placed,1); staged.equipment.splice(index,0,replacement);
        await campaign.writeWorld(world);
        await commitInventorySheets(apply,sheets);
        await projectInventory(await this.writer.campaign(params),world);
        const published = defined ? [defined,adopted] : [adopted];
        entry.status = 'ready'; entry.receipts = published.map(value => value.receipt);
        await campaign.writeSave(EQUIPMENT_PREPARATION,ledger);
        for (const landed of published) await campaign.appendEvent(number(turn.turn),
            {...landed.event,receipt:landed.receipt.id,data:{...landed.event.data,background_equipment:true,job:entry.job}});
        return {status:'ready',name:item.name,actor:actor.name};
    }
}
