// @vitest-environment jsdom
import React from 'react'
import {render,screen,waitFor,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {CocCharacterDraft} from './CocCharacterDraft'
afterEach(cleanup)
const sheet={name:'艾琳',occupation:'Lawyer',age:28,era:'1920s',characteristics:{STR:20},derived:{HP:14,DB:'+1D4'},skills:{'Language (Other: Latin)':53},finance:{cash:{amount:60,currency:'USD'},assets:{amount:1500,currency:'USD'},spending_level:{amount:10,currency:'USD'}},credit_rating:30,backstory:{personal_description:'谨慎的律师'},own_language:'English',key_connection:{summary:'编辑朋友'},equipment:['Camera'],creation:{skills:{occupation:{unspent:0},interest:{unspent:0}}}}
const zh={'Characteristics':'属性','Calculation':'计算过程','Rolled value':'初始值','Dice results':'骰点','Age adjustment':'年龄调整','EDU improvement checks':'教育成长检定','Keep highest':'取最高','Base movement':'基础移动力','Age movement penalty':'年龄减值','Round down':'向下取整','Standard rolled characteristics':'标准掷骰建卡','Quick-fire array':'快速建卡','Skill':'技能名称','Base value':'基础值','Occupation points':'职业加点','Interest points':'兴趣加点','Final value':'最终值','Point allocation':'点数分配','Total points':'总额','Spent':'已用','Remaining':'剩余','Character draft':'角色草稿','Character draft — reply to confirm or describe changes.':'请确认角色卡，或告诉我需要修改之处。',Parameter:'参数',Value:'数值',Half:'半值',Fifth:'五分之一值',Skills:'技能',Finance:'财务',Background:'背景',Language:'语言','Key connection':'关键联系',Equipment:'装备',Weapons:'武器','Occupation unspent':'未分配职业点数','Interest unspent':'未分配兴趣点数',cash:'现金',assets:'资产',spending:'消费水平',credit_rating:'信用评级',Lawyer:'律师','1920s':'1920年代',STR:'力量',HP:'生命值',DB:'伤害加值','Language (Other: Latin)':'其他语言（拉丁语）',personal_description:'个人描述','谨慎的律师':'谨慎的律师',English:'英语','编辑朋友':'编辑朋友',Camera:'相机',USD:'美元'}
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
 expect(container.textContent).toBe('…');expect(ack).not.toHaveBeenCalled();
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
 expect(label.closest('tr')?.querySelector('td:last-child')?.textContent).toBe('0');
 expect(screen.queryByText('无')).toBeNull();
 expect(JSON.stringify(data)).toBe(before);
})

it('shows base and both allocation pools, counting Credit Rating once in occupational spending',async()=>{
 const skills={Accounting:50,'Dodge':48,'Credit Rating':30,'Library Use':60};
 const creation={skills:{occupation:{budget:{total:110},spent:80,unspent:0,credit_rating:{value:30},allocations:{Accounting:45,'Library Use':35}},interest:{budget:{total:31},spent:31,unspent:0,allocations:{Dodge:26,'Library Use':5}}}};
 const data={revision:2,sheet:{...sheet,skills,creation},presentation:{texts:{...zh,Accounting:'会计',Dodge:'闪避','Credit Rating':'信用评级','Library Use':'图书馆使用'}}};
 const before=JSON.stringify(data);const {container}=render(<CocCharacterDraft data={data}/>);
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
 const row=screen.getByText('其他语言（拉丁语）').closest('tr')!;
 expect(Array.from(row.querySelectorAll('td')).map(x=>x.textContent)).toEqual(['—','—','—','53']);
})

it('shows recorded rolls, age changes and derived formulas beside the saved values',()=>{
 const creation={characteristics:{method:'rolled',multiplier:5,values:{STR:20,EDU:50},rolls:{STR:{dice:'3D6',faces:[1,1,2],total:4},EDU:{dice:'2D6+6',faces:[1,3],total:10}}},age:{bracket:'20-39',edu_reduction:0,app_reduction:0,characteristic_reductions:[],edu_improvement_checks:[{roll:49,edu:50}],mov_penalty:0},luck:{dice:'3D6',multiplier:5,attempts:[{faces:[5,4,4],total:13}],value:65},derived:{HP:'derived-attributes.hit_points (CON+SIZ)/10',MP:'derived-attributes.magic_points (POW)/5',SAN:'derived-attributes.sanity (POW)',MOV:'movement-rate.rules both_str_and_dex_less_than_siz - age penalty 0',DB:'damage-bonus-build STR+SIZ=85',BUILD:'damage-bonus-build STR+SIZ=85'}};
 const data={revision:1,sheet:{...sheet,characteristics:{STR:20,CON:75,SIZ:65,DEX:45,POW:65,EDU:50,LUCK:65},derived:{HP:14,MP:13,SAN:65,MOV:7,DB:'none',BUILD:0},creation},presentation:{texts:{...zh,CON:'体质',SIZ:'体型',DEX:'敏捷',POW:'意志',EDU:'教育',LUCK:'幸运',MP:'魔法值',SAN:'理智',MOV:'移动力',BUILD:'体格','both lower':'力量和敏捷都低于体型'},calculations:{movement:{condition:'both lower',base:7,penalty:0},damage_bonus:{total:85,min:85,max:124}}}};
 const before=JSON.stringify(data);render(<CocCharacterDraft data={data}/>);
 const row=(name:string)=>screen.getByRole('rowheader',{name,exact:true}).closest('tr')!.textContent;
 expect(row('力量')).toContain('(3D6) × 5骰点: [1, 1, 2] → 4 × 5 = 20');
 expect(row('教育')).toContain('D100: 49 ≤ 教育 50 → +0');
 expect(row('生命值')).toContain('(体质 75 + 体型 65) ÷ 10 · 向下取整');
 expect(row('移动力')).toContain('基础移动力 7 − 年龄减值 0');
 expect(row('伤害加值')).toContain('力量 20 + 体型 65 = 8585–124 → 0');
 expect(row('幸运')).toContain('[5, 4, 4] → 13 × 5');
 expect(JSON.stringify(data)).toBe(before);
})
