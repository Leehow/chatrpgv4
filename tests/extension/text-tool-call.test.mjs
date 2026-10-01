import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {textToolCalls} from '../../extensions/kernel/text-tool-call.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {openTable, waitForIdle, customMessages} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';

const prose = 'You name the address. The clerk slides the register across the counter.\n\nThe ink is still wet.';
const envelope = JSON.stringify({narrate:{text:prose}});
const fenced = '```json\n'+envelope+'\n```';
test('only a complete, schema-valid, single registered call is routed', () => {
    for (const value of [envelope,fenced]) assert.deepEqual(textToolCalls(value,COC_TOOLS),[{name:'narrate',arguments:{text:prose}}]);
    for (const value of ['Some prose\n'+fenced,JSON.stringify({narrate:{text:prose,extra:true}}),JSON.stringify({narrate:{text:12}}),
        JSON.stringify({narrate:{}}),JSON.stringify({narrate:{text:prose},apply:{effects:[]}}),JSON.stringify({unknown:{text:prose}}),
        '[{"narrate":{"text":"hello"}}]', '```json\n'+envelope]) assert.equal(textToolCalls(value,COC_TOOLS),undefined,value);
});
for (const spent of [false,true]) test(`real message_end routes fenced narrate with spent steer=${spent}`,async t=>{
    const campaign=spent?'text-call-spent':'text-call';
    const table=await openTable({realKernel:true,campaign,env:{PI_COC_SPEECH_STEER:'0',...(spent?{PI_COC_ADMISSION_MODEL:'nobody/home'}:{})},responses:[
        fauxAssistantMessage([fauxToolCall('look',{})],{stopReason:'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate',{text:'The room is quiet. The clerk waits by the counter.'})],{stopReason:'toolUse'}),
        ...(spent ? [fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'move',to:'newspaper-morgue',via:'Cross the street.'}]})],{stopReason:'toolUse'}),fauxAssistantMessage([{type:'thinking',thinking:'Nothing else.'}])] : []),
        fauxAssistantMessage(fenced),
    ]});t.after(()=>table.dispose());assert.deepEqual(table.extensionsResult.errors,[]);await waitForIdle(table.session,{timeoutMs:60000});
    await table.session.prompt('I tell the clerk the address.');await waitForIdle(table.session,{timeoutMs:60000});
    const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns',campaign,'turns/0001.json'),'utf8'));
    assert.equal(record.text,prose);assert.equal(record.rendered_text.includes('```'),false);
    assert.equal(table.telemetry().filter(row=>row.reason==='text_tool_call_routed').length,1);
    assert.ok(table.session.messages.some(message=>message.role==='toolResult' && message.toolName==='narrate'));
    if(spent)assert.equal(customMessages(table.session,'coc-host').filter(m=>m.details?.kind==='steer').length,1);
});

// ---------------------------------------------------------------------------------------------------------
// §160.2: a body of several fenced envelopes is those calls in written order, and `{name, arguments}` is an envelope.
// The recorded text is grp-a-j2 turn 12 (grok-build/grok-4.5, prose-first prototype), verbatim from its event log.
// ---------------------------------------------------------------------------------------------------------

const RECORDED = JSON.parse(readFileSync(join(import.meta.dirname,'fixtures','serialized-arguments-20261001.json'),'utf8')).text_envelopes[0].text;
const named = JSON.stringify({name:'narrate',arguments:{text:prose}});
const fence = (value) => '```json\n'+value+'\n```';

test('§160.2: {name, arguments} is an envelope, bare or fenced, and a body of fences is its calls in written order', () => {
    for (const value of [named,fence(named)]) assert.deepEqual(textToolCalls(value,COC_TOOLS),[{name:'narrate',arguments:{text:prose}}]);
    const effects=[{kind:'move',to:'newspaper-morgue',via:'Cross the street.'}];
    const both=fence(JSON.stringify({name:'apply',arguments:{effects}}))+'\n'+fence(JSON.stringify({narrate:{text:prose}}));
    assert.deepEqual(textToolCalls(both,COC_TOOLS),[{name:'apply',arguments:{effects}},{name:'narrate',arguments:{text:prose}}]);
    assert.deepEqual(textToolCalls('```\n'+named+'\n```',COC_TOOLS),[{name:'narrate',arguments:{text:prose}}],'a bare fence is a fence');
});

test('§160.2: the recorded body routes as apply and then narrate, the narration with real line breaks', () => {
    const calls=textToolCalls(RECORDED,COC_TOOLS);
    assert.deepEqual(calls?.map(call=>call.name),['apply','narrate']);
    assert.deepEqual(calls[0].arguments.effects.map(effect=>effect.clue),['catholic-wards','nailed-windows']);
    assert.ok(calls[1].arguments.text.startsWith('你把肩抵上后墙那扇门'));
    assert.ok(calls[1].arguments.text.includes('\n\n'));
    assert.equal(calls[1].arguments.text.includes('\\n'),false);
});

test('§160.2: one bad envelope, prose between the fences, an extra key or a non-object arguments routes nothing', () => {
    const good=fence(named);
    for (const value of [
        good+'\nThe clerk looks up.\n'+good,
        'The clerk looks up.\n'+good+'\n'+good,
        good+'\n'+fence(JSON.stringify({name:'unknown',arguments:{text:prose}})),
        good+'\n'+fence(JSON.stringify({name:'narrate',arguments:{text:12}})),
        good+'\n'+fence(JSON.stringify({name:'narrate',arguments:{text:prose,extra:true}})),
        fence(JSON.stringify({name:'narrate',arguments:{text:prose},id:'call-1'})),
        fence(JSON.stringify({name:'narrate',arguments:JSON.stringify({text:prose})})),
        fence(JSON.stringify({name:12,arguments:{text:prose}})),
        good+'\n```json\n'+named,
    ]) assert.equal(textToolCalls(value,COC_TOOLS),undefined,value);
});

for (const engine of ['legacy','hybrid-v1']) test(`§160.2 on the ${engine} engine: the recorded body, as a Keeper's whole message, runs both calls and the player reads the narration, not the fences`,async t=>{
    const hybrid=engine==='hybrid-v1'?createHybridEngine({env:process.env,decision:null}):undefined;
    const table=await openTable({...(hybrid?{runDriver:hybrid.runDriver,extraExtensions:[{name:'coc-hybrid-engine',factory:hybrid.extension}],env:{PI_COC_LOOP_ENGINE:'hybrid-v1'}}:{}),
        responses:[fauxAssistantMessage(RECORDED)]});
    t.after(()=>table.dispose());
    await table.session.prompt('我把门再推一推，看能不能下去。');await waitForIdle(table.session,{timeoutMs:60000});
    const requests=table.kernelRequests().map(request=>request.method).filter(method=>method==='table.apply'||method==='table.narrate');
    assert.deepEqual(requests,['table.apply','table.narrate']);
    const narrate=table.kernelRequests().find(request=>request.method==='table.narrate');
    assert.ok(narrate.params.text.startsWith('你把肩抵上后墙那扇门'));
    assert.equal(/```|"name"|\\n/.test(narrate.params.text),false);
    assert.deepEqual(table.telemetry().filter(row=>row.reason==='text_tool_call_routed').map(row=>row.tool),['apply','narrate']);
});
