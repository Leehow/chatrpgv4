/**
 * Contract §39.4: the case board's map pixels travel by path and are materialized at the player host.
 *
 * The pack answers the board through the host bridge, whose body is capped at 4 MiB; on the installed
 * App two whole village maps inline were over it and the panel said "the pack did not answer". The pack
 * now hands over the PNG it stored under the campaign's `map-views/`, and `withMapImages` reads it back
 * here -- only from that directory, only a PNG, only within the renderer's own size cap -- and removes
 * every path before the answer goes on to the panel.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {piBackend} from './pi-backend-source.mjs';

const {withMapImages} = await piBackend('coc-map-images.ts');

async function table() {
    const home = await mkdtemp(join(tmpdir(), 'board-map-images-')), campaign = 'c1';
    const views = join(home, '.coc', 'campaigns', campaign, 'map-views');
    await mkdir(views, {recursive: true});
    const canvas = createCanvas(4, 4), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 4, 4);
    const png = canvas.toBuffer('image/png');
    const stored = join(views, 'village-abc.png'), level = join(views, 'village-ground.png');
    await writeFile(stored, png);
    await writeFile(level, png);
    return {home, campaign, views, png, stored, level, binding: {home, campaign}};
}

const row = (extra) => ({kind: 'map', map: 'village', name: 'Village', view_id: 'abc', document: 'ready', regions: [], levels: [], ...extra});

test('a stored card becomes pixels, and no path reaches the panel', async () => {
    const t = await table();
    const [map] = withMapImages([row({image_path: t.stored, level_images: [{level: 'Ground', image_path: t.level}]})], t.binding);
    assert.equal(map.document, 'ready');
    assert.equal(map.image, `data:image/png;base64,${t.png.toString('base64')}`);
    assert.deepEqual(map.level_images, [{level: 'Ground', image: map.image}]);
    assert.equal(JSON.stringify(map).includes(t.views), false, 'the stored path stops at the host');
});

test('only a PNG in this campaign\'s map-views becomes pixels; anything else answers none', async () => {
    const t = await table();
    const outside = join(t.home, 'elsewhere.png');
    await writeFile(outside, t.png);
    const escape = join(t.views, 'escape.png');
    await symlink(outside, escape);
    const notPng = join(t.views, 'note.png');
    await writeFile(notPng, 'not a picture');
    const big = join(t.views, 'big.png');
    await writeFile(big, Buffer.concat([t.png.subarray(0, 8), Buffer.alloc(8 * 1024 * 1024 + 1)]));
    const other = await table();
    for (const [label, rows, binding] of [
        ['a file outside map-views', [row({image_path: outside})], t.binding],
        ['a symlink out of map-views', [row({image_path: escape})], t.binding],
        ['bytes that are not a PNG', [row({image_path: notPng})], t.binding],
        ['a file over the renderer\'s cap', [row({image_path: big})], t.binding],
        ['another campaign\'s picture', [row({image_path: other.stored})], t.binding],
        ['a relative path', [row({image_path: 'village-abc.png'})], t.binding],
        ['no binding at all', [row({image_path: t.stored})], undefined],
    ]) {
        const [map] = withMapImages(rows, binding);
        assert.equal(map.document, 'none', label);
        assert.equal(map.image, undefined, label);
        assert.equal('image_path' in map, false, `${label}: the path is removed even when refused`);
    }
});

test('bytes a row brings with it are never trusted: only the stored file is read', async () => {
    const t = await table();
    const [forged] = withMapImages([row({image: 'data:image/png;base64,Zm9yZ2Vk'})], t.binding);
    assert.equal(forged.image, undefined);
    assert.equal(forged.document, 'none');
});
