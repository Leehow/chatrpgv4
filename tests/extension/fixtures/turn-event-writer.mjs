// Observable author substitute for integration tests, never a Keeper or live-play source.
import {readFileSync,writeFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('task.json','utf8'));
if(JSON.stringify(packet).includes('PRIVATE_'))throw Error('Private material or metadata reached the author');
const selected=packet.materials.filter(item=>packet.required.includes(item.name));
const parts=selected.map(item=>item.kind==='speech'?`{{say:${item.speaker}}}${item.text??item.meaning}{{/say}}`:item.text);
const text=parts.join('\n');
writeFileSync('draft.json',JSON.stringify({version:1,text,coverage:selected.map((item,index)=>({name:item.name,
  quote:process.env.PI_COC_TEST_SHORT_COVERAGE==='1'&&item.kind==='speech'?'office':parts[index],
  ...(process.env.PI_COC_TEST_SHORT_COVERAGE==='1'&&item.kind==='speech'?{occurrence:1}:{})}))}));
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'grok-build',model:'grok-4.5',stopReason:'stop',content:[]}})+'\n');
