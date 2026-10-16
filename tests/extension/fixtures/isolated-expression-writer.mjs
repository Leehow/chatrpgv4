// Deterministic task transport fixture, never gameplay evidence.
import {readFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('task.json','utf8'));
if(Object.keys(packet).some(key=>!['play_language','scene','narrative_content','npc_turns','writing'].includes(key)))throw Error('Unexpected author context');
const text='{{public}}{{say:Steven Knott}}I can meet you at noon.{{/say}}';
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text}]}})+'\n');
