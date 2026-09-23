/** Real TS material owners through the context hook and provider conversion. This is not a playtest. */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {supportWire} from './support-agent-helpers.mjs';

const root=resolve(import.meta.dirname,'../..');await mkdir(join(root,'.tmp'),{recursive:true});
const temp=await mkdtemp(join(root,'.tmp/prescreen-loop-request-'));after(()=>rm(temp,{recursive:true,force:true}));
await build({stdin:{resolveDir:root,contents:`
export {installContextPolicy} from './extensions/table/context-runtime.ts';
export {PRESCREEN_TYPE} from './extensions/table/context-policy.ts';
export {publicMaterial} from './extensions/table/prescreen-types.ts';
export {prescreenFollowTargets} from './extensions/table/prescreen-loop.ts';
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {convertToLlm} from './build/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';
`},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);

test('a relationship read discovers new owner material and delivers it in the actual Keeper request',async t=>{
    const home=await mkdtemp(join(temp,'home-')),campaign='adaptive-materials';
    const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:campaign,locks:api.nativeAdvisoryLocks(),
        env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    const runtime=api.createKernelRuntime(context);t.after(()=>runtime.close());
    const call=(method,params={})=>runtime.handlers[method]({campaign,...params});
    await call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
    const opened=await call('table.open');
    const query='Look into the related source material before explaining what this clue establishes.';
    const input=await call('table.player_input',{text:query}),{_context:binding,...capsule}=await call('table.capsule',{rehydrate:true});
    const catalog=await call('table.workspace.read',{query,candidate_limit:48,preselect:{version:2,mode:'catalog',cursor:0,limit:128}});
    let relationIndex=-1,seed,seedEntity;
    for(const candidate of catalog.materials.candidates.filter(row=>row.kind==='graph_entity').slice(0,8)){
        seedEntity=candidate.read.query;
        const focused=await call('table.workspace.read',{query,names:[seedEntity],candidate_limit:48,
            preselect:{version:2,mode:'catalog',entity:seedEntity,cursor:0,limit:128}});
        assert.equal(focused.binding.catalog_revision,catalog.binding.catalog_revision,'focused source navigation retains the original catalog query binding');
        assert(focused.materials.candidates.every(row=>row.kind==='graph_entity'&&row.read.query===seedEntity));
        relationIndex=focused.materials.candidates.findIndex(candidate=>api.prescreenFollowTargets([api.publicMaterial(candidate,'seed')])
            .some(link=>link.relation!=='source_detail'));
        if(relationIndex>=0){seed=focused.materials.candidates[relationIndex];break;}
    }
    assert(seed,'the real source must contain an authored relationship');
    await assert.rejects(call('table.workspace.read',{preselect:{version:2,mode:'check',entity:seedEntity}}),/catalog mode/);
    const target=api.prescreenFollowTargets([api.publicMaterial(seed,'seed')]).find(link=>link.relation!=='source_detail').target;
    const hooks=new Map(),bus=new Map(),events=[],calls=[],decisions=[];
    const oldFlag=process.env.PI_COC_JEV_PRESELECT,oldKey=process.env.TYPESAFE_API_KEY,oldFetch=globalThis.fetch;
    process.env.PI_COC_JEV_PRESELECT='1';process.env.TYPESAFE_API_KEY='request-boundary-test-key';
    let followed=false,read=false;
    globalThis.fetch=async(_url,options)=>{
        const sent=JSON.parse(options.body),state=sent.state??{};decisions.push(structuredClone(state));
        if(!state.operations)return Response.json(supportWire(sent));
        const hasSeed=state.materials?.some(material=>material.label===seed.label);
        const operations=state.operations??[],next=!hasSeed?operations.find(op=>op.tool==='read'&&op.label===seed.label)
            ??operations.find(op=>op.basis?.candidates?.some(candidate=>candidate.label===seed.label))
            :!followed?operations.find(op=>op.tool==='follow'&&op.basis?.target===target)
            :!read?operations.find(op=>op.tool==='read'):undefined;
        if(next?.tool==='follow')followed=true;else if(next?.tool==='read'&&followed)read=true;
        const answers=Object.fromEntries(Object.entries(sent.questions).map(([key,question])=>{
            const candidate=state.candidates?.find(row=>row.name===key);
            const choice=key==='operation'?next?.alias??'finish':key==='coverage'?read?'sufficient':'missing':key==='consistency'?'clear'
                :'skip';
            return [key,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(question.criteria).map(name=>[name,name===choice?1:0]))}];
        }));
        return Response.json({model:sent.model,usage:{input_tokens:10,output_tokens:2},answers});
    };
    api.installContextPolicy({on:(key,fn)=>hooks.set(key,fn),events:{on:(key,fn)=>bus.set(key,fn)},getActiveTools:()=>[],getAllTools:()=>[]},event=>events.push(event));
    const bridgeCall=async(method,params)=>{
        calls.push({method,params:structuredClone(params)});
        // Exercise a real one-entry initial catalog page; the follow tool must discover beyond it.
        if(method==='table.workspace.read'&&params.preselect?.mode==='catalog'&&!params.binding)
            return call(method,{...params,query,names:[seedEntity],candidate_limit:48,preselect:{version:2,mode:'catalog',entity:seedEntity,cursor:relationIndex,limit:1}});
        return call(method,params);
    };
    bus.get('coc:kernel-bridge')({campaign,call:bridgeCall});bus.get('coc:table-open')({campaign,open:opened});
    bus.get('coc:capsule')({capsule,context:binding,epoch:input.epoch??`${campaign}:${binding.turn}`});
    try{
        const projected=await hooks.get('context')({type:'context',messages:[{role:'user',content:query}]},
            {model:{contextWindow:1_000_000},getSystemPrompt:()=>''});
        const packet=projected.messages.find(message=>message.customType===api.PRESCREEN_TYPE);
        assert(packet,JSON.stringify(events));const body=JSON.parse(packet.content);
        assert(!packet.content.includes('graph-unit:'),'host dependency keys stay outside the Keeper packet');
        assert(!JSON.stringify(decisions).includes('graph-unit:'),'the decision model receives semantic context requirements');
        assert(followed,'Jev must choose an owner-issued follow operation');assert(read,'the discovered candidate must then be read');
        assert(calls.some(row=>row.method==='table.workspace.read'&&row.params.binding&&row.params.preselect?.entity===target&&row.params.preselect?.mode==='catalog'));
        assert(body.materials.length>1,'new material must survive final packing');
        assert(body.retrieval?.steps>=2,JSON.stringify(body.retrieval));
        const payload={model:'fixture',input:api.convertToLlm(structuredClone(projected.messages))};
        assert(JSON.stringify(payload).includes(JSON.stringify(packet.content).slice(1,-1)));
        await hooks.get('before_provider_request')({type:'before_provider_request',payload},{});
        assert.equal(events.findLast(event=>event.lane==='prescreen'&&event.event==='delivered')?.delivered,true);
        assert(decisions.some(state=>state.operations?.some(op=>op.tool==='read')&&state.materials?.length));
        assert(!calls.some(row=>['table.resolve','table.apply'].includes(row.method)));
    }finally{
        await hooks.get('session_shutdown')();globalThis.fetch=oldFetch;
        if(oldFlag===undefined)delete process.env.PI_COC_JEV_PRESELECT;else process.env.PI_COC_JEV_PRESELECT=oldFlag;
        if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;
    }
});
