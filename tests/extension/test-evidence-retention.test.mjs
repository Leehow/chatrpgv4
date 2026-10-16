import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,realpathSync,chmodSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {removePassedFixtures} from '../../scripts/test-storage.mjs';
import {compactRun} from '../../scripts/compact-test-evidence.mjs';

const tar=spawnSync('tar',['--version'],{encoding:'utf8'}),gnu=tar.stdout?.includes('GNU tar');
function scratch(t){const path=mkdtempSync(join(realpathSync(tmpdir()),'test-retention-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function fixture(root,nodeid,storage='ordinary'){
  const path=join(root,`case-${createHash('sha256').update(nodeid).digest('hex').slice(0,16)}-fixture`);
  mkdirSync(path,{recursive:true});writeFileSync(join(path,'value'),nodeid);return{path,nodeid,storage};
}
function completed(t){const base=scratch(t),run=join(base,'.pytest-runs','project','run.example');mkdirSync(run,{recursive:true});writeFileSync(join(run,'result.exit'),'1\n');return{base,run};}
test('failed invocation drops only explicitly passed independent fixtures',t=>{
  const base=scratch(t),ordinary=join(base,'ordinary'),disk=join(base,'disk');
  const passed=fixture(ordinary,'passed'),failed=fixture(ordinary,'failed'),unknown=fixture(ordinary,'unknown'),diskPassed=fixture(join(disk,'123'),'disk-passed','disk');
  assert.deepEqual(new Set(removePassedFixtures([passed,failed,unknown,diskPassed],[{nodeid:'passed',outcome:'passed'},{nodeid:'failed',outcome:'failed'},{nodeid:'disk-passed',outcome:'passed'}],{ordinary,disk})),new Set([passed.path,diskPassed.path]));
  assert.ok(!existsSync(passed.path));assert.ok(!existsSync(diskPassed.path));assert.ok(existsSync(failed.path));assert.ok(existsSync(unknown.path));
});
test('conflicting outcomes and dependencies of retained cases survive',t=>{
  const base=scratch(t),ordinary=join(base,'ordinary'),disk=join(base,'disk'),shared=fixture(ordinary,'shared'),failed=fixture(ordinary,'failed'),conflict=fixture(ordinary,'conflict');
  symlinkSync(join(shared.path,'value'),join(failed.path,'dependency'));
  assert.deepEqual(removePassedFixtures([shared,failed,conflict],[{nodeid:'shared',outcome:'passed'},{nodeid:'failed',outcome:'failed'},{nodeid:'conflict',outcome:'failed'},{nodeid:'conflict',outcome:'passed'}],{ordinary,disk}),[]);
  assert.equal(readFileSync(join(failed.path,'dependency'),'utf8'),'shared');
});
test('out-of-root paths and symlink process roots refuse cleanup before deletion',t=>{
  const base=scratch(t),ordinary=join(base,'ordinary'),disk=join(base,'disk'),passed=fixture(ordinary,'passed'),outside=fixture(join(base,'outside'),'outside');
  assert.throws(()=>removePassedFixtures([passed,outside],[{nodeid:'passed',outcome:'passed'}],{ordinary,disk}),/escaped/);assert.ok(existsSync(passed.path));
  mkdirSync(disk);symlinkSync(join(base,'outside'),join(disk,'123'));
  assert.throws(()=>removePassedFixtures([{...outside,path:join(disk,'123',outside.path.split('/').at(-1)),storage:'disk'}],[{nodeid:'outside',outcome:'passed'}],{ordinary,disk}),/symlink/);assert.ok(existsSync(outside.path));
});
test('maintenance skips incomplete, recent and locked runs',async t=>{
  const {run}=completed(t);assert.equal((await compactRun(run,{apply:true})).skipped,'recent run');
  rmSync(join(run,'result.exit'));assert.equal((await compactRun(run,{apply:true,minAgeMs:0})).skipped,'no terminal result');
  writeFileSync(join(run,'result.exit'),'143');mkdirSync(join(run,'.evidence-compaction.lock'));
  assert.equal((await compactRun(run,{apply:true,minAgeMs:0})).skipped,'compaction locked');
});
test('verified compression preserves failure bytes, symlinks, read-only files and readable logs',{skip:!gnu&&'GNU tar is required on LAN boxes'},async t=>{
  const {run}=completed(t),payload=join(run,'legacy-pytest');mkdirSync(payload);writeFileSync(join(payload,'failure value'),'failure\n'.repeat(1000));symlinkSync('failure value',join(payload,'alias'));chmodSync(join(payload,'failure value'),0o400);
  writeFileSync(join(run,'py.log'),'original error');writeFileSync(join(run,'source.diff'),'original source');
  assert.deepEqual((await compactRun(run,{minAgeMs:0})).payloads,['legacy-pytest']);assert.ok(existsSync(payload));
  const result=await compactRun(run,{apply:true,minAgeMs:0});assert.equal(result.archives,1);assert.ok(!existsSync(payload));assert.equal(readFileSync(join(run,'py.log'),'utf8'),'original error');assert.equal(readFileSync(join(run,'source.diff'),'utf8'),'original source');
  const manifest=JSON.parse(readFileSync(join(run,'evidence-compaction.json'),'utf8')),entry=manifest.archives[0],archive=join(run,entry.archive);
  assert.equal(entry.sha256,createHash('sha256').update(readFileSync(archive)).digest('hex'));
  const restore=spawnSync('tar',['-xzf',archive,'-C',run]);assert.equal(restore.status,0,restore.stderr.toString());assert.equal(readFileSync(join(payload,'alias'),'utf8'),'failure\n'.repeat(1000));assert.equal(lstatSync(join(payload,'failure value')).mode&0o777,0o400);
  await compactRun(run,{apply:true,minAgeMs:0});assert.ok(!existsSync(payload));assert.deepEqual(readFileSync(join(run,'evidence-compaction.json')),Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
});
test('failed archive comparison keeps originals and removes only its partial archive',{skip:!gnu&&'GNU tar is required on LAN boxes'},async t=>{
  const {base,run}=completed(t),payload=join(run,'legacy-pytest');mkdirSync(payload);writeFileSync(join(payload,'failure'),'keep me');
  const bin=join(base,'bin');mkdirSync(bin);const executable=spawnSync('sh',['-c','command -v tar'],{encoding:'utf8'}).stdout.trim();
  writeFileSync(join(bin,'tar'),`#!/bin/sh\nif [ "$1" = --compare ]; then exit 2; fi\nexec ${JSON.stringify(executable)} "$@"\n`,{mode:0o700});
  const previous=process.env.PATH;process.env.PATH=bin+':'+previous;
  try{await assert.rejects(compactRun(run,{apply:true,minAgeMs:0}),/tar exit 2/);}finally{process.env.PATH=previous;}
  assert.equal(readFileSync(join(payload,'failure'),'utf8'),'keep me');assert.ok(!existsSync(join(run,'compressed-evidence/legacy-pytest.tar.gz.partial')));assert.ok(!existsSync(join(run,'evidence-compaction.json')));
});
