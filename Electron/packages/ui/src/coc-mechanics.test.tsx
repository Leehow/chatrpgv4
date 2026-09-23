// @vitest-environment jsdom
import React from 'react'
import {render, cleanup, fireEvent} from '@testing-library/react'
import {afterEach, expect, it} from 'vitest'
// @ts-expect-error -- runtime pack asset
import {createComponent} from '../../../../pipicoc/mechanics.js'
import {mechanicsEntry, deliveryWords} from '../../pi-backend/src/coc-view'
import {ui} from './fixtures/coc-ui-words'

const Card = createComponent(React)
afterEach(cleanup)
const row = {public_combat:true,visibility:'public',actor_is_investigator:false,actor_label:'Masked visitor',target_label:'Alice',call:'t1-c1',family:'combat'}
const roll = {...row,kind:'roll',receipt:'r1',combat_action:'attack',skill:'Fighting',roll:31,target:60,threshold:60,difficulty:'regular',level:'regular',passed:true}
function entry(mechanics:unknown[],labels={}) {
  return {type:'custom',id:'card',customType:'coc-mechanics',timestamp:'2026-09-23',data:{turn:1,mechanics,labels}}
}
function draw(mechanics:unknown[], labels={}) {
  const projected=mechanicsEntry(entry(mechanics,labels),'fr',undefined,{ui:ui('en')})!
  const drawn=render(<Card details={projected.presentation!.details} />)
  for(const toggle of drawn.container.querySelectorAll<HTMLButtonElement>('.coc-mech-list button[aria-controls]'))fireEvent.click(toggle)
  return drawn.container
}
it('draws explicit source to target and each HP value, using the presenter skill word',()=>{
  const container=draw([roll,{...row,kind:'dice',receipt:'d1',word:'hp_damage',label:'HP Damage',faces:[3],total:3},
    {kind:'change',receipt:'hp1',family:'combat',call:'t1-c1',resource:'hp',public_combat:true,subject_label:'Alice',source_label:'Masked visitor',source_receipt:'d1',before:12,after:9}],{Fighting:'Combat rapproché'})
  for(const kind of ['roll','dice','change'])expect(container.querySelector(`[data-kind="${kind}"]`)?.textContent).toContain('Masked visitor → Alice')
  expect(container.querySelector('[data-kind="roll"]')?.textContent).toContain('Combat rapproché')
  expect(container.querySelector('[data-kind="change"] .coc-mech-figure')?.textContent).toBe('12 → 9')
})
it('keeps noncombat NPC anonymous and strips concealed combat labels, links and figures at the backend',()=>{
  const concealed={...roll,visibility:'concealed',bonus:1,source_receipt:'hidden-link',source_label:'Hidden source'}
  const projected=mechanicsEntry(entry([concealed,{...roll,visibility:'keeper'}]))!
  const rows=(projected.presentation!.details as any).mechanics
  expect(rows).toHaveLength(1)
  for(const key of ['actor_label','target_label','source_label','source_receipt','public_combat','combat_action','roll','target','bonus'])expect(rows[0]).not.toHaveProperty(key)
  const container=draw([{...roll,public_combat:undefined,actor_label:'Unintroduced identity'}])
  expect(container.textContent).not.toContain('Unintroduced identity')
  expect(container.textContent).not.toContain('Alice')
})
it('a missing safe name never changes a remaining name from recipient into roller or source into HP owner',()=>{
  const container=draw([
    {...roll,actor_label:undefined},
    {...row,kind:'dice',receipt:'d1',actor_label:undefined,label:'HP Damage',faces:[3],total:3},
    {kind:'change',receipt:'hp1',family:'combat',call:'t1-c1',resource:'hp',public_combat:true,source_label:'Alice',before:12,after:9},
  ])
  expect(container.querySelector('[data-kind="roll"] .coc-mech-who')).toBeNull()
  expect(container.querySelector('[data-kind="dice"] .coc-mech-who')).toBeNull()
  expect(container.querySelector('[data-kind="change"] .coc-mech-who')).toBeNull()
  expect(container.querySelector('[data-kind="change"] .coc-mech-figure')?.textContent).toBe('12 → 9')
})
it('a lone roller or HP recipient keeps its own role when the opposite name is unavailable',()=>{
  const container=draw([
    {...roll,target_label:undefined},
    {...row,kind:'dice',receipt:'d1',target_label:undefined,label:'HP Damage',faces:[3],total:3},
    {kind:'change',receipt:'hp1',family:'combat',call:'t1-c1',resource:'hp',public_combat:true,subject_label:'Alice',before:12,after:9},
  ])
  expect(container.querySelector('[data-kind="roll"] .coc-mech-who')?.textContent?.trim()).toBe('Masked visitor')
  expect(container.querySelector('[data-kind="dice"] .coc-mech-who')?.textContent?.trim()).toBe('Masked visitor')
  expect(container.querySelector('[data-kind="change"] .coc-mech-who')?.textContent?.trim()).toBe('Alice')
})
it('asks the existing rules lane for missing delivered skill terms, not seeded or keeper terms',()=>{
  expect(deliveryWords(entry([roll,{...roll,skill:'Secret check',visibility:'keeper'}]))).toEqual({rules:['Fighting']})
  expect(deliveryWords(entry([roll],{Fighting:'Projected term'}))).toEqual({})
})
it('never infers a damage target from another row and has no damage for a miss',()=>{
  const container=draw([{...roll,passed:false,level:'failure'},
    {kind:'roll',receipt:'other',skill:'Dodge',actor_is_investigator:true,actor_label:'Bob',roll:50,target:60,passed:true}])
  expect(container.querySelectorAll('[data-kind="dice"], [data-kind="change"]')).toHaveLength(0)
  expect(container.querySelector('[data-kind="roll"]')?.textContent).toContain('Masked visitor → Alice')
})
