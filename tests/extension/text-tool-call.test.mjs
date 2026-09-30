import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {textToolCall} from '../../extensions/kernel/text-tool-call.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {openTable, waitForIdle, customMessages} from './harness.mjs';

const prose = 'You name the address. The clerk slides the register across the counter.\n\nThe ink is still wet.';
const envelope = JSON.stringify({narrate:{text:prose}});
const fenced = '```json\n'+envelope+'\n```';
test('only a complete, schema-valid, single registered call is routed', () => {
    for (const value of [envelope,fenced]) assert.deepEqual(textToolCall(value,COC_TOOLS),{name:'narrate',arguments:{text:prose}});
    for (const value of ['Some prose\n'+fenced,JSON.stringify({narrate:{text:prose,extra:true}}),JSON.stringify({narrate:{text:12}}),
        JSON.stringify({narrate:{}}),JSON.stringify({narrate:{text:prose},apply:{effects:[]}}),JSON.stringify({unknown:{text:prose}}),
        '[{"narrate":{"text":"hello"}}]', '```json\n'+envelope]) assert.equal(textToolCall(value,COC_TOOLS),undefined,value);
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
