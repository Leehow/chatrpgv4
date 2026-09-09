// @vitest-environment jsdom
/**
 * The Mod manager's chrome comes from the answer's `ui` (§23) and a Mod's own name and description
 * come from its manifest. Two Mods used to be named in this file by id, which meant every other Mod
 * stayed in whatever language its author wrote and nobody could tell why.
 */
import React from 'react';
import {render, screen, fireEvent, cleanup, waitFor} from '@testing-library/react';
import {afterEach, test, expect, vi} from 'vitest';
import {authored, createComponent} from '../../../../pipicoc/mods-panel.js';
import {say, ui} from './fixtures/coc-ui-words';

const Panel = createComponent(React);
afterEach(cleanup);
const row = {id:'natural-npc', version:'1.0.0', name:'Natural NPC', author:'PipiCOC', compatible:true,
  description:'First impressions', settings:{}, default_enabled:true, active:{enabled:true,version:'1.0.0'}};
const en = (key:string) => say('en', 'mods', key);

test('lists disabled and enabled Mods and routes a toggle through the host', async () => {
  const invoke = vi.fn(async (method:string) => ({ok:true, data:{campaign:'c1',ui:ui('en'),mods:[row,
    {...row,id:'enhanced-items',name:'Enhanced Items',active:{enabled:false,version:'1.0.0'}}]}}));
  render(<Panel api={{invoke}} />);
  await screen.findByText('Natural NPC');
  expect(screen.getByText('Enhanced Items')).toBeTruthy();
  const toggles = screen.getAllByLabelText(en('campaign'));
  expect((toggles[0] as HTMLInputElement).checked).toBe(true);
  expect((toggles[1] as HTMLInputElement).checked).toBe(false);
  fireEvent.click(toggles[0]);
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.configure',{id:'natural-npc',version:'1.0.0',enabled:false}));
});

test('an unbound session can manage defaults but cannot change a guessed campaign', async () => {
  const invoke = vi.fn(async ()=>({ok:true,data:{ui:ui('en'),mods:[row]}}));
  render(<Panel api={{invoke}} />);
  await screen.findByText('Natural NPC');
  expect((screen.getByLabelText(en('campaign')) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(en('defaults')));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.defaults',{id:'natural-npc',enabled:false}));
});

test('new versions are selectable without silently upgrading the campaign', async () => {
  const invoke = vi.fn(async ()=>({ok:true,data:{campaign:'c1',ui:ui('en'),mods:[row,{...row,version:'1.1.0'}]}}));
  render(<Panel api={{invoke}} />);
  await screen.findByText('Natural NPC');
  fireEvent.change(screen.getByLabelText(`Natural NPC ${en('version')}`),{target:{value:'1.1.0'}});
  expect(invoke).not.toHaveBeenCalledWith('mods.configure',expect.anything());
  fireEvent.click(screen.getByText(en('update')));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.configure',{id:'natural-npc',version:'1.1.0'}));
});

test('shows override ownership and sends the complete user load order',async()=>{
  const rows=[row,{...row,id:'enhanced-items',name:'Enhanced Items'},{...row,id:'overhaul',name:'Overhaul'}];
  const invoke=vi.fn(async()=>({ok:true,data:{campaign:'c1',ui:ui('en'),mods:rows,
    order:['enhanced-items','natural-npc','overhaul'],providers:{materializer:['enhanced-items','overhaul']}}}));
  render(<Panel api={{invoke}}/>);
  await screen.findByText(`${en('slot.materializer')} · ${en('overridden')}: Overhaul`);
  fireEvent.click(screen.getByRole('button',{name:`Enhanced Items ${en('later')}`}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.order',{order:['natural-npc','enhanced-items','overhaul']}));
});

/**
 * A Mod's own words. The manifest may carry one wording or one per language; the panel reads the
 * session's tag, and a Mod that speaks only a language the player does not is still better named
 * by its author's word than by its id.
 */
test('reads a Mod name and description at the session language',async()=>{
  const multilingual={...row, name:{en:'Natural NPC','zh-Hans':'自然 NPC 行为'},
    description:{en:'First impressions','zh-Hans':'以外貌留下初见印象。'}};
  const invoke=vi.fn(async()=>({ok:true,data:{campaign:'c1',ui:ui('zh-Hans'),mods:[multilingual]}}));
  render(<Panel api={{invoke}}/>);
  await screen.findByText('自然 NPC 行为');
  // The description prints once as the card's blurb and once as the changelog fallback.
  expect(screen.getAllByText('以外貌留下初见印象。')).toHaveLength(2);
  expect(screen.queryByText('Natural NPC')).toBeNull();
  expect(screen.queryByText('First impressions')).toBeNull();
});

test('authored() picks the tag, then any wording, then nothing',()=>{
  expect(authored('One wording','zh-Hans')).toBe('One wording');
  expect(authored({en:'English','zh-Hans':'中文'},'zh-Hans')).toBe('中文');
  expect(authored({en:'English'},'zh-Hans')).toBe('English');
  expect(authored(undefined,'en')).toBe('');
});

/** Before the first answer there are no words, so the panel shows none. */
test('draws an ellipsis before mods.list answers',()=>{
  const {container}=render(<Panel api={{invoke:()=>new Promise(()=>{})}}/>);
  expect(container.textContent).toContain('…');
  expect(container.textContent).not.toContain(en('refresh'));
  expect(container.textContent).not.toContain(say('zh-Hans','mods','refresh'));
  expect(container.textContent).not.toContain(en('unbound'));
});

/** A refused request is captioned by its code; the host's English message stays behind the fold. */
test('captions a refused mods request by its code',async()=>{
  const invoke=vi.fn(async(method:string)=>method==='mods.list'
    ?{ok:true,data:{campaign:'c1',ui:ui('zh-Hans'),mods:[row]}}
    :{ok:false,error:{code:'operation_in_progress',message:'a turn is settling'}});
  render(<Panel api={{invoke}}/>);
  fireEvent.click(await screen.findByLabelText(say('zh-Hans','mods','campaign')));
  const alert=await screen.findByRole('alert');
  expect(alert.firstChild?.textContent).toBe(say('zh-Hans','errors','operation_in_progress'));
  expect(alert.textContent).not.toBe('a turn is settling');
  expect(alert.querySelector('summary')?.textContent).toBe(say('zh-Hans','errors','details'));
  expect(alert.querySelector('details')?.textContent).toContain('a turn is settling');
});
