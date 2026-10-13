/** Host-only reference collection calls the real kernel; no fictional turns are synthesized. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {table, root, api} from './object-usages-fixture.mjs';
import {withDocumentImage} from '../../shared/handout-images.js';
import {renderMapView} from '../../extensions/kernel/map-view.ts';
import {createCanvas, loadImage} from '@napi-rs/canvas';

const MAP = 'Corbitt House Investigator Map';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=', 'base64');
async function pictured(t, options) {
    const game = await table(t, options), folder = join(game.home, '.coc/modules/the-haunting');
    const sourcePath = join(folder, 'assets/player/corbitt-house-investigator-map.png');
    await mkdir(join(folder, 'assets/player'), {recursive: true}); await writeFile(sourcePath, PNG);
    return {...game, sourcePath};
}
const select = game => ({actor: game.sheet.id, handout: MAP, presentation: 'map'});
const protectedBytes = async game => Object.fromEntries(await Promise.all([
    'world.json', 'turn.json', 'campaign.json', 'events.jsonl', 'transcript.jsonl',
    'party/' + game.sheet.id + '.json',
].map(async name => [name, (await readFile(join(game.directory, name))).toString('base64')])));

test('selection queues a stable reference, finishes without world effects and keeps frozen read-only pixels', async t => {
    const game = await pictured(t); await game.apply([{kind: 'handout', name: MAP, label: 'My public map'}]);
    const before = await protectedBytes(game);
    const queued = await game.call('mods.document.collect', select(game));
    assert.equal(queued.reference.status, 'queued'); assert.equal(queued.reference.editing, 'read_only');
    assert.equal(queued.reference.actor_id, game.sheet.id); assert.equal(queued.reference.presentation, 'map');
    assert.equal(queued.reference.label, 'My public map');
    assert.deepEqual(Object.keys(queued.reference).sort(), ['actor_id', 'editing', 'handout', 'id', 'label', 'name', 'presentation', 'status', 'worldline'].sort());
    const shown = (await game.call('table.view')).handouts.find(row => row.handout);
    assert.ok(shown);
    assert.equal((await game.call('mods.document.collect', {...select(game), handout: shown.handout})).reference.id, queued.reference.id);
    const listing = await game.call('mods.document.references', {actor: game.sheet.id});
    assert.deepEqual(listing.references, [queued.reference]);
    assert.deepEqual(listing._reference_jobs, [{reference_id: queued.reference.id}]);
    await assert.rejects(game.call('mods.document.view', {actor: game.sheet.id, reference_id: queued.reference.id}), /not ready/);
    const ready = await game.call('mods.document.reference_finish', {reference_id: queued.reference.id});
    assert.equal(ready.reference.id, queued.reference.id); assert.equal(ready.reference.status, 'ready');
    assert.deepEqual(await game.call('mods.document.reference_finish', {reference_id: queued.reference.id}), ready);
    assert.deepEqual(await game.call('mods.document.collect', select(game)), ready);
    assert.deepEqual(await protectedBytes(game), before, 'Collection has no world, party, turn, event or transcript writer');
    const params = {actor: game.sheet.id, reference_id: queued.reference.id};
    const view = await game.call('mods.document.view', params);
    assert.equal(view.editing, 'read_only'); assert.equal(view.player_edited, false); assert.equal(view.text, '');
    assert.equal(view.image.source, MAP); assert.deepEqual(await readFile(view.image.path), PNG);
    assert.ok(view.image.path.startsWith(join(await realpath(game.directory), 'document-assets')));
    assert.equal(withDocumentImage(view, {home: game.home, campaign: 'c1'}).image, 'data:image/png;base64,' + PNG.toString('base64'));
    await writeFile(game.sourcePath, Buffer.concat([PNG, Buffer.from('later source')]));
    assert.deepEqual((await game.call('mods.document.view', params)).image, view.image);
    assert.deepEqual(await readFile(view.image.path), PNG);
    for (const method of ['mods.document.apply', 'mods.document.request'])
        await assert.rejects(game.call(method, {...params, version: view.version, action: 'save', text: 'Overwrite'}));
    const world = await game.world(); world.mods.active = {}; await writeFile(join(game.directory, 'world.json'), JSON.stringify(world));
    assert.deepEqual((await game.call('mods.document.view', params)).image, view.image, 'Disabling the provider cannot lose retained references');
    await writeFile(view.image.path, 'tampered');
    await assert.rejects(game.call('mods.document.view', params), /unavailable or has changed/);
});

test('a source changed after selection is refused once with retained diagnostics, not silently rebased', async t => {
    const game = await pictured(t); await game.apply([{kind: 'handout', name: MAP}]);
    const queued = await game.call('mods.document.collect', select(game));
    await writeFile(game.sourcePath, Buffer.concat([PNG, Buffer.from('changed')]));
    const refused = await game.call('mods.document.reference_finish', {reference_id: queued.reference.id});
    assert.equal(refused.reference.id, queued.reference.id); assert.equal(refused.reference.status, 'refused');
    assert.equal(refused.reference.image, undefined); assert.equal(refused.error.code, 'revision_conflict');
    assert.match(refused.error.message, /source.*changed/);
    await writeFile(game.sourcePath, PNG);
    assert.deepEqual(await game.call('mods.document.reference_finish', {reference_id: queued.reference.id}), refused);
    assert.deepEqual(await game.call('mods.document.collect', select(game)), {reference: refused.reference});
    const retained = JSON.parse(await readFile(join(game.directory, 'reference-items.json'), 'utf8'));
    assert.equal(retained.version, 1); assert.deepEqual(retained.entries[queued.reference.id].failure, refused.error);
    await assert.rejects(game.call('mods.document.view', {actor: game.sheet.id, reference_id: queued.reference.id}), /not ready/);
});

test('collection accepts only explicit category and existing revealed safe sources for a party investigator', async t => {
    const game = await pictured(t);
    await assert.rejects(game.call('mods.document.collect', select(game)), /already revealed/);
    await game.apply([{kind: 'handout', name: MAP}]);
    for (const field of ['path', 'bytes', 'owner', 'mode', 'image', 'name'])
        await assert.rejects(game.call('mods.document.collect', {...select(game), [field]: 'forged'}), /Unknown reference/);
    for (const presentation of ['paper', 'notebook', '', null])
        await assert.rejects(game.call('mods.document.collect', {...select(game), presentation}), /map or image/);
    await assert.rejects(game.call('mods.document.collect', {...select(game), actor: 'Steven Knott'}));
    await assert.rejects(game.call('mods.document.references', {}), /actor.*nonempty/);
    await assert.rejects(game.call('mods.document.reference_finish', {reference_id: 'unknown'}), /No collected reference/);
    await assert.rejects(game.call('mods.document.reference_finish', {reference_id: 'unknown', actor: game.sheet.id}), /Unknown reference/);
    const image = await game.call('mods.document.collect', {...select(game), presentation: 'image'});
    assert.equal(image.reference.presentation, 'image', 'The explicit UI category wins over the source name');
    await assert.rejects(game.call('mods.document.view', {actor: game.sheet.id, reference_id: image.reference.id, name: MAP}), /Unknown reference/);
});

test('ready reads and queued completion remain bound to investigator and selected worldline', async t => {
    const game = await pictured(t); await game.apply([{kind: 'handout', name: MAP}]);
    const first = await game.call('mods.document.collect', select(game));
    const other = {...game.sheet, id: 'another-reader', name: 'Another reader'};
    await writeFile(join(game.directory, 'party', other.id + '.json'), JSON.stringify(other));
    assert.deepEqual((await game.call('mods.document.references', {actor: other.id})).references, []);
    await assert.rejects(game.call('mods.document.view', {actor: other.id, reference_id: first.reference.id}), /does not hold/);
    const metaPath = join(game.directory, 'campaign.json'), meta = JSON.parse(await readFile(metaPath, 'utf8'));
    meta.active_worldline = 'reference-test-new-worldline'; await writeFile(metaPath, JSON.stringify(meta));
    assert.deepEqual((await game.call('mods.document.references', {actor: game.sheet.id})).references, []);
    const stale = await game.call('mods.document.reference_finish', {reference_id: first.reference.id});
    assert.equal(stale.reference.status, 'refused'); assert.equal(stale.error.code, 'revision_conflict');
    await assert.rejects(game.call('mods.document.view', {actor: game.sheet.id, reference_id: first.reference.id}), /worldline/);
    const second = await game.call('mods.document.collect', select(game));
    assert.notEqual(second.reference.id, first.reference.id);
});

test('a held region map queues before rendering and snapshots only its pinned authorized pixels', async t => {
    const game = await pictured(t), canvas = createCanvas(200, 200), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(26, 122, 52, 16); await writeFile(game.sourcePath, canvas.toBuffer('image/png'));
    await game.apply([{kind: 'map', name: 'player-corbitt-house-map', regions: ['ground-entry-hall'], label: 'My observed map',
        region_labels: {'ground-entry-hall': 'Entry hall'}, level_labels: {'Ground Floor': 'Ground Floor'}, why: 'Observed in this authorization fixture.'}]);
    const queued = await game.call('mods.document.collect', {...select(game), handout: 'player-corbitt-house-map', presentation: 'image'});
    assert.equal(queued.reference.status, 'queued'); assert.deepEqual(queued._reference_source, {map: 'player-corbitt-house-map'});
    assert.deepEqual((await game.call('mods.document.references', {actor: game.sheet.id}))._reference_jobs,
        [{reference_id: queued.reference.id, map: 'player-corbitt-house-map'}]);
    const looked = await game.call('table.look', {focus: 'map', name: queued._reference_source.map});
    for (const view of looked.map_views) await renderMapView(view, {modulesRoot: join(game.home, '.coc/modules'), campaignDir: game.directory});
    const ready = await game.call('mods.document.reference_finish', {reference_id: queued.reference.id});
    assert.equal(ready.reference.id, queued.reference.id); assert.equal(ready.reference.status, 'ready');
    const image = await loadImage(await readFile(ready.reference.image.path)), output = createCanvas(image.width, image.height);
    const out = output.getContext('2d'); out.drawImage(image, 0, 0); const pixels = out.getImageData(0, 0, image.width, image.height).data;
    let red = 0, blue = 0; for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 200 && pixels[i + 2] < 40) red++;
        if (pixels[i + 2] > 200 && pixels[i] < 40) blue++;
    }
    assert.ok(red > 0); assert.equal(blue, 0, 'Unknown source pixels must never enter a reference');
    assert.notDeepEqual(await readFile(ready.reference.image.path), await readFile(game.sourcePath));
});

test('concurrent collectors use actual advisory locking and preserve all ledger entries', async t => {
    const game = await pictured(t); await game.apply([{kind: 'handout', name: MAP}]);
    const require = createRequire(import.meta.url), fsExt = require('fs-ext');
    const context = await api.createKernelContext({workspace: game.home, content: join(root, 'content'),
        locks: api.createAdvisoryLocks((fd, op) => new Promise((resolve, reject) => fsExt.flock(fd, op, error => error ? reject(error) : resolve())))});
    const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
    const call = params => runtime.handlers['mods.document.collect']({campaign: 'c1', ...params});
    const rows = await Promise.all(Array.from({length: 6}, (_, index) => call({...select(game), presentation: index % 2 ? 'image' : 'map'})));
    assert.equal(new Set(rows.map(row => row.reference.id)).size, 2);
    const saved = JSON.parse(await readFile(join(game.directory, 'reference-items.json'), 'utf8'));
    assert.equal(Object.keys(saved.entries).length, 2); assert.equal(saved.version, 1);
});

test('a queued map cannot acquire later revealed regions or fall back to its full source when no cache exists', async t => {
    const game = await pictured(t);
    const reveal = regions => game.apply([{kind: 'map', name: 'player-corbitt-house-map', regions,
        label: 'My observed map', region_labels: Object.fromEntries(regions.map(name => [name, name])),
        level_labels: {'Ground Floor': 'Ground Floor'}, why: 'Observed in this authorization fixture.'}]);
    await reveal(['ground-entry-hall']);
    const first = await game.call('mods.document.collect', {...select(game), handout: 'player-corbitt-house-map'});
    await reveal(['ground-living-room']);
    const stale = await game.call('mods.document.reference_finish', {reference_id: first.reference.id});
    assert.equal(stale.reference.status, 'refused'); assert.equal(stale.error.code, 'revision_conflict');
    assert.match(stale.error.message, /authorized view changed/); assert.equal(stale.reference.image, undefined);
    const later = await game.call('mods.document.collect', {...select(game), handout: 'player-corbitt-house-map'});
    assert.notEqual(later.reference.id, first.reference.id, 'A newly revealed view is a distinct explicit selection');
    const uncached = await game.call('mods.document.reference_finish', {reference_id: later.reference.id});
    assert.equal(uncached.reference.status, 'refused'); assert.equal(uncached.error.code, 'needs');
    assert.match(uncached.error.message, /must be rendered/); assert.equal(uncached.reference.image, undefined);
    assert.deepEqual(await readFile(game.sourcePath), PNG, 'A valid full raster exists but is not a permitted fallback');
});

test('a queued image whose public reveal authority is removed is retained as refused', async t => {
    const game = await pictured(t); await game.apply([{kind: 'handout', name: MAP}]);
    const queued = await game.call('mods.document.collect', select(game));
    const world = await game.world(); world.handouts_shown = [];
    await writeFile(join(game.directory, 'world.json'), JSON.stringify(world));
    const refused = await game.call('mods.document.reference_finish', {reference_id: queued.reference.id});
    assert.equal(refused.reference.status, 'refused'); assert.equal(refused.reference.image, undefined);
    assert.match(refused.error.message, /already revealed/);
    const retained = JSON.parse(await readFile(join(game.directory, 'reference-items.json'), 'utf8'));
    assert.deepEqual(retained.entries[queued.reference.id].failure, refused.error);
});

test('a table without the image reference capability cannot collect', async t => {
    const game = await pictured(t, {without: ['objects.image-references.v1']});
    await game.apply([{kind: 'handout', name: MAP}]);
    await assert.rejects(game.call('mods.document.collect', select(game)), /requires an active image reference provider/);
});
