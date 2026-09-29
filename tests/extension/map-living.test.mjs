/**
 * Contract §39.4 through the production map functions: a map is pictured once and then updated,
 * its living set is what every reader takes, a player-safe source is drawn whole with only the
 * regions not held masked, a place's maps include the maps of the places it lies in, and a merged
 * worldline keeps the fact that a map was shown.
 *
 * The graph is synthetic on purpose. The built-in Corbitt house map places its basement storage
 * away from where its source puts it, so it is exactly the map §39.4 keeps region-by-region; the
 * whole-source path needs a map whose regions agree on one picture, which is the shape a published
 * PDF map has (source box equal to placement).
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const out = join(await mkdtemp(join(tmpdir(), 'map-living-')), 'api.mjs');
await build({stdin: {contents: [
    "export {ModuleGraph} from './kernel-ts/read/module-graph.ts';",
    "export {livingMapRegions, mapsForScene, mapView, mapCatalog, knownMapViews, revealMap, presentArrivalMaps} from './kernel-ts/read/maps.ts';",
    "export {report} from './kernel-ts/worldline/confluence-plan.ts';",
    "export {parsePythonJson} from './kernel-ts/json.ts';",
].join('\n'), resolveDir: root, sourcefile: 'map-living-api.ts'}, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent'});
const api = await import(pathToFileURL(out).href);

const region = (id, source, box, placement = box, extra = {}) => ({region_id: id, name: id.toUpperCase(), source_asset: source, source_box: box, placement, ...extra});
const RAW = {
    nodes: [
        {node_id: 'asset-village-map', node_kind: 'asset', name: 'Village map', visibility: 'player-safe', properties: {map_regions: [
            region('r-inn', 'village-map', [0, 0, 0.3, 0.5]),
            region('r-park', 'village-map', [0.3, 0, 0.6, 0.5]),
            region('r-dock', 'village-map', [0.6, 0.5, 1, 1]),
            // A secret whose authoritative crop is the Keeper's map, placed on the village's frame.
            region('r-vault', 'vault-map', [0, 0, 1, 1], [0.6, 0, 1, 0.5], {redactions: [[0, 0, 0.1, 0.1]], safe_after_redactions: true}),
        ]}},
        {node_id: 'asset-vault-map', node_kind: 'asset', name: 'Vault plan', visibility: 'keeper-only', properties: {}},
        {node_id: 'asset-harbor-map', node_kind: 'asset', name: 'Harbor map', visibility: 'player-safe', properties: {map_regions: [
            region('h-quay', 'harbor-map', [0, 0, 1, 1]),
        ]}},
        // Two regions of one source that disagree on where it lands: a composed plan, not one picture.
        {node_id: 'asset-composed-map', node_kind: 'asset', name: 'Composed plan', visibility: 'player-safe', properties: {map_regions: [
            region('c-left', 'composed-map', [0, 0, 0.5, 0.5]),
            region('c-right', 'composed-map', [0.5, 0.5, 1, 1], [0.2, 0.5, 0.7, 1]),
        ]}},
        // §152.4: a second crop of the village map, found by the reviewer to be the same print.
        {node_id: 'asset-village-print-2', node_kind: 'asset', name: 'Village map (second crop)', visibility: 'player-safe', properties: {map_regions: [
            region('v-inn', 'village-print-2', [0.1, 0.1, 0.4, 0.6]),
            region('v-bank', 'village-print-2', [0.5, 0.1, 0.9, 0.6]),
        ]}},
        {node_id: 'location-village', node_kind: 'location', name: 'Village'},
        {node_id: 'location-harbor', node_kind: 'location', name: 'Harbor district'},
        {node_id: 'scene-dockside', node_kind: 'scene', name: 'Dockside', properties: {}},
        {node_id: 'scene-green', node_kind: 'scene', name: 'Green', properties: {}},
    ],
    relations: [
        {relation_id: 'r1', relation_kind: 'depicts', from_node_id: 'asset-village-map', to_node_id: 'location-village'},
        {relation_id: 'r2', relation_kind: 'depicts', from_node_id: 'asset-harbor-map', to_node_id: 'location-harbor'},
        {relation_id: 'r3', relation_kind: 'occurs-at', from_node_id: 'scene-dockside', to_node_id: 'location-harbor'},
        {relation_id: 'r4', relation_kind: 'located-in', from_node_id: 'location-harbor', to_node_id: 'location-village'},
        {relation_id: 'r5', relation_kind: 'depicts', from_node_id: 'asset-composed-map', to_node_id: 'scene-green'},
        {relation_id: 'r6', relation_kind: 'depicts', from_node_id: 'asset-village-print-2', to_node_id: 'location-village'},
        {relation_id: 'r7', relation_kind: 'variant-of', from_node_id: 'asset-village-print-2', to_node_id: 'asset-village-map',
            properties: {region_correspondence: {'v-inn': 'r-inn'}}},
    ],
};
// Through the kernel's own JSON reader, so authored boxes carry the numeric identity a loaded graph has.
const graph = () => new api.ModuleGraph('village-book', api.parsePythonJson(JSON.stringify(RAW)), 'g1', {});
const asset = (_module, name) => ({path: `/assets/${name}.png`, media_type: 'image/png'});
const ids = (rows) => rows.map((item) => item.id ?? item.region_id);
const context = (g, world, turn = 1) => ({graph: g, world, turn: {turn}, callId: `t${turn}-c1`, mint: (base) => base});
const grant = (regions, labels = Object.fromEntries(regions.map((id) => [id, id.toUpperCase()]))) =>
    ({kind: 'map', name: 'village-map', regions, region_labels: labels, level_labels: {}, label: 'Village', why: 'seen'});

test('the living set is what was granted, plus what arrival showed; the catalog reads it', () => {
    const g = graph(), node = g.find('village-map');
    assert.deepEqual(ids(api.livingMapRegions(g, {map_knowledge: {'village-map': ['r-inn']}}, node)), ['r-inn']);
    // Arrival shows the player-safe and revealable regions; the Keeper's secret waits for a grant.
    assert.deepEqual(ids(api.livingMapRegions(g, {maps_presented: ['village-map']}, node)), ['r-inn', 'r-park', 'r-dock']);
    assert.deepEqual(ids(api.livingMapRegions(g, {maps_presented: ['village-map'], map_knowledge: {'village-map': ['r-vault']}}, node)),
        ['r-inn', 'r-park', 'r-dock', 'r-vault']);
    const row = api.mapCatalog(g, {maps_presented: ['village-map']}).find((item) => item.name === 'village-map');
    assert.deepEqual(row.regions.filter((item) => item.known).map((item) => item.name), ['r-inn', 'r-park', 'r-dock'],
        'a map the player holds from arrival is known to the Keeper');
});

test('a player-safe source is drawn whole, masking only its own regions not held', async () => {
    const g = graph();
    const view = await api.mapView(g, {map_knowledge: {'village-map': ['r-inn']}}, asset, 'village-map');
    assert.equal(view.presentation, 'update', 'a look at a map already held is an update, not a second picture');
    assert.deepEqual(view.render.base.map((item) => [item.source_asset, item.placement, item.source_box]), [['village-map', [0, 0, 1, 1], [0, 0, 1, 1]]]);
    assert.deepEqual(view.render.masks.map((item) => item.placement), [[0.3, 0, 0.6, 0.5], [0.6, 0.5, 1, 1]],
        'the village regions not held are masked; the secret on the Keeper map is never announced by a mask');
    // The Keeper's own map is never drawn whole, even when its region is held.
    const secret = await api.mapView(g, {map_knowledge: {'village-map': ['r-inn', 'r-vault']}}, asset, 'village-map');
    assert.deepEqual(secret.render.base.map((item) => item.source_asset), ['village-map']);
    assert.deepEqual(secret.render.masks.map((item) => item.placement), [[0.3, 0, 0.6, 0.5], [0.6, 0.5, 1, 1]]);
    const onlySecret = await api.mapView(g, {map_knowledge: {'village-map': ['r-vault']}}, asset, 'village-map');
    assert.equal(onlySecret.render.base, undefined, 'nothing of the village is held, so none of it is drawn');
    // A source whose regions disagree on where it lands keeps the region-by-region picture.
    const composed = await api.mapView(g, {map_knowledge: {'composed-map': ['c-left']}}, asset, 'composed-map');
    assert.equal(composed.render.base, undefined);
    assert.deepEqual(composed.render.layers.map((layer) => layer.region), ['c-left']);
});

test('the maps of a place include the maps of the places it lies in, nearest first', () => {
    const g = graph();
    assert.deepEqual(api.mapsForScene(g, g.scene('dockside')).map((node) => node.node_id), ['asset-harbor-map', 'asset-village-map']);
    // The scene's assets list the same maps the arrival presents.
    const listed = g.sceneAssetNodes(g.scene('dockside')).map((node) => node.node_id);
    assert.ok(listed.includes('asset-harbor-map') && listed.includes('asset-village-map'));
});

test('apply map pictures a map once; later grants are updates naming what they added', async () => {
    const g = graph(), world = {};
    const first = await api.revealMap(context(g, world, 1), grant(['r-inn']), asset);
    assert.equal(first.receipt.presentation, 'card');
    assert.ok(first.view, 'the first picture of a map is a card');
    const second = await api.revealMap(context(g, world, 2), grant(['r-inn', 'r-park']), asset);
    assert.equal(second.receipt.presentation, 'update');
    assert.equal(second.view, undefined, 'a map already pictured is not pictured again');
    assert.deepEqual(second.receipt.revealed, [{id: 'r-park', label: 'R-PARK', level: null}]);
    const third = await api.revealMap(context(g, world, 3), grant(['r-park']), asset);
    assert.equal(third.receipt.presentation, 'update');
    assert.deepEqual(third.receipt.revealed, [], 'a grant that adds nothing still keeps its receipt');
    assert.deepEqual(world.map_knowledge['village-map'], ['r-inn', 'r-park']);
});

test('arrival pictures a map the table does not hold, and updates one it does', async () => {
    const g = graph(), world = {active_scene: 'dockside', map_knowledge: {'village-map': ['r-inn']}};
    const arrived = await api.presentArrivalMaps(context(g, world, 4), asset);
    const byMap = Object.fromEntries(arrived.map((item) => [item.receipt.map, item]));
    assert.equal(byMap['harbor-map'].receipt.presentation, 'card');
    assert.ok(byMap['harbor-map'].view);
    assert.equal(byMap['village-map'].receipt.presentation, 'update');
    assert.equal(byMap['village-map'].view, undefined);
    assert.deepEqual(ids(byMap['village-map'].receipt.revealed), ['r-park', 'r-dock']);
    assert.deepEqual(world.maps_presented, ['harbor-map', 'village-map']);
    // An arrival that adds nothing to a map already held delivers nothing, and still records the presentation.
    const full = {active_scene: 'dockside', maps_presented: ['harbor-map'], map_knowledge: {'village-map': ['r-inn', 'r-park', 'r-dock']}};
    assert.deepEqual(await api.presentArrivalMaps(context(graph(), full, 5), asset), []);
    assert.deepEqual(full.maps_presented, ['harbor-map', 'village-map']);
});

test('the board reads one living row per map, arrival and grants together', async () => {
    const g = graph();
    const rows = await api.knownMapViews(g, {maps_presented: ['village-map'], map_knowledge: {'village-map': ['r-vault']}}, asset);
    assert.deepEqual(rows.map((item) => item.map), ['village-map']);
    assert.deepEqual(ids(rows[0].regions), ['r-inn', 'r-park', 'r-dock', 'r-vault']);
    assert.deepEqual(rows[0].render.masks, [], 'every village region is held, so nothing is masked');
});

test('a merged worldline keeps every map either line was shown', () => {
    const state = (line, world) => ({line, world: {active_scene: 'dockside', ...world}, party: {}, candidates: [], spent: new Set(), engines: {}});
    const merged = api.report(graph(), [state('main', {maps_presented: ['harbor-map']}), state('side', {maps_presented: ['village-map']})], null);
    assert.deepEqual(merged.world.maps_presented, ['harbor-map', 'village-map']);
});

test('§152.4: a variant is read as the print it stands for, and what the table held of it carries over only through the correspondence', async () => {
    const g = graph();
    assert.deepEqual(api.mapsForScene(g, g.scene('dockside')).map((node) => node.node_id), ['asset-harbor-map', 'asset-village-map'],
        'the second crop is never a second map');
    assert.deepEqual(api.mapCatalog(g, {}).map((item) => item.name).sort(), ['composed-map', 'harbor-map', 'village-map']);
    // A name the table learned for the variant reaches the survivor.
    assert.equal((await api.mapView(g, {map_knowledge: {'village-map': ['r-inn']}}, asset, 'village-print-2')).map, 'village-map');
    // Knowledge on the variant: only the matched region carries; the unmatched one is not guessed onto the survivor.
    const learned = {map_knowledge: {'village-print-2': ['v-inn', 'v-bank']}, map_labels: {'village-print-2': {title: 'Village', regions: {'v-inn': 'The inn', 'v-bank': 'The bank'}, levels: {}}}};
    assert.deepEqual(ids(api.livingMapRegions(g, learned, g.find('village-map'))), ['r-inn']);
    const view = await api.mapView(g, learned, asset, 'village-map');
    assert.deepEqual(view.regions, [{id: 'r-inn', label: 'The inn', level: null}], 'the Keeper\'s word for the matched region carries with it');
    assert.deepEqual(learned.map_knowledge, {'village-print-2': ['v-inn', 'v-bank']}, 'the variant\'s own record is not rewritten');
    // A table shown the variant was shown the map: arrival presents only the harbor.
    const world = {active_scene: 'dockside', maps_presented: ['village-print-2']};
    const arrived = await api.presentArrivalMaps(context(g, world, 7), asset);
    assert.deepEqual(arrived.map((item) => item.receipt.map), ['harbor-map']);
    const rows = await api.knownMapViews(g, {maps_presented: ['village-print-2']}, asset);
    assert.deepEqual(rows.map((item) => item.map), ['village-map'], 'the board lists the print once');
});
