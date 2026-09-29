/**
 * A stand-in for the tool-enabled Pi child that reads a pictured handout (contract §155).
 *
 * It is launched exactly as the real child is -- through the worker's node launcher, with the child's own argv and the
 * attempt directory as its working directory -- and does what the instruction files ask of a model: opens the image the
 * host copied, writes `transcription.json`, or reads `request.json` and writes `result.json`, then runs the host's own
 * `node check.mjs`. It records what it was launched with and which picture it saw, and decides nothing about language.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2),flag=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const files=readdirSync('.');
const record={model:flag('--model'),thinking:flag('--thinking'),tools:flag('--tools')};
if(files.includes('request.json')){
  const packet=JSON.parse(readFileSync('request.json','utf8'));
  const [title,text]=[packet.parts.title,packet.parts.text].map(alias=>packet.sources.find(source=>source.alias===alias));
  const shown=source=>({source:source.alias,action:'translate',text:`[${packet.play_language}] ${source.text}`});
  writeFileSync('result.json',JSON.stringify({protocol:packet.protocol,texts:[shown(title),shown(text)]}));
  Object.assign(record,{phase:'projection',known_names:packet.known_names??null});
}else{
  const image=files.find(name=>name.startsWith('image.'));
  writeFileSync('transcription.json',JSON.stringify({blocks:[{role:'headline',text:'PRINTED HEADLINE'},{role:'body',text:'Printed body, line one.'}]}));
  Object.assign(record,{phase:'transcription',image,seen_sha256:createHash('sha256').update(readFileSync(image)).digest('hex')});
}
execFileSync(process.execPath,['check.mjs'],{stdio:'inherit'});
writeFileSync('launch-argv.json',JSON.stringify(record));
