import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const root=new URL('../..',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const manifest=JSON.parse(read('tests/direct-ts-migration.json'));
const full=JSON.parse(read('tests/ts-migration-manifest.json'));
test('frozen migration inventories keep every original assertion and fast counterpart reviewable after source retirement',()=>{
  const migrated=new Set();
  for(const group of manifest.groups){
    const original=full.files.find(file=>file.source===group.source),direct=read(group.direct);
    assert.ok(original,group.source);assert.equal(original.sha256,group.sha256,`${group.source} original inventory changed`);
    assert.deepEqual(new Set([...group.cases.map(c=>c.name),...group.retainedOnly]),new Set(original.cases.map(c=>c.name)));
    for(const entry of group.cases){const id=`${group.source}::${entry.name}`;assert.ok(!migrated.has(id),id);migrated.add(id);assert.ok(direct.includes(entry.name),`${id} has no fast counterpart`);assert.ok(entry.assertions.length||entry.raises.length,`${id} lost its assertion inventory`);}
    assert.ok(manifest.fastFiles.includes(group.direct));
  }
});
test('the retired controller requires a complete validated native counterpart inventory',()=>{
  assert.equal(full.complete,true,'Full native execution and assertion review must finish before controller retirement');
  for(const file of full.files)for(const entry of file.cases){
    const id=`${file.source}::${entry.name}`;assert.equal(entry.status,'validated',id);assert.equal(entry.review,'statement-by-statement',id);
    assert.ok(entry.counterpart?.file&&entry.counterpart?.name,id);const native=read(entry.counterpart.file);
    assert.equal(createHash('sha256').update(native).digest('hex'),entry.counterpart.sha256,`${id} counterpart changed after validation`);
    assert.ok(native.includes(entry.counterpart.name),`${id} counterpart name absent`);assert.ok(entry.validation?.command,id);
  }
});
test('default fast lane and full native gate retain their distinct responsibilities',()=>{
  const scripts=JSON.parse(read('package.json')).scripts;
  assert.equal(scripts.test,'node scripts/test-fast.mjs');assert.equal(scripts['test:integration'],'node scripts/test-integration.mjs');assert.equal(scripts['test:all'],'node scripts/test-all.mjs');
  for(const smoke of ['ts-kernel-foundation','control-flow-inventory'])assert.ok(manifest.fastFiles.includes(`tests/extension/${smoke}.test.mjs`));
  const integration=read('scripts/test-integration.mjs');assert.ok(integration.includes('scripts/test-integration-ts.mjs'));assert.ok(!/--ignore|--deselect|['"]-k['"]/.test(integration),'No implicit loss of integration coverage');
  const all=read('scripts/test-all.mjs');for(const lane of ['scripts/build-runtime.mjs','scripts/test-extension.mjs','experiments/single-loop-routing/loop.test.mjs','scripts/test-integration.mjs'])assert.ok(all.includes(lane));
});
