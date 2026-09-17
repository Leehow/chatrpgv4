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
  expect(within(dialog).getByRole('textbox',{name:'Accounting'})).toHaveProperty('value','50')
  expect(within(dialog).getByRole('textbox',{name:'Credit Rating'})).toHaveProperty('value','30')
  // Credit Rating is edited in its own field, never duplicated as a skill input.
  expect(within(dialog).getAllByRole('textbox',{name:'Credit Rating'})).toHaveLength(1)
  expect(within(dialog).getAllByText('Allowed range: 15 – 90')).toHaveLength(9)
  expect(within(dialog).getByText('Allowed range: 5 – 75')).toBeTruthy()
  expect(within(dialog).getByText('Allowed range: 22 – 75')).toBeTruthy()
  expect(within(dialog).getByText('Allowed range: 20 – 75')).toBeTruthy()
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
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting'}),{target:{value:'80'}})
  expect(await within(dialog).findByText(/Not enough occupation points/)).toBeTruthy()
  expect(within(dialog).getByRole('textbox',{name:'Accounting'}).getAttribute('aria-invalid')).toBe('true')
})

it('§92 reports a pool refusal as arithmetic and a way out, never as the field\'s own range',async()=>{
  // Both pools start fully spent, so raising one value is the first thing every player meets. The
  // refusal used to end in the offending field's legal range -- a range the entered value is
  // already inside -- which reads as a number refused for being where it is allowed to be.
  const override=vi.fn(async()=>({ok:false,error:{code:'needs',message:'The occupation point budget is exceeded',details:{pool:'occupation',total:184,spend:194,field:'Accounting',range:[25,75]}}}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting'}),{target:{value:'60'}})
  const refusal=await within(dialog).findByText(/Not enough occupation points/)
  expect(refusal.textContent).toContain('194 / 184')
  expect(refusal.textContent).toMatch(/another skill in the same pool/)
  expect(refusal.textContent).not.toMatch(/25 . 75/)
})

it('§92 a bound refusal still names the range, which is what it is about',async()=>{
  const override=vi.fn(async()=>({ok:false,error:{code:'needs',message:'A skill stays between its recomputed base and the starting cap',details:{field:'Accounting',range:[25,75],attempted:90}}}))
  render(card(override))
  const dialog=await openEditor()
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Accounting'}),{target:{value:'90'}})
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
