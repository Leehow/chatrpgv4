import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {readTextToolCalls, textToolCallFix, textToolCalls} from '../../extensions/kernel/text-tool-call.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {openTable, waitForIdle, customMessages, assistantTexts} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';

const prose = 'You name the address. The clerk slides the register across the counter.\n\nThe ink is still wet.';
const envelope = JSON.stringify({narrate:{text:prose}});
const fenced = '```json\n'+envelope+'\n```';
test('only a complete, schema-valid, single registered call is routed', () => {
    for (const value of [envelope,fenced]) assert.deepEqual(textToolCalls(value,COC_TOOLS),[{name:'narrate',arguments:{text:prose}}]);
    for (const value of ['Some prose\n'+fenced,JSON.stringify({narrate:{text:prose,extra:true}}),JSON.stringify({narrate:{text:12}}),
        JSON.stringify({narrate:{}}),JSON.stringify({narrate:{text:prose},apply:{effects:[]}}),JSON.stringify({unknown:{text:prose}}),
        '```json\n'+envelope]) assert.equal(textToolCalls(value,COC_TOOLS),undefined,value);
    // §160.4 amends §158.7 here: an array of envelopes is the same call list as consecutive fences.
    assert.deepEqual(textToolCalls('[{"narrate":{"text":"hello"}}]',COC_TOOLS),[{name:'narrate',arguments:{text:'hello'}}]);
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

// ---------------------------------------------------------------------------------------------------------
// §160.4: a label, a JSON array and `parameters` are forms of the same call list; a list that cannot be routed is
// still a list, and it never reaches the player. The recorded message is un-V3-20261004 kernel turn 7 (grok-build/
// grok-4.5, thinking low, stop), verbatim from its event log: the host closed the turn on it and the player read it.
// ---------------------------------------------------------------------------------------------------------

const LIST = JSON.parse(readFileSync(join(import.meta.dirname,'fixtures','text-tool-call-list-20261004.json'),'utf8'));
const lookups = JSON.parse(LIST.text.slice(LIST.text.indexOf('['))).map(item=>item.parameters);
const look = {focus:'scene'};
const named2 = (name,args,key='arguments') => JSON.stringify({name,[key]:args});

test('§160.4: the recorded message routes as its two lookups, in order, with the arguments it wrote', () => {
    assert.ok(LIST.text.startsWith('mon_calls:['));
    const reading=readTextToolCalls(LIST.text,COC_TOOLS);
    assert.equal(reading?.kind,'calls');
    assert.deepEqual(reading.calls,lookups.map(args=>({name:'lookup',arguments:args})));
    assert.deepEqual(reading.forms,[{label:'mon_calls',array:true,key:'parameters'},{label:'mon_calls',array:true,key:'parameters'}]);
    assert.deepEqual(textToolCalls(' '+LIST.text+'\n',COC_TOOLS),reading.calls,'the leading space the stream carried');
});

test('§160.4: a label, an array and `parameters` each route alone and together, bare and fenced', () => {
    const one=[{name:'look',arguments:look}];
    const two=[{name:'look',arguments:look},{name:'narrate',arguments:{text:prose}}];
    const cases=[
        [named2('look',look,'parameters'),one],
        ['tool_calls: '+named2('look',look),one],
        ['functions.call:\n'+named2('look',look),one],
        ['['+named2('look',look)+','+named2('narrate',{text:prose})+']',two],
        ['['+JSON.stringify({look})+','+named2('narrate',{text:prose},'parameters')+']',two],
        ['calls:'+fence('['+named2('look',look,'parameters')+','+named2('narrate',{text:prose},'parameters')+']'),two],
        [fence('['+named2('look',look)+']')+'\n'+fence(named2('narrate',{text:prose},'parameters')),two],
    ];
    for (const [value,calls] of cases) assert.deepEqual(textToolCalls(value,COC_TOOLS),calls,value);
    assert.deepEqual(readTextToolCalls('x:'+fence(named2('look',look)),COC_TOOLS)?.forms,[{label:'x',array:false,key:'arguments'}]);
    assert.deepEqual(readTextToolCalls(JSON.stringify({look}),COC_TOOLS)?.forms,[{label:null,array:false,key:'tool'}]);
});

test('§160.4: prose, a label that is not an identifier, and the other boundaries are not a call list', () => {
    const list='['+named2('look',look)+']';
    for (const value of [
        'I check: '+list,
        'mon calls:'+list,
        '查询:'+list,
        'a:b:'+list,
        list+' and then I narrate.',
        'mon_calls:'+list+'\nThe clerk looks up.',
        '[]','mon_calls:[]',
        '[['+named2('look',look)+']]',
        '["look"]',
        JSON.stringify({name:'look',arguments:look,id:'call-1'}),
        JSON.stringify({type:'function',function:{name:'look',arguments:JSON.stringify(look)}}),
        JSON.stringify({look:'scene'}),
        '<tool_call>'+named2('look',look)+'</tool_call>',
        'mon_calls:',
        prose,
    ]) assert.equal(readTextToolCalls(value,COC_TOOLS),undefined,value);
});

test('§160.4: a list naming a tool not offered, a wrong type, an extra key or string arguments is unroutable, each envelope with why', () => {
    const cases=[
        ['['+named2('look',look)+','+named2('setup',{step:'start'})+']',['look','setup'],[false,true]],
        [named2('lookup',{kind:'nope'},'parameters'),['lookup'],[true]],
        ['mon_calls:['+named2('look',{...look,extra:1})+']',['look'],[true]],
        [fence(named2('narrate',JSON.stringify({text:prose}))),['narrate'],[true]],
        [JSON.stringify({narrate:{text:12}}),['narrate'],[true]],
        [JSON.stringify({unknown:{text:prose}}),['unknown'],[true]],
    ];
    for (const [value,tools,failed] of cases) {
        const reading=readTextToolCalls(value,COC_TOOLS);
        assert.equal(reading?.kind,'unroutable',value);
        assert.deepEqual(reading.envelopes.map(row=>row.tool),tools,value);
        assert.deepEqual(reading.envelopes.map(row=>typeof row.error==='string'&&row.error.length>0),failed,value);
        assert.equal(textToolCalls(value,COC_TOOLS),undefined,value);
    }
    const fix=textToolCallFix(readTextToolCalls(cases[0][0],COC_TOOLS).envelopes);
    assert.match(fix,/- look: valid, but not run/);
    assert.match(fix,/- setup: setup is not a tool offered here/);
    assert.match(fix,/real tool call/);
    assert.match(textToolCallFix(readTextToolCalls(cases[1][0],COC_TOOLS).envelopes),/- lookup: Validation failed for tool "lookup"/);
});

const engineOptions = (engine) => {
    const hybrid=engine==='hybrid-v1'?createHybridEngine({env:process.env,decision:null}):undefined;
    return hybrid?{runDriver:hybrid.runDriver,extraExtensions:[{name:'coc-hybrid-engine',factory:hybrid.extension}],env:{PI_COC_LOOP_ENGINE:'hybrid-v1'}}:{};
};
const recordedMessage = () => fauxAssistantMessage([{type:'thinking',thinking:'The player orders and asks the owner his name.'},{type:'text',text:LIST.text}]);
const shown = (table) => assistantTexts(table.session).join('\n');
const delivered = '你把一块二搁在桌上。瘦削的老板瞥了一眼硬币，没接你的话茬，只朝后厨喊了一声。';

for (const engine of ['legacy','hybrid-v1']) test(`§160.4 on the ${engine} engine: the recorded message runs both lookups, and the player reads the narration that follows them`,async t=>{
    const options=engineOptions(engine);
    const table=await openTable({...options,responses:[recordedMessage(),fauxAssistantMessage([fauxToolCall('narrate',{text:delivered})],{stopReason:'toolUse'})]});
    t.after(()=>table.dispose());
    await table.session.prompt(LIST.player_text);await waitForIdle(table.session,{timeoutMs:60000});
    // The message Pi runs is the calls the text spelled, with the arguments it wrote, and nothing of the text.
    const first=table.session.messages.find(message=>message.role==='assistant');
    assert.deepEqual(first.content.filter(block=>block.type!=='thinking').map(block=>[block.type,block.name,block.arguments]),
        lookups.map(args=>['toolCall','lookup',args]));
    assert.equal(first.stopReason,'toolUse');
    // Both reached the dispatcher's lookup path: the source question went to the reading host (§22) on both engines.
    // The fake host has no checked answer and says stop; legacy goes on to the catalog search, the driven engine stops
    // the batch there, as it does for a native call.
    const read=table.kernelRequests().find(request=>request.method==='module.read.request');
    assert.equal(read?.params.question,lookups[0].question);
    const catalog=table.kernelRequests().filter(request=>request.method==='table.lookup');
    assert.deepEqual(catalog.map(request=>request.params.query),engine==='legacy'?[lookups[1].query]:[]);
    const narrates=table.kernelRequests().filter(request=>request.method==='table.narrate');
    assert.deepEqual(narrates.map(request=>[request.params.text,!!request.params.implicit]),[[delivered,false]]);
    assert.deepEqual(table.telemetry().filter(row=>row.reason==='text_tool_call_routed').map(row=>[row.tool,row.label,row.array,row.key]),
        [['lookup','mon_calls',true,'parameters'],['lookup','mon_calls',true,'parameters']]);
    assert.equal(/mon_calls|"parameters"/.test(shown(table)),false);
    assert.equal(table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='lookup').length,2);
});

test('§160.4 with the emitted kernel: the turn record holds the narration, not the list', async t=>{
    const campaign='text-call-list';
    const table=await openTable({realKernel:true,campaign,env:{PI_COC_SPEECH_STEER:'0'},responses:[
        fauxAssistantMessage([fauxToolCall('look',{})],{stopReason:'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate',{text:'The room is quiet. The clerk waits by the counter.'})],{stopReason:'toolUse'}),
        recordedMessage(),
        fauxAssistantMessage([fauxToolCall('narrate',{text:delivered})],{stopReason:'toolUse'}),
    ]});
    t.after(()=>table.dispose());assert.deepEqual(table.extensionsResult.errors,[]);await waitForIdle(table.session,{timeoutMs:60000});
    await table.session.prompt(LIST.player_text);await waitForIdle(table.session,{timeoutMs:60000});
    const record=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns',campaign,'turns/0001.json'),'utf8'));
    assert.equal(record.text,delivered);
    assert.equal(/mon_calls|"parameters"/.test(record.rendered_text),false);
    assert.equal(table.telemetry(campaign).filter(row=>row.reason==='text_tool_call_routed').length,2);
    assert.equal(table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='lookup').length,2);
});

const UNROUTABLE = 'mon_calls:['+named2('lookup',{kind:'nope',query:'The Last Stop'},'parameters')+']';

for (const engine of ['legacy','hybrid-v1']) test(`§160.4 on the ${engine} engine: an unroutable list is never shown, its fix reaches the Keeper once, and the next message delivers`,async t=>{
    const options=engineOptions(engine);
    const table=await openTable({...options,responses:[fauxAssistantMessage(UNROUTABLE),fauxAssistantMessage([fauxToolCall('narrate',{text:delivered})],{stopReason:'toolUse'})]});
    t.after(()=>table.dispose());
    await table.session.prompt(LIST.player_text);await waitForIdle(table.session,{timeoutMs:60000});
    assert.equal(table.kernelRequests().some(request=>request.method==='table.lookup'),false);
    const narrates=table.kernelRequests().filter(request=>request.method==='table.narrate');
    assert.deepEqual(narrates.map(request=>[request.params.text,!!request.params.implicit]),[[delivered,false]]);
    const row=table.telemetry().find(row=>row.reason==='text_tool_call_unroutable');
    assert.equal(row?.dropped,1);
    assert.deepEqual(row.calls.map(call=>call.tool),['lookup']);
    assert.match(row.calls[0].error,/Validation failed for tool "lookup"/);
    const steers=table.session.messages.filter(message=>JSON.stringify(message.content??'').includes('wrote tool calls as JSON text'));
    assert.equal(steers.length,1);
    assert.match(JSON.stringify(steers[0].content),/lookup: Validation failed/);
    assert.equal(/mon_calls|"parameters"/.test(shown(table)),false);
    assert.ok(shown(table).includes(delivered));
});

for (const engine of ['legacy','hybrid-v1']) test(`§160.4 on the ${engine} engine: with the turn-close steer spent, a second unroutable list is dropped too and nothing is delivered`, async t=>{
    const options=engineOptions(engine);
    const table=await openTable({...options,responses:[fauxAssistantMessage(UNROUTABLE),fauxAssistantMessage(UNROUTABLE)]});
    t.after(()=>table.dispose());
    await table.session.prompt(LIST.player_text);await waitForIdle(table.session,{timeoutMs:60000});
    assert.equal(table.kernelRequests().some(request=>request.method==='table.narrate'||request.method==='table.lookup'),false);
    assert.equal(table.telemetry().filter(row=>row.reason==='text_tool_call_unroutable').length,2);
    assert.equal(/mon_calls|"parameters"/.test(shown(table)),false);
    assert.equal(table.session.messages.filter(message=>JSON.stringify(message.content??'').includes('wrote tool calls as JSON text')).length,1);
    // The driven run names the fix its spent steer could not carry (§135.11 addendum).
    if (engine==='hybrid-v1') assert.ok(table.telemetry().some(row=>row.lane==='turn'&&row.event==='turn_close'&&row.unsent_fix==='text-tool-call'));
});
