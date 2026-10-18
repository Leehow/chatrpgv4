// Deterministic task transport fixture, never gameplay evidence.
import {readFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('task.json','utf8'));
if(Object.keys(packet).some(key=>!['play_language','scene','narrative_content','npc_turns','writing','player_input','investigator_names','settled_actions','decision_context','result'].includes(key)))throw Error('Unexpected author context');
if(packet.settled_actions!==undefined&&(!Array.isArray(packet.settled_actions)||packet.settled_actions.some(row=>row.status!=='committed')))throw Error('Invalid settled actions');
if(packet.player_input!==undefined&&typeof packet.player_input!=='string')throw Error('Invalid current player input');
if(packet.investigator_names!==undefined&&(!Array.isArray(packet.investigator_names)||!packet.investigator_names.every(name=>typeof name==='string')))throw Error('Invalid investigator names');
const speaker=packet.decision_context?.people?.[0]?.ref??'Steven Knott';
const material=packet.decision_context?.settled_results?.materials?.find(row=>row.text==='The office closes at noon.');
const text=material?JSON.stringify({version:1,text:'The notice says the office shuts at midday.',coverage:[{name:material.name,quote:'the office shuts at midday'}]}):'{{public}}{{say:'+speaker+'}}I can meet you at noon.{{/say}}';
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text}]}})+'\n');
