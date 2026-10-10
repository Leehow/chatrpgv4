import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,symlink,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'mod-discovery-index-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
    "export * from './kernel-ts/testing/api.ts';",
    "export {parseSections} from './kernel-ts/read/sections.ts';",
].join('\n'),resolveDir:root,sourcefile:'mod-discovery-index-test.ts'},outfile:join(temp,'api.mjs'),
    bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const markdown='# Sample\n\nPreserve canonical authority.\n\n## Ordinary activity\n\nRecord the actual observed transition.\n';
const manifest={id:'sample',version:'2.0.0',requires:['instructions.sections.v1','instructions.discovery.v1']};
const index={schema_version:2,sections:[
    {heading:null,kind:'resident'},
    {heading:'Ordinary activity',kind:'situational',category:'Ordinary local activity',
        applicability:{what:'An actual activity transition needs recording.',not_for:'An inferred rewrite of observation.',examples:['A person actually wakes.']},
        dependencies:['npc-activity']},
]};

test('version-2 applicability remains a bounded index over complete immutable sections',()=>{
    const parts=api.parseSections(manifest,index,markdown);
    assert.equal(parts[1].index_contract_version,2);
    assert.equal(parts[1].text,'## Ordinary activity\n\nRecord the actual observed transition.');
    assert.equal(parts[1].applicability.what,index.sections[1].applicability.what);
    assert.deepEqual(parts[1].dependencies,['npc-activity']);
    assert.throws(()=>api.parseSections({...manifest,requires:['instructions.sections.v1']},index,markdown),/require instructions.discovery.v1/);
    const legacy={schema_version:1,sections:[{heading:null,kind:'resident'},
        {heading:'Ordinary activity',kind:'situational',topics:['time_passes']}]};
    assert.equal(api.parseSections({...manifest,requires:['instructions.sections.v1']},legacy,markdown)[1].index_contract_version,undefined);
});

test('invalid dependency, applicability and hidden resident metadata are rejected',()=>{
    for(const patch of [
        {dependencies:['made-up-capability']},
        {dependencies:['npc-activity','npc-activity']},
        {applicability:{what:'',not_for:'',examples:[]}},
        {applicability:{what:'x'.repeat(401),not_for:'',examples:[]}},
        {category:''},
    ]){
        const bad=structuredClone(index);Object.assign(bad.sections[1],patch);
        assert.throws(()=>api.parseSections(manifest,bad,markdown));
    }
    const resident=structuredClone(index);resident.sections[0].category='Hidden metadata';
    assert.throws(()=>api.parseSections(manifest,resident,markdown),/resident section/);
    assert.throws(()=>api.parseSections(manifest,{...index,sections:index.sections.slice(0,1)},markdown),/every ## heading/);
});

test('the kernel projects a new locked index even under a budget that keeps legacy packages full',async t=>{
    const home=await mkdtemp(join(temp,'home-')),path=join(temp,'package');
    await cp(join(root,'mods/keeper-pacing'),path,{recursive:true});
    const m=JSON.parse(await readFile(join(path,'mod.json'),'utf8'));
    m.version='1.3.2';m.requires.push('instructions.discovery.v1');
    const declaration=JSON.parse(await readFile(join(path,'sections.json'),'utf8'));
    declaration.schema_version=2;
    declaration.sections=declaration.sections.map(s=>s.kind==='resident'?s:{...s,category:'Test pacing',
        applicability:{what:'This section concerns '+s.heading+'.',not_for:'An unrelated situation.',examples:[]}});
    await writeFile(join(path,'mod.json'),JSON.stringify(m));
    await writeFile(join(path,'sections.json'),JSON.stringify(declaration));
    const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'mod-discovery',
        locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    const runtime=api.createKernelRuntime(context);t.after(()=>runtime.close());
    const call=(method,args={})=>runtime.handlers[method](args);
    await call('mods.install',{path});
    await call('campaign.create',{id:'discovery',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
    const capsule=await call('table.capsule',{campaign:'discovery',rehydrate:true});
    const pacing=capsule.mods.instructions.find(r=>r.mod==='keeper-pacing');
    assert.equal(pacing.version,'1.3.2');assert.equal(pacing.form,'indexed');assert.equal(pacing.index_contract_version,2);
    assert.ok(pacing.sections.every(s=>s.applicability&&s.category));
    assert.ok(capsule.mods.instructions.filter(r=>r.mod!=='keeper-pacing').every(r=>r.form==='full'));
});
