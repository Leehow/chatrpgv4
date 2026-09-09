/** Instance-owned writing and immutable acquisition snapshots. */
import { join } from 'node:path';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { jsonDigest } from '../json.js';
import { appendJsonl } from '../fileio.js';
import { actor as selectActor } from '../read/handlers.js';
import { playLanguageOf } from '../read/languages.js';
import { findNamedObject, rootObjectOwner } from '../read/mods.js';
import { length, row, truth, values, type Row } from '../read/values.js';
import { nowIso, type CampaignWriter } from '../write/store.js';
import type { createWriteRuntime } from '../write/index.js';
import { validateDocumentSeed } from './definition.js';
import type { ModRuntime } from './runtime.js';

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
    return jsonDigest([campaign.id, (await campaign.readCampaign()).active_worldline ?? null, item.id, rootObjectOwner(world, item), item.document]);
}
export function writeDocument(item: Row, text: any): boolean {
    if (typeof text !== 'string' || length(text) > 64000) throw new RpcError('invalid_params', 'Document text must be a string of at most 64000 characters');
    const document = item.document;
    if (!truth(document)) throw new RpcError('invalid_params', 'Initialize the writable carrier before changing its text');
    if (text === document.text) return false;
    document.text = text; document.player_edited = false; document.revision++; document.edited_at = nowIso();
    return true;
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
        return {name: item.name, actor: actor.name, text: document.text, original: document.original, presentation: document.presentation,
            player_edited: Object.hasOwn(document, 'player_edited') ? document.player_edited : truth(document.edited_at) && document.text !== document.original,
            version: await documentVersion(campaign, world, item), editor: await runtime.editor(world),
            play_language: await playLanguageOf(campaign.context, meta)};
    }
    return {
        'mods.document.view': async params => response(await owned(params)),
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
