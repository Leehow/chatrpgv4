// @vitest-environment jsdom
import React from 'react'
import {render,screen,within,waitFor,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {CocCharacterDraft} from './CocCharacterDraft'
afterEach(cleanup)

const characteristics={STR:40,CON:45,SIZ:50,DEX:65,APP:55,INT:55,POW:40,EDU:62,LUCK:45}
const derived={HP:9,MP:8,SAN:40,MOV:8,DB:'none',BUILD:0}
const skills={Accounting:50,Dodge:48,'Credit Rating':30,'Library Use':60}
const creation={skills:{occupation:{budget:{total:248},spent:80,unspent:138,credit_rating:{value:30},allocations:{Accounting:45,'Library Use':35}},interest:{budget:{total:110},spent:31,unspent:79,allocations:{Dodge:26,'Library Use':5}}}}
const sheet={name:'艾琳',occupation:'Lawyer',age:28,era:'1920s',characteristics,derived,skills,finance:{},credit_rating:30,backstory:{},own_language:'English',key_connection:{summary:'编辑朋友'},equipment:[],creation}
const limits={characteristic_min:15,characteristic_max:90,skill_cap:75,occupation_points:248,interest_points:110,occupation_formula:{formula:'EDU*4',total:248},interest_formula:{formula:'INT*2',total:110},credit_rating_range:[0,99],overridden:[] as string[]}
const card=(override?:ReturnType<typeof vi.fn>,extra:Record<string,any>={})=><CocCharacterDraft data={{revision:3,play_language:'en',sheet,limits,presentation:{texts:{}},...extra}} onOverride={override as any}/>
const openEditor=async()=>{
  fireEvent.click(await screen.findByRole('button',{name:'Edit numbers'}))
  return await screen.findByRole('dialog',{name:'Edit draft numbers'})
}

it('offers the edit entry only when the payload carries limits and a handler is wired',async()=>{
  const override=vi.fn(async()=>({}))
  const {rerender}=render(<CocCharacterDraft data={{revision:3,sheet,presentation:{texts:{}}}} onOverride={override as any}/>)
  await screen.findByRole('region',{name:'Character draft'})
  expect(screen.queryByRole('button',{name:'Edit numbers'})).toBeNull()
  rerender(<CocCharacterDraft data={{revision:3,sheet,limits,presentation:{texts:{}}}}/>)
  expect(screen.queryByRole('button',{name:'Edit numbers'})).toBeNull()
  rerender(card(override))
  expect(await screen.findByRole('button',{name:'Edit numbers'})).toBeTruthy()
})

it('shows the allowed ranges, live budgets and the rules in force straight from the payload',async()=>{
  const override=vi.fn(async()=>({}))
  render(card(override))
  const dialog=await openEditor()
  expect(override).not.toHaveBeenCalled()
  expect(within(dialog).getByRole('textbox',{name:'STR'})).toHaveProperty('value','40')
  // The worksheet's own columns: what each pool bought, with the printed base beside them and the
  // sum below. A card whose ledger names no lists still knows what it spent, so the boxes open on
  // the recorded allocations rather than on zero.
  expect(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'})).toHaveProperty('value','45')
  expect(within(dialog).getByRole('textbox',{name:'Accounting Interest points'})).toHaveProperty('value','0')
  const skillRow=(name:string)=>(dialog.querySelector(`[data-skill="${name}"]`) as HTMLElement).textContent!.replace(/\s+/g,' ')
  expect(skillRow('Accounting')).toContain('Base 5')
  expect(skillRow('Accounting')).toContain('Final 50')
  // Dodge was bought with interest points alone, so it has no occupation box to type into.
  expect(within(dialog).queryByRole('textbox',{name:'Dodge Occupation points'})).toBeNull()
  expect(within(dialog).getByRole('textbox',{name:'Dodge Interest points'})).toHaveProperty('value','26')
  expect(within(dialog).getByRole('textbox',{name:'Credit Rating'})).toHaveProperty('value','30')
  // Credit Rating is edited in its own field, never duplicated as a skill input.
  expect(within(dialog).getAllByRole('textbox',{name:'Credit Rating'})).toHaveLength(1)
  expect(within(dialog).getAllByText('Allowed range: 15 – 90')).toHaveLength(9)
  expect(within(dialog).getByText('Allowed range: 0 – 99')).toBeTruthy()
  // Derived values stay read-only and come from the sheet, captioned as calculated.
  expect(within(dialog).queryByRole('textbox',{name:'HP'})).toBeNull()
  expect(within(dialog).getAllByText('Calculated automatically')).toHaveLength(6)
  // Occupation pool counts Credit Rating once: 80 spent + 30 credit against 248.
  const row=(label:string)=>within(dialog).getAllByText(label).find(x=>x.closest('tr'))!.closest('tr')!.textContent
  expect(row('Occupation points')).toBe('Occupation points248110138')
  expect(row('Interest points')).toBe('Interest points1103179')
  // The limits section spells the rules out instead of hardcoding them.
  expect(within(dialog).getByText('EDU*4 = 248')).toBeTruthy()
  expect(within(dialog).getByText('INT*2 = 110')).toBeTruthy()
  expect(within(dialog).getByText('15 – 90')).toBeTruthy()
  expect(within(dialog).getByText('0 – 99')).toBeTruthy()
})

it('previews an edited characteristic with a debounced dry run and shows the returned arithmetic',async()=>{
  const previewed={revision:3,sheet:{...sheet,characteristics:{...characteristics,STR:55},derived:{...derived,HP:11}},limits}
  const override=vi.fn(async()=>previewed)
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'STR'}),{target:{value:'55'}})
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{characteristics:{STR:55}},dry_run:true}),{timeout:2000})
  // The new hit points are the kernel's preview, not local arithmetic.
  await waitFor(()=>expect(within(dialog).getByText('11')).toBeTruthy())
})

it('marks the offending input when the kernel refuses with needs details',async()=>{
  const override=vi.fn(async()=>({ok:false,error:{code:'needs',message:'The occupation point budget is exceeded',details:{pool:'occupation',total:110,spend:125,field:'Accounting',range:[5,75]}}}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'}),{target:{value:'80'}})
  expect(await within(dialog).findByText(/Not enough occupation points/)).toBeTruthy()
  expect(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'}).getAttribute('aria-invalid')).toBe('true')
})

it('§92 reports a pool refusal as arithmetic and a way out, never as the field\'s own range',async()=>{
  // Both pools start fully spent, so raising one value is the first thing every player meets. The
  // refusal used to end in the offending field's legal range -- a range the entered value is
  // already inside -- which reads as a number refused for being where it is allowed to be.
  const override=vi.fn(async()=>({ok:false,error:{code:'needs',message:'The occupation point budget is exceeded',details:{pool:'occupation',total:184,spend:194,field:'Accounting',range:[25,75]}}}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'}),{target:{value:'60'}})
  const refusal=await within(dialog).findByText(/Not enough occupation points/)
  expect(refusal.textContent).toContain('194 / 184')
  expect(refusal.textContent).toMatch(/another skill in the same pool/)
  expect(refusal.textContent).not.toMatch(/25 . 75/)
})

it('§92 a bound refusal still names the range, which is what it is about',async()=>{
  const override=vi.fn(async()=>({ok:false,error:{code:'needs',message:'A skill stays between its recomputed base and the starting cap',details:{field:'Accounting',range:[25,75],attempted:90}}}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'}),{target:{value:'90'}})
  const refusal=await within(dialog).findByText(/Value outside the allowed range/)
  expect(refusal.textContent).toContain('25 – 75')
  expect(refusal.textContent).not.toMatch(/same pool/)
})

it('saves the accumulated edits with the unlocked bounds and shows the returned revision',async()=>{
  const savedSheet={...sheet,characteristics:{...characteristics,STR:55}}
  const saved={revision:4,sheet:savedSheet,limits:{...limits,occupation_points:300,overridden:['occupation_points']}}
  const override=vi.fn(async()=>saved)
  const {rerender}=render(card(override))
  const dialog=await openEditor()
  fireEvent.click(within(dialog).getByRole('button',{name:'Unlock limits'}))
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Occupation points'}),{target:{value:'300'}})
  fireEvent.change(within(dialog).getByRole('textbox',{name:'STR'}),{target:{value:'55'}})
  // The unlocked bound rides every subsequent preview.
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{characteristics:{STR:55}},limits_override:{occupation_points:300},dry_run:true}),{timeout:2000})
  fireEvent.click(within(dialog).getByRole('button',{name:'Save changes'}))
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{characteristics:{STR:55}},limits_override:{occupation_points:300}}))
  expect((override.mock.calls.at(-1) as any[])[0].dry_run).toBeUndefined()
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
  // The host swaps the displayed data to the returned payload; the card renders that revision.
  rerender(<CocCharacterDraft data={{revision:4,play_language:'en',sheet:savedSheet,limits:saved.limits,presentation:{texts:{}}}} onOverride={override as any}/>)
  const region=await screen.findByRole('region',{name:'Character draft'})
  expect(region.getAttribute('data-draft-revision')).toBe('4')
  expect(within(region).getAllByText('55').length).toBeGreaterThan(0)
})

it('keeps the unlocked bounds while the modal stays open',async()=>{
  const override=vi.fn(async()=>({revision:3,sheet,limits}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.click(within(dialog).getByRole('button',{name:'Unlock limits'}))
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Occupation points'}),{target:{value:'300'}})
  fireEvent.click(within(dialog).getByRole('button',{name:'Hide limit overrides'}))
  fireEvent.click(within(dialog).getByRole('button',{name:'Unlock limits'}))
  expect(within(dialog).getByRole('textbox',{name:'Occupation points'})).toHaveProperty('value','300')
})

it('reports a superseded draft and closes back to the card',async()=>{
  const override=vi.fn(async()=>({superseded:true}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'STR'}),{target:{value:'55'}})
  fireEvent.click(within(dialog).getByRole('button',{name:'Save changes'}))
  expect(await screen.findByText('The draft changed while you were editing. The latest version is shown instead.')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button',{name:'Close'}).at(-1)!)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('discards the edits on cancel',async()=>{
  const override=vi.fn(async()=>({revision:3,sheet,limits}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'STR'}),{target:{value:'55'}})
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(override.mock.calls.some(call=>(call as any[])[0].dry_run!==true)).toBe(false)
})

it('keeps Save disabled until an edit or a bound actually changes',async()=>{
  const override=vi.fn(async()=>({}))
  render(card(override))
  const dialog=await openEditor()
  const saveButton=within(dialog).getByRole('button',{name:'Save changes'})
  // A no-op save would still write a revision and pay a full re-projection.
  expect(saveButton).toHaveProperty('disabled',true)
  fireEvent.change(within(dialog).getByRole('textbox',{name:'STR'}),{target:{value:'55'}})
  await waitFor(()=>expect(saveButton).toHaveProperty('disabled',false))
})

it('prefills the unlocked bounds from the persisted overrides without counting them as changes',async()=>{
  const override=vi.fn(async()=>({revision:3,sheet,limits}))
  render(card(override,{limits:{...limits,skill_cap:80,overridden:['skill_cap']}}))
  const dialog=await openEditor()
  fireEvent.click(within(dialog).getByRole('button',{name:'Unlock limits'}))
  expect(within(dialog).getByRole('textbox',{name:'Skill cap'})).toHaveProperty('value','80')
  // The persisted relaxation is the state in force, not a pending change: Save stays disabled.
  expect(within(dialog).getByRole('button',{name:'Save changes'})).toHaveProperty('disabled',true)
})

/**
 * §98: the pools are the player's to decide. The occupation list is eight entries the rulebook
 * pays for; everything else is either bought with interest points or is the base rating nobody
 * bought. Moving a skill between them re-flows the points around the pins, so the lists ride back
 * as a profile patch -- and only when one of them actually moved, because an unchanged pair would
 * make every save a re-flow the player never asked for.
 */
const poolSkills={Accounting:50,Anthropology:25,Appraise:30,Archaeology:21,Art:25,Charm:35,Climb:40,'Credit Rating':30,Dodge:48,'Library Use':60,'Spot Hidden':45}
const occupationList=['Accounting','Anthropology','Appraise','Archaeology','Art','Charm','Climb','Library Use']
const pooledCreation={skills:{
  occupation:{resolved:occupationList,budget:{total:248},spent:80,unspent:138,credit_rating:{value:30},allocations:{Accounting:45,'Library Use':35}},
  interest:{pool:['Dodge'],budget:{total:110},spent:31,unspent:79,allocations:{Dodge:26}}}}
const pooledSheet={...sheet,skills:poolSkills,creation:pooledCreation}
const pooledCard=(override:ReturnType<typeof vi.fn>,extra:Record<string,any>={})=>
  <CocCharacterDraft data={{revision:3,play_language:'en',sheet:pooledSheet,limits,presentation:{texts:{}},...extra}} onOverride={override as any}/>
const section=(dialog:HTMLElement,key:string)=>dialog.querySelector(`[data-skill-group="${key}"]`) as HTMLElement
const rowsOf=(dialog:HTMLElement,key:string)=>Array.from(section(dialog,key).querySelectorAll('[data-skill]')).map(node=>node.getAttribute('data-skill'))

it('draws every skill on the sheet under the pool the trade took it from',async()=>{
  const override=vi.fn(async()=>({}))
  render(pooledCard(override))
  const dialog=await openEditor()
  expect(Array.from(dialog.querySelectorAll('[data-skill-group]')).map(node=>node.getAttribute('data-skill-group'))).toEqual(['occupation','interest','other','custom'])
  expect(Array.from(dialog.querySelectorAll('[data-skill-group] h4')).map(node=>node.textContent)).toEqual(['Occupation skills','Interest skills','Other skills','Custom skills'])
  expect(rowsOf(dialog,'occupation')).toEqual(occupationList)
  expect(rowsOf(dialog,'interest')).toEqual(['Dodge'])
  // Credit Rating keeps its own field below and is never a skill row; Spot Hidden has no points
  // at all and is still listed, because a skill you cannot see is a skill you cannot move.
  expect(rowsOf(dialog,'other')).toEqual(['Spot Hidden'])
  // The occupation list is the trade's, as the kernel filled it: those rows have occupation money
  // to spend and a box to spend it in, and no other row does.
  expect(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'})).toBeTruthy()
  expect(within(dialog).queryByRole('textbox',{name:'Dodge Occupation points'})).toBeNull()
  expect(within(dialog).queryByRole('textbox',{name:'Spot Hidden Occupation points'})).toBeNull()
  // Nothing on this dialog asks the player which pool a skill belongs to; the trade answered that.
  expect(within(dialog).queryAllByRole('combobox')).toHaveLength(0)
  expect(override).not.toHaveBeenCalled()
})

it('sends no profile when only a number changed',async()=>{
  const override=vi.fn(async()=>({revision:4,sheet:pooledSheet,limits}))
  render(pooledCard(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'}),{target:{value:'55'}})
  fireEvent.click(within(dialog).getByRole('button',{name:'Save changes'}))
  await waitFor(()=>expect(override.mock.calls.some(call=>(call as any[])[0].dry_run===undefined)).toBe(true))
  for(const call of override.mock.calls)expect((call as any[])[0].profile).toBeUndefined()
})

/**
 * Age is a characteristic edit in everything but name: the kernel reruns the age table on the same
 * dice, so EDU, APP, movement and Luck move with it and the pinned numbers stay as typed. It rides
 * the same profile patch, and the preview shows what it did.
 */
it('sends a changed age as part of the profile patch, and previews what it did',async()=>{
  const aged={revision:3,sheet:{...pooledSheet,age:52,characteristics:{...characteristics,EDU:70,APP:50},derived:{...derived,MOV:7}},limits}
  const override=vi.fn(async()=>aged)
  render(pooledCard(override))
  const dialog=await openEditor()
  const field=within(dialog).getByRole('textbox',{name:'Age'})
  expect(field).toHaveProperty('value','28')
  expect(within(dialog).getByText('Age changes EDU, APP, movement and Luck.')).toBeTruthy()
  fireEvent.change(field,{target:{value:'52'}})
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{},profile:{age:52},dry_run:true}),{timeout:2000})
  await waitFor(()=>expect(within(dialog).getByText('7')).toBeTruthy())
  fireEvent.click(within(dialog).getByRole('button',{name:'Save changes'}))
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{},profile:{age:52}}))
})

/**
 * The point-buy allowance the rulebook prints. The dialog recomputes it from the eight fields on
 * screen -- Luck is rolled, never bought -- so the player watches the allowance move under the
 * cursor instead of after a round trip.
 */
it('recomputes the characteristic allowance from the fields being typed',async()=>{
  const override=vi.fn(async()=>({}))
  render(pooledCard(override,{budget:{characteristics:{total:460,spent:412,unspent:48}}}))
  const dialog=await openEditor()
  const line=()=>dialog.querySelector('.coc-draft-edit-characteristic-budget')?.textContent?.replace(/\s+/g,' ').trim()
  expect(line()).toBe('Characteristic points 412 / 460 · Points left 48')
  fireEvent.change(within(dialog).getByRole('textbox',{name:'STR'}),{target:{value:'90'}})
  expect(line()).toBe('Characteristic points 462 / 460 · Overspent by 2')
  fireEvent.change(within(dialog).getByRole('textbox',{name:'LUCK'}),{target:{value:'99'}})
  expect(line()).toBe('Characteristic points 462 / 460 · Overspent by 2')
})

it('says nothing about a characteristic allowance the card does not carry',async()=>{
  const override=vi.fn(async()=>({}))
  render(pooledCard(override))
  const dialog=await openEditor()
  expect(dialog.querySelector('.coc-draft-edit-characteristic-budget')).toBeNull()
})

/**
 * §98: the worksheet's own columns. A skill edit says what each pool bought, because a final value
 * cannot say which pool the player meant -- the reason raising one skill used to be refused for
 * overspending a budget they never touched.
 */
const worksheetCreation={skills:{
  bases:{Accounting:5,Dodge:22,'Library Use':20,'Spot Hidden':25,Anthropology:1,Appraise:5,Archaeology:1,Art:5,Charm:15,Climb:20},
  custom:['Language (Other: Latin)'],
  occupation:{resolved:occupationList,budget:{total:248},spent:80,unspent:138,credit_rating:{value:30},allocations:{Accounting:45,'Library Use':35}},
  interest:{pool:['Dodge'],budget:{total:110},spent:26,unspent:84,allocations:{Dodge:26}}}}
const worksheetSheet={...sheet,skills:{...poolSkills,'Language (Other: Latin)':1},creation:worksheetCreation}
const worksheet=(override:ReturnType<typeof vi.fn>,extra:Record<string,any>={})=>
  <CocCharacterDraft data={{revision:3,play_language:'en',sheet:worksheetSheet,limits,presentation:{texts:{}},...extra}} onOverride={override as any} {...(extra.onCatalog?{onCatalog:extra.onCatalog}:{})}/>

it('sends what each pool bought, not the sum',async()=>{
  const override=vi.fn(async()=>({revision:4,sheet:worksheetSheet,limits}))
  render(worksheet(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'}),{target:{value:'60'}})
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Dodge Interest points'}),{target:{value:'40'}})
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{skills:{Accounting:{interest:0,occupation:60},Dodge:{interest:40}}},dry_run:true}),{timeout:2000})
})

it('draws the printed base, the boxes and the sum, and takes the final from the kernel once it answers',async()=>{
  const previewed={revision:3,limits,sheet:{...worksheetSheet,skills:{...poolSkills,Accounting:75},
    creation:{...worksheetCreation,skills:{...worksheetCreation.skills,bases:{...worksheetCreation.skills.bases,Dodge:45}}}}}
  const override=vi.fn(async()=>previewed)
  render(worksheet(override))
  const dialog=await openEditor()
  const row=(name:string)=>(dialog.querySelector(`[data-skill="${name}"]`) as HTMLElement).textContent!.replace(/\s+/g,' ')
  expect(row('Accounting')).toContain('Base 5')
  expect(row('Accounting')).toContain('Final 50')
  // While the player types, the row adds up its own boxes.
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting Occupation points'}),{target:{value:'90'}})
  expect(row('Accounting')).toContain('Final 95')
  // When the kernel answers, its arithmetic -- which knows the starting cap -- replaces it, and
  // Dodge's base follows the characteristic it is half of.
  await waitFor(()=>expect(row('Accounting')).toContain('Final 75'),{timeout:2000})
  expect(row('Dodge')).toContain('Base 45')
})

it('offers the rulebook trades from the host and sends the chosen one as a profile fact',async()=>{
  const override=vi.fn(async()=>({revision:4,sheet:worksheetSheet,limits}))
  const catalog=vi.fn(async()=>({occupations:[{id:'lawyer',label:'Lawyer'},{id:'mechanic',label:'Mechanic'},{id:'nurse'}],skills:[],weapons:[]}))
  render(worksheet(override,{onCatalog:catalog}))
  const dialog=await openEditor()
  const picker=await within(dialog).findByRole('combobox',{name:'Occupation'})
  expect(Array.from(picker.querySelectorAll('option')).map(node=>node.textContent)).toContain('Mechanic')
  // An entry with no label is still selectable under its id, rather than an empty line.
  expect(Array.from(picker.querySelectorAll('option')).map(node=>node.textContent)).toContain('nurse')
  fireEvent.change(picker,{target:{value:'mechanic'}})
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{},profile:{occupation:'mechanic'},dry_run:true}),{timeout:2000})
  fireEvent.click(within(dialog).getByRole('button',{name:'Save changes'}))
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,edits:{},profile:{occupation:'mechanic'}}))
})

it('draws no trade picker when the host cannot answer with the book',async()=>{
  const override=vi.fn(async()=>({}))
  render(worksheet(override,{onCatalog:vi.fn(async()=>{throw new Error('runtime_unavailable')})}))
  const dialog=await openEditor()
  await new Promise(resolve=>setTimeout(resolve,20))
  // A dropdown with nothing in it reads as "the book has no occupations".
  expect(within(dialog).queryByRole('combobox',{name:'Occupation'})).toBeNull()
})

/**
 * A skill the book does not print. A language is one of these: the rulebook writes it as a
 * specialisation of Language, and a player who does not know that writes "Latin" and wonders why
 * the sheet has no Latin on it -- so the section says so where they are typing.
 */
it('adds a custom skill with its base and points, and takes it back off while it is unsaved',async()=>{
  const override=vi.fn(async()=>({revision:4,sheet:worksheetSheet,limits}))
  render(worksheet(override))
  const dialog=await openEditor()
  expect(within(dialog).getByText('A language you speak is written as Language (Other: name).')).toBeTruthy()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Skill name'}),{target:{value:'Language (Other: Greek)'}})
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Base'}),{target:{value:'1'}})
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Skill name Interest points'}),{target:{value:'40'}})
  fireEvent.click(within(dialog).getByRole('button',{name:'Add'}))
  const custom=section(dialog,'custom')
  expect(within(custom).getByText('Language (Other: Greek)')).toBeTruthy()
  expect(custom.querySelector('[data-skill="Language (Other: Greek)"]')?.textContent?.replace(/\s+/g,' ')).toContain('Final 41')
  await waitFor(()=>expect(override).toHaveBeenCalledWith({revision:3,
    edits:{skills:{'Language (Other: Greek)':{interest:40}}},
    profile:{custom_skills:[{name:'Language (Other: Greek)',base:1}]},dry_run:true}),{timeout:2000})
  fireEvent.click(within(custom).getByRole('button',{name:'Remove'}))
  expect(custom.querySelector('[data-skill="Language (Other: Greek)"]')).toBeNull()
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Save changes'})).toHaveProperty('disabled',true))
})

it('carries the saved custom skills with a new one, and tags the ones already on the sheet',async()=>{
  const override=vi.fn(async()=>({revision:4,sheet:worksheetSheet,limits}))
  const saved=[{name:'Language (Other: Latin)',base:1}]
  render(worksheet(override,{profile:{custom_skills:saved,occupation:'lawyer'}}))
  const dialog=await openEditor()
  // A saved custom skill is a skill like any other: it sits in its group, tagged.
  expect((dialog.querySelector('[data-skill="Language (Other: Latin)"]') as HTMLElement).textContent).toContain('Custom')
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Skill name'}),{target:{value:'Bagpipes'}})
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Base'}),{target:{value:'5'}})
  fireEvent.click(within(dialog).getByRole('button',{name:'Add'}))
  await waitFor(()=>expect((override.mock.calls.at(-1) as any[])[0].profile.custom_skills)
    .toEqual([{name:'Language (Other: Latin)',base:1},{name:'Bagpipes',base:5}]),{timeout:2000})
})

it('refuses to add a skill with no name, no base, or a name the sheet already has',async()=>{
  const override=vi.fn(async()=>({}))
  render(worksheet(override))
  const dialog=await openEditor()
  const custom=section(dialog,'custom')
  const add=()=>fireEvent.click(within(custom).getByRole('button',{name:'Add'}))
  add()
  expect(custom.querySelectorAll('[data-skill]')).toHaveLength(0)
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Skill name'}),{target:{value:'Dodge'}})
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Base'}),{target:{value:'22'}})
  add()
  expect(custom.querySelectorAll('[data-skill]')).toHaveLength(0)
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Skill name'}),{target:{value:'Bagpipes'}})
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Base'}),{target:{value:'x'}})
  add()
  expect(custom.querySelectorAll('[data-skill]')).toHaveLength(0)
})
