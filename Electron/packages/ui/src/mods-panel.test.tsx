// @vitest-environment jsdom
import React from 'react';
import {render, screen, fireEvent, cleanup, waitFor} from '@testing-library/react';
import {afterEach, test, expect, vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/mods-panel.js';

const Panel = createComponent(React);
afterEach(cleanup);
const row = {id:'natural-npc', version:'1.0.0', name:'Natural NPC', author:'PipiCOC', compatible:true,
  description:'First impressions', settings:{}, default_enabled:true, active:{enabled:true,version:'1.0.0'}};

test('lists disabled and enabled Mods and routes a toggle through the host', async () => {
  const invoke = vi.fn(async (method:string) => ({ok:true, data:{campaign:'c1',play_language:'en',mods:[row,
    {...row,id:'enhanced-items',name:'Enhanced Items',active:{enabled:false,version:'1.0.0'}}]}}));
  render(<Panel api={{invoke}} />);
  await screen.findByText('Natural NPC');
  expect(screen.getByText('Enhanced Items')).toBeTruthy();
  const toggles = screen.getAllByLabelText('Enabled in this campaign');
  expect((toggles[0] as HTMLInputElement).checked).toBe(true);
  expect((toggles[1] as HTMLInputElement).checked).toBe(false);
  fireEvent.click(toggles[0]);
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.configure',{id:'natural-npc',version:'1.0.0',enabled:false}));
});

test('an unbound session can manage defaults but cannot change a guessed campaign', async () => {
  const invoke = vi.fn(async ()=>({ok:true,data:{play_language:'en',mods:[row]}}));
  render(<Panel api={{invoke}} />);
  await screen.findByText('Natural NPC');
  expect((screen.getByLabelText('Enabled in this campaign') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Enable in new campaigns'));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.defaults',{id:'natural-npc',enabled:false}));
});

test('new versions are selectable without silently upgrading the campaign', async () => {
  const invoke = vi.fn(async ()=>({ok:true,data:{campaign:'c1',play_language:'en',mods:[row,{...row,version:'1.1.0'}]}}));
  render(<Panel api={{invoke}} />);
  await screen.findByText('Natural NPC');
  fireEvent.change(screen.getByLabelText('Natural NPC Version'),{target:{value:'1.1.0'}});
  expect(invoke).not.toHaveBeenCalledWith('mods.configure',expect.anything());
  fireEvent.click(screen.getByText('Use this version'));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.configure',{id:'natural-npc',version:'1.1.0'}));
});

test('shows override ownership and sends the complete user load order',async()=>{
  const rows=[row,{...row,id:'enhanced-items',name:'Enhanced Items'},{...row,id:'overhaul',name:'Overhaul'}];
  const invoke=vi.fn(async()=>({ok:true,data:{campaign:'c1',play_language:'en',mods:rows,
    order:['enhanced-items','natural-npc','overhaul'],providers:{materializer:['enhanced-items','overhaul']}}}));
  render(<Panel api={{invoke}}/>);
  await screen.findByText('Item generator · Overridden by: Overhaul');
  fireEvent.click(screen.getByRole('button',{name:'Enhanced Items Move later'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.order',{order:['natural-npc','enhanced-items','overhaul']}));
});
