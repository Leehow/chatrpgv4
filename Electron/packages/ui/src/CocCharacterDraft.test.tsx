// @vitest-environment jsdom
import React from 'react'
import {render,screen,waitFor,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {CocCharacterDraft} from './CocCharacterDraft'
afterEach(cleanup)
const sheet={name:'艾琳',occupation:'Lawyer',age:28,era:'1920s',characteristics:{STR:20},derived:{HP:14,DB:'+1D4'},skills:{'Language (Other: Latin)':53},finance:{cash:{amount:60,currency:'USD'},assets:{amount:1500,currency:'USD'},spending_level:{amount:10,currency:'USD'}},credit_rating:30,backstory:{personal_description:'谨慎的律师'},own_language:'English',key_connection:{summary:'编辑朋友'},equipment:['Camera'],creation:{skills:{occupation:{unspent:0},interest:{unspent:0}}}}
const zh={'Character draft':'角色草稿','Character draft — reply to confirm or describe changes.':'请确认角色卡，或告诉我需要修改之处。',Parameter:'参数',Value:'数值',Half:'半值',Fifth:'五分之一值',Skills:'技能',Finance:'财务',Background:'背景',Language:'语言','Key connection':'关键联系',Equipment:'装备',Weapons:'武器','Occupation unspent':'未分配职业点数','Interest unspent':'未分配兴趣点数',cash:'现金',assets:'资产',spending:'消费水平',credit_rating:'信用评级',Lawyer:'律师','1920s':'1920年代',STR:'力量',HP:'生命值',DB:'伤害加值','Language (Other: Latin)':'其他语言（拉丁语）',personal_description:'个人描述','谨慎的律师':'谨慎的律师',English:'英语','编辑朋友':'编辑朋友',Camera:'相机',USD:'美元'}
it('renders the whole card in the supplied player language and preserves exact numbers',async()=>{
 const ack=vi.fn(async()=>{}),load=vi.fn(async()=>({play_language:'zh-Hans',texts:zh}));
 const {container}=render(<CocCharacterDraft data={{revision:2,play_language:'zh-Hans',sheet}} onPresentation={load} onRendered={ack}/>);
 await screen.findByRole('region',{name:'角色草稿'});
 expect(container.textContent).not.toMatch(/Lawyer|Parameter|Value|Half|Fifth|Background|USD|personal_description|English|Camera/);
 expect(screen.getByText('律师 · 28 · 1920年代')).toBeTruthy();expect(screen.getByText('60 美元')).toBeTruthy();expect(screen.getByText('1500 美元')).toBeTruthy();expect(screen.getByText('相机')).toBeTruthy();expect(screen.getByText('+1D4')).toBeTruthy();expect(screen.getByText('20')).toBeTruthy();expect(screen.getByText('4')).toBeTruthy();
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
 expect(label.closest('tr')?.textContent).toBe('伤害加值0');
 expect(screen.queryByText('无')).toBeNull();
 expect(JSON.stringify(data)).toBe(before);
})
