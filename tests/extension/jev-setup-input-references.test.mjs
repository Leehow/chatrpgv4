/** Exact setup source protocol and kernel conformance. No model calls or gameplay acceptance. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {setupUserTextFields,buildSetupInputCatalog,materializeSetupInputs,validateSetupInputs,SETUP_INPUT_LIMITS} from '../../runtime/jev/setup-input-references.ts';
const root=resolve(import.meta.dirname,'../..');let api,bundle;
before(async()=>{await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/setup-input-'));
    await build({stdin:{contents:["export {createKernelContext} from './kernel-ts/context.ts';","export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';","export {createKernelRuntime} from './kernel-ts/registry.ts';"].join('\n'),resolveDir:root,sourcefile:'setup-input-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
const catalog=(epoch='epoch-1',generation=1,text='Alice')=>buildSetupInputCatalog({epoch,generation,branch:'branch-leaf',fields:[{occurrence:'message-1',field:0,text}]});
const selected=(source,field,value,inputKey=source.snapshot.epoch)=>materializeSetupInputs(source,{campaign:'c1',inputKey,values:{[field]:value}});
const whole=source=>({source:source.public.sources[0].alias});

test('only actual user text fields enter the catalog; equal occurrences remain independent',()=>{
    const fields=setupUserTextFields([{type:'message',id:'a',message:{role:'user',content:[{type:'text',text:'Same'},{type:'image',text:'not text',data:'private attachment'},{type:'text',text:'Same'}]}},
        {type:'message',id:'b',message:{role:'assistant',content:'Same'}},{type:'message',id:'c',message:{role:'toolResult',content:'Never source this'}},
        {type:'message',id:'d',message:{role:'user',content:'Same'}}],{occurrence:'pending-user',text:'Same'});
    assert.equal(fields.length,4);assert.deepEqual(fields.map(value=>value.field),[0,2,0,0]);
    const pinned=buildSetupInputCatalog({epoch:'epoch',generation:7,branch:'private-leaf',fields});
    assert.equal(new Set(pinned.public.sources.map(value=>value.alias)).size,4);
    const first=selected(pinned,'profile.name',{source:pinned.public.sources[0].alias}),second=selected(pinned,'profile.name',{source:pinned.public.sources[1].alias});
    assert.equal(first.values['profile.name'],second.values['profile.name']);assert.notEqual(first.envelope.bindings['profile.name'].ref.resource,second.envelope.bindings['profile.name'].ref.resource);
    assert.ok(!JSON.stringify(pinned.public).includes('private-leaf'));assert.ok(!JSON.stringify(pinned.public).includes('private attachment'));
});
test('whole fields and grapheme endpoint selections preserve CRLF, emoji and combining marks exactly',()=>{
    const text='  E\u0301va \u674e 👩‍👩‍👧‍👦\r\n',source=catalog('epoch',1,text),all=selected(source,'profile.name',whole(source));
    assert.equal(all.values['profile.name'],text);const units=source.public.sources[0].units;
    assert.ok(units.some(unit=>unit.text==='E\u0301'));assert.ok(units.some(unit=>unit.text==='👩‍👩‍👧‍👦'));assert.ok(units.some(unit=>unit.text==='\r\n'));
    const unit=units.find(value=>value.text==='E\u0301'),range={source:whole(source).source,range:{first:unit.alias,last:unit.alias}};
    const exact=selected(source,'profile.name',range);assert.equal(exact.values['profile.name'],'E\u0301');
    assert.deepEqual(validateSetupInputs(exact.envelope,{campaign:'c1',inputKey:'epoch',values:exact.values}),exact.envelope);
    const split=structuredClone(exact.envelope);split.bindings['profile.name'].ref.selector.start++;
    assert.throws(()=>validateSetupInputs(split,{campaign:'c1',inputKey:'epoch',values:{'profile.name':'\u0301'}}),/split_setup_input_grapheme/);
    assert.throws(()=>selected(source,'profile.name',{source:whole(source).source,range:{first:units.at(-1).alias,last:units[0].alias}}));
    assert.throws(()=>selected(source,'profile.name',{source:whole(source).source,range:{first:'input:other/u:0',last:unit.alias}}));
});
test('§98 addendum 7 (SL-66) a selected name range stops at the word, never at the punctuation or space after/before it',()=>{
    // The b10 setup turn-4 fixture: "...名字叫雷·卡特，现在就做卡吧。" -- the selected range's last grapheme was the
    // sentence's own trailing comma, one past the name's own last character.
    const sentence='别人常找我跟丢了的人的线索，追踪失踪人口是我的老本行。名字叫雷·卡特，现在就做卡吧。';
    const source=catalog('name-epoch',4,sentence),units=source.public.sources[0].units;
    const nameStart=units.findIndex(unit=>unit.text==='雷'),nameEnd=units[nameStart+3],comma=units[nameStart+4];
    assert.deepEqual([nameEnd.text,comma.text],['特','，'],'the fixture: the grapheme right after the name is the trailing comma');
    const trimmed=selected(source,'profile.name',{source:whole(source).source,range:{first:units[nameStart].alias,last:comma.alias}});
    assert.equal(trimmed.values['profile.name'],'雷·卡特','the trailing comma never enters the stamped name');
    assert.deepEqual(validateSetupInputs(trimmed.envelope,{campaign:'c1',inputKey:'name-epoch',values:trimmed.values}),trimmed.envelope,'the recorded ref is the trimmed range: re-validation agrees without re-trimming');
    // A range ending on a letter (no trailing punctuation to trim) is unchanged.
    const clean=selected(source,'profile.name',{source:whole(source).source,range:{first:units[nameStart].alias,last:nameEnd.alias}});
    assert.equal(clean.values['profile.name'],'雷·卡特');
    assert.deepEqual(clean.envelope.bindings['profile.name'].ref.selector,trimmed.envelope.bindings['profile.name'].ref.selector,'a clean range and a trimmed one land on the identical ref');
    // Leading punctuation and space are trimmed too, not only trailing.
    const leading=catalog('leading-epoch',1,'  ，雷·卡特，'),leadUnits=leading.public.sources[0].units;
    const leadTrimmed=selected(leading,'profile.name',{source:whole(leading).source,range:{first:leadUnits[0].alias,last:leadUnits.at(-1).alias}});
    assert.equal(leadTrimmed.values['profile.name'],'雷·卡特');
    // A range that is wholly punctuation/space has no word to bound to: it is left exactly as selected, not emptied.
    const blank=catalog('blank-epoch',1,'，， ，'),blankUnits=blank.public.sources[0].units;
    const blankResult=selected(blank,'profile.name',{source:whole(blank).source,range:{first:blankUnits[0].alias,last:blankUnits.at(-1).alias}});
    assert.equal(blankResult.values['profile.name'],'，， ，');
    // A whole-field selection (no range) and every `pending_action` selection keep T14's exact-bytes contract unamended.
    const untouched=selected(catalog('untouched-epoch',1,sentence),'profile.name',whole(catalog('untouched-epoch',1,sentence)));
    assert.equal(untouched.values['profile.name'],sentence,'a whole-field profile.name selection is never trimmed');
    const actionSource=catalog('action-epoch',1,'，Open the door，'),actionUnits=actionSource.public.sources[0].units;
    const action=selected(actionSource,'pending_action',{source:whole(actionSource).source,range:{first:actionUnits[0].alias,last:actionUnits.at(-1).alias}});
    assert.equal(action.values['pending_action'],'，Open the door，','pending_action ranges are never trimmed, only profile.name');
});
test('generated authority is name-only, stale epochs and copied strings never become references',()=>{
    const source=catalog(),generated=selected(source,'profile.name',{generated:'Proposed Name'});
    assert.deepEqual(generated.envelope.bindings['profile.name'],{authority:'generated'});
    assert.throws(()=>selected(source,'pending_action',{generated:'Invented action'}));
    assert.throws(()=>selected(source,'profile.name','Alice'));assert.throws(()=>selected(source,'pending_action','Alice'));
    assert.throws(()=>selected(source,'profile.name',{generated:'Alice',...whole(source)}));
    assert.throws(()=>selected(source,'profile.name',whole(source),'new-epoch'));
    assert.throws(()=>selected(catalog('new-epoch',2),'profile.name',whole(source)));
    const valid=selected(source,'pending_action',whole(source));
    assert.throws(()=>validateSetupInputs(valid.envelope,{campaign:'foreign',inputKey:'epoch-1',values:valid.values}));
    assert.throws(()=>validateSetupInputs(valid.envelope,{campaign:'c1',inputKey:'new-epoch',values:valid.values}));
    assert.throws(()=>validateSetupInputs(valid.envelope,{campaign:'c1',inputKey:'epoch-1',values:{pending_action:'Changed'}}));
    const tampered=structuredClone(valid.envelope);tampered.snapshot.fields[0].text='Changed';assert.throws(()=>validateSetupInputs(tampered,{campaign:'c1',inputKey:'epoch-1',values:valid.values}));
});
test('bounded coverage is explicit and omitted or unavailable history is never invented',()=>{
    const bounded=buildSetupInputCatalog({epoch:'e',generation:3,branch:'leaf',fields:[{occurrence:'old',field:0,text:'x'.repeat(SETUP_INPUT_LIMITS.text+1)},{occurrence:'current',field:0,text:'Available'}]});
    assert.deepEqual(bounded.public.coverage,{complete:false,omitted:1,unavailable:false});assert.equal(bounded.public.sources.length,1);
    assert.throws(()=>selected(bounded,'profile.name',{source:'input:3:0'}));
    const unavailable=buildSetupInputCatalog({epoch:'e',generation:4,branch:'restart',fields:[],unavailable:true});
    assert.equal(unavailable.public.coverage.complete,false);assert.deepEqual(unavailable.public.sources,[]);
    assert.throws(()=>selected(unavailable,'profile.name',{source:'input:1:0'}));
    assert.deepEqual(materializeSetupInputs(unavailable,{campaign:'c1',inputKey:'e',values:{}}).values,{});
});
function profile(name){return {name,occupation:'Journalist',age:29,sex:'female',concept:'A cautious local reporter.',own_language:'English',
    occupation_skills:['Art and Craft (Photography)','History','Language (Own)','Library Use','Psychology','Persuade','Spot Hidden','Listen'],interest_skills:['Accounting','Law','First Aid','Drive Auto'],
    backstory:{personal_description:'A practical coat',ideology_beliefs:'Evidence before rumors',significant_people:'An editor friend',scenario_bound:'Meeting Knott about the house'},
    key_connection:{backstory_field:'significant_people',summary:'The editor friend'},equipment:['Notebook','Camera']};}
async function kernelFixture(t){const base=join(root,'.coc/playtests/jev-setup-input-contracts');await mkdir(base,{recursive:true});const home=await mkdtemp(join(base,'suite-'));
    await writeFile(join(home,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
    const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'setup-input',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(context);
    t.after(()=>runtime.close());const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});await call('campaign.create',{id:'c1',module:'the-haunting',play_language:'en'});
    return {home,call,path:join(home,'.coc/campaigns/c1')};}
test('kernel validates before writes and preserves exact names through draft, revision, receipt and handoff',async(t)=>{
    const f=await kernelFixture(t),text='  E\u0301va \u674e 👩‍👩‍👧‍👦\r\n',source=catalog('create-epoch',1,text),bound=selected(source,'profile.name',whole(source));
    const before=await readFile(join(f.path,'campaign.json'),'utf8');
    await assert.rejects(f.call('setup.draft',{profile:profile('Wrong'),input_key:'create-epoch',setup_input:bound.envelope}),error=>error.code==='invalid_params');
    assert.equal(await readFile(join(f.path,'campaign.json'),'utf8'),before);
    const draft=await f.call('setup.draft',{profile:profile(bound.values['profile.name']),input_key:'create-epoch',setup_input:bound.envelope});
    assert.equal(draft.profile.name,text);assert.equal(draft.sheet.name,text);assert.equal(draft.name_source,undefined);
    const saved=JSON.parse(await readFile(join(f.path,'setup/drafts/1.json'),'utf8'));assert.equal(saved.receipt.name,text);assert.equal(saved.name_source.binding.authority,'player_input');
    await assert.rejects(f.call('setup.confirm',{consent:'approved',input_key:'create-epoch',setup_input:materializeSetupInputs(source,{campaign:'c1',inputKey:'create-epoch',values:{}}).envelope}),error=>error.codeDetail==='confirmation_required');
    const resumed=buildSetupInputCatalog({epoch:'revision-epoch',generation:2,branch:'restart',fields:[],unavailable:true}),empty=materializeSetupInputs(resumed,{campaign:'c1',inputKey:'revision-epoch',values:{}});
    const revised=await f.call('setup.revise',{revision:draft.revision,profile:{age:30},input_key:'revision-epoch',setup_input:empty.envelope});assert.equal(revised.sheet.name,text);
    const stored=JSON.parse(await readFile(join(f.path,`setup/drafts/${revised.revision}.json`),'utf8'));assert.deepEqual(stored.name_source,saved.name_source);
    await f.call('setup.prologue',{scene:"Knott's Office",guide:'Steven Knott',text:'The meeting begins.',handoff:'Continue after introductions.'});
    const action='Inspect the 🔒 door.\r\n',confirmSource=catalog('confirm-epoch',3,action),pending=selected(confirmSource,'pending_action',whole(confirmSource));
    await assert.rejects(f.call('setup.confirm',{consent:'approved',input_key:'confirm-epoch',pending_action:action,setup_input:bound.envelope}),error=>error.code==='invalid_params');
    await f.call('setup.confirm',{consent:'approved',input_key:'confirm-epoch',pending_action:pending.values.pending_action,setup_input:pending.envelope});
    const meta=JSON.parse(await readFile(join(f.path,'campaign.json'),'utf8'));assert.equal(meta.setup.receipts.at(-1).name,text);assert.equal(meta.setup.prologue.pending_action,action);assert.equal(meta.setup.pending_action_source.binding.authority,'player_input');
    assert.equal((await f.call('setup.confirm',{consent:'approved',input_key:'old-epoch',setup_input:{version:999}})).replayed,true);
    const handoff=await f.call('setup.complete');assert.equal(handoff.prologue.pending_action,action);assert.equal(handoff.prologue.introduction.name,text);assert.equal(handoff.prologue.pending_action_source,undefined);
    const opened=await f.call('table.open');assert.equal(opened.setup_prologue.pending_action,action);
});
test('legacy RPC names/actions and direct UI confirmation keep their established string protocol',async(t)=>{
    const f=await kernelFixture(t),draft=await f.call('setup.draft',{profile:profile('Legacy Name')});
    await f.call('setup.confirm',{revision:draft.revision,consent:'approved'});assert.equal((await f.call('setup.complete')).status,'ready_for_table');
    const other=await kernelFixture(t),legacy=await other.call('setup.draft',{profile:profile('Old Name')});
    await other.call('setup.confirm',{revision:legacy.revision,consent:'delegated',pending_action:'Inspect the door',player_requests:['Inspect the door next.']});
    assert.equal((await other.call('setup.complete')).prologue.pending_action,'Inspect the door');
});
