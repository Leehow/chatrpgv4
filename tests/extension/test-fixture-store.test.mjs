import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,existsSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {publishTestFixture,materializeTestFixture,legacyFixtureSeed} from '../../scripts/test-fixture-store.mjs';
import {readFixture,materialize,fixtureDigest,removeTree} from '../../experiments/single-loop-routing/fixture.mjs';
import {cloneTestFiles,shareTestTree} from '../../scripts/test-workspace.mjs';

function sample(t){const root=mkdtempSync(join(process.platform==='darwin'?'/private/tmp':tmpdir(),'fixture-store-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const seed=join(root,'source');mkdirSync(join(seed,'.coc/modules/book/assets'),{recursive:true});mkdirSync(join(seed,'.coc/campaigns/table'),{recursive:true});writeFileSync(join(seed,'.coc/campaigns/table/world.json'),'{"world":1}');writeFileSync(join(seed,'.coc/modules/book/assets/page.png'),Buffer.from([0,255,0,128]));return{root,seed};}
function capable(t,root){const a=join(root,'probe-a');writeFileSync(a,'probe');try{cloneTestFiles([[a,join(root,'probe-b')]]);return true;}catch(error){if(process.platform!=='darwin'&&['ENOTSUP','ENOSYS','EOPNOTSUPP','EXDEV'].includes(error.code)){t.skip('Fixture views require a reflink-capable filesystem');return false;}throw error;}}

test('new fixtures retain one shared workspace reference and isolate consumers',t=>{
  const{root,seed}=sample(t);if(!capable(t,root))return;const directory=join(root,'fixture'),reference=publishTestFixture(seed,directory);
  writeFileSync(join(directory,'turn.json'),JSON.stringify({campaign:'table',module:'book',turn:1}));
  assert.equal(reference.kind,'shared-test-fixture');assert.equal(existsSync(join(directory,'workspace.tar.gz')),false);
  const fixture=readFixture(directory);assert.equal(fixture.workspace,join(directory,'workspace'));assert.match(fixtureDigest(fixture),/^[a-f0-9]{64}$/);
  const a=join(root,'a'),b=join(root,'b');materializeTestFixture({workspace:fixture.workspace},a);materializeTestFixture({workspace:fixture.workspace},b);
  const relative='.coc/campaigns/table/world.json';writeFileSync(join(a,relative),'changed');assert.equal(readFileSync(join(b,relative),'utf8'),'{"world":1}');assert.equal(readFileSync(join(fixture.workspace,relative),'utf8'),'{"world":1}');
  assert.throws(()=>publishTestFixture(seed,directory),/existing fixture/);
  const view=materialize(directory);t.after(()=>rmSync(view,{recursive:true,force:true}));assert.equal(readFileSync(join(view,relative),'utf8'),'{"world":1}');
});

test('legacy tar data is expanded once, then every consumer uses private CoW files',t=>{
  const{root,seed}=sample(t);if(!capable(t,root))return;const archive=join(root,'legacy.tar.gz'),cacheRoot=join(root,'cache');
  const result=spawnSync('tar',['-czf',archive,'-C',seed,'.coc'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const first=legacyFixtureSeed(archive,{cacheRoot}),inode=lstatSync(join(first,'.coc/campaigns/table/world.json')).ino;
  assert.equal(legacyFixtureSeed(archive,{cacheRoot}),first);assert.equal(lstatSync(join(first,'.coc/campaigns/table/world.json')).ino,inode);
  assert.equal(readdirSync(cacheRoot).filter(name=>!name.endsWith('.lock')).length,1);
  const a=join(root,'a'),b=join(root,'b');materializeTestFixture({archive},a,{cacheRoot});materializeTestFixture({archive},b,{cacheRoot});
  writeFileSync(join(a,'.coc/campaigns/table/world.json'),'private');assert.equal(readFileSync(join(b,'.coc/campaigns/table/world.json'),'utf8'),'{"world":1}');assert.equal(readFileSync(join(first,'.coc/campaigns/table/world.json'),'utf8'),'{"world":1}');
  assert.ok(existsSync(archive));assert.notEqual(lstatSync(join(b,'.coc/campaigns/table/world.json')).ino,inode);
});

test('discarding one reference tree leaves shared payloads read-only and other trees intact',t=>{
  const{root,seed}=sample(t);if(!capable(t,root))return;const a=join(root,'a'),b=join(root,'b');shareTestTree(seed,a,{readOnly:true});shareTestTree(seed,b,{readOnly:true});const world=join(b,'.coc/campaigns/table/world.json'),before=readFileSync(world);assert.equal(lstatSync(world).isSymbolicLink(),true);removeTree(a);assert.deepEqual(readFileSync(world),before);assert.throws(()=>writeFileSync(world,'forbidden'),/EACCES|EPERM/);
});
