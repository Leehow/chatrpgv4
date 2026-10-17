// Deterministic task transport fixture, never gameplay evidence.
import {readFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('task.json','utf8'));
if(Object.keys(packet).some(key=>!['play_language','scene','narrative_content','npc_turns','writing','player_input','investigator_names'].includes(key)))throw Error('Unexpected author context');
if(packet.player_input!==undefined&&typeof packet.player_input!=='string')throw Error('Invalid current player input');
if(packet.investigator_names!==undefined&&(!Array.isArray(packet.investigator_names)||!packet.investigator_names.every(name=>typeof name==='string')))throw Error('Invalid investigator names');
const text='{{public}}{{say:Steven Knott}}I can meet you at noon.{{/say}}';
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text}]}})+'\n');
