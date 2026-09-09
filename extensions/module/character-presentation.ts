/** Player-facing text for an immutable card. Numeric cells never enter the model. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {resourceRootFrom,runtimeEntryUrl} from '../../runtime/deployment.mjs';
import type {ReaderRequest,ReaderOutcome} from './reader.ts';
const root=resourceRootFrom(import.meta.url);
export const CARD_TEXT = ['Character draft','Character draft — reply to confirm or describe changes.',
  'Parameter','Value','Skill','Base value','Occupation points','Interest points','Final value','Point allocation','Total points','Spent','Remaining','Skills','Finance','Background','Language','Key connection',
  'Show calculation details','Hide calculation details','Characteristics','Calculation','Rolled value','Dice results','Age adjustment','EDU improvement checks','Keep highest','Base movement','Age movement penalty','Round down','Standard rolled characteristics','Rolled characteristics assigned to the stated aptitudes','Quick-fire array','Equipment','Weapons','Preview unavailable','Retry',
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
export function prepareStandingPresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  return prepareGrowingPresentation(options,'standing',standingTexts);
}
/**
 * The words an acquired object brings onto the sheet in the language its definition was written
 * in: trait names, units and string values, the state keys the kernel keeps and its closed state
 * words. Names, descriptions and containers are the Keeper's own prose in the play language and
 * stay out; numbers are the kernel's.
 */
export function possessionTexts(view:Row):string[] {
  const texts=new Set<string>();
  const add=(value:unknown)=>{if(typeof value==='string'&&value.trim())texts.add(value)};
  for(const sheet of Array.isArray(view?.investigators)?view.investigators:[])
    for(const object of Array.isArray(sheet?.objects)?sheet.objects:[]) {
      for(const trait of Array.isArray(object?.traits)?object.traits:[]){add(trait?.name);add(trait?.unit);add(trait?.value);}
      const state=object?.state&&typeof object.state==='object'&&!Array.isArray(object.state)?object.state:{};
      for(const [key,value] of Object.entries(state)){if(value===null||value===undefined)continue;add(key);add(value);}
    }
  return [...texts].sort();
}
export function preparePossessionPresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  return prepareGrowingPresentation(options,'possessions',possessionTexts);
}
/** A projection that grows with the table: what its saved file lacks is asked, what it has is kept. */
async function prepareGrowingPresentation(options:TextOptions&{campaign:string;view:Row},kind:string,collect:(view:Row)=>string[]):Promise<Row> {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.campaign)||!['zh-Hans','en'].includes(options.play_language))throw new Error('Invalid presentation request');
  if(options.view?.play_language!==options.play_language)throw new Error('View language does not match the session');
  const file=`${kind}-${options.play_language}.json`;
  let previous:Record<string,string>={};
  try {const saved=JSON.parse(await readFile(join(options.home,'.coc/campaigns',options.campaign,'setup/presentations',file),'utf8'));if(saved.play_language===options.play_language)previous=saved.texts||{};}catch{}
  const missing=collect(options.view).filter(text=>typeof previous[text]!=='string'||!previous[text].trim());
  const added=missing.length?(await prepareTexts(options,missing)).texts:{};
  const result={play_language:options.play_language,texts:{...previous,...added}};
  await saveProjection(options,file,result);return result;
}
/**
 * Every card is drawn from one accumulating per-language vocabulary, not from a per-character
 * projection. A card's strings are overwhelmingly the same strings as the last card's — the UI
 * chrome, the characteristic and skill names, the era, the occupation — and fingerprinting the
 * whole list made every new investigator a full miss, so each draft paid for a fresh translation
 * of ~140 strings before it could be drawn at all. Keyed by language, the second investigator
 * asks for the handful of words that are actually new: their backstory prose and their kit.
 *
 * The instruction digest stays in the file name so editing the prompt still starts a clean
 * vocabulary rather than silently keeping text the old instructions produced.
 */
function vocabularyPath(home: string, language: string, instructions: string): string {
  const digest = createHash('sha256').update(instructions).digest('hex').slice(0, 8);
  return join(home, '.coc/character-presentations', `vocabulary-${language}-${digest}.json`);
}
async function readVocabulary(path: string, language: string): Promise<Record<string,string>> {
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved?.play_language !== language || !saved.texts || typeof saved.texts !== 'object' || Array.isArray(saved.texts)) return {};
    return Object.fromEntries(Object.entries(saved.texts as Row)
      .filter(([, value]) => typeof value === 'string' && value.trim())) as Record<string,string>;
  } catch { return {}; /* An absent or unreadable vocabulary costs a translation, never a wrong word. */ }
}
/** Re-read before writing: another card may have added words while this one was with the model. */
async function mergeVocabulary(path: string, language: string, added: Record<string,string>): Promise<Record<string,string>> {
  const merged = {...await readVocabulary(path, language), ...added};
  await mkdir(dirname(path), {recursive: true});
  const temp = join(dirname(path), randomUUID() + '.tmp');
  await writeFile(temp, JSON.stringify({play_language: language, texts: merged}, null, 2));
  await rename(temp, path);
  return merged;
}
/** Which equipment entries are money rather than belongings depends on the kit, not the character. */
function equipmentPath(home: string, language: string, equipment: string[]): string {
  const key = createHash('sha256').update(JSON.stringify([language, equipment])).digest('hex').slice(0, 32);
  return join(home, '.coc/character-presentations', `equipment-${language}-${key}.json`);
}
/**
 * The words this round got right, whatever it got wrong.
 *
 * `validatePresentation` is the schema the agent's own checker runs, and it is all-or-nothing on
 * purpose: the card may not be drawn from a partial map. That is the wrong rule for the pipeline,
 * where one dropped key used to throw away every other correct translation in the round and, with
 * only two rounds, turn a near-miss into a card that never appears. Accepting what validated and
 * re-asking for the remainder costs the model a word, not the sheet.
 */
export function acceptedTexts(value: unknown, wanted: readonly string[]): Record<string,string> {
  const map = (value as Row)?.texts;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  return Object.fromEntries(wanted.filter(text => typeof map[text] === 'string' && map[text].trim())
    .map(text => [text, map[text] as string]));
}
async function prepareTexts(options:TextOptions,texts:string[]):Promise<{texts:Record<string,string>;finance_equipment:string[]}> {
  const prompt=join(options.contentRoot ?? join(root,'content'),'setup/character-presentation.md');
  const instructions=await readFile(prompt,'utf8');
  const language=options.play_language;
  // Only the card path carries a kit; a standing-name projection has no financial subset to make.
  const wantEquipment=Array.isArray(options.equipment);
  const equipment=[...new Set((options.equipment||[]).filter(value=>typeof value==='string'))].sort();
  const known=Object.fromEntries(Object.entries(options.known_labels||{}).filter(([key])=>texts.includes(key)));
  const vocabularyFile=vocabularyPath(options.home,language,instructions);
  const financeFile=equipmentPath(options.home,language,equipment);
  let vocabulary=await readVocabulary(vocabularyFile,language);
  // Known labels are the kernel's own glossary. They were being sent to the model and then
  // overwritten with the same values on the way back; they are context now, never a question.
  let missing=texts.filter(text=>!known[text]&&!vocabulary[text]);
  let finance:string[]|undefined;
  if(!wantEquipment)finance=[];
  else try {finance=validateFinanceEquipment(JSON.parse(await readFile(financeFile,'utf8')),equipment);}
  catch{/* An uncached kit is asked for once, alongside whatever words are still missing. */}
  const answer=()=>({texts:{...Object.fromEntries(texts.filter(text=>vocabulary[text]).map(text=>[text,vocabulary[text]])),...known},
    finance_equipment:finance!});
  if(!missing.length&&finance)return answer();
  const runner=options.runner;
  if(!runner)throw new Error('Character presentation requires its owner runtime');
  const attempt=join(options.home,'.coc/character-presentations/attempts',randomUUID());await mkdir(attempt,{recursive:true});
  await writeFile(join(attempt,'check.mjs'),`import {readFileSync} from 'node:fs';\nimport {validatePresentation,validateFinanceEquipment} from ${JSON.stringify(runtimeEntryUrl('characterPresentation',import.meta.url))};\ntry {const packet=JSON.parse(readFileSync('texts.json','utf8'));const value=JSON.parse(readFileSync('presentation.json','utf8'));validatePresentation(value,packet.texts);if(packet.finance_equipment_required)validateFinanceEquipment(value,packet.equipment);console.log('Presentation valid');}catch(error){console.error(error.message);process.exitCode=1;}\n`);
  let failure:unknown;
  for(let round=1;round<=2;round++) {
    await writeFile(join(attempt,'texts.json'),JSON.stringify({play_language:language,texts:missing,known_labels:known,
      equipment,finance_equipment_required:wantEquipment&&!finance},null,2));
    const outcome=await runner({cwd:attempt,systemPrompt:prompt,model:options.model,thinking:options.thinking,signal:options.signal,eventLog:join(attempt,`events-${round}.jsonl`),timeoutMs:120000,
      brief:'Read texts.json and write the player-facing text projection to presentation.json. Its "texts" object answers exactly the strings texts.json lists, which are the ones not already projected: words it does not list are already settled and must not be added. The file must contain exactly one JSON object, without Markdown or trailing text. Run node check.mjs and correct any error before finishing.'
        +(missing.length?'':' This request lists no texts: write "texts": {} and only the financial equipment subset.')
        +(round>1?' Read findings.json and supply exactly the entries it still names; the words already accepted are not asked again.':'')});
    if(!outcome.ok||options.signal?.aborted)throw new Error('Card presentation could not be prepared');
    const bytes=await readFile(join(attempt,'presentation.json'),'utf8');
    await writeFile(join(attempt,`presentation-round-${round}.json`),bytes);
    let value:unknown;
    try {value=JSON.parse(bytes);}
    catch(error){failure=error;await writeFile(join(attempt,'findings.json'),JSON.stringify({error:String(error)}));continue;}
    const accepted=acceptedTexts(value,missing);
    if(Object.keys(accepted).length)vocabulary=await mergeVocabulary(vocabularyFile,language,accepted);
    missing=missing.filter(text=>!vocabulary[text]);
    if(wantEquipment&&!finance) {
      try {
        finance=validateFinanceEquipment(value,equipment);
        const temp=join(dirname(financeFile),randomUUID()+'.tmp');
        await writeFile(temp,JSON.stringify({play_language:language,equipment,finance_equipment:finance},null,2));
        await rename(temp,financeFile);
      } catch(error){failure=error;}
    }
    if(!missing.length&&finance)break;
    failure??=new Error('Incomplete card presentation');
    await writeFile(join(attempt,'findings.json'),JSON.stringify({error:String(failure),texts:missing,
      finance_equipment_required:wantEquipment&&!finance},null,2));
  }
  if(missing.length)throw new Error(`Incomplete card presentation: ${missing.length} text${missing.length===1?'':'s'} were not projected`);
  if(!finance)throw failure instanceof Error?failure:new Error('Invalid financial equipment projection');
  return answer();
}
