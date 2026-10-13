// Legacy deterministic publication fixtures use the new author boundary. Never live-play evidence.
import {readFileSync,writeFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('task.json','utf8'));
const rows=packet.materials.filter(row=>row.name.startsWith('legacy draft:'));
if(!rows.length)throw Error('This fixture only realizes explicitly supplied legacy draft material');
const text=rows.map(row=>row.text).join('');
let start=0;
const coverage=rows.map(row=>{const span={name:row.name,start,end:start+row.text.length};start=span.end;return span;});
writeFileSync('draft.json',JSON.stringify({version:1,text,coverage}));
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'grok-build',model:'grok-4.5',stopReason:'stop',
  content:packet.commands?[]:[{type:'text',text:JSON.stringify({version:1,text,coverage})}]}})+'\n');
