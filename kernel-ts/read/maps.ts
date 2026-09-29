/** Source-backed maps and campaign-scoped region knowledge. */
import { RpcError } from '../errors.js';
import type { ModuleGraph } from './module-graph.js';
import { array, entries, normalize, number, numeric, repr, row, type Row } from './values.js';

export type AssetReader = (moduleId: string, name: string) => Promise<Row | null>;

function box(value: unknown, field: string): number[] {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(item => numeric(item) && Number.isFinite(number(item)) && number(item) >= 0 && number(item) <= 1)
        || number(value[2]) <= number(value[0]) || number(value[3]) <= number(value[1]))
        throw new RpcError('invalid_params', `${field} must be a normalized [x0, y0, x1, y1] box`);
    return value.map(item => number(item));
}

export function mapNodes(graph: ModuleGraph): Row[] {
    // §152.4: a map the reviewer found to be the same print as another is read as that other.
    return [...graph.kind('asset'), ...graph.kind('handout')].filter(node => array(row(node.properties).map_regions).length > 0 && !graph.isVariant(node));
}

export function mapNode(graph: ModuleGraph, name: string): Row {
    // §152.4: a name the table learned for a variant still reaches the map it is a print of.
    const node = graph.survivorOf(graph.resolve(name, ['asset', 'handout'], 'map'));
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

/**
 * Contract §39.4: the regions of a map this table holds -- what `apply map` granted, and, for a map
 * §39.2 presented, what arrival showed. Every reader takes the set from here: the board row, a look
 * view, the catalog's `known`, and every card. Until this existed a look read only the granted half,
 * so a map the player was holding from arrival read as unknown to the Keeper.
 */
export function livingMapRegions(graph: ModuleGraph, world: Row, node: Row, regions: Row[] = mapRegions(graph, node)): Row[] {
    const held = heldState(graph, world, node), shown = new Set(held.presented ? playerSafeRegions(graph, regions) : []);
    return regions.filter(region => held.known.has(region.id) || shown.has(region));
}

/**
 * Contract §152.4: what the table holds of a map, read through its survivor. A table that was shown
 * a variant was shown this map; a region it learned on a variant, and the Keeper's word for it, carry
 * over only where the reviewer matched that region to one of this map's on the pixels. Nothing is
 * moved or rewritten: the variant's own record stays where it was written.
 */
function heldState(graph: ModuleGraph, world: Row, node: Row): { known: Set<string>; presented: boolean; labels: Row } {
    const handle = graph.handle(node), presentedList = array(world.maps_presented), allLabels = row(world.map_labels),
        own = row(allLabels[handle]), known = new Set(knownMapRegions(world, handle)),
        regions: Row = { ...row(own.regions) }, levels: Row = { ...row(own.levels) };
    let presented = presentedList.includes(handle), title = own.title;
    for (const variant of [...graph.kind('asset'), ...graph.kind('handout')]) {
        if (variant.node_id === node.node_id || graph.survivorOf(variant).node_id !== node.node_id) continue;
        const theirs = graph.handle(variant), match = graph.regionCorrespondence(variant, node), labels = row(allLabels[theirs]);
        if (presentedList.includes(theirs)) presented = true;
        for (const id of knownMapRegions(world, theirs)) if (typeof match[id] === 'string') known.add(match[id]);
        for (const [id, label] of entries(row(labels.regions)))
            if (typeof match[id] === 'string' && regions[match[id]] === undefined) regions[match[id]] = label;
        for (const [level, label] of entries(row(labels.levels))) if (levels[level] === undefined) levels[level] = label;
        if (title === undefined && labels.title !== undefined) title = labels.title;
    }
    return { known, presented, labels: { ...(title !== undefined ? { title } : {}), regions, levels } };
}

/** §39.4: a table has pictured a map when it held any of it before the effect being applied. */
function pictured(graph: ModuleGraph, world: Row, node: Row, regions: Row[]): boolean {
    return livingMapRegions(graph, world, node, regions).length > 0;
}

/** How far a source-to-map transform may drift between two regions of one source and still be one picture. */
const TRANSFORM_TOLERANCE = 0.002;

type Affine = { sx: number; sy: number; tx: number; ty: number };

/** The one axis-aligned scale-and-offset every region of a source agrees on, or null when they disagree. */
function sourceTransform(regions: Row[]): Affine | null {
    let found: Affine | null = null;
    for (const region of regions) {
        const [s0, s1, s2, s3] = region.source_box as number[], [p0, p1, p2, p3] = region.placement as number[];
        const sx = (p2 - p0) / (s2 - s0), sy = (p3 - p1) / (s3 - s1);
        if (!found) { found = { sx, sy, tx: p0 - sx * s0, ty: p1 - sy * s1 }; continue; }
        const t = found, predicted = [t.tx + t.sx * s0, t.ty + t.sy * s1, t.tx + t.sx * s2, t.ty + t.sy * s3];
        if (predicted.some((value, index) => Math.abs(value - [p0, p1, p2, p3][index]) > TRANSFORM_TOLERANCE)) return null;
    }
    return found;
}

/**
 * Where the whole of a source lands in the map frame, cut to that frame, with the source box that
 * lands there. Null when nothing of it falls inside.
 */
function wholeSource(transform: Affine): { source_box: number[]; placement: number[] } | null {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const placement = [clamp(transform.tx), clamp(transform.ty), clamp(transform.tx + transform.sx), clamp(transform.ty + transform.sy)];
    if (placement[2] <= placement[0] || placement[3] <= placement[1]) return null;
    const source_box = [
        clamp((placement[0] - transform.tx) / transform.sx), clamp((placement[1] - transform.ty) / transform.sy),
        clamp((placement[2] - transform.tx) / transform.sx), clamp((placement[3] - transform.ty) / transform.sy),
    ];
    if (source_box[2] <= source_box[0] || source_box[3] <= source_box[1]) return null;
    return { source_box, placement };
}

/**
 * Contract §39.4: nearest first, the map nodes that depict the scene, a place it occurs at, or any
 * place those lie in. Arrival (§39.2, §107.1) reads this, and the scene's assets list the same maps.
 */
export function mapsForScene(graph: ModuleGraph, scene: Row): Row[] {
    const seen = new Set<string>(), result: Row[] = [];
    const take = (rels: Row[] | undefined) => {
        for (const rel of rels ?? []) {
            if (rel.relation_kind !== 'depicts') continue;
            const found = graph.nodes.get(rel.from_node_id), node = found ? graph.survivorOf(found) : undefined;
            if (!node || seen.has(node.node_id) || !array(row(node.properties).map_regions).length) continue;
            seen.add(node.node_id);
            result.push(node);
        }
    };
    const [self, ...around] = graph.placesOutward(scene);
    take(graph.incoming.get(self));
    take(graph.incoming.get(graph.handle(scene)));
    for (const place of around) take(graph.incoming.get(place));
    return result;
}

/** The name §39.2 and the reading queue (§107.1) call it by; it is §39.4's outward walk. */
export const mapsDepictingScene = mapsForScene;

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

/**
 * The host-only geometry of one picture of a map: a layer per selected region, and, per §39.4, the
 * whole of each player-safe source the selection draws from, with that source's regions the table
 * does not hold yet masked. `all` is every region of the map, so the masks can be found.
 */
async function composeMapView(graph: ModuleGraph, asset: AssetReader, node: Row, selected: Row[], title: string, all: Row[] = selected): Promise<Row> {
    const handle = graph.handle(node), layers: Row[] = [], base: Row[] = [], masks: Row[] = [];
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
    // Only a player-safe source is drawn whole: the book hands it to players as it is. A revealable
    // or private source is never drawn whole and never masked -- a dark box on a public picture
    // would announce that a secret is there. A source whose regions disagree on where it lands is
    // not one picture, and keeps the region-by-region drawing.
    const bySource = new Map<string, Row[]>();
    for (const region of all) bySource.set(region.source_node, [...(bySource.get(region.source_node) ?? []), region]);
    for (const [sourceNode, regions] of bySource) {
        if (graph.nodes.get(sourceNode)?.visibility !== 'player-safe') continue;
        const held = regions.filter(region => selected.includes(region));
        if (!held.length) continue;
        const transform = sourceTransform(regions), whole = transform ? wholeSource(transform) : null;
        if (!whole) continue;
        const source = await readAsset(sourceNode), path = source?.path, first = regions[0];
        base.push({
            source_asset: first.source_asset, ...whole,
            ...(typeof first.source_digest === 'string' ? { source_digest: first.source_digest } : {}),
            path: typeof path === 'string' ? path : null, media_type: source?.media_type ?? null,
            levels: [...new Set(regions.flatMap(region => region.level ? [region.level] : []))],
        });
        for (const region of regions)
            if (!held.includes(region)) masks.push({ placement: region.placement, levels: region.level ? [region.level] : [] });
    }
    return {
        map: handle,
        name: graph.displayName(node),
        label: title,
        source_revision: graph.digest,
        regions: selected.map(region => ({ id: region.id, label: region.name, level: region.level ?? null })),
        available: selected.length > 0 && layers.every(layer => typeof layer.path === 'string' && layer.path),
        render: { layers, ...(base.length ? { base, masks } : {}) },
    };
}

/**
 * §39.4: the picture of what this table holds of a map, and whose words are on it. The Keeper's
 * words when `apply map` stored one for the title and every held region; the module's own when any
 * is missing, for the host to project (§39.2) -- a card is wholly one or the other.
 */
async function livingView(graph: ModuleGraph, world: Row, asset: AssetReader, node: Row): Promise<Row> {
    const regions = mapRegions(graph, node), selected = livingMapRegions(graph, world, node, regions),
        hasWord = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0,
        labels = heldState(graph, world, node).labels, regionLabels = row(labels.regions), levelLabels = row(labels.levels),
        keeperWords = hasWord(labels.title) && selected.every(region => hasWord(regionLabels[region.id]) && (!region.level || hasWord(levelLabels[region.level]))),
        titled = keeperWords ? selected.map(region => ({
            ...region, name: regionLabels[region.id], ...(region.level ? { level: levelLabels[region.level] } : {}),
        })) : selected,
        // A region not held yet is only ever a mask, but it is split by level with the rest, so its
        // level carries the same word the held regions' levels do.
        all = regions.map(region => titled.find(item => item.id === region.id)
            ?? (keeperWords && region.level && hasWord(levelLabels[region.level]) ? { ...region, level: levelLabels[region.level] } : region)),
        view = await composeMapView(graph, asset, node, titled, keeperWords ? labels.title : graph.displayName(node), all);
    view.words = keeperWords ? KEEPER_WORDS : AUTHORED_WORDS;
    view.levels = [...new Set(titled.flatMap(region => region.level ? [region.level] : []))];
    return view;
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

/**
 * `look focus=map` with a name: the living map (§39.4). On a map this table has pictured it says
 * `presentation: "update"`, and the host delivers a row naming it, never a second picture. On a map
 * the table holds nothing of it is empty, as it always was.
 */
export async function mapView(graph: ModuleGraph, world: Row, asset: AssetReader, name: string): Promise<Row> {
    const node = mapNode(graph, name), view = await livingView(graph, world, asset, node);
    if (array(view.regions).length) view.presentation = UPDATE;
    return view;
}

/** The case board reads only maps and regions already authorized by arrival or an explicit grant. */
export async function knownMapViews(graph: ModuleGraph, world: Row, asset: AssetReader): Promise<Row[]> {
    const views: Row[] = [];
    for (const node of mapNodes(graph)) {
        if (!livingMapRegions(graph, world, node).length) continue;
        const view = await livingView(graph, world, asset, node);
        views.push({
            map: view.map, name: view.name, label: view.label, words: view.words,
            regions: view.regions, levels: view.levels,
            source_revision: view.source_revision, render: view.render,
        });
    }
    return views;
}

/** §39.4: a card carries the picture; an update names what an effect added to a map already pictured. */
export const CARD = 'card', UPDATE = 'update';

/** The regions an effect added to a map's living set, as a card or update names them. */
function revealedRegions(before: Row[], after: Row[], label: (region: Row) => unknown, level: (region: Row) => unknown): Row[] {
    return after.filter(region => !before.includes(region)).map(region => ({ id: region.id, label: label(region), level: level(region) }));
}

export async function presentArrivalMaps(context: {graph: ModuleGraph; world: Row; turn: Row; callId: string; mint(base: string): string}, asset: AssetReader): Promise<Array<{receipt: Row; event: Row; view?: Row}>> {
    const scene = context.graph.scene(context.world.active_scene), presented = array(context.world.maps_presented).filter(value => typeof value === 'string');

    const out: Array<{receipt: Row; event: Row; view?: Row}> = [];
    for (const node of mapsForScene(context.graph, scene)) {
        const handle = context.graph.handle(node);
        if (heldState(context.graph, context.world, node).presented) continue;
        const regions = mapRegions(context.graph, node), selected = playerSafeRegions(context.graph, regions);
        if (!selected.length) continue;
        const before = livingMapRegions(context.graph, context.world, node, regions), wasPictured = before.length > 0;
        presented.push(handle);
        context.world.maps_presented = [...presented];
        const after = livingMapRegions(context.graph, context.world, node, regions),
            revealed = revealedRegions(before, after, region => region.name, region => region.level ?? null);
        // §39.4: a map the table already holds (an earlier `apply map`) is not pictured again, and an
        // arrival that adds nothing to it is not a delivery at all.
        if (wasPictured && !revealed.length) continue;
        const title = context.graph.displayName(node), view = wasPictured ? undefined : await livingView(context.graph, context.world, asset, node);
        // No Keeper ran for this card, so every word on it is the module's own. It is marked as
        // authored rather than passed off as play-language words the way `apply map`'s are; the
        // host projects them before delivery (§39.2) and says so when it could not. A card over a
        // map the Keeper already named keeps the Keeper's words only when every held region has one.
        const words = view ? view.words : AUTHORED_WORDS;
        const receipt: Row = {
            id: context.mint(`map:${handle}-t${context.turn.turn}`), kind: 'map', call_id: context.callId,
            map: handle, name: title, label: view ? view.label : title, words, supplement: true,
            presentation: wasPictured ? UPDATE : CARD,
            regions: selected.map(region => ({ id: region.id, label: region.name, level: region.level ?? null })),
            revealed,
            known_regions: knownMapRegions(context.world, handle), source_revision: context.graph.digest,
            why: 'arrival', at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        };
        out.push({ receipt, event: { type: 'map-revealed', data: { map: handle, regions: selected.map(region => region.id), known_regions: receipt.known_regions, why: 'arrival' } }, ...(view ? { view } : {}) });
    }
    // §107.1: an arrival whose map was still being read is answered once the map is presented here.
    if (out.length && Array.isArray(context.world.map_arrivals_pending))
        context.world.map_arrivals_pending = context.world.map_arrivals_pending.filter((value: unknown) => value !== context.graph.handle(scene));
    return out;
}

/**
 * §107.1: the map of a scene the table arrived at while it was still being read, presented on the first turn after
 * its publication. Each `world.map_arrivals_pending` entry is answered once: the active scene's entry mints the
 * §39.2 arrival card (marked `late`) as soon as a reviewed map depicts the scene, and is dropped once the map is
 * presented or the focus has settled as unusable. An entry for a scene the table has left waits for the next real
 * move into it, where §39.2 presents the map itself.
 */
export async function presentPublishedArrivalMaps(context: {graph: ModuleGraph; world: Row; turn: Row; callId: string; mint(base: string): string},
    asset: AssetReader, settled: (focus: string) => boolean): Promise<Array<{receipt: Row; event: Row; view?: Row}>> {
    const pending = array(context.world.map_arrivals_pending).filter((value): value is string => typeof value === 'string');
    if (!pending.length) return [];
    const here = context.graph.handle(context.graph.scene(context.world.active_scene)), keep: string[] = [];
    let out: Array<{receipt: Row; event: Row; view?: Row}> = [];
    for (const handle of pending) {
        if (handle !== here) { keep.push(handle); continue; }
        if (mapsForScene(context.graph, context.graph.scene(here)).length) {
            out = (await presentArrivalMaps(context, asset)).map(item => {
                Object.assign(item.receipt, { late: true, scene: here });
                return { ...item, event: { ...item.event, data: { ...row(item.event.data), late: true, scene: here } } };
            });
            continue;
        }
        if (!settled(handle)) keep.push(handle);
    }
    context.world.map_arrivals_pending = keep;
    return out;
}

export async function revealMap(context: {graph: ModuleGraph; world: Row; turn: Row; callId: string; mint(base: string): string}, effect: Row, asset: AssetReader): Promise<{receipt: Row; event: Row; view?: Row}> {
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
    const livingBefore = livingMapRegions(context.graph, context.world, node, regions), wasPictured = livingBefore.length > 0;
    const knowledge = row(context.world.map_knowledge), before = knownMapRegions(context.world, handle), after = [...before];
    for (const region of chosen) if (!after.includes(region.id)) after.push(region.id);
    const mapLabels = row(context.world.map_labels), priorLabels = row(mapLabels[handle]), savedRegions = {...row(priorLabels.regions)}, savedLevels = {...row(priorLabels.levels)};
    for (const region of chosen) savedRegions[region.id] = (supplied[region.id] as string).trim();
    for (const [level, value] of Object.entries(suppliedLevels)) savedLevels[level] = (value as string).trim();
    context.world.map_knowledge = { ...knowledge, [handle]: after };
    context.world.map_labels = {...mapLabels, [handle]: {title: label, regions: savedRegions, levels: savedLevels}};
    const visibleLabel = (region: Row) => savedRegions[region.id] ?? region.id,
        visibleLevel = (region: Row) => region.level ? savedLevels[region.level] ?? null : null,
        livingAfter = livingMapRegions(context.graph, context.world, node, regions),
        receipt: Row = {
            id: context.mint(`map:${handle}-t${context.turn.turn}`), kind: 'map', call_id: context.callId,
            map: handle, name: context.graph.displayName(node), label, words: KEEPER_WORDS,
            // §39.4: the first picture of a map is a card; on a map the table already holds, the act
            // is kept as a receipt that names what it added, and nothing is pictured again.
            presentation: wasPictured ? UPDATE : CARD,
            regions: chosen.map(region => ({ id: region.id, label: visibleLabel(region), level: visibleLevel(region) })),
            revealed: revealedRegions(livingBefore, livingAfter, visibleLabel, visibleLevel),
            known_regions: after, source_revision: context.graph.digest,
            why: typeof effect.why === 'string' && effect.why.trim() ? effect.why.trim() : null,
            at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        };
    const event = { type: 'map-revealed', data: { map: handle, regions: chosen.map(region => region.id), known_regions: after } };
    return wasPictured ? { receipt, event } : { receipt, event, view: await livingView(context.graph, context.world, asset, node) };
}

export function mapCatalog(graph: ModuleGraph, world: Row): Row[] {
    return mapNodes(graph).map(node => {
        const regions = mapRegions(graph, node), held = new Set(livingMapRegions(graph, world, node, regions));
        return {
            name: graph.handle(node),
            display_name: graph.displayName(node),
            regions: regions.map(region => ({ name: region.id, label: region.name, level: region.level ?? null, known: held.has(region) })),
        };
    });
}
