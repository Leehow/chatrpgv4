// Deterministic transport fixture, never a playtest Keeper or acceptance evidence.
import {readFileSync,writeFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('packet.json','utf8'));
if(process.argv.at(-1).startsWith('Independently'))writeFileSync('review.json',JSON.stringify({approved:true,issues:[]}));
else writeFileSync('guidance.json',JSON.stringify({protocol:'setup-guidance-reference-v2',guide:packet.guides[0]?.alias??null,
  handoff:'Continue after introductions.',opening:'A test prologue. What is your name and occupation concept?',advice:'Use the public premise to guide the existing setup conversation.'}));
