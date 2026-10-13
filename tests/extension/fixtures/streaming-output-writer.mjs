// Controlled author transport for integration tests, never gameplay.
import {readFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('task.json','utf8'));
if(JSON.stringify(packet).includes('PRIVATE_STREAM_SECRET'))throw Error('Private material reached author');
const artifact={version:1,text:'The room is chilly.',coverage:[{name:'cold room',quote:'The room is chilly.'}]};
const message={role:'assistant',provider:'grok-build',model:'grok-4.5',stopReason:'stop',content:[{type:'text',text:JSON.stringify(artifact)}]};
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
send({type:'message_start',message:{...message,content:[]}});
send({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'{"version":1,"text":"The room '}});
await new Promise(resolve=>setTimeout(resolve,150));
if(process.env.PI_COC_TEST_STREAM_INTERRUPT==='1')process.exit(1);
send({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'is chilly.","coverage":[{"name":"cold room","quote":"The room is chilly."}]}'}});
send({type:'message_end',message});
