/** Player-facing text for an immutable card. Numeric cells never enter the model. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runReader,type ReaderRequest,type ReaderOutcome} from './reader.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const prompt=join(root,'content/setup/character-presentation.md');
export const CARD_TEXT = ['Character draft','Character draft — reply to confirm or describe changes.',
  'Parameter','Value','Half','Fifth','Skills','Finance','Background','Language','Key connection',
  'Equipment','Weapons','Occupation unspent','Interest unspent','Preview unavailable','Retry',
  'cash','assets','spending','credit_rating','living_standard','damage','range','attacks','ammo','malfunction','skill','Yes','No'];
type Row=Record<string,any>;
export function cardTexts(sheet:Row):string[] {
  const texts=new Set(CARD_TEXT);
  const add=(value:unknown)=>{if(typeof value==='string'&&value.trim()&&!/^(?=.*\d)[\d\s()+\-*/Dd×.,]+$/.test(value))texts.add(value)};
  for(const key of ['occupation','era','own_language'])add(sheet[key]);
  for(const group of ['characteristics','derived','skills'])for(const [key,value] of Object.entries(sheet[group]||{})){add(key);if(group==='derived')add(value)}
  for(const [key,value] of Object.entries(sheet.backstory||{})){add(key);add(value)}
  add(sheet.key_connection?.summary);
  for(const item of sheet.equipment||[])add(item);
  for(const weapon of sheet.weapons||[])for(const [key,value] of Object.entries(weapon)){add(key);if(Array.isArray(value))value.forEach(add);else add(value)}
  add(sheet.finance?.living_standard);
  for(const key of ['cash','assets','spending_level'])add(sheet.finance?.[key]?.currency);
  return [...texts].sort();
}
export function validatePresentation(value:unknown,texts:string[]):Record<string,string> {
  const map=(value as Row)?.texts;
  if(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).length!==texts.length||texts.some(t=>typeof map[t]!=='string'||!map[t].trim()))throw new Error('Incomplete card presentation');
  return Object.fromEntries(texts.map(t=>[t,map[t]]));
}
export async function prepareCharacterPresentation(options:{home:string;campaign:string;revision:number;play_language:string;model?:string;thinking?:string;known_labels?:Record<string,string>;signal?:AbortSignal;runner?:(r:ReaderRequest)=>Promise<ReaderOutcome>}):Promise<Row> {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.campaign)||!Number.isSafeInteger(options.revision)||options.revision<1||!['zh-Hans','en'].includes(options.play_language))throw new Error('Invalid presentation request');
  const draft=JSON.parse(await readFile(join(options.home,'.coc/campaigns',options.campaign,'setup/drafts',`${options.revision}.json`),'utf8'));
  if(draft.play_language!==options.play_language)throw new Error('Draft language does not match the session');
  const texts=cardTexts(draft.sheet), instructions=await readFile(prompt,'utf8');
  const known=Object.fromEntries(Object.entries(options.known_labels||{}).filter(([key])=>texts.includes(key)));
  const fingerprint=createHash('sha256').update(JSON.stringify([options.play_language,texts,known,instructions])).digest('hex');
  const directory=join(options.home,'.coc/character-presentations',fingerprint),accepted=join(directory,'accepted.json');
  const deliver=async(map:Record<string,string>)=>{
    const result={play_language:options.play_language,texts:{...map,...known}};
    const folder=join(options.home,'.coc/campaigns',options.campaign,'setup/presentations');await mkdir(folder,{recursive:true});
    const temp=join(folder,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(result));await rename(temp,join(folder,`${options.revision}-${options.play_language}.json`));return result;
  };
  try {const cached=JSON.parse(await readFile(accepted,'utf8'));return await deliver(validatePresentation(cached,texts))}catch{/* Missing projections are generated without modifying the card. */}
  const attempt=join(directory,'attempts',randomUUID());await mkdir(attempt,{recursive:true});
  await writeFile(join(attempt,'texts.json'),JSON.stringify({play_language:options.play_language,texts,known_labels:known},null,2));
  const outcome=await (options.runner||runReader)({cwd:attempt,systemPrompt:prompt,model:options.model,thinking:options.thinking,signal:options.signal,eventLog:join(attempt,'events.jsonl'),timeoutMs:120000,brief:'Read texts.json and write the complete player-facing text projection to presentation.json.'});
  if(!outcome.ok||options.signal?.aborted)throw new Error('Card presentation could not be prepared');
  const result={texts:validatePresentation(JSON.parse(await readFile(join(attempt,'presentation.json'),'utf8')),texts)};
  const temporary=join(directory,randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(result,null,2));await rename(temporary,accepted);
  return deliver(result.texts);
}
