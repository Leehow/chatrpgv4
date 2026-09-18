import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';

const bundle = await build({entryPoints:['kernel-ts/journal/naming.ts'],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {toldTurn, nameWords} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const node = {name:'Nate', node_id:'npc-nate'};
const graph = {handle:()=>'nate', displayName:n=>n.name};
const delivered = (turn, extra = {}) => ({turn, closed_by:'narrate', commit:`commit-${turn}`, rendered_text:'He waits.', ...extra});

test('name disclosure uses committed display words, never an identity, draft or hidden token', () => {
  assert.deepEqual(nameWords(graph, node), ['nate']);
  assert.equal(toldTurn(graph, node, [delivered(0, {speech:[{who:{npc:'nate',name:'The man in a hat'}}]})]), null);
  assert.equal(toldTurn(graph, node, [delivered(0, {rendered_text:'Please donate here.'})]), null);
  assert.equal(toldTurn(graph, node, [delivered(0, {commit:null,rendered_text:'Nate'})]), null);
  assert.equal(toldTurn(graph, node, [delivered(0, {closed_by:'ask',rendered_text:'Nate'})]), null);
  assert.equal(toldTurn(graph, node, [delivered(0, {text:'{{say:Nate}}Hello{{/say}}'})]), null);
  assert.equal(toldTurn(graph, node, [delivered(0, {speech:[{who:{npc:'nate',name:'Nate'}}]})]), 0);
  assert.equal(toldTurn(graph, node, [delivered(0, {speech:[{who:{npc:'other',name:'Nate'}}]})]), null);
  assert.equal(toldTurn(graph, node, [delivered(4, {rendered_text:'Nate'}), delivered(2, {rendered_text:'Nate'})]), 2);
  assert.equal(toldTurn(graph, node, [delivered(4, {rendered_text:'Nate'})], 3), null);
});

test('the base Keeper prompt keeps untold speaker titles in the player perspective', async () => {
  const prompt = await readFile(new URL('../../prompts/keeper.md', import.meta.url), 'utf8');
  assert.ok(!prompt.includes('with `Name` exactly as `present[].name` gives it'));
  assert.ok(prompt.includes('`present[].name` or this table\'s `called.name`'));
  assert.ok(prompt.includes('For a person marked `untold`'));
  assert.ok(prompt.includes('establish a stable epithet with `apply person`'));
  assert.ok(prompt.includes('until the fiction introduces their name'));
  const host = await readFile(new URL('../../extensions/kernel/index.ts', import.meta.url), 'utf8');
  const steer = host.slice(host.indexOf('const SPEECH_STEER ='), host.indexOf('let table: TableState'));
  assert.ok(steer.includes('present[].name or called.name'));
  assert.ok(steer.includes('For an untold person'));
  assert.ok(steer.includes('apply person'));
  assert.ok(steer.includes('until the fiction introduces the name'));
});
