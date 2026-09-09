/** Player-facing text for an immutable card. Numeric cells never enter the model. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ReaderRequest,ReaderOutcome} from './reader.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const CARD_TEXT = ['Character draft','Character draft — reply to confirm or describe changes.',
  'Parameter','Value','Skill','Base value','Occupation points','Interest points','Final value','Point allocation','Total points','Spent','Remaining','Skills','Finance','Background','Language','Key connection',
  'Show calculation details','Hide calculation details','Characteristics','Calculation','Rolled value','Dice results','Age adjustment','EDU improvement checks','Keep highest','Base movement','Age movement penalty','Round down','Standard rolled characteristics','Quick-fire array','Equipment','Weapons','Preview unavailable','Retry',
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
export function validateFinanceEquipment(value:unknown,equipment:string[]):string[] {
  const excluded=(value as Row)?.finance_equipment;
  if(!Array.isArray(excluded)||new Set(excluded).size!==excluded.length||excluded.some(name=>typeof name!=='string'||!equipment.includes(name)))throw new Error('Invalid financial equipment projection');
  return excluded;
}
export async function creationRuleDetails(sheet:Row,contentRoot=join(root,'content')):Promise<Row> {
  const trace=sheet.creation?.derived||{}, details:Row={};
  if(typeof trace.MOV==='string') {
    const movement=JSON.parse(await readFile(join(contentRoot,'rulesets/coc7/rules-json/movement-rate.json'),'utf8'));
    const rule=movement.rules.find((row:Row)=>trace.MOV.startsWith(`movement-rate.rules ${row.key} - age penalty `));
    const penalty=sheet.creation?.age?.mov_penalty;
    if(rule&&typeof penalty==='number'&&Math.max(movement.age_penalty.minimum_mov,rule.base_mov-penalty)===sheet.derived?.MOV)
      details.movement={condition:rule.formula.split(' -> ')[0],base:rule.base_mov,penalty};
  }
  const total=typeof trace.DB==='string'?trace.DB.match(/^damage-bonus-build STR\+SIZ=(\d+)$/):null;
  if(total) {
    const rows=JSON.parse(await readFile(join(contentRoot,'rulesets/coc7/rules-json/damage-bonus-build.json'),'utf8'));
    const value=Number(total[1]);
    const row=rows.find((row:Row)=>value>=row.min&&value<=row.max);
    if(row&&row.damage_bonus===sheet.derived?.DB&&row.build===sheet.derived?.BUILD)
      details.damage_bonus={total:value,min:row.min,max:row.max};
  }
  return details;
}
export async function prepareCharacterPresentation(options:TextOptions&{campaign:string;revision:number}):Promise<Row> {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.campaign)||!Number.isSafeInteger(options.revision)||options.revision<1||!['zh-Hans','en'].includes(options.play_language))throw new Error('Invalid presentation request');
  const draft=JSON.parse(await readFile(join(options.home,'.coc/campaigns',options.campaign,'setup/drafts',`${options.revision}.json`),'utf8'));
  if(draft.play_language!==options.play_language)throw new Error('Draft language does not match the session');
  const calculations=await creationRuleDetails(draft.sheet,options.contentRoot);
  const texts=[...new Set([...cardTexts(draft.sheet),...(calculations.movement?[calculations.movement.condition]:[])])].sort();
  const projection=await prepareTexts({...options,equipment:draft.sheet.equipment},texts);
  const result={play_language:options.play_language,...projection,calculations};
  await saveProjection(options,`${options.revision}-${options.play_language}.json`,result);
  return result;
}
type TextOptions={equipment?:string[];home:string;contentRoot?:string;play_language:string;model?:string;thinking?:string;known_labels?:Record<string,string>;signal?:AbortSignal;runner?:(r:ReaderRequest)=>Promise<ReaderOutcome>};
async function saveProjection(options:{home:string;campaign:string},file:string,result:Row) {
  const folder=join(options.home,'.coc/campaigns',options.campaign,'setup/presentations');
  await mkdir(folder,{recursive:true});const temp=join(folder,randomUUID()+'.tmp');
  await writeFile(temp,JSON.stringify(result));await rename(temp,join(folder,file));
}
/** Only already-visible display names enter the model, never the module graph. */
export function standingTexts(view:Row):string[] {
  return [...new Set([view.scene?.display_name||view.scene?.name,...(Array.isArray(view.present)?view.present:[]),view.session?.kind]
    .filter((value):value is string=>typeof value==='string'&&!!value.trim()))].sort();
}
export async function prepareStandingPresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.campaign)||!['zh-Hans','en'].includes(options.play_language))throw new Error('Invalid presentation request');
  if(options.view.play_language!==options.play_language)throw new Error('View language does not match the session');
  const file=`standing-${options.play_language}.json`;
  let previous:Record<string,string>={};
  try {const saved=JSON.parse(await readFile(join(options.home,'.coc/campaigns',options.campaign,'setup/presentations',file),'utf8'));if(saved.play_language===options.play_language)previous=saved.texts||{};}catch{}
  const missing=standingTexts(options.view).filter(text=>typeof previous[text]!=='string'||!previous[text].trim());
  const added=missing.length?(await prepareTexts(options,missing)).texts:{};
  const result={play_language:options.play_language,texts:{...previous,...added}};
  await saveProjection(options,file,result);return result;
}
async function prepareTexts(options:TextOptions,texts:string[]):Promise<{texts:Record<string,string>;finance_equipment:string[]}> {
  const prompt=join(options.contentRoot ?? join(root,'content'),'setup/character-presentation.md');
  const equipment=[...new Set((options.equipment||[]).filter(value=>typeof value==='string'))].sort();
  const instructions=await readFile(prompt,'utf8');
  const known=Object.fromEntries(Object.entries(options.known_labels||{}).filter(([key])=>texts.includes(key)));
  const fingerprint=createHash('sha256').update(JSON.stringify([options.play_language,texts,known,instructions,equipment])).digest('hex');
  const directory=join(options.home,'.coc/character-presentations',fingerprint),accepted=join(directory,'accepted.json');
  try {const cached=JSON.parse(await readFile(accepted,'utf8'));return {texts:{...validatePresentation(cached,texts),...known},finance_equipment:validateFinanceEquipment(cached,equipment)}}catch{/* Missing projections are generated without modifying the card. */}
  const runner=options.runner;
  if(!runner)throw new Error('Character presentation requires its owner runtime');
  const attempt=join(directory,'attempts',randomUUID());await mkdir(attempt,{recursive:true});
  await writeFile(join(attempt,'texts.json'),JSON.stringify({play_language:options.play_language,texts,known_labels:known,equipment},null,2));
  await writeFile(join(attempt,'check.mjs'),`import {readFileSync} from 'node:fs';\nimport {validatePresentation,validateFinanceEquipment} from ${JSON.stringify(import.meta.url)};\ntry {const packet=JSON.parse(readFileSync('texts.json','utf8'));const value=JSON.parse(readFileSync('presentation.json','utf8'));validatePresentation(value,packet.texts);validateFinanceEquipment(value,packet.equipment);console.log('Presentation valid');}catch(error){console.error(error.message);process.exitCode=1;}\n`);
  let result:{texts:Record<string,string>;finance_equipment:string[]}|undefined;
  for(let round=1;round<=2;round++) {
    const outcome=await runner({cwd:attempt,systemPrompt:prompt,model:options.model,thinking:options.thinking,signal:options.signal,eventLog:join(attempt,`events-${round}.jsonl`),timeoutMs:120000,
      brief:'Read texts.json and write the complete player-facing text projection to presentation.json. The file must contain exactly one JSON object, without Markdown or trailing text. Run node --experimental-strip-types check.mjs and correct any error before finishing.'+(round>1?' Read findings.json and repair the retained file; preserve every correct translation.':'')});
    if(!outcome.ok||options.signal?.aborted)throw new Error('Card presentation could not be prepared');
    const bytes=await readFile(join(attempt,'presentation.json'),'utf8');
    await writeFile(join(attempt,`presentation-round-${round}.json`),bytes);
    try {const value=JSON.parse(bytes);result={texts:validatePresentation(value,texts),finance_equipment:validateFinanceEquipment(value,equipment)};break;}
    catch(error){await writeFile(join(attempt,'findings.json'),JSON.stringify({error:String(error)}));if(round===2)throw error;}
  }
  if(!result)throw new Error('Card presentation could not be validated');
  const temporary=join(directory,randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(result,null,2));await rename(temporary,accepted);
  return {...result,texts:{...result.texts,...known}};
}
