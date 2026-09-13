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
        return {
            id,
            name,
            ...(typeof region.level === 'string' && region.level.trim() ? { level: region.level.trim() } : {}),
            source_asset: graph.handle(source),
            source_node: source.node_id,
            source_box: box(region.source_box ?? [0, 0, 1, 1], `map region ${repr(id)} source_box`),
            placement: box(region.placement, `map region ${repr(id)} placement`),
            ...(redactions.length ? { redactions } : {}),
        };
    });
}

export function knownMapRegions(world: Row, map: string): string[] {
    return array(row(world.map_knowledge)[map]).filter(value => typeof value === 'string');
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

export async function mapView(graph: ModuleGraph, world: Row, asset: AssetReader, name: string): Promise<Row> {
    const node = mapNode(graph, name), handle = graph.handle(node), regions = mapRegions(graph, node),
        labels = row(row(world.map_labels)[handle]), regionLabels = row(labels.regions), levelLabels = row(labels.levels),
        known = new Set(knownMapRegions(world, handle)), selected = regions.filter(region => known.has(region.id)), layers: Row[] = [];
    for (const region of selected) {
        const source = await asset(graph.moduleId, region.source_node), path = source?.path;
        layers.push({
            region: region.id, label: regionLabels[region.id] ?? region.id, level: region.level ? levelLabels[region.level] ?? null : null,
            placement: region.placement, source_box: region.source_box, redactions: region.redactions ?? [],
            path: typeof path === 'string' ? path : null,
            media_type: source?.media_type ?? null,
        });
    }
    return {
        map: handle,
        name: graph.displayName(node),
        label: labels.title ?? handle,
        source_revision: graph.digest,
        regions: selected.map(region => ({ id: region.id, label: regionLabels[region.id] ?? region.id, level: region.level ? levelLabels[region.level] ?? null : null })),
        available: selected.length > 0 && layers.every(layer => typeof layer.path === 'string' && layer.path),
        render: { layers },
    };
}

export async function revealMap(context: {graph: ModuleGraph; world: Row; turn: Row; callId: string; mint(base: string): string}, effect: Row, asset: AssetReader): Promise<{receipt: Row; event: Row; view: Row}> {
    const name = typeof effect.name === 'string' && effect.name.trim() ? effect.name.trim() : '';
    if (!name) throw new RpcError('invalid_params', 'a map effect needs name');
    const node = mapNode(context.graph, name), handle = context.graph.handle(node), regions = mapRegions(context.graph, node), chosen = chooseRegions(regions, effect.regions);
    const knowledge = row(context.world.map_knowledge), before = knownMapRegions(context.world, handle), after = [...before];
    for (const region of chosen) if (!after.includes(region.id)) after.push(region.id);
    context.world.map_knowledge = { ...knowledge, [handle]: after };
    if(typeof effect.label!=='string'||!effect.label.trim())throw new RpcError('invalid_params','a map effect needs a player-facing label in play_language');
    const label=effect.label.trim(), supplied = row(effect.region_labels), chosenIds=new Set(chosen.map(region=>region.id)),
        unknownLabels = Object.keys(supplied).filter(key => !chosenIds.has(key)),missingLabels=[...chosenIds].filter(key=>typeof supplied[key]!=='string'||!supplied[key].trim());
    if (unknownLabels.length || missingLabels.length || Object.values(supplied).some(value => typeof value !== 'string' || !value.trim()))
        throw new RpcError('invalid_params', 'region_labels must map every chosen region id to one non-empty player-facing label', {details:{unknown:unknownLabels,missing:missingLabels}});
    const suppliedLevels=row(effect.level_labels), chosenLevels=new Set(chosen.flatMap(region=>region.level?[region.level]:[])),unknownLevels=Object.keys(suppliedLevels).filter(key=>!chosenLevels.has(key)),missingLevels=[...chosenLevels].filter(key=>typeof suppliedLevels[key]!=='string'||!suppliedLevels[key].trim());
    if(unknownLevels.length||missingLevels.length||Object.values(suppliedLevels).some(value=>typeof value!=='string'||!value.trim()))
        throw new RpcError('invalid_params','level_labels must map every chosen source level name to one non-empty player-facing label',{details:{unknown:unknownLevels,missing:missingLevels}});
    const mapLabels=row(context.world.map_labels), priorLabels=row(mapLabels[handle]), savedRegions={...row(priorLabels.regions)},savedLevels={...row(priorLabels.levels)};
    for(const region of chosen)if(typeof supplied[region.id]==='string')savedRegions[region.id]=supplied[region.id].trim();
    for(const [level,value] of Object.entries(suppliedLevels))savedLevels[level]=(value as string).trim();
    context.world.map_labels={...mapLabels,[handle]:{title:label,regions:savedRegions,levels:savedLevels}};
    const visibleLabel=(region:Row)=>savedRegions[region.id]??region.id,
        visibleLevel=(region:Row)=>region.level?savedLevels[region.level]??null:null,
        receipt: Row = {
            id: context.mint(`map:${handle}-t${context.turn.turn}`), kind: 'map', call_id: context.callId,
            map: handle, name: context.graph.displayName(node), label,
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
