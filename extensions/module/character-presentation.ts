/** Player-facing text for an immutable card. Numeric cells never enter the model. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {resourceRootFrom,runtimeEntryUrl} from '../../runtime/deployment.mjs';
import {PLAY_LANGUAGE_TAG} from '../../runtime/ui-words.ts';
import {coded} from '../ui/errors.ts';
import {reasoned,readerFailureReason} from './reader.ts';
import {runPresentationAttempt} from './presentation-attempt.ts';
import type {ReaderRequest,ReaderOutcome} from './reader.ts';
const root=resourceRootFrom(import.meta.url);
export const CARD_TEXT = ['Character draft','Character draft — reply to confirm or describe changes.','Click "Confirm and open the table", or say below what to change.',
  'Pinned','Points left','Auto-spread','Non-standard card','Confirm and open the table','Reroll','Reroll the dice? Pinned numbers stay.','Yes, reroll','Earlier draft','Overspent by','Relaxed to','Above the starting cap','occupation points','interest points',
  'Parameter','Value','Skill','Base value','Occupation points','Interest points','Final value','Point allocation','Total points','Spent','Remaining','Skills','Finance','Background','Language','Key connection',
  'Show calculation details','Hide calculation details','Characteristics','Calculation','Rolled value','Dice results','Age adjustment','EDU improvement checks','Keep highest','Base movement','Age movement penalty','Round down','Standard rolled characteristics','Rolled characteristics assigned to the stated aptitudes','Quick-fire array','Equipment','Weapons','Preview unavailable','Retry',
  'Edit numbers','Edit draft numbers','Derived values','Save changes','Cancel','Close','Allowed range','Calculated automatically','Rules in force','Characteristic range','Starting skill cap','Credit Rating range','Unlock limits','Hide limit overrides','Characteristic minimum','Characteristic maximum','Skill cap','Overridden','Enter a whole number.','Not enough occupation points.','Not enough interest points.','Value outside the allowed range.','Take the points from another skill in the same pool, or raise the budget under Unlock limits.','The draft changed while you were editing. The latest version is shown instead.','The save failed — try again.',
  'cash','assets','spending','credit_rating','living_standard','finance_period','substituted_for','damage','range','attacks','ammo','malfunction','skill','Yes','No'];
type Row=Record<string,any>;
/** A campaign id, checked before it is ever joined onto a path. */
const CAMPAIGN_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/**
 * Whether the requested tag has the shape of a play language -- and nothing else.
 *
 * The tag set is open (contract §23, 2026-09-09): the player names a language and the card is
 * written in it. This asked `content/languages.json` for membership until that ruling, which made
 * adding a language a data change and refused every tag nobody had registered. Shape is all a lane
 * may ask, because a shape is not a list.
 */
function shapedLanguage(options:{play_language:string}):boolean {
  return typeof options.play_language==='string'&&PLAY_LANGUAGE_TAG.test(options.play_language);
}
export function cardTexts(sheet:Row):string[] {
  const texts=new Set(CARD_TEXT);
  const add=(value:unknown)=>{if(typeof value==='string'&&value.trim()&&!/^(?=.*\d)[\d\s()+\-*/Dd×.,]+$/.test(value))texts.add(value)};
  for(const key of ['occupation','era','own_language'])add(sheet[key]);
  add(sheet.sex);
  for(const group of ['characteristics','derived','skills'])for(const [key,value] of Object.entries(sheet[group]||{})){add(key);if(group==='derived')add(value)}
  for(const [key,value] of Object.entries(sheet.backstory||{})){add(key);add(value)}
  add(sheet.key_connection?.summary);
  for(const item of sheet.equipment||[])add(item);
  for(const weapon of sheet.weapons||[])for(const [key,value] of Object.entries(weapon)){add(key);if(Array.isArray(value))value.forEach(add);else add(value)}
  add(sheet.finance?.living_standard);
  // The authored setting a substituted finance period stood in for is the book's own prose, so the
  // card can only print it in the player's language if the projection is asked for it (§23.4).
  add(sheet.finance?.substituted_for);
  for(const key of ['cash','assets','spending_level'])add(sheet.finance?.[key]?.currency);
  return [...texts].sort();
}
export function validatePresentation(value:unknown,texts:string[]):Record<string,string> {
  const map=(value as Row)?.texts;
  if(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).length!==texts.length||texts.some(t=>typeof map[t]!=='string'||!map[t].trim()))throw coded('preparation_failed','Incomplete card presentation');
  return Object.fromEntries(texts.map(t=>[t,map[t]]));
}
export function validateFinanceEquipment(value:unknown,equipment:string[]):string[] {
  const excluded=(value as Row)?.finance_equipment;
  if(!Array.isArray(excluded)||new Set(excluded).size!==excluded.length||excluded.some(name=>typeof name!=='string'||!equipment.includes(name)))throw coded('preparation_failed','Invalid financial equipment projection');
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
  if(!CAMPAIGN_NAME.test(options.campaign)||!Number.isSafeInteger(options.revision)||options.revision<1||!shapedLanguage(options))throw coded('invalid_params','Invalid presentation request');
  const draft=JSON.parse(await readFile(join(options.home,'.coc/campaigns',options.campaign,'setup/drafts',`${options.revision}.json`),'utf8'));
  if(draft.play_language!==options.play_language)throw coded('invalid_params','Draft language does not match the session');
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
/**
 * The names of the languages an investigator holds, in the language the skill catalog wrote them
 * in. A specialty is chosen when the card is built, so it can carry no authored `localized_labels`
 * the way a fixed skill does; without this lane a zh-Hans table reads `Latin` and `Italian` on a
 * sheet whose every other word is its own -- and language is what decides how much of an NPC's
 * speech reaches the investigator now (Natural NPC 1.1.0), so it is the last word that should read
 * as foreign by accident.
 *
 * Only the name is asked. The number is the kernel's, and `Own`/`Other` is the catalog's structure,
 * named by the sidebar's own settled words. Two places carry a name: the required `own_language`
 * field, and the skill keys in the three shapes the catalog writes -- all three in shipped sheets:
 * `Language (Other: English)`, a starter's inline `Language (Latin)`, and `Language (Own: X)`. The
 * same shapes are read in `pipicoc/panel.js` to place the row; keep the two together. They are
 * separate because a field added to the kernel's own investigator projection cannot be represented
 * by the frozen Python oracle, and this lane needs none.
 */
export function languageTexts(view:Row):string[] {
  const texts=new Set<string>();
  for(const sheet of Array.isArray(view?.investigators)?view.investigators:[]) {
    // `own_language` names the tongue the investigator was raised in; the skill keys name the rest.
    if(typeof sheet?.own_language==='string'&&sheet.own_language.trim())texts.add(sheet.own_language.trim());
    const skills=sheet?.skills&&typeof sheet.skills==='object'&&!Array.isArray(sheet.skills)?sheet.skills:{};
    for(const key of Object.keys(skills)) {
      if(typeof key!=='string'||!key.startsWith('Language (')||!key.endsWith(')'))continue;
      const inside=key.slice('Language ('.length,-1).trim();
      const name=inside==='Own'?'':inside.startsWith('Own:')?inside.slice('Own:'.length).trim()
        :inside.startsWith('Other:')?inside.slice('Other:'.length).trim():inside;
      if(name)texts.add(name);
    }
  }
  return [...texts].sort();
}
export function prepareLanguagePresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  return prepareGrowingPresentation(options,'languages',languageTexts);
}
/**
 * The words a discovered clue puts on the sheet that are not written at the table: the name it is
 * filed under. The name is the Keeper's own play-language word when `apply clue` gave one and
 * otherwise the graph's display name; the row does not say which, so it is asked exactly as a
 * scene's name is, and a word already in the play language comes back as itself.
 *
 * The row's `how` is not asked. Like the journal lane's own prose, the Keeper wrote it at this
 * table in the play language, so it has no leg to travel. The module's `summary` is not here
 * because it is not on the row any more: it is Keeper material and §80 stops it at the projection
 * boundary. The handle never enters, and a clue the scene offers but nobody has found stays the
 * Keeper's business.
 */
export function clueTexts(view:Row):string[] {
  const texts=new Set<string>();
  const add=(value:unknown)=>{if(typeof value==='string'&&value.trim())texts.add(value)};
  const clues=view?.clues&&typeof view.clues==='object'&&!Array.isArray(view.clues)?view.clues:{};
  const found=[...(Array.isArray(clues.here)?clues.here:[]).filter((row:unknown)=>(row as Row)?.discovered===true),
    ...(Array.isArray(clues.discovered)?clues.discovered:[])];
  for(const row of found){if(row&&typeof row==='object')add((row as Row).label);}
  return [...texts].sort();
}
export function prepareCluePresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  return prepareGrowingPresentation(options,'clues',clueTexts);
}
/**
 * The words the NPC journal (§17.10) puts in front of the player that are not its own prose: the
 * name each entry is filed under, and the scene stamped on every exchange.
 *
 * The journal lane writes the description and the exchange summary in the play language, and those
 * stay out of here. The name cannot travel that leg: the lane is required to copy a recordable name
 * exactly (`journal.submit` validates membership), so it is the module graph's word, and the scene
 * is the kernel's stamp of the display name at the turn the exchange happened -- frozen there, so a
 * scene the Keeper renamed afterwards keeps the book's name in the entries already written. Both
 * are the same class of word as a clue's graph name, and reach the player the same way: projected
 * once per language, merged under the glossary, looked up by the panel.
 */
export function journalTexts(view:Row):string[] {
  const texts=new Set<string>();
  const add=(value:unknown)=>{if(typeof value==='string'&&value.trim())texts.add(value)};
  const journal=Array.isArray((view?.npcs as Row)?.journal)?((view.npcs as Row).journal as Row[]):[];
  for(const entry of journal) {
    if(!entry||typeof entry!=='object')continue;
    add(entry.name);
    for(const exchange of Array.isArray(entry.exchanges)?entry.exchanges as Row[]:[])
      if(exchange&&typeof exchange==='object')add(exchange.scene);
  }
  return [...texts].sort();
}
export function prepareJournalPresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  return prepareGrowingPresentation(options,'journal',journalTexts);
}
/**
 * The words a handed-over handout puts in front of the player: the document itself, and the name
 * the row folds under.
 *
 * A handout with a body is the module's own prose -- the graph's `authored_text`, which the graph
 * contract keeps in the language the book was read in and leaves to a presentation layer. Unlike
 * a clue's one sentence this is a whole document, and it is asked as one string: a newspaper
 * column translated a line at a time stops being a newspaper column.
 *
 * Its input is not `table.view`. A handout is on no panel and in no view -- `apply handout` writes
 * it to `<campaign>/handouts/<handle>.md` and the delivery card is the only surface that shows it
 * -- so the caller collects those files and hands them over as `handouts`, `name` being the `# `
 * heading the kernel writes above the body, which is the same display name the receipt files.
 */
export function handoutTexts(view:Row):string[] {
  const texts=new Set<string>();
  const add=(value:unknown)=>{if(typeof value==='string'&&value.trim())texts.add(value)};
  for(const row of Array.isArray(view?.handouts)?view.handouts:[])
    if(row&&typeof row==='object'){add((row as Row).name);add((row as Row).text);}
  return [...texts].sort();
}
/**
 * The handouts a campaign has handed over, as the lane's own input.
 *
 * `apply handout` writes a card that has a body to `<campaign>/handouts/<handle>.md` as
 * `# <display>\n\n<body>`, so the heading is read back rather than guessed out of the prose, and
 * an absent folder is a campaign that has handed nothing over — not a failure.
 */
export async function handoutInput(home:string,campaign:string):Promise<Row[]> {
  if(!CAMPAIGN_NAME.test(campaign))throw coded('invalid_params','Invalid presentation request');
  const folder=join(home,'.coc/campaigns',campaign,'handouts');
  const rows:Row[]=[];
  for(const file of (await readdir(folder).catch(()=>[] as string[])).filter(name=>name.endsWith('.md')).sort()) {
    const text=await readFile(join(folder,file),'utf8').catch(()=>null);
    if(typeof text!=='string'||!text.trim())continue;
    const heading=/^#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/.exec(text);
    rows.push({name:heading?heading[1]:null,text});
  }
  return rows;
}
/**
 * The rules words this table actually shows: the skills it rolls, and the characteristics and
 * derived values on the sheet beside them.
 *
 * These reach a card through `playerGlossary`, the kernel's union of the rules data's own
 * `localized_labels`. That is a hand-seeded set -- 185 rows for zh-Hans, 57 for en, nothing for
 * any other tag -- and the kernel is deterministic and may not call a model to widen it, so a
 * table played in a third language reads every skill and characteristic in English while the card,
 * the possessions and the clues beside them are all in the play language. This lane is the half
 * §23 already promised for the rules data ("the seeds are seeds; the lane fills what is empty").
 *
 * It limits itself by the same glossary it completes. `view.labels` is what the kernel answered,
 * so a word already in it is never collected, and a table in a seeded language collects nothing
 * at all and starts no run. The lane costs exactly the languages the seeds do not cover -- which
 * is also what keeps it from asking for the same skill every turn, the way a lane asked for words
 * it could never collect would.
 *
 * Display only. The kernel matches a skill by its canonical name (`resolve {skill: "Spot Hidden"}`),
 * so what this projects may fill `labels` and must never travel back as an identifier.
 */
export function rulesTexts(view:Row):string[] {
  const known=view?.labels&&typeof view.labels==='object'&&!Array.isArray(view.labels)?view.labels as Row:{};
  const texts=new Set<string>();
  const add=(value:unknown)=>{
    if(typeof value!=='string'||!value.trim())return;
    const word=value.trim();
    // A figure is not a word, and a term the glossary already answers is not this lane's to ask.
    if(/^(?=.*\d)[\d\s()+\-*/Dd×.,%]+$/.test(word)||typeof known[word]==='string')return;
    texts.add(word);
  };
  for(const sheet of Array.isArray(view?.investigators)?view.investigators:[]) {
    if(!sheet||typeof sheet!=='object')continue;
    for(const group of ['characteristics','derived','skills']) {
      const rows=(sheet as Row)[group];
      if(rows&&typeof rows==='object'&&!Array.isArray(rows))for(const key of Object.keys(rows))add(key);
    }
  }
  return [...texts].sort();
}
export function prepareRulesPresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  return prepareGrowingPresentation(options,'rules',rulesTexts);
}
/**
 * The identity words a sheet carries that are the setup model's, not the rules data's: today
 * exactly `sex`.
 *
 * Sex is free text the setup model drafts as a visible suggestion (contract §23.4) -- never an
 * enum, never rules data -- so no `localized_labels` row can ever carry it, and a card drafted in
 * the system language shows that word to the player unchanged unless a lane projects it. This is
 * that lane, §23's second leg for the sheet's own identity field. `occupation_stated` and
 * `concept` stay out: they are the player's own prose, already written in the play language by
 * the model that heard them, which is the first leg. A value already in the kernel glossary is
 * never asked, because prepareTexts' known_labels answer it; a figure is not a word. The lane is
 * named `identity` rather than `sex` so the next word of the same kind lands here without a new
 * kind.
 */
export function identityTexts(view:Row):string[] {
  const texts=new Set<string>();
  for(const sheet of Array.isArray(view?.investigators)?view.investigators:[]) {
    const sex=(sheet as Row)?.sex;
    if(typeof sex!=='string'||!sex.trim())continue;
    const word=sex.trim();
    if(/^(?=.*\d)[\d\s()+\-*/Dd×.,%]+$/.test(word))continue;
    texts.add(word);
  }
  return [...texts].sort();
}
export function prepareIdentityPresentation(options:TextOptions&{campaign:string;view:Row}):Promise<Row> {
  return prepareGrowingPresentation(options,'identity',identityTexts);
}
export async function prepareHandoutPresentation(options:TextOptions&{campaign:string}):Promise<Row> {
  const handouts=await handoutInput(options.home,options.campaign);
  return prepareGrowingPresentation({...options,view:{play_language:options.play_language,handouts}},'handouts',handoutTexts);
}
/** A projection that grows with the table: what its saved file lacks is asked, what it has is kept. */
async function prepareGrowingPresentation(options:TextOptions&{campaign:string;view:Row},kind:string,collect:(view:Row)=>string[]):Promise<Row> {
  if(!CAMPAIGN_NAME.test(options.campaign)||!shapedLanguage(options))throw coded('invalid_params','Invalid presentation request');
  if(options.view?.play_language!==options.play_language)throw coded('invalid_params','View language does not match the session');
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
  if(!runner)throw coded('preparation_failed','Character presentation requires its owner runtime');
  const attempt=join(options.home,'.coc/character-presentations/attempts',randomUUID());
  let failure:unknown;
  await runPresentationAttempt({
    attempt,outputFile:'presentation.json',outputArtifact:round=>`presentation-round-${round}.json`,
    checkSource:`import {readFileSync} from 'node:fs';\nimport {validatePresentation,validateFinanceEquipment} from ${JSON.stringify(runtimeEntryUrl('characterPresentation',import.meta.url))};\ntry {const packet=JSON.parse(readFileSync('texts.json','utf8'));const value=JSON.parse(readFileSync('presentation.json','utf8'));validatePresentation(value,packet.texts);if(packet.finance_equipment_required)validateFinanceEquipment(value,packet.equipment);console.log('Presentation valid');}catch(error){console.error(error.message);process.exitCode=1;}\n`,
    systemPrompt:prompt,model:options.model,thinking:options.thinking,signal:options.signal,runner,
    prepareRound:async round=>{
      await writeFile(join(attempt,'texts.json'),JSON.stringify({play_language:language,texts:missing,known_labels:known,
        equipment,finance_equipment_required:wantEquipment&&!finance},null,2));
      return 'Read texts.json and write the player-facing text projection to presentation.json. Its "texts" object answers exactly the strings texts.json lists, which are the ones not already projected: words it does not list are already settled and must not be added. The file must contain exactly one JSON object, without Markdown or trailing text. Run node check.mjs and correct any error before finishing.'
        +(missing.length?'':' This request lists no texts: write "texts": {} and only the financial equipment subset.')
        +(round>1?' Read findings.json and supply exactly the entries it still names; the words already accepted are not asked again.':'');
    },
    failure:(outcome,aborted)=>coded(aborted?'presentation_timeout':'preparation_failed',
      reasoned('Card presentation could not be prepared',aborted?undefined:readerFailureReason(outcome))),
    invalidOutput:error=>{
      if(!(error instanceof SyntaxError))throw error;
      failure=error;return {error:String(error)};
    },
    accept:async value=>{
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
      if(!missing.length&&finance)return {done:true};
      failure??=coded('preparation_failed','Incomplete card presentation');
      return {done:false,findings:{error:String(failure),texts:missing,finance_equipment_required:wantEquipment&&!finance}};
    },
  });
  if(missing.length)throw coded('preparation_failed',`Incomplete card presentation: ${missing.length} text${missing.length===1?'':'s'} were not projected`);
  if(!finance)throw failure instanceof Error?failure:coded('preparation_failed','Invalid financial equipment projection');
  return answer();
}
