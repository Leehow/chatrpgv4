/** Source-backed maps and campaign-scoped region knowledge. */
import { RpcError } from '../errors.js';
import type { ModuleGraph } from './module-graph.js';
import { array, normalize, number, numeric, repr, row, type Row } from './values.js';

export type AssetReader = (moduleId: string, name: string) => Promise<Row | null>;

function box(value: unknown, field: string): number[] {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(item => numeric(item) && Number.isFinite(number(item)) && number(item) >= 0 && number(item) <= 1)
        || number(value[2]) <= number(value[0]) || number(value[3]) <= number(value[1]))
        throw new RpcError('invalid_params', `${field} must be a normalized [x0, y0, x1, y1] box`);
    return value.map(item => number(item));
}

export function mapNodes(graph: ModuleGraph): Row[] {
    return [...graph.kind('asset'), ...graph.kind('handout')].filter(node => array(row(node.properties).map_regions).length > 0);
}

export function mapNode(graph: ModuleGraph, name: string): Row {
    const node = graph.resolve(name, ['asset', 'handout'], 'map');
    if (!array(row(node.properties).map_regions).length)
        throw new RpcError('invalid_params', `${repr(graph.handle(node))} is not a region map`, {
            fix: 'use one of details.candidates',
            details: { candidates: mapNodes(graph).map(item => graph.handle(item)) },
        });
    return node;
}

export function mapRegions(graph: ModuleGraph, node: Row): Row[] {
    const seen = new Set<string>();
    return array(row(node.properties).map_regions).map((value, index) => {
        const region = row(value), id = typeof region.region_id === 'string' ? region.region_id.trim() : '';
        if (!id || seen.has(normalize(id)))
            throw new RpcError('invalid_params', `map region ${index} needs a unique semantic region_id`);
        seen.add(normalize(id));
        const name = typeof region.name === 'string' && region.name.trim() ? region.name.trim() : id;
        const assetName = typeof region.source_asset === 'string' && region.source_asset.trim() ? region.source_asset.trim() : '';
        if (!assetName)
            throw new RpcError('invalid_params', `map region ${repr(id)} needs source_asset`);
        const source = graph.resolve(assetName, ['asset'], 'map region source');
        const visibility = source.visibility;
        const redactions = array(region.redactions).map((item, n) => box(item, `map region ${repr(id)} redactions[${n}]`));
        if (!['player-safe', 'revealable'].includes(visibility) && !(region.safe_after_redactions === true && redactions.length))
            throw new RpcError('invalid_params', `map region ${repr(id)} uses a private source without reviewed redactions`, {
                fix: 'use a player-safe/revealable source, or independently review explicit redactions and set safe_after_redactions',
            });
        if (region.source_box == null)
            throw new RpcError('invalid_params', `map region ${repr(id)} needs source_box`);
        return {
            id,
            name,
            ...(typeof region.level === 'string' && region.level.trim() ? { level: region.level.trim() } : {}),
            source_asset: graph.handle(source),
            source_node: source.node_id,
            // Reviewed publication metadata may bind bytes independently of graph generation.
            ...(typeof row(source.properties).source_digest === 'string' && row(source.properties).source_digest.trim()
                ? { source_digest: row(source.properties).source_digest.trim() }
                : typeof row(source.properties).asset_digest === 'string' && row(source.properties).asset_digest.trim()
                    ? { source_digest: row(source.properties).asset_digest.trim() } : {}),
            source_box: box(region.source_box, `map region ${repr(id)} source_box`),
            placement: box(region.placement, `map region ${repr(id)} placement`),
            ...(redactions.length ? { redactions } : {}),
        };
    });
}

export function knownMapRegions(world: Row, map: string): string[] {
    return array(row(world.map_knowledge)[map]).filter(value => typeof value === 'string');
}

function playerSafeRegions(graph: ModuleGraph, regions: Row[]): Row[] {
    return regions.filter(region => ['player-safe', 'revealable'].includes(graph.nodes.get(region.source_node)?.visibility));
}

/** A card never prints more captions than this; a module larger than this is asking for a different feature. */
const MAX_AUTHORED_MAP_WORDS = 200;

/**
 * Every word the module's published maps could print on a player's card, distinct and ordered.
 *
 * Handed to the host at `table.open` (contract §39.2) because a first-arrival card is minted inside
 * `apply move` and is on screen at the end of that same turn -- no room for the presentation lane
 * that has to put these words in the play language. They are the module's, not the campaign's, so
 * they are knowable the moment the table opens and are sent once, rather than discovered when a
 * card already needs them.
 *
 * Only player-safe regions contribute, exactly as `presentArrivalMaps` selects them: a secret room's
 * authored name is module truth and has no business being sent anywhere for translation. Region ids
 * never contribute either -- they are the machine handle the Keeper names a region by, and they are
 * never drawn.
 */
export function authoredMapWords(graph: ModuleGraph): string[] {
    const words: string[] = [];
    for (const node of mapNodes(graph)) {
        words.push(graph.displayName(node));
        let regions: Row[] = [];
        // A map whose regions do not resolve publishes nothing and is reported where publication is
        // checked; it must not take the whole open down with it.
        try { regions = playerSafeRegions(graph, mapRegions(graph, node)); }
        catch { continue; }
        for (const region of regions) {
            words.push(region.name);
            if (region.level) words.push(region.level);
        }
    }
    return [...new Set(words.filter(value => typeof value === 'string' && value.trim().length > 0))].sort().slice(0, MAX_AUTHORED_MAP_WORDS);
}

export function mapsDepictingScene(graph: ModuleGraph, scene: Row): Row[] {
    const seen = new Set<string>(), result: Row[] = [];
    const links = [...(graph.incoming.get(scene.node_id) ?? []), ...(graph.incoming.get(graph.handle(scene)) ?? [])];
    for (const rel of links) {
        if (rel.relation_kind !== 'depicts') continue;
        const node = graph.nodes.get(rel.from_node_id);
        if (!node || seen.has(node.node_id) || !array(row(node.properties).map_regions).length) continue;
        seen.add(node.node_id);
        result.push(node);
    }
    return result;
}

async function composeMapView(graph: ModuleGraph, asset: AssetReader, node: Row, selected: Row[], title: string): Promise<Row> {
    const handle = graph.handle(node), layers: Row[] = [];
    // A campaign or adapted graph resolves its own published assets; the injected reader is the
    // library path only for graphs that carry no scope (module administration and starters).
    const readAsset = graph.assetOverride ?? ((name: string) => asset(graph.moduleId, name));
    for (const region of selected) {
        const source = await readAsset(region.source_node), path = source?.path;
        layers.push({
            region: region.id, label: region.name, level: region.level ?? null,
            source_asset: region.source_asset,
            placement: region.placement, source_box: region.source_box, redactions: region.redactions ?? [],
            ...(typeof region.source_digest === 'string' ? { source_digest: region.source_digest } : {}),
            path: typeof path === 'string' ? path : null,
            media_type: source?.media_type ?? null,
        });
    }
    return {
        map: handle,
        name: graph.displayName(node),
        label: title,
        source_revision: graph.digest,
        regions: selected.map(region => ({ id: region.id, label: region.name, level: region.level ?? null })),
        available: selected.length > 0 && layers.every(layer => typeof layer.path === 'string' && layer.path),
        render: { layers },
    };
}

function chooseRegions(regions: Row[], requested: unknown): Row[] {
    if (!Array.isArray(requested) || !requested.length || !requested.every(value => typeof value === 'string' && value.trim()))
        throw new RpcError('invalid_params', 'map.regions must be a non-empty list of semantic region names');
    const chosen: Row[] = [];
    for (const name of requested) {
        const key = normalize(name), matches = regions.filter(region => [region.id, region.name].some(value => normalize(value) === key));
        if (matches.length !== 1)
            throw new RpcError('unknown_entity', `no map region ${repr(name)}`, {
                fix: 'use one of details.candidates', details: { candidates: regions.map(region => ({ name: region.id, label: region.name, level: region.level ?? null })) },
            });
        if (!chosen.includes(matches[0])) chosen.push(matches[0]);
    }
    return chosen;
}

/**
 * Which leg wrote the player-facing words on a map card (contract §23, §39.2).
 *
 * `apply map` carries words the Keeper wrote in `play_language`; a first-arrival card carries the
 * module's authored labels, which are in whatever language the module was written in. Both produce
 * the same projection shape for the same consumer, so without this the second is indistinguishable
 * from the first and reaches the player as authored -- which is exactly how a Chinese table was
 * handed an English floor plan (campaign `game-5779d0fd`, turn 2). The host's presentation lane
 * reads this to know which cards it still owes words for.
 */
export const KEEPER_WORDS = 'play_language', AUTHORED_WORDS = 'source';

export async function mapView(graph: ModuleGraph, world: Row, asset: AssetReader, name: string): Promise<Row> {
    const node = mapNode(graph, name), handle = graph.handle(node), regions = mapRegions(graph, node),
        labels = row(row(world.map_labels)[handle]), regionLabels = row(labels.regions), levelLabels = row(labels.levels),
        known = new Set(knownMapRegions(world, handle)), selected = regions.filter(region => known.has(region.id));
    const view = await composeMapView(graph, asset, node, selected, labels.title ?? handle);
    view.regions = selected.map(region => ({ id: region.id, label: regionLabels[region.id] ?? region.id, level: region.level ? levelLabels[region.level] ?? null : null }));
    for (const layer of array(row(view.render).layers)) {
        const region = selected.find(item => item.id === layer.region);
        if (!region) continue;
        layer.label = regionLabels[region.id] ?? region.id;
        layer.level = region.level ? levelLabels[region.level] ?? null : null;
    }
    // Every word here came out of `world.map_labels`, which only `apply map` writes: the Keeper
    // wrote them in play_language, and an unrevealed region falls back to its own id, never to the
    // authored label. Nothing on this view is owed a projection.
    view.words = KEEPER_WORDS;
    return view;
}

/** The case board reads only maps and regions already authorized by arrival or an explicit grant. */
export async function knownMapViews(graph: ModuleGraph, world: Row, asset: AssetReader): Promise<Row[]> {
    const presented = new Set(array(world.maps_presented)), views: Row[] = [],
        hasWord = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
    for (const node of mapNodes(graph)) {
        const handle = graph.handle(node), known = new Set(knownMapRegions(world, handle));
        if (!presented.has(handle) && !known.size) continue;
        const regions = mapRegions(graph, node), shown = new Set(presented.has(handle) ? playerSafeRegions(graph, regions) : []),
            selected = regions.filter(region => known.has(region.id) || shown.has(region)),
            labels = row(row(world.map_labels)[handle]), regionLabels = row(labels.regions), levelLabels = row(labels.levels),
            keeperWords = hasWord(labels.title) && selected.every(region => hasWord(regionLabels[region.id]) && (!region.level || hasWord(levelLabels[region.level]))),
            words = keeperWords ? KEEPER_WORDS : AUTHORED_WORDS,
            titled = keeperWords ? selected.map(region => ({
                ...region, name: regionLabels[region.id], ...(region.level ? { level: levelLabels[region.level] } : {}),
            })) : selected,
            view = await composeMapView(graph, asset, node, titled, keeperWords ? labels.title : graph.displayName(node));
        views.push({
            map: view.map, name: view.name, label: view.label, words,
            regions: view.regions, levels: [...new Set(titled.flatMap(region => region.level ? [region.level] : []))],
            source_revision: view.source_revision, render: view.render,
        });
    }
    return views;
}

export async function presentArrivalMaps(context: {graph: ModuleGraph; world: Row; turn: Row; callId: string; mint(base: string): string}, asset: AssetReader): Promise<Array<{receipt: Row; event: Row; view: Row}>> {
    const scene = context.graph.scene(context.world.active_scene), presented = array(context.world.maps_presented).filter(value => typeof value === 'string');

    const out: Array<{receipt: Row; event: Row; view: Row}> = [];
    for (const node of mapsDepictingScene(context.graph, scene)) {
        const handle = context.graph.handle(node);
        if (presented.includes(handle)) continue;
        const selected = playerSafeRegions(context.graph, mapRegions(context.graph, node));
        if (!selected.length) continue;
        presented.push(handle);
        context.world.maps_presented = [...presented];
        const title = context.graph.displayName(node), view = await composeMapView(context.graph, asset, node, selected, title);
        // No Keeper ran for this card, so every word on it is the module's own. It is marked as
        // authored rather than passed off as play-language words the way `apply map`'s are; the
        // host projects them before delivery (§39.2) and says so when it could not.
        view.words = AUTHORED_WORDS;
        const receipt: Row = {
            id: context.mint(`map:${handle}-t${context.turn.turn}`), kind: 'map', call_id: context.callId,
            map: handle, name: title, label: title, words: AUTHORED_WORDS, supplement: true,
            regions: selected.map(region => ({ id: region.id, label: region.name, level: region.level ?? null })),
            known_regions: knownMapRegions(context.world, handle), source_revision: context.graph.digest,
            why: 'arrival', at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        };
        out.push({ receipt, event: { type: 'map-revealed', data: { map: handle, regions: selected.map(region => region.id), known_regions: receipt.known_regions, why: 'arrival' } }, view });
    }
    return out;
}

export async function revealMap(context: {graph: ModuleGraph; world: Row; turn: Row; callId: string; mint(base: string): string}, effect: Row, asset: AssetReader): Promise<{receipt: Row; event: Row; view: Row}> {
    const name = typeof effect.name === 'string' && effect.name.trim() ? effect.name.trim() : '';
    if (!name) throw new RpcError('invalid_params', 'a map effect needs name');
    if (typeof effect.label !== 'string' || !effect.label.trim())
        throw new RpcError('invalid_params', 'a map effect needs a player-facing label in play_language');
    const node = mapNode(context.graph, name), handle = context.graph.handle(node), regions = mapRegions(context.graph, node), chosen = chooseRegions(regions, effect.regions);
    const label = effect.label.trim(), supplied = row(effect.region_labels), chosenIds = new Set(chosen.map(region => region.id)),
        unknownLabels = Object.keys(supplied).filter(key => !chosenIds.has(key)), missingLabels = [...chosenIds].filter(key => typeof supplied[key] !== 'string' || !supplied[key].trim());
    if (unknownLabels.length || missingLabels.length || Object.values(supplied).some(value => typeof value !== 'string' || !value.trim()))
        throw new RpcError('invalid_params', 'region_labels must map every chosen region id to one non-empty player-facing label', {details:{unknown:unknownLabels,missing:missingLabels}});
    const suppliedLevels = row(effect.level_labels), chosenLevels = new Set(chosen.flatMap(region => region.level ? [region.level] : [])),
        unknownLevels = Object.keys(suppliedLevels).filter(key => !chosenLevels.has(key)), missingLevels = [...chosenLevels].filter(key => typeof suppliedLevels[key] !== 'string' || !suppliedLevels[key].trim());
    if (unknownLevels.length || missingLevels.length || Object.values(suppliedLevels).some(value => typeof value !== 'string' || !value.trim()))
        throw new RpcError('invalid_params', 'level_labels must map every chosen source level name to one non-empty player-facing label', {details:{unknown:unknownLevels,missing:missingLevels}});
    const knowledge = row(context.world.map_knowledge), before = knownMapRegions(context.world, handle), after = [...before];
    for (const region of chosen) if (!after.includes(region.id)) after.push(region.id);
    const mapLabels = row(context.world.map_labels), priorLabels = row(mapLabels[handle]), savedRegions = {...row(priorLabels.regions)}, savedLevels = {...row(priorLabels.levels)};
    for (const region of chosen) savedRegions[region.id] = (supplied[region.id] as string).trim();
    for (const [level, value] of Object.entries(suppliedLevels)) savedLevels[level] = (value as string).trim();
    context.world.map_knowledge = { ...knowledge, [handle]: after };
    context.world.map_labels = {...mapLabels, [handle]: {title: label, regions: savedRegions, levels: savedLevels}};
    const visibleLabel = (region: Row) => savedRegions[region.id] ?? region.id,
        visibleLevel = (region: Row) => region.level ? savedLevels[region.level] ?? null : null,
        receipt: Row = {
            id: context.mint(`map:${handle}-t${context.turn.turn}`), kind: 'map', call_id: context.callId,
            map: handle, name: context.graph.displayName(node), label, words: KEEPER_WORDS,
            regions: chosen.map(region => ({ id: region.id, label: visibleLabel(region), level: visibleLevel(region) })),
            known_regions: after, source_revision: context.graph.digest,
            why: typeof effect.why === 'string' && effect.why.trim() ? effect.why.trim() : null,
            at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        };
    return { receipt, event: { type: 'map-revealed', data: { map: handle, regions: chosen.map(region => region.id), known_regions: after } }, view: await mapView(context.graph, context.world, asset, handle) };
}

export function mapCatalog(graph: ModuleGraph, world: Row): Row[] {
    return mapNodes(graph).map(node => {
        const handle = graph.handle(node), known = new Set(knownMapRegions(world, handle));
        return {
            name: handle,
            display_name: graph.displayName(node),
            regions: mapRegions(graph, node).map(region => ({ name: region.id, label: region.name, level: region.level ?? null, known: known.has(region.id) })),
        };
    });
}
