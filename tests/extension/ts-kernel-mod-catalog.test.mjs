import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {build} from 'esbuild';

/**
 * The builtin packages ship beside content and need no earlier install. The catalog row is the
 * manifest as written on disk -- a Mod's name and description are objects keyed by play-language
 * tag (contract §23), passed through untouched -- plus a digest over the package's bytes. The
 * retired Python kernel predates per-tag manifests and is no oracle for this shape.
 */
test('a fresh home reads the real builtin Mod catalog and byte digests beside content',async t=>{
  const root=resolve(import.meta.dirname,'../..');
  const home=await mkdtemp(join(tmpdir(),'fresh builtin Mods '));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await build({stdin:{contents:`export {createKernelContext} from './kernel-ts/context.ts';
export {readModCatalog, packageFiles, packageDigest} from './kernel-ts/read/mods.ts';`,resolveDir:root,loader:'ts'},
    outfile:join(home,'catalog.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
  const api=await import(pathToFileURL(join(home,'catalog.mjs')).href);
  const context=await api.createKernelContext({workspace:home,content:join(root,'content')});
  t.after(()=>context.git.close());
  const rows=[...await api.readModCatalog(context)].map(([,value])=>value);
  const shipped=[];
  for(const name of (await readdir(join(root,'mods'))).sort())
    if(await stat(join(root,'mods',name,'mod.json')).then(()=>true,()=>false))shipped.push(name);
  assert.ok(shipped.length>0,'The product ships builtin packages without requiring an earlier install');
  assert.deepEqual(rows.map(row=>row.id),shipped);
  for(const row of rows){
    const manifest=JSON.parse(await readFile(join(root,'mods',row.id,'mod.json'),'utf8'));
    for(const key of ['id','version','name','description','author','game_api','requires'])assert.deepEqual(row[key],manifest[key],`${row.id}.${key}`);
    assert.ok(typeof row.name==='object'&&Object.values(row.name).every(word=>typeof word==='string'&&word.trim()),`${row.id} names itself per play language`);
    assert.equal(row.compatible,true);
    assert.match(row.digest,/^[0-9a-f]{64}$/);
    assert.equal(row.digest,api.packageDigest(await api.packageFiles(join(root,'mods',row.id))));
    assert.equal(createHash('sha256').update(row.files.get('mod.json')).digest('hex'),createHash('sha256').update(await readFile(join(root,'mods',row.id,'mod.json'))).digest('hex'));
  }
});
