/** Exact source selectors and real kernel acceptance; no model calls or simulated gameplay. */
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, rm, cp} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..');
let api,bundle;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});
    bundle=await mkdtemp(join(root,'.tmp/audit-references-'));
    await build({stdin:{contents:[
        "export * from './kernel-ts/mods/audit-references.ts';",
        "export * from './kernel-ts/mods/audit-result.ts';",
        "export {MOD_CAPABILITIES,readModCatalog} from './kernel-ts/read/mods.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';"
    ].join('\n'),resolveDir:root,sourcefile:'audit-references-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle) await rm(bundle,{recursive:true,force:true});});
const plain=()=>({schema:2,missing:[],findings:[],continuity_review:{verdict:'pass',summary:'Compatible.',conflicts:[]}});
const files=()=>({'context.json':{current_input:'Keep it. Keep it.',intelligibility_review:{requires_review:true},player_address_review:{requires_review:true},
    scene_commitment:{requires_review:true,active:{name:'Office'},moves:[]}},'memory.json':[{statement:'It remains shut.'},{statement:'It remains shut.'}]});
function complete(catalog) {
    const value=plain(); Object.assign(value.continuity_review,{
        intelligibility_review:{verdict:'pass',source:null},player_address_review:{verdict:'pass',source:null},
        locus_review:{verdict:'pass',mode:'same_locus',locus_source:null,claim_source:null,basis:'active_scene'},
        ...(catalog.sources.speech.length ? {speech_review:{verdict:'pass',lines:catalog.sources.speech.map(v=>({source:v.alias,verdict:'pass',reason:'A complete spoken statement.'}))}} : {})
    }); return value;
}
test('pinned draft/input/evidence/speech duplicates have separate occurrences and exact Unicode',()=>{
    const text='“e\u0301😀”.\r\n“e\u0301😀”.\r\n{{say:A}}Equal {{roll:x}} words.{{/say}} {{say:A}}Equal  words.{{/say}}';
    const source=files(), request={input:{text}}, catalog=api.buildAuditReferences(request,source);
    assert.deepEqual(catalog.speechTexts,['Equal  words.','Equal  words.']);
    assert.deepEqual(catalog.sources.speech.map(v=>v.alias),['speech:0','speech:1']);
    assert.equal(catalog.sources.draft.slice(0,2).map(v=>v.text).join(''),'“e\u0301😀”.\r\n“e\u0301😀”.\r\n');
    const bindings=api.auditEvidenceBindings(source).filter(v=>v.file==='memory.json');
    assert.deepEqual(bindings.map(v=>v.path),[['0','statement'],['1','statement']]);
    assert.notEqual(bindings[0].alias,bindings[1].alias);
    request.input.text='Changed'; source['memory.json'][0].statement='Changed';
    assert.equal(catalog.resolve(bindings[0].alias,['evidence']).text,'It remains shut.');
    assert.equal(catalog.resolve('speech:0',['speech']).text,'Equal  words.');
    assert.throws(()=>catalog.resolve('speech:0',['draft']));
    assert.throws(()=>catalog.resolve('speech:200',['speech']));
    assert.ok(!JSON.stringify(catalog.sources).includes('selector'));
    const materialized=api.materializeAuditReferences(complete(catalog),catalog);
    assert.deepEqual(materialized.errors,[]);
    assert.deepEqual(api.continuityArtifactErrors(materialized.value,text,files(),catalog.speechTexts),[]);
});
test('surrogate boundaries, CRLF, empty and long fields retain exact spans',()=>{
    const text='a'.repeat(999)+'😀\r\n'+'b'.repeat(1100), request={input:{text}};
    const catalog=api.buildAuditReferences(request,{'memory.json':[{statement:text,id:'private-id',path:'/private'}]});
    assert.equal(catalog.sources.draft.map(v=>v.text).join(''),text);
    assert.equal(api.auditEvidenceBindings({'memory.json':[{statement:text}]}).map(v=>v.text).join(''),text);
    assert.ok(catalog.sources.evidence.every(v=>v.text !== 'private-id' && v.text !== '/private'));
    assert.deepEqual(api.buildAuditReferences({input:{text:''}},{}).sources.draft,[]);
});
test('all copy fields materialize while adverse selections are never silently dropped',()=>{
    const text='The door opens. You arrive elsewhere.', source=files();
    source['context.json'].outcome_commitments={requires_review:true};
    source['context.json'].causal_reentry={mode:'clarify_known',known:[{name:'Ledger',relation:'supports'}]};
    source['effective.json']={graph:{nodes:[{node_kind:'scene',name:'Cellar'}]}};
    const catalog=api.buildAuditReferences({input:{text},unregistered_equipment:[{name:'Key'}]},source), value=complete(catalog);
    value.missing=[{subject:'object:0',category:'item',reason:'Registration required.'}];
    value.findings=[{reason:'The claim is unsupported.',fix:'Retain the closed door.'}];
    Object.assign(value.continuity_review,{verdict:'revise',conflicts:[{claim_source:'draft:0',reason:'The door is closed.',evidence_sources:['memory:1']}],
        intelligibility_review:{verdict:'revise',source:'draft:1'},player_address_review:{verdict:'revise',source:'draft:1'},
        outcome_review:{verdict:'revise',basis:'unsupported_positive_result',claim_sources:['draft:0']},
        locus_review:{verdict:'revise',mode:'new_locus',basis:'none',locus_source:'scene:0',claim_source:'draft:1'},
        reentry_review:{verdict:'pass',basis:'acquired_clarification',source:'draft:0',evidence_source:'known:0'}});
    const result=api.materializeAuditReferences(value,catalog);
    assert.deepEqual(result.errors,[]);
    assert.deepEqual(api.continuityArtifactErrors(result.value,text,source,catalog.speechTexts),[]);
    assert.equal(result.value.missing[0].name,'Key');
    assert.equal(result.value.continuity_review.conflicts[0].evidence[0].quote,'It remains shut.');
    assert.equal(result.value.continuity_review.locus_review.locus,'Cellar');
    assert.equal(result.value.continuity_review.reentry_review.clue,'Ledger');
    for(const mutate of [v=>{v.continuity_review.conflicts[0].claim_source='input:0';},v=>{v.continuity_review.conflicts[0].claim='Copied';},
        v=>{delete v.continuity_review.intelligibility_review.source;},v=>{v.continuity_review.conflicts[0].evidence_sources=['memory:0','memory:0'];},
        v=>{v.missing[0].subject='object:99';},v=>{v.continuity_review.outcome_review.claim_sources=['draft:0','draft:0'];}]) {
        const bad=structuredClone(value);mutate(bad);const refused=api.materializeAuditReferences(bad,catalog);
        assert.ok(refused.errors.length);assert.equal(refused.value,undefined);
    }
});
test('speech coverage is complete ordered and adverse aggregate consistency remains enforced',()=>{
    const text='{{say:A}}Same.{{/say}}{{say:A}}Same.{{/say}}', source=files(), catalog=api.buildAuditReferences({input:{text}},source);
    for(const sequence of [['speech:0'],['speech:1','speech:0'],['speech:0','speech:0'],['speech:0','draft:0'],['speech:0','speech:8']]) {
        const value=complete(catalog);value.continuity_review.speech_review.lines=sequence.map(source=>({source,verdict:'pass',reason:'Clear.'}));
        assert.ok(api.materializeAuditReferences(value,catalog).errors.length);
    }
    const adverse=complete(catalog);adverse.continuity_review.speech_review={verdict:'revise',lines:[{source:'speech:0',verdict:'revise',reason:'Missing relation.'},{source:'speech:1',verdict:'pass',reason:'Clear.'}]};
    const canonical=api.materializeAuditReferences(adverse,catalog).value;
    const errors=api.continuityArtifactErrors(canonical,text,source,catalog.speechTexts);
    assert.ok(errors.some(v=>v.path==='/findings'));assert.ok(errors.some(v=>v.path==='/continuity_review/verdict'));
});
test('legacy location and current-input reentry select exact host fields',()=>{
    const source={'context.json':{current_input:'I understand.',location_authority:{requires_review:true,current_scene:'Office',move_receipts:[]},
        causal_reentry:{mode:'clarify_known',known:[{name:'Ledger',relation:'supports'}]}}};
    const catalog=api.buildAuditReferences({input:{text:'You remain.'}},source), value=plain();
    Object.assign(value.continuity_review,{location_review:{verdict:'pass',basis:'current_scene',current_scene_source:'scene:active',asserted_elsewhere_sources:[]},
        reentry_review:{verdict:'pass',basis:'player_discharge',source:'input:0',evidence_source:'known:0'}});
    const result=api.materializeAuditReferences(value,catalog);assert.deepEqual(result.errors,[]);
    assert.deepEqual(api.continuityArtifactErrors(result.value,'You remain.',source,catalog.speechTexts),[]);
    value.continuity_review.reentry_review.source='draft:0';assert.ok(api.materializeAuditReferences(value,catalog).errors.length);
});
test('equal reentry names preserve the selected relation and reject cross-basis aliases',()=>{
    const source={'context.json':{current_input:'I understand.',causal_reentry:{mode:'clarify_known',
        known:[{name:'Ledger',relation:'supports'},{name:'Ledger',relation:'contradicts'}],bridge:{clue:'Ledger',relation:'contradicts'}}}};
    const catalog=api.buildAuditReferences({input:{text:'You understand.'}},source),value=plain();
    value.continuity_review.reentry_review={verdict:'pass',basis:'player_discharge',source:'input:0',evidence_source:'known:1'};
    const result=api.materializeAuditReferences(value,catalog);assert.deepEqual(result.errors,[]);
    assert.equal(result.value.continuity_review.reentry_review.relation,'contradicts');
    assert.deepEqual(api.continuityArtifactErrors(result.value,'You understand.',source,catalog.speechTexts),[]);
    value.continuity_review.reentry_review.evidence_source='bridge';assert.ok(api.materializeAuditReferences(value,catalog).errors.length);
});
test('v1 remains unchanged and both package capabilities are advertised',()=>{
    assert.ok(api.MOD_CAPABILITIES.has('audit.continuity.v1'));assert.ok(api.MOD_CAPABILITIES.has('audit.continuity.v2'));
    const v1={missing:[],findings:[],continuity_review:{verdict:'pass',summary:'Compatible.',conflicts:[]}}, retained=JSON.stringify(v1);
    assert.deepEqual(api.continuityArtifactErrors(v1,'A quiet room.',{}),[]);assert.equal(JSON.stringify(v1),retained);
    assert.ok(api.materializeAuditReferences(v1,api.buildAuditReferences({input:{text:'A quiet room.'}},{})).errors.length);
});
test('real kernel v2 jobs retain selectors, materialize acceptance, replay and reject stale evidence',async()=>{
    const base=join(root,'.coc/playtests/jev-audit-reference-contracts');await mkdir(base,{recursive:true});
    const home=await mkdtemp(join(base,'suite-'));
    await writeFile(join(home,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
    const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'audit-source-selectors',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    const runtime=api.createKernelRuntime(context);
    try {
        const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
        // A separately versioned fixture makes capability selection independent of the shipped version.
        const packageRoot=join(home,'selector-package');await cp(join(root,'mods/narration-audit'),packageRoot,{recursive:true});
        const manifest=JSON.parse(await readFile(join(packageRoot,'mod.json'),'utf8'));
        manifest.id='selector-audit-fixture';manifest.version='1.0.0';manifest.requires=manifest.requires.filter(v=>!v.startsWith('audit.continuity.')).concat('audit.continuity.v2');
        manifest.default_enabled=true;manifest.contributes.audit_slot='narration-audit';
        await writeFile(join(packageRoot,'mod.json'),JSON.stringify(manifest));
        await writeFile(join(packageRoot,'auditor.md'),'Schema 2 selector contract fixture. No model is invoked.');await call('mods.install',{path:packageRoot});
        const legacy={...manifest,version:'0.9.0',requires:manifest.requires.map(v=>v==='audit.continuity.v2'?'audit.continuity.v1':v)};
        await writeFile(join(packageRoot,'mod.json'),JSON.stringify(legacy));await call('mods.install',{path:packageRoot});
        api.MOD_CAPABILITIES.delete('audit.continuity.v2');
        try {
            const old=await api.readModCatalog(context);
            assert.equal(old.get('selector-audit-fixture\0'+'0.9.0').compatible,true);
            assert.equal(old.get('selector-audit-fixture\0'+'1.0.0').compatible,false);
        } finally {api.MOD_CAPABILITIES.add('audit.continuity.v2');}

        await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
        await call('table.open');
        await call('table.player_input',{text:'I wait and listen.'});
        const text='{{say:Knott}}The house stands empty.{{/say}} {{say:Knott}}The house stands empty.{{/say}}';
        const job=await call('mods.job',{role:'audit',input:{text}});
        assert.equal(job.continuity_schema,2);assert.equal(job.focus.sources.speech.length,2);
        const request=JSON.parse(await readFile(join(job.cwd,'request.json'),'utf8')), evidence={};
        for(const file of request.continuity_review.files) evidence[file]=JSON.parse(await readFile(join(job.cwd,file),'utf8'));
        const catalog=api.buildAuditReferences(request,evidence), artifact=complete(catalog);
        await writeFile(join(job.cwd,'result.json'),JSON.stringify(artifact));
        const accepted=await call('mods.accept',{job:job.job});
        assert.equal(accepted.schema,undefined);assert.equal(accepted.continuity_review.speech_review.lines[0].quote,'The house stands empty.');
        assert.equal(JSON.parse(await readFile(join(job.cwd,'result.json'),'utf8')).schema,2);
        assert.deepEqual(await call('mods.accept',{job:job.job}),accepted);
        const tampered=structuredClone(accepted);tampered.continuity_review.summary='Changed accepted artifact.';
        await writeFile(join(job.cwd,'accepted.json'),JSON.stringify(tampered));
        await assert.rejects(call('mods.accept',{job:job.job}),/differs from its pinned raw selectors/);
        await writeFile(join(job.cwd,'accepted.json'),JSON.stringify(accepted));
        // §130.8: the kernel's own accept moves top-level subreviews into place, as submit_audit does.
        const placedJob=await call('mods.job',{role:'audit',input:{text:'{{say:Knott}}The keys are yours.{{/say}}'}});
        const placedRequest=JSON.parse(await readFile(join(placedJob.cwd,'request.json'),'utf8')), placedEvidence={};
        for(const file of placedRequest.continuity_review.files) placedEvidence[file]=JSON.parse(await readFile(join(placedJob.cwd,file),'utf8'));
        const nested=complete(api.buildAuditReferences(placedRequest,placedEvidence)), {verdict,summary,conflicts,...subreviews}=nested.continuity_review;
        const topLevel={...nested,continuity_review:{verdict,summary,conflicts},...subreviews};
        assert.ok(Object.keys(subreviews).length);
        await writeFile(join(placedJob.cwd,'result.json'),JSON.stringify(topLevel));
        const placed=await call('mods.accept',{job:placedJob.job});
        assert.equal(placed.continuity_review.speech_review.lines[0].quote,'The keys are yours.');
        for(const key of Object.keys(subreviews)) assert.equal(Object.hasOwn(placed,key),false);
        await call('table.apply',{call_id:'t0-c1',effects:[{kind:'time',minutes:1,why:'A chosen wait'}]});
        await assert.rejects(call('mods.accept',{job:job.job}),error=>error.details?.reason==='mod_audit_stale');
    } finally {await runtime.close();}
});
