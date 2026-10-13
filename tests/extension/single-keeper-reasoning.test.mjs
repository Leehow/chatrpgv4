/** Real Pi/RunDriver and TS tools; provider substitution observes effort, not live-play quality. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {Type} from 'typebox';
import {fauxAssistantMessage,fauxProvider,fauxToolCall} from '@earendil-works/pi-ai';
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from './pi.mjs';
import thinkingSchedule from '../../extensions/thinking-schedule/index.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {table} from './object-usages-fixture.mjs';

async function reasoningSession(t,{selected='high',profile}={}){
    const prior={mode:process.env.PI_COC_MODE,profile:process.env.PI_COC_TEST_MODEL};
    process.env.PI_COC_MODE='play';
    if(profile)process.env.PI_COC_TEST_MODEL=profile;else delete process.env.PI_COC_TEST_MODEL;
    t.after(()=>{
        if(prior.mode===undefined)delete process.env.PI_COC_MODE;else process.env.PI_COC_MODE=prior.mode;
        if(prior.profile===undefined)delete process.env.PI_COC_TEST_MODEL;else process.env.PI_COC_TEST_MODEL=prior.profile;
    });
    const game=await table(t),levels=[];
    const faux=fauxProvider();
    Object.assign(faux.models[0],{reasoning:true,thinkingLevelMap:{off:null,minimal:'minimal',low:'low',medium:'medium',high:'high'}});
    const stream=faux.provider.streamSimple;
    faux.provider.streamSimple=(model,context,options)=>{levels.push(options?.reasoning??'off');return stream(model,context,options);};
    faux.setResponses([
        fauxAssistantMessage([fauxToolCall('resolve',{})],{stopReason:'toolUse'}),
        fauxAssistantMessage([fauxToolCall('apply',{})],{stopReason:'toolUse'}),
        fauxAssistantMessage('{{public}}The current actions are complete.'),
    ]);
    const modelRuntime=await ModelRuntime.create({authPath:join(game.home,'auth.json'),modelsPath:null,
        modelsStorePath:join(game.home,'models-store.json'),refreshOnCreate:false});
    modelRuntime.registerNativeProvider(faux.provider);
    const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
    const settingsManager=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}});
    const resourceLoader=new DefaultResourceLoader({cwd:game.home,agentDir:join(game.home,'agent'),noContextFiles:true,settingsManager,
        extensionFactories:[{name:'thinking',factory:thinkingSchedule},{name:'driver',factory:engine.extension},
            {name:'ts-tool-boundary',factory:pi=>{
                pi.events.emit('coc:kernel-bridge',{campaign:'c1',call:game.call});
                pi.registerTool({name:'resolve',label:'Resolve',description:'Perform the selected observation using the TS kernel.',parameters:Type.Object({}),
                    async execute(){const result=await game.call('table.resolve',{call_id:game.next(),action:{intent:'investigate',skill:'Spot Hidden',goal:'Notice signs around the desk',method:'Look at the desk'}});
                        return{content:[{type:'text',text:JSON.stringify(result)}],details:result};}});
                pi.registerTool({name:'apply',label:'Apply',description:'Record the selected wait using the TS kernel.',parameters:Type.Object({}),
                    async execute(){const result=await game.apply([{kind:'time',minutes:1,why:'A selected wait.'}]);
                        return{content:[{type:'text',text:JSON.stringify(result)}],details:result};}});
            }}]});
    await resourceLoader.reload();
    const {session,extensionsResult}=await createAgentSession({cwd:game.home,agentDir:join(game.home,'agent'),model:faux.getModel(),modelRuntime,
        thinkingLevel:selected,noTools:'builtin',resourceLoader,sessionManager:SessionManager.inMemory(),settingsManager,runDriver:engine.runDriver});
    t.after(()=>session.dispose());
    assert.deepEqual(extensionsResult.errors,[]);
    await session.bindExtensions({mode:'print'});
    await session.prompt('I inspect the desk, then wait one minute.');
    return{session,levels};
}

test('single Keeper retains the selected effort while judging after real rule and state tools',async t=>{
    const {session,levels}=await reasoningSession(t);
    assert.deepEqual(levels,['high','high','high']);
    assert.equal(session.thinkingLevel,'high');
});

for(const [profile,expected] of [['codex-relay/gpt-6-luna','high'],['grok-build/grok-4.5','low']])
test(`the explicit ${profile} live-test effort overrides selection throughout the single-Keeper turn`,async t=>{
    const {session,levels}=await reasoningSession(t,{selected:'medium',profile});
    assert.deepEqual(levels,[expected,expected,expected]);
    assert.equal(session.thinkingLevel,expected);
});
