/** Player-selected image references; neither physical acquisitions nor world effects. */
import {join} from 'node:path';
import {RpcError} from '../errors.js';
import {jsonDigest, type JsonObject} from '../json.js';
import {withExclusiveLock} from '../locks.js';
import {actor as selectActor, tableView} from '../read/handlers.js';
import {loadCampaignModule} from '../read/campaign.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {playLanguageOf} from '../read/languages.js';
import {clone, normalize, row, string, type Row} from '../read/values.js';
import type {CampaignWriter} from '../write/store.js';
import type {createWriteRuntime} from '../write/index.js';
import type {ModRuntime} from './runtime.js';
import type {ModJobs} from './jobs.js';
import {handoutImageFile} from '../../shared/handout-images.js';
import {prepareMapRender, readMapRenderCache} from '../../shared/map-render-cache.js';

export const REFERENCE_ITEMS = 'reference-items.json';
export const IMAGE_REFERENCES_CAPABILITY = 'objects.image-references.v1';
interface ReferenceSource {
    graph: ModuleGraph;
    world: Row;
    selected: Row;
    identity: JsonObject;
    pin: JsonObject;
    render_sha256: string | undefined;
    map: string | undefined;
}
const allowed = (params: Row, keys: string[]) => {
    if (Object.keys(params).some(key => !keys.includes(key)))
        throw new RpcError('invalid_params', 'Unknown reference collection field');
};
const required = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 160)
        throw new RpcError('invalid_params', `Reference ${field} must be a nonempty name`);
    return value;
};
function projection(entry: Row): Row {
    return {id: entry.id, actor_id: entry.actor_id, worldline: entry.worldline,
        name: entry.name, ...(typeof entry.label === 'string' ? {label: entry.label} : {}),
        handout: entry.handout, presentation: entry.presentation, status: entry.status,
        editing: 'read_only', ...(entry.status === 'ready' ? {image: clone(entry.image)} : {})};
}

export function createReferenceItems(writer: ReturnType<typeof createWriteRuntime>, runtime: ModRuntime, jobs: ModJobs) {
    async function ledger(campaign: CampaignWriter): Promise<Row> {
        if (!await campaign.context.snapshots.pathExists(campaign.path(REFERENCE_ITEMS))) return {version: 1, entries: {}};
        const value = await campaign.read(REFERENCE_ITEMS);
        if (value.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries))
            throw new RpcError('needs', 'The retained reference collection is unreadable');
        return value;
    }
    async function owned(params: Row) {
        const campaign = await writer.campaign(params), meta = await campaign.readCampaign();
        const actor = selectActor(await campaign.party(), required(params.actor, 'actor'));
        return {campaign, meta, actor, worldline: meta.active_worldline ?? null};
    }
    async function source(campaign: CampaignWriter, handout: string): Promise<ReferenceSource> {
        const meta = await campaign.readCampaign(), world = await campaign.readWorld();
        const graph = (await loadCampaignModule(campaign.context, string(meta.module_id), world, campaign.id)).graph;
        const catalog = await jobs.knownHandouts(graph, world), node = graph.find(handout);
        const names = new Set([normalize(handout), ...(node ? [normalize(graph.displayName(node))] : [])]);
        const matches = catalog.filter(value => names.has(normalize(value.name))
            || value.map_view && normalize(value.map_view.map) === normalize(handout));
        if (matches.length !== 1)
            throw new RpcError('invalid_params', 'Reference source must name one already revealed image or authorized map');
        const selected = matches[0];
        if (typeof selected.map_view?.label === 'string') selected.label = selected.map_view.label;
        else {
            const displayed = (await tableView(campaign.context, {campaign: campaign.id})).handouts;
            const card = Array.isArray(displayed) ? displayed.find(value => {
                const shown = typeof value.handout === 'string' ? graph.find(value.handout) : null;
                return shown && normalize(graph.displayName(shown)) === normalize(selected.name);
            }) : undefined;
            if (typeof card?.name === 'string') selected.label = card.name;
        }
        if (selected.map_view) {
            const plan = await prepareMapRender(selected.map_view, {
                modulesRoot: join(campaign.context.stateRoot, 'modules'),
                sourceRoots: [join(campaign.context.stateRoot, 'module-campaigns', campaign.id, 'modules')],
                campaignDir: campaign.directory,
            });
            if (!plan) throw new RpcError('needs', 'The current authorized map source is unavailable');
            const cached = await readMapRenderCache(plan);
            return {graph, world, selected, identity: {module: graph.moduleId, kind: 'map', map: plan.map},
                pin: {view_id: plan.viewId, source_revision: plan.source_revision, sources: plan.sourceDigests},
                render_sha256: cached?.sha256, map: plan.map};
        }
        const file = handoutImageFile({...selected.image, document: 'ready'},
            {home: campaign.context.workspace, campaign: campaign.id});
        if (!file) throw new RpcError('needs', 'The revealed source has no available player-safe raster image');
        const sourceNode = required(selected.source_node, 'source identity');
        return {graph, world, selected,
            identity: {module: graph.moduleId, kind: 'handout', node: sourceNode, name: required(selected.name, 'source name')},
            pin: {sha256: file.sha256, media_type: file.media_type}, render_sha256: undefined, map: undefined};
    }
    async function serial<T>(campaign: CampaignWriter, action: () => Promise<T>): Promise<T> {
        return withExclusiveLock(campaign.context.locks, campaign.path('reference-items.lock'), action,
            {timeoutMs: campaign.context.campaignLockTimeoutMs});
    }
    return {
        collect: async (params: Row): Promise<Row> => {
            allowed(params, ['campaign', 'actor', 'handout', 'presentation']);
            if (!['map', 'image'].includes(params.presentation))
                throw new RpcError('invalid_params', 'Reference presentation must be map or image');
            const handout = required(params.handout, 'handout'), scope = await owned(params);
            return serial(scope.campaign, async () => {
                const active = await runtime.active(await scope.campaign.readWorld());
                if (!active.some(mod => Array.isArray(mod.requires) && mod.requires.includes(IMAGE_REFERENCES_CAPABILITY)))
                    throw new RpcError('not_implemented', 'Player image collection requires an active image reference provider');
                const current = await source(scope.campaign, handout);
                const id = 'reference-' + jsonDigest([scope.actor.id, scope.worldline, current.identity, current.pin, params.presentation]);
                const saved = await ledger(scope.campaign);
                let entry = saved.entries[id];
                if (!entry) {
                    entry = {id, actor_id: scope.actor.id, worldline: scope.worldline,
                        name: current.selected.name, handout: current.selected.name, presentation: params.presentation,
                        ...(typeof current.selected.label === 'string' ? {label: current.selected.label} : {}),
                        status: 'queued', source_identity: current.identity, source_pin: current.pin,
                        ...(current.render_sha256 ? {render_sha256: current.render_sha256} : {}),
                        ...(current.map ? {map: current.map} : {})};
                    saved.entries[id] = entry;
                    await scope.campaign.write(REFERENCE_ITEMS, saved);
                }
                return {reference: projection(entry), ...(entry.map ? {_reference_source: {map: entry.map}} : {})};
            });
        },
        references: async (params: Row): Promise<Row> => {
            allowed(params, ['campaign', 'actor']);
            const scope = await owned(params), saved = await ledger(scope.campaign);
            const entries = Object.values(saved.entries).map(row)
                .filter(entry => entry.actor_id === scope.actor.id && entry.worldline === scope.worldline);
            return {references: entries.map(projection), _reference_jobs: entries.filter(entry => entry.status === 'queued')
                .map(entry => ({reference_id: entry.id, ...(entry.map ? {map: entry.map} : {})}))};
        },
        finish: async (params: Row): Promise<Row> => {
            allowed(params, ['campaign', 'reference_id']);
            const id = required(params.reference_id, 'id'), campaign = await writer.campaign(params);
            return serial(campaign, async () => {
                const saved = await ledger(campaign), entry = saved.entries[id];
                if (!entry) throw new RpcError('unknown_entity', 'No collected reference with that id');
                if (entry.status !== 'queued') {
                    if (entry.worldline !== ((await campaign.readCampaign()).active_worldline ?? null))
                        throw new RpcError('not_owned', 'The reference belongs to a different worldline');
                    selectActor(await campaign.party(), entry.actor_id);
                    return {reference: projection(entry), ...(entry.failure ? {error: clone(entry.failure)} : {})};
                }
                try {
                    const meta = await campaign.readCampaign();
                    if (entry.worldline !== (meta.active_worldline ?? null))
                        throw new RpcError('revision_conflict', 'The reference worldline changed before completion');
                    selectActor(await campaign.party(), entry.actor_id);
                    const current = await source(campaign, entry.handout);
                    if (jsonDigest([current.identity, current.pin]) !== jsonDigest([entry.source_identity, entry.source_pin]))
                        throw new RpcError('revision_conflict', 'The selected reference source or authorized view changed');
                    if (entry.render_sha256 && current.render_sha256 !== entry.render_sha256)
                        throw new RpcError('revision_conflict', 'The selected map pixels changed before completion');
                    const seed = await jobs.documentSeed(current.graph, current.world,
                        {handout: current.selected.name, presentation: entry.presentation}, campaign);
                    if (!seed.image || current.identity.kind === 'handout' && seed.image.sha256 !== current.pin.sha256)
                        throw new RpcError('revision_conflict', 'The selected reference pixels changed during completion');
                    const confirmed = await source(campaign, entry.handout);
                    if (jsonDigest([confirmed.identity, confirmed.pin]) !== jsonDigest([entry.source_identity, entry.source_pin])
                        || confirmed.render_sha256 && seed.image.sha256 !== confirmed.render_sha256)
                        throw new RpcError('revision_conflict', 'The selected reference source changed during completion');
                    entry.image = seed.image; entry.status = 'ready';
                } catch (error) {
                    entry.status = 'refused'; entry.failure = {code: error instanceof RpcError ? error.code : 'internal',
                        message: error instanceof Error ? error.message : String(error)};
                }
                await campaign.write(REFERENCE_ITEMS, saved);
                return {reference: projection(entry), ...(entry.failure ? {error: clone(entry.failure)} : {})};
            });
        },
        view: async (params: Row): Promise<Row> => {
            allowed(params, ['campaign', 'actor', 'reference_id']);
            const scope = await owned(params), id = required(params.reference_id, 'id');
            const entry = (await ledger(scope.campaign)).entries[id];
            if (!entry || entry.actor_id !== scope.actor.id || entry.worldline !== scope.worldline)
                throw new RpcError('not_owned', 'This investigator does not hold that reference in this worldline');
            if (entry.status !== 'ready') throw new RpcError('needs', 'The reference image is not ready',
                {details: {status: entry.status}});
            const file = handoutImageFile({...entry.image, document: 'ready'},
                {home: scope.campaign.context.workspace, campaign: scope.campaign.id});
            if (!file || file.sha256 !== entry.image.sha256)
                throw new RpcError('needs', 'The retained reference image is unavailable or has changed');
            return {name: entry.name, actor: scope.actor.name, text: '', original: '', presentation: entry.presentation,
                player_edited: false, version: jsonDigest([scope.campaign.id, entry]),
                editor: await runtime.editor(await scope.campaign.readWorld()), editing: 'read_only', image: clone(entry.image),
                play_language: await playLanguageOf(scope.campaign.context, scope.meta)};
        },
    };
}
