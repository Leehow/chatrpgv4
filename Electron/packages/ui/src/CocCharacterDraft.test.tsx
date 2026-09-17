// @vitest-environment jsdom
import React from 'react'
import {render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {CocCharacterDraft, isDiceNotation} from './CocCharacterDraft'
afterEach(cleanup)
const sheet={name:'艾琳',occupation:'Lawyer',age:28,era:'1920s',characteristics:{STR:20},derived:{HP:14,DB:'+1D4'},skills:{'Language (Other: Latin)':53},finance:{cash:{amount:60,currency:'USD'},assets:{amount:1500,currency:'USD'},spending_level:{amount:10,currency:'USD'}},credit_rating:30,backstory:{personal_description:'谨慎的律师'},own_language:'English',key_connection:{summary:'编辑朋友'},equipment:['Camera'],creation:{skills:{occupation:{unspent:0},interest:{unspent:0}}}}
const zh={'Show calculation details':'查看计算详情','Hide calculation details':'收起计算详情','Characteristics':'属性','Calculation':'计算过程','Rolled value':'初始值','Dice results':'骰点','Age adjustment':'年龄调整','EDU improvement checks':'教育成长检定','Keep highest':'取最高','Base movement':'基础移动力','Age movement penalty':'年龄减值','Round down':'向下取整','Standard rolled characteristics':'标准掷骰建卡','Rolled characteristics assigned to the stated aptitudes':'掷骰后按所述特长分配','Quick-fire array':'快速建卡','Skill':'技能名称','Base value':'基础值','Occupation points':'职业加点','Interest points':'兴趣加点','Final value':'最终值','Point allocation':'点数分配','Total points':'总额','Spent':'已用','Remaining':'剩余','Character draft':'角色草稿','Character draft — reply to confirm or describe changes.':'请确认角色卡，或告诉我需要修改之处。',Parameter:'参数',Value:'数值',Half:'半值',Fifth:'五分之一值',Skills:'技能',Finance:'财务',Background:'背景',Language:'语言','Key connection':'关键联系',Equipment:'装备',Weapons:'武器','Occupation unspent':'未分配职业点数','Interest unspent':'未分配兴趣点数',cash:'现金',assets:'资产',spending:'消费水平',credit_rating:'信用评级',Lawyer:'律师','1920s':'1920年代',STR:'力量',HP:'生命值',DB:'伤害加值','Language (Other: Latin)':'其他语言（拉丁语）',personal_description:'个人描述','谨慎的律师':'谨慎的律师',English:'英语','编辑朋友':'编辑朋友',Camera:'相机',USD:'美元'}
it('renders the whole card in the supplied player language and preserves exact numbers',async()=>{
 const ack=vi.fn(async()=>{}),load=vi.fn(async()=>({play_language:'zh-Hans',texts:zh}));
 const {container}=render(<CocCharacterDraft data={{revision:2,play_language:'zh-Hans',sheet}} onPresentation={load} onRendered={ack}/>);
 await screen.findByRole('region',{name:'角色草稿'});
 expect(container.textContent).not.toMatch(/Lawyer|Parameter|Value|Half|Fifth|Background|USD|personal_description|English|Camera/);
 expect(screen.getByText('律师 · 28 · 1920年代')).toBeTruthy();expect(screen.getByText('60 美元')).toBeTruthy();expect(screen.getByText('1500 美元')).toBeTruthy();expect(screen.getByText('相机')).toBeTruthy();expect(screen.getByText('+1D4')).toBeTruthy();expect(screen.getByText('20')).toBeTruthy();expect(screen.queryByText('半值')).toBeNull();expect(screen.queryByText('五分之一值')).toBeNull();
 await waitFor(()=>expect(ack).toHaveBeenCalledOnce());
})
it('does not acknowledge an untranslated card while its projection is pending',()=>{
 const ack=vi.fn(async()=>{});const {container}=render(<CocCharacterDraft data={{revision:1,play_language:'zh-Hans',sheet}} onPresentation={()=>new Promise(()=>{})} onRendered={ack}/>);
 expect(container.querySelector('.coc-draft-spinner')).toBeTruthy();expect(ack).not.toHaveBeenCalled();
})
it('polls the same pending projection and acknowledges only the displayed result',async()=>{
 const ack=vi.fn(async()=>{}),load=vi.fn().mockResolvedValueOnce({pending:true}).mockResolvedValue({play_language:'zh-Hans',texts:zh});
 render(<CocCharacterDraft data={{revision:2,play_language:'zh-Hans',sheet}} onPresentation={load} onRendered={ack}/>);
 expect(ack).not.toHaveBeenCalled();
 await screen.findByRole('region',{name:'角色草稿'},{timeout:4000});
 expect(load).toHaveBeenCalledTimes(2);await waitFor(()=>expect(ack).toHaveBeenCalledOnce());
})
it('uses English model output for an English campaign without changing data',async()=>{
 const texts=Object.fromEntries(Object.keys(zh).map(t=>[t,t.replaceAll('_',' ')]));texts['谨慎的律师']='A cautious lawyer';texts['编辑朋友']='An editor friend';render(<CocCharacterDraft data={{revision:1,play_language:'en',sheet,presentation:{texts,play_language:'en'}}}/>);
 expect(await screen.findByRole('region',{name:'Character draft'})).toBeTruthy();expect(screen.getByText('60 USD')).toBeTruthy();expect(screen.getByText('A cautious lawyer')).toBeTruthy();
})

it('displays canonical zero damage bonus numerically even with an old text projection',async()=>{
 const data={revision:3,play_language:'zh-Hans',sheet:{...sheet,derived:{HP:14,DB:'none'}},presentation:{texts:{...zh,none:'无'}}};
 const before=JSON.stringify(data);
 render(<CocCharacterDraft data={data}/>);
 const label=await screen.findByText('伤害加值');
 expect(label.closest('.coc-draft-stat')?.querySelector('dd')?.textContent).toBe('0');
 expect(screen.queryByText('无')).toBeNull();
 expect(JSON.stringify(data)).toBe(before);
})

it('shows base and both allocation pools, counting Credit Rating once in occupational spending',async()=>{
 const skills={Accounting:50,'Dodge':48,'Credit Rating':30,'Library Use':60};
 const creation={skills:{occupation:{budget:{total:110},spent:80,unspent:0,credit_rating:{value:30},allocations:{Accounting:45,'Library Use':35}},interest:{budget:{total:31},spent:31,unspent:0,allocations:{Dodge:26,'Library Use':5}}}};
 const data={revision:2,sheet:{...sheet,skills,creation},presentation:{texts:{...zh,Accounting:'会计',Dodge:'闪避','Credit Rating':'信用评级','Library Use':'图书馆使用'}}};
 const before=JSON.stringify(data);const {container}=render(<CocCharacterDraft data={data}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看计算详情'}));
 const cells=(label:string)=>Array.from(screen.getAllByText(label).find(x=>x.closest('tr'))!.closest('tr')!.querySelectorAll('td')).map(x=>x.textContent);
 expect(cells('会计')).toEqual(['5','45','0','50']);
 expect(cells('闪避')).toEqual(['22','0','26','48']);
 expect(cells('信用评级')).toEqual(['0','30','0','30']);
 expect(cells('图书馆使用')).toEqual(['20','35','5','60']);
 const budget=screen.getAllByText('职业加点').find(x=>x.closest('tbody'))!;
 expect(budget.closest('tr')?.textContent).toBe('职业加点1101100');
 expect(container.textContent).not.toMatch(/半值|五分之一|Half|Fifth/);
 expect(JSON.stringify(data)).toBe(before);
})
it('does not invent allocations for a legacy card without a creation ledger',()=>{
 render(<CocCharacterDraft data={{revision:1,sheet:{...sheet,creation:undefined},presentation:{texts:zh}}}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看计算详情'}));
 const row=screen.getByText('其他语言（拉丁语）').closest('tr')!;
 expect(Array.from(row.querySelectorAll('td')).map(x=>x.textContent)).toEqual(['—','—','—','53']);
})

it('shows recorded rolls, age changes and derived formulas beside the saved values',()=>{
 const creation={characteristics:{method:'rolled',multiplier:5,values:{STR:20,EDU:50},rolls:{STR:{dice:'3D6',faces:[1,1,2],total:4},EDU:{dice:'2D6+6',faces:[1,3],total:10}}},age:{bracket:'20-39',edu_reduction:0,app_reduction:0,characteristic_reductions:[],edu_improvement_checks:[{roll:49,edu:50}],mov_penalty:0},luck:{dice:'3D6',multiplier:5,attempts:[{faces:[5,4,4],total:13}],value:65},derived:{HP:'derived-attributes.hit_points (CON+SIZ)/10',MP:'derived-attributes.magic_points (POW)/5',SAN:'derived-attributes.sanity (POW)',MOV:'movement-rate.rules both_str_and_dex_less_than_siz - age penalty 0',DB:'damage-bonus-build STR+SIZ=85',BUILD:'damage-bonus-build STR+SIZ=85'}};
 const data={revision:1,sheet:{...sheet,characteristics:{STR:20,CON:75,SIZ:65,DEX:45,POW:65,EDU:50,LUCK:65},derived:{HP:14,MP:13,SAN:65,MOV:7,DB:'none',BUILD:0},creation},presentation:{texts:{...zh,CON:'体质',SIZ:'体型',DEX:'敏捷',POW:'意志',EDU:'教育',LUCK:'幸运',MP:'魔法值',SAN:'理智',MOV:'移动力',BUILD:'体格','both lower':'力量和敏捷都低于体型'},calculations:{movement:{condition:'both lower',base:7,penalty:0},damage_bonus:{total:85,min:85,max:124}}}};
 const before=JSON.stringify(data);render(<CocCharacterDraft data={data}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看计算详情'}));
 const row=(name:string)=>screen.getByRole('rowheader',{name,exact:true}).closest('tr')!.textContent;
 expect(row('力量')).toContain('(3D6) × 5骰点: [1, 1, 2] → 4 × 5 = 20');
 expect(row('教育')).toContain('D100: 49 ≤ 教育 50 → +0');
 expect(row('生命值')).toContain('(体质 75 + 体型 65) ÷ 10 · 向下取整');
 expect(row('移动力')).toContain('基础移动力 7 − 年龄减值 0');
 expect(row('伤害加值')).toContain('力量 20 + 体型 65 = 8585–124 → 0');
 expect(row('幸运')).toContain('[5, 4, 4] → 13 × 5');
 expect(JSON.stringify(data)).toBe(before);
})

it('starts compact, toggles calculations locally, and resets on a new revision',async()=>{
 const ack=vi.fn(async()=>{}),load=vi.fn(async()=>({texts:zh}));
 const data={revision:1,sheet};const before=JSON.stringify(data);
 const {rerender}=render(<CocCharacterDraft data={data} onPresentation={load} onRendered={ack}/>);
 await screen.findByRole('button',{name:'查看计算详情'});
 await waitFor(()=>expect(ack).toHaveBeenCalledOnce());
 const row=()=>screen.getByText('其他语言（拉丁语）').closest('tr')!;
 expect(row().querySelectorAll('td')).toHaveLength(1);
 expect(row().textContent).toContain('53');
 expect(screen.queryByText('点数分配')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'查看计算详情'}));
 expect(screen.getByRole('button',{name:'收起计算详情'}).getAttribute('aria-expanded')).toBe('true');
 expect(row().querySelectorAll('td')).toHaveLength(4);
 fireEvent.click(screen.getByRole('button',{name:'收起计算详情'}));
 expect(row().querySelectorAll('td')).toHaveLength(1);
 expect(ack).toHaveBeenCalledOnce();expect(load).toHaveBeenCalledOnce();
 expect(JSON.stringify(data)).toBe(before);
 fireEvent.click(screen.getByRole('button',{name:'查看计算详情'}));
 rerender(<CocCharacterDraft data={{...data,revision:2}} onPresentation={load} onRendered={ack}/>);
 expect(await screen.findByRole('button',{name:'查看计算详情'})).toBeTruthy();
 expect(row().querySelectorAll('td')).toHaveLength(1);
})

it('uses semantic financial exclusions without removing physical money-related objects or changing balances',()=>{
 const data={revision:1,sheet:{...sheet,equipment:['Some cash','Wallet','Collectible coin']},presentation:{texts:{...zh,'Some cash':'适量现金',Wallet:'钱包','Collectible coin':'收藏硬币'},finance_equipment:['Some cash']}};
 const before=JSON.stringify(data);render(<CocCharacterDraft data={data}/>);
 expect(screen.queryByText('适量现金')).toBeNull();expect(screen.getByText('钱包')).toBeTruthy();expect(screen.getByText('收藏硬币')).toBeTruthy();expect(screen.getByText('60 美元')).toBeTruthy();expect(JSON.stringify(data)).toBe(before);
});

/**
 * The card decides what to translate by shape, not by which alphabet a string is written in.
 *
 * The rule it replaced asked whether a value held a digit and nothing but digits, spaces, brackets
 * and the letter D -- a character-class test, which quietly means "Latin script". A value in any
 * other writing system fell straight past it into the glossary, and a Latin-script phrase with a
 * number in it skipped the glossary and printed untranslated.
 */
it('treats dice notation as a reading and every other value as a word',()=>{
 for(const dice of ['1D6','2D6+6','3D6','+1D4','15','15/30/60','3D6 × 5','-2','1.5'])
  expect(isDiceNotation(dice)).toBe(true)
 for(const prose of ['none','1 (3)','Firearms (Handgun)','.45 Revolver','每天 20 美元','20 доларів','1920s',''])
  expect(isDiceNotation(prose)).toBe(false)
})

/**
 * A word the projection does not carry is shown as it stands. Returning '' blanked the cell, which
 * reads as "there is nothing here" -- the one outcome a player cannot tell apart from a real gap.
 */
it('shows an untranslated word rather than an empty cell',()=>{
 render(<CocCharacterDraft data={{revision:1,sheet:{...sheet,equipment:['Hurricane lamp']},presentation:{texts:zh}}}/>)
 expect(screen.getByText('Hurricane lamp')).toBeTruthy()
 expect(screen.getByRole('region',{name:'角色草稿'}).querySelector('.coc-draft-kit')?.textContent).toBe('Hurricane lamp')
})

it('names the pool assignment and the dice each characteristic actually holds',()=>{
 const creation={method:'rolled_pool_assignment',characteristics:{method:'rolled_pool_assignment',multiplier:5,aptitude:{strong:['STR'],weak:['EDU']},values:{STR:50,EDU:20},rolls:{STR:{dice:'3D6',faces:[3,3,4],total:10},EDU:{dice:'2D6+6',faces:[1,3],total:4}},assignment:[{characteristic:'STR',rolled_for:'EDU',direction:'strong'},{characteristic:'EDU',rolled_for:'STR',direction:'weak'}]},age:{bracket:'20-39',edu_improvement_checks:[]}};
 const data={revision:3,sheet:{...sheet,characteristics:{STR:50,EDU:20},creation},presentation:{texts:{...zh,EDU:'教育'}}};
 render(<CocCharacterDraft data={data}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看计算详情'}));
 expect(screen.getByText(/掷骰后按所述特长分配/)).toBeTruthy();
 const row=(name:string)=>screen.getByRole('rowheader',{name,exact:true}).closest('tr')!.textContent;
 expect(row('力量')).toContain('骰点: [3, 3, 4] → 10 × 5 = 50');
})

it('shows the trade the player named, with the rulebook entry after it',()=>{
 render(<CocCharacterDraft data={{revision:4,sheet:{...sheet,occupation_stated:'护士'},presentation:{texts:zh}}}/>);
 expect(screen.getByText(/护士 \(律师\) · 28/)).toBeTruthy();
})

/**
 * Sex travels the card's presentation like the occupation beside it: the setup model drafted the
 * word, so a projection the texts carry is what the player sees, and a word the texts do not
 * carry falls back to the sheet's own until the lane answers. A card that never collected one
 * shows no dangling separator.
 */
it('shows sex through the presentation like the occupation, and raw when the texts lack it',()=>{
 render(<CocCharacterDraft data={{revision:1,sheet:{...sheet,sex:'Female'},presentation:{texts:{...zh,Female:'女'}}}}/>);
 expect(screen.getByText('律师 · 28 · 女 · 1920年代')).toBeTruthy();
 cleanup();
 render(<CocCharacterDraft data={{revision:2,sheet:{...sheet,sex:'Female'},presentation:{texts:zh}}}/>);
 expect(screen.getByText('律师 · 28 · Female · 1920年代')).toBeTruthy();
 cleanup();
 render(<CocCharacterDraft data={{revision:3,sheet,presentation:{texts:zh}}}/>);
 expect(screen.getByText('律师 · 28 · 1920年代')).toBeTruthy();
})

/**
 * A failed projection used to leave the card at a bare retry glyph, the reason nowhere. The lane's
 * own message ("Model grok-build/grok-4.6 not found") is the one thing that tells the player what
 * happened, so the card carries it next to the retry -- trimmed to one capped line, since a stderr
 * tail runs to thousands of characters.
 */
it('shows why a projection failed next to its retry, and recovers on retry',async()=>{
 const load=vi.fn().mockRejectedValueOnce(new Error('Model "grok-build/grok-4.6" not found. Use --list-models to see available models.')).mockResolvedValue({play_language:'zh-Hans',texts:zh});
 render(<CocCharacterDraft data={{revision:2,play_language:'zh-Hans',sheet}} onPresentation={load}/>);
 expect(await screen.findByText(/grok-build\/grok-4\.6" not found/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'↻'}));
 expect(await screen.findByRole('region',{name:'角色草稿'})).toBeTruthy();
 expect(load).toHaveBeenCalledTimes(2);
})

it('trims a multi-line or endless failure to its first capped line',async()=>{
 render(<CocCharacterDraft data={{revision:2,play_language:'zh-Hans',sheet}} onPresentation={async()=>{throw new Error(`first line\n${'x'.repeat(300)}`)}}/>);
 expect(await screen.findByText('first line')).toBeTruthy();
 expect(screen.queryByText(/x{20}/)).toBeNull();
 cleanup();
 render(<CocCharacterDraft data={{revision:3,play_language:'zh-Hans',sheet}} onPresentation={async()=>{throw new Error('y'.repeat(300))}}/>);
 expect(await screen.findByText('y'.repeat(237)+'…')).toBeTruthy();
})

it('shows why the preview acknowledgment failed',async()=>{
 const ack=vi.fn(async()=>{throw new Error('campaign_locked')});
 render(<CocCharacterDraft data={{revision:2,play_language:'zh-Hans',sheet,presentation:{texts:zh,play_language:'zh-Hans'}}} onRendered={ack}/>);
 expect((await screen.findByRole('alert')).textContent).toContain('campaign_locked');
})

/**
 * The rulebook's Penniless row prints no assets. `cash-assets.json` carries that as `assets: null`
 * and the kernel writes it onto the card as `{amount: null, formula: 'None'}` -- the row's
 * derivation *is* "None", which is a recorded fact and not a hole. `game-1c0faba5` and
 * `game-33a2a97a` both drew it as the literal word `null` in front of a currency within minutes of
 * each other on 2026-09-14, and one of those players wrote the string back into the fiction asking
 * what it meant. The card already knows how to say "nothing here"; the money cell did not use it.
 */
it('draws a money cell the rulebook printed no figure for the way it draws every other empty cell',async()=>{
 const finance={credit_rating:0,living_standard:'Penniless',cash:{amount:0.5,currency:'USD'},assets:{amount:null,currency:'USD',formula:'None'},spending_level:{amount:0.5,currency:'USD'},period:'1920s',source:'cash-assets.periods.1920s'};
 const data={revision:2,sheet:{...sheet,credit_rating:0,finance},presentation:{texts:{...zh,Penniless:'身无分文'},play_language:'zh-Hans'}};
 const {container}=render(<CocCharacterDraft data={data}/>);
 await screen.findByRole('region',{name:'角色草稿'});
 expect(container.textContent).not.toMatch(/null/);
 const cell=(label:string)=>screen.getByText(label).closest('div')?.querySelector('dd')?.textContent;
 expect(cell('资产')).toBe('—');
 expect(cell('现金')).toBe('0.5 美元');
})

/**
 * A book set in a year the rulebook never tabulated builds its figures off the table's own nominated
 * column, and the kernel records the swap (§23.4). `game-b4cebfe0` is set in 1895, its money is the
 * 1920s column, and the player saw only "9 美元": the contract asks the setup agent to say the
 * substitution once in prose and that transcript never says it. The fact belongs beside the numbers.
 */
it('says beside the numbers which period they came from when it stood in for the authored setting',async()=>{
 const era='1895 (default); investigators then reach the night before the 1287 storm';
 const finance={credit_rating:9,living_standard:'Poor',cash:{amount:9,currency:'USD',formula:'CR x 1'},assets:{amount:90,currency:'USD',formula:'CR x 10'},spending_level:{amount:2,currency:'USD'},period:'1920s',source:'cash-assets.periods.1920s',substituted_for:era};
 const texts={...zh,finance_period:'财务年代',substituted_for:'代替',[era]:'1895 年（默认）；随后是 1287 年暴风雨前夜'};
 const {container}=render(<CocCharacterDraft data={{revision:2,sheet:{...sheet,setting_era:era,finance},presentation:{texts,play_language:'zh-Hans'}}}/>);
 await screen.findByRole('region',{name:'角色草稿'});
 const note=container.querySelector('.coc-draft-finance')?.nextElementSibling?.textContent;
 expect(note).toBe('财务年代: 1920年代 · 代替: 1895 年（默认）；随后是 1287 年暴风雨前夜');
 expect(container.textContent).not.toMatch(/substituted_for|1287 storm/);
})

it('carries no substitution note on a card whose period the rulebook does tabulate',async()=>{
 const finance={credit_rating:30,living_standard:'Average',cash:{amount:60,currency:'USD'},assets:{amount:1500,currency:'USD'},spending_level:{amount:10,currency:'USD'},period:'1920s',source:'cash-assets.periods.1920s'};
 const {container}=render(<CocCharacterDraft data={{revision:2,sheet:{...sheet,finance},presentation:{texts:{...zh,finance_period:'财务年代',substituted_for:'代替'},play_language:'zh-Hans'}}}/>);
 await screen.findByRole('region',{name:'角色草稿'});
 expect(container.textContent).not.toMatch(/财务年代/);
})

/**
 * §97: the card is a document with two kinds of number on it. A pinned cell is one somebody set
 * on purpose -- the player on the sheet, or the model from what the player said -- and it is the
 * one thing a later spread or reroll may not move. A revision that predates pins draws exactly
 * as it did before, so an old card in a live transcript is not suddenly a card with no numbers
 * anybody chose.
 */
const cardWords={...zh,'Pinned':'钉住','Points left':'剩余点数','Auto-spread':'自动铺平','Non-standard card':'非标准卡','Confirm and open the table':'确认，开桌','Reroll':'重掷','Reroll the dice? Pinned numbers stay.':'重掷骰子？钉住的数不动。','Yes, reroll':'是的，重掷','Cancel':'取消','Click "Confirm and open the table", or say below what to change.':'点「确认，开桌」，或在下面说要改什么。','Credit Rating is above the new occupation range.':'信用评级高于新职业的范围。'}
const budget={occupation:{total:110,spent:80,unspent:30},interest:{total:31,spent:31,unspent:0},legal:true,notes:[] as string[]}
const carded=(extra:Record<string,any>={})=>({revision:5,sheet,presentation:{texts:cardWords,play_language:'zh-Hans'},...extra})

it('marks the numbers somebody set on purpose and leaves the spread ones as they were',()=>{
 const pins={characteristics:{STR:{value:20,by:'player'}},skills:{'Language (Other: Latin)':{value:53,by:'model'}}}
 const {container}=render(<CocCharacterDraft data={carded({pins})}/>)
 expect(screen.getAllByLabelText('钉住')).toHaveLength(2)
 expect(container.querySelector('.coc-draft-stat.coc-draft-pinned dt')?.textContent).toContain('力量')
 expect(container.querySelector('tr.coc-draft-pinned th')?.textContent).toContain('其他语言（拉丁语）')
})

it('draws no pin at all on a revision that carries none',()=>{
 const {container}=render(<CocCharacterDraft data={carded()}/>)
 expect(screen.queryByLabelText('钉住')).toBeNull()
 expect(container.querySelector('.coc-draft-pinned')).toBeNull()
})

it('reports both budgets, and offers the spread only while a pool still holds points',()=>{
 const spread=vi.fn(async()=>({}))
 const {container,rerender}=render(<CocCharacterDraft data={carded({budget})} onSpread={spread}/>)
 const counts=Array.from(container.querySelectorAll('.coc-draft-budget-count')).map(node=>node.textContent)
 expect(counts).toEqual(['80 / 110','31 / 31'])
 expect(screen.getByText('剩余点数: 30')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'自动铺平'}))
 expect(spread).toHaveBeenCalledOnce()
 rerender(<CocCharacterDraft data={carded({revision:6,budget:{...budget,occupation:{total:110,spent:110,unspent:0}}})} onSpread={spread}/>)
 expect(screen.queryByRole('button',{name:'自动铺平'})).toBeNull()
 expect(screen.queryByText(/剩余点数/)).toBeNull()
})

it('says on the card when the limits were relaxed, and says nothing when they were not',()=>{
 const notes=['Credit Rating is above the new occupation range.']
 render(<CocCharacterDraft data={carded({budget:{...budget,legal:false,notes}})}/>)
 expect(screen.getByText('非标准卡')).toBeTruthy()
 expect(screen.getByText('信用评级高于新职业的范围。')).toBeTruthy()
 cleanup()
 render(<CocCharacterDraft data={carded({budget})}/>)
 expect(screen.queryByText('非标准卡')).toBeNull()
})

it('confirms from the card itself, and says so when the host refuses',async()=>{
 const confirm=vi.fn(async()=>({confirmed:true}))
 render(<CocCharacterDraft data={carded()} onConfirm={confirm}/>)
 expect(screen.getByText('点「确认，开桌」，或在下面说要改什么。')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'确认，开桌'}))
 expect(confirm).toHaveBeenCalledOnce()
 cleanup()
 const refused=vi.fn(async()=>({ok:false,error:{code:'needs',message:'The draft has no occupation'}}))
 render(<CocCharacterDraft data={carded()} onConfirm={refused}/>)
 fireEvent.click(screen.getByRole('button',{name:'确认，开桌'}))
 expect((await screen.findByRole('alert')).textContent).toContain('The draft has no occupation')
})

it('asks before it rerolls, and says what a reroll will not touch',async()=>{
 const reroll=vi.fn(async()=>({}))
 render(<CocCharacterDraft data={carded()} onReroll={reroll}/>)
 fireEvent.click(screen.getByRole('button',{name:'重掷'}))
 expect(reroll).not.toHaveBeenCalled()
 expect(screen.getByText('重掷骰子？钉住的数不动。')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'取消'}))
 expect(reroll).not.toHaveBeenCalled()
 expect(screen.queryByText('重掷骰子？钉住的数不动。')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'重掷'}))
 fireEvent.click(screen.getByRole('button',{name:'是的，重掷'}))
 expect(reroll).toHaveBeenCalledOnce()
 await waitFor(()=>expect(screen.getByRole('button',{name:'重掷'}).hasAttribute('disabled')).toBe(false))
})

it('holds every card action while one is in flight',async()=>{
 let release=()=>{}
 const confirm=vi.fn(()=>new Promise<Record<string,any>>(resolve=>{release=()=>resolve({})}))
 render(<CocCharacterDraft data={carded({budget})} onConfirm={confirm} onSpread={async()=>({})} onReroll={async()=>({})}/>)
 fireEvent.click(screen.getByRole('button',{name:'确认，开桌'}))
 expect(screen.getByRole('button',{name:'自动铺平'}).hasAttribute('disabled')).toBe(true)
 expect(screen.getByRole('button',{name:'重掷'}).hasAttribute('disabled')).toBe(true)
 release()
 await waitFor(()=>expect(screen.getByRole('button',{name:'自动铺平'}).hasAttribute('disabled')).toBe(false))
})

it('offers no card action a host has not wired',()=>{
 render(<CocCharacterDraft data={carded({budget})}/>)
 for(const name of ['确认，开桌','自动铺平','重掷'])expect(screen.queryByRole('button',{name})).toBeNull()
})
