/** Instance-owned writing and immutable acquisition snapshots. */
import { join } from 'node:path';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { jsonDigest } from '../json.js';
import { appendJsonl } from '../fileio.js';
import { actor as selectActor } from '../read/handlers.js';
import { playLanguageOf } from '../read/languages.js';
import { findNamedObject, rootObjectOwner } from '../read/mods.js';
import { clone, length, number, row, truth, values, type Row } from '../read/values.js';
import { nowIso, type CampaignWriter } from '../write/store.js';
import type { createWriteRuntime } from '../write/index.js';
import { validateDocumentSeed } from './definition.js';
import type { ModRuntime } from './runtime.js';
import {documentRequests,documentRequestState,requestDocumentEdit,acknowledgeDocumentDispatch} from './document-requests.js';

export function initializeDocument(item: Row, seed: any): void {
    if (item.document != null) throw new RpcError('invalid_params', 'An existing document cannot be reinitialized; its acquisition snapshot is retained');
    item.document = { ...validateDocumentSeed(seed), original: null, acquired_by: null, revision: 1 };
    if (!Object.hasOwn(item.document, 'text')) throw new RpcError('invalid_params', 'The kernel must materialize the revealed handout before initializing its carrier');
}
export function ownershipChanged(world: Row): void {
    for (const item of values(row(world.objects).instances)) {
        const document = item.document;
        if (!truth(document)) continue;
        const owner = rootObjectOwner(world, item), actor = owner.kind === 'investigator' ? owner.id : null;
        if ((document.acquired_by ?? null) === actor) continue;
        if (actor !== null) {
            document.original = document.text; document.player_edited = false;
            document.acquired_turn = Object.hasOwn(item, 'changed_turn') ? item.changed_turn : item.created_turn ?? null;
        }
        document.acquired_by = actor; document.revision++;
    }
}
export async function documentVersion(campaign: Pick<CampaignWriter, 'id' | 'readCampaign'>, world: Row, item: Row): Promise<string> {
    const owner=rootObjectOwner(world,item);
    return jsonDigest([campaign.id, (await campaign.readCampaign()).active_worldline ?? null, item.id, {kind:owner.kind,id:owner.id}, item.document]);
}
export function writeDocument(item: Row, text: any): boolean {
    if (typeof text !== 'string' || length(text) > 64000) throw new RpcError('invalid_params', 'Document text must be a string of at most 64000 characters');
    const document = item.document;
    if (!truth(document)) throw new RpcError('invalid_params', 'Initialize the writable carrier before changing its text');
    if (text === document.text) return false;
    document.text = text; document.player_edited = false; document.revision++; document.edited_at = nowIso();
    return true;
}
/** Preserve explicit player wording while extending the same physical text. */
export function appendDocument(item: Row, suffix: any): boolean {
    if (typeof suffix !== 'string') throw new RpcError('invalid_params', 'Document suffix must be a string');
    const document = item.document;
    if (!document || typeof document.text !== 'string') throw new RpcError('invalid_params', 'Initialize the writable carrier before appending');
    const playerEdited = Object.hasOwn(document, 'player_edited') ? document.player_edited
        : truth(document.edited_at) && document.text !== document.original;
    const changed = writeDocument(item, document.text + suffix);
    if (changed) document.player_edited = playerEdited;
    return changed;
}

/** Contract §99: a physical split rebases each carrier onto the complete text it now contains. */
export function divideDocument(prior: Row, part: Row, split: {part: string; remainder: string}): void {
    const source = row(prior.document), revision = Math.trunc(number(source.revision)) + 1;
    const rebase = (text: string): Row => {
        const document: Row = {...clone(source), text, original: text, player_edited: false, revision};
        delete document.edited_at;
        return document;
    };
    prior.document = rebase(split.remainder);
    part.document = rebase(split.part);
}
export function createDocumentHandlers(writer: ReturnType<typeof createWriteRuntime>, runtime: ModRuntime): HandlerGroup {
    async function owned(params: Row): Promise<{campaign: CampaignWriter; world: Row; actor: Row; item: Row}> {
        const campaign = await writer.campaign(params), world = await campaign.readWorld(), actor = selectActor(await campaign.party(), params.actor);
        const item = findNamedObject(row(row(world.objects).instances), params.name);
        if (!item || !truth(item.document)) throw new RpcError('unknown_entity', 'No writable document with that name');
        const owner = rootObjectOwner(world, item);
        if (owner.kind !== 'investigator' || owner.id !== actor.id) throw new RpcError('not_owned', 'This investigator does not own the document');
        if (item.document.acquired_by !== actor.id) throw new RpcError('needs', 'The document acquisition has not been committed');
        return {campaign, world, actor, item};
    }
    async function response({campaign, world, actor, item}: Awaited<ReturnType<typeof owned>>): Promise<Row> {
        const document = item.document, meta = await campaign.readCampaign();
        const request=row((await documentRequests(campaign)).entries)[item.id];
        return {name: item.name, actor: actor.name, text: document.text, original: document.original, presentation: document.presentation,
            player_edited: Object.hasOwn(document, 'player_edited') ? document.player_edited : truth(document.edited_at) && document.text !== document.original,
            version: await documentVersion(campaign, world, item), editor: await runtime.editor(world),editing:'in_fiction',
            ...(request?{edit_request:{status:await documentRequestState(campaign,world,item,request),text:request.text,action:request.action}}:{}),
            play_language: await playLanguageOf(campaign.context, meta)};
    }
    return {
        'mods.document.options': async params => {
            const campaign = await writer.campaign(params), world = await campaign.readWorld(), party = await campaign.party();
            // Omitted actor is not a choice of one investigator from a multi-investigator table.
            const actor = params.actor == null && party.length !== 1 ? null : selectActor(party, params.actor);
            const documents: Row[] = [];
            for (const item of values(row(row(world.objects).instances))) {
                if (!truth(item.document)) continue;
                const root = rootObjectOwner(world, item);
                if (!actor || root.kind !== 'investigator' || root.id !== actor.id || item.document.acquired_by !== actor.id) continue;
                const owner = row(item.owner), holder = owner.kind === 'investigator'
                    ? party.find(sheet => sheet.id === owner.id)?.name
                    : owner.kind === 'object' ? row(row(row(world.objects).instances)[String(owner.id)]).name : null;
                if (typeof holder !== 'string' || !holder) continue;
                documents.push({name:item.name, owner:holder, presentation:item.document.presentation,
                    version:await documentVersion(campaign, world, item)});
            }
            const known = Array.isArray(params.names) ? params.names.flatMap((name:any)=>{
                if(typeof name!=='string')return [];
                const item=findNamedObject(row(row(world.objects).instances),name);
                if(!item)return [];
                const root=rootObjectOwner(world,item);
                return [{query:name,actor_owned:actor ? root.kind==='investigator'&&root.id===actor.id : null}];
            }) : [];
            return {actor:actor?.name ?? null, documents, known};
        },
        'mods.document.view': async params => response(await owned(params)),
        'mods.document.request':async params=>{
            const {campaign,world,actor,item}=await owned(params);
            return requestDocumentEdit(campaign,world,item,actor,params);
        },
        'mods.document.request_status':async params=>response(await owned(params)),
        'mods.document.dispatch':async params=>{
            const {campaign,world,item}=await owned(params);
            await acknowledgeDocumentDispatch(campaign,world,item,params);return {acknowledged:true};
        },
        'mods.document.apply': async params => {
            if (Object.keys(params).some(key => !['campaign', 'actor', 'name', 'version', 'action', 'text'].includes(key))) throw new RpcError('invalid_params', 'Unknown document edit field');
            const value = await owned(params), {campaign, world, actor, item} = value;
            if (params.version !== await documentVersion(campaign, world, item)) throw new RpcError('revision_conflict', 'The document or its ownership changed; keep your draft and reload before saving');
            const action = params.action;
            if (!['save', 'reset'].includes(action as string) || action === 'reset' && Object.hasOwn(params, 'text')) throw new RpcError('invalid_params', 'Document action must be save with text, or reset without client text');
            const document = item.document, text = action === 'reset' ? document.original : params.text, before = document.text;
            const changed = writeDocument(item, text);
            if (changed || (document.player_edited ?? false) !== (action === 'save')) {
                if (!changed) { document.revision++; document.edited_at = nowIso(); }
                document.player_edited = action === 'save'; await campaign.writeWorld(world);
                await appendJsonl(join(campaign.directory, 'document-edits.jsonl'), {kind: 'document-edit', at: document.edited_at, action, actor: actor.id,
                    instance: item.id, revision: document.revision, before, after: text, worldline: (await campaign.readCampaign()).active_worldline ?? null});
            }
            return response(value);
        },
    };
}
