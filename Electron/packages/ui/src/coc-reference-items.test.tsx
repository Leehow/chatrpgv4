// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen, waitFor, act} from '@testing-library/react';
import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest';
import {loadControlledContributions} from './controlled-component-loader';
import {getToolRenderer, type ToolRenderProps} from './ui-registries';
import {createMockHost} from './mock-host';
import type {PipiHostAPI} from '@pipi/host-api';
import type {Disposer} from './contribution-registry';
// @ts-expect-error -- the real pack is a plain ESM asset
import {createComponent as createPanel} from '../../../../pipicoc/panel.js';
// @ts-expect-error -- the real pack is a plain ESM asset
import {createComponent as createBoard} from '../../../../pipicoc/board.js';
import {ui} from './fixtures/coc-ui-words';
import enBoard from '../../../../content/ui/en/board.json';
import enHandout from '../../../../content/ui/en/handout.json';
import enPaper from '../../../../content/ui/en/paper.json';
import enSheet from '../../../../content/ui/en/sheet.json';
vi.mock('streamdown',()=>({Streamdown:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('@streamdown/code',()=>({code:{}}));
import {MessageView} from './Transcript';
import type {ChatMessage} from './transcript-model';

const Panel=createPanel(React), Board=createBoard(React), PACK='coc-keeper';
const image='data:image/png;base64,iVBORw0KGgo=';
const words=()=>{const base=ui('en');return {...base,words:{...base.words,board:enBoard,handout:enHandout,paper:enPaper}};};
const party=[{id:'alice',name:'Alice',weapons:[],equipment:[],objects:[]},{id:'ben',name:'Ben',weapons:[],equipment:[],objects:[]}];
const card={ui:words(),marked_text:'The clipping is visible. {{handout:clipping}}',
  mechanics:[{kind:'handout',handout:'clipping',name:'Clipping',receipt:'handout:clipping-t4',marker:'handout:clipping',document:'ready',image}]};
let disposers:Disposer[]=[];
beforeAll(async()=>{disposers=await loadControlledContributions({id:PACK,directory:'/tmp/coc-keeper',
  ui:{toolRenderers:[{tool:'coc-mechanics',entry:'pipicoc/mechanics.js'}]}},createMockHost() as PipiHostAPI,
  // @ts-expect-error -- the real pack is a plain ESM asset
  async()=>import('../../../../pipicoc/mechanics.js'));});
afterAll(()=>{for(const dispose of disposers)dispose();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function drawCard(invoke?:ToolRenderProps['onInvokeExtension'],collectionWritable?:boolean) {
  return render(<>{getToolRenderer('coc-mechanics')!.render!({tool:{id:'card',name:'coc-mechanics',input:'',startedAt:0,finished:true},
    content:'',details:card,elapsed:()=>'',onInvokeExtension:invoke,collectionWritable})}</>);
}

test('the modern controlled card collects only the selected investigator and category through its bound host',async()=>{
  const invoke=vi.fn(async(_extension:string,method:string)=>{
    if(method==='sheet')return {view:{investigators:party},collection_writable:true};
    if(method==='mods.document.collect')return {reference:{id:'stable-reference',status:'queued'}};
    throw new Error('Unexpected fictional operation');
  });
  const {container}=drawCard(invoke,true);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Save',hidden:true}));
  const selects=await screen.findAllByRole('combobox',{hidden:true});
  expect(screen.getByRole('combobox',{name:enSheet.identityTitle,hidden:true})).toBe(selects[0]);
  fireEvent.change(selects[0],{target:{value:'ben'}});
  fireEvent.change(selects[1],{target:{value:'map'}});
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Save',hidden:true}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith(PACK,'mods.document.collect',
    {actor:'ben',handout:'clipping',presentation:'map'}));
  await waitFor(()=>expect(container.querySelector('[data-reference-id="stable-reference"]')).toBeTruthy());
  expect(invoke.mock.calls.map(call=>call[1])).toEqual(['sheet','mods.document.collect']);
});

test('archive or missing writable capability hides collection while retaining the original image',()=>{
  const invoke=vi.fn();
  const first=drawCard(invoke,false);
  expect(screen.queryByRole('button',{name:'Save',hidden:true})).toBeNull();
  expect(first.container.querySelector('img.coc-map-image')).toBeTruthy();
  first.unmount();
  drawCard(invoke);
  expect(screen.queryByRole('button',{name:'Save',hidden:true})).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

test('a current host lease refusal prevents collection even when a transcript was previously writable',async()=>{
  const invoke=vi.fn(async()=>({collection_writable:false,view:{investigators:party}}));
  drawCard(invoke,true);
  fireEvent.click(screen.getByRole('button',{name:'Save',hidden:true}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Save',hidden:true})).toBeNull());
  expect(invoke).toHaveBeenCalledTimes(1);
});

test('the modern transcript forwards collection capability separately from the read-only host call',async()=>{
  const invoke=vi.fn(async()=>({collection_writable:true,view:{investigators:party}}));
  const message={id:'visible-card',role:'assistant',content:'',timestamp:1,
    presentation:{renderer:'coc-mechanics',details:card}} as unknown as ChatMessage;
  const props={message,onInvokeExtension:invoke,onCopy:vi.fn(async()=>undefined),onResend:()=>undefined,resendDisabled:false};
  const entry=render(<MessageView {...props} collectionWritable/>);
  fireEvent.click(screen.getByRole('button',{name:'Save',hidden:true}));
  await screen.findAllByRole('combobox',{hidden:true});
  expect(invoke).toHaveBeenCalledWith(PACK,'sheet',{});
  entry.rerender(<MessageView {...props} collectionWritable={false}/>);
  expect(screen.queryByRole('button',{name:'Save',hidden:true})).toBeNull();
  expect(screen.getByRole('button',{name:enHandout.translate,hidden:true})).toBeTruthy();
});

test('the card polls the same queued reference without reissuing collection',async()=>{
  const invoke=vi.fn(async(_extension:string,method:string)=>{
    if(method==='sheet')return {collection_writable:true,view:{investigators:party}};
    if(method==='mods.document.collect')return {reference:{id:'card-reference',status:'queued'}};
    if(method==='mods.document.references')return {references:[{id:'card-reference',actor_id:'alice',status:'ready'}]};
    throw new Error('Unexpected operation');
  });
  drawCard(invoke,true);
  fireEvent.click(screen.getByRole('button',{name:'Save',hidden:true}));
  await screen.findAllByRole('combobox',{hidden:true});
  fireEvent.click(screen.getByRole('button',{name:'Save',hidden:true}));
  await screen.findByText('Saved',{exact:true},{timeout:2000});
  expect(invoke).toHaveBeenCalledWith(PACK,'mods.document.references',{actor:'alice'});
  expect(invoke.mock.calls.filter(([,method])=>method==='mods.document.collect')).toHaveLength(1);
});

test('the actual board exposes a revealed map source and retains a collection refusal',async()=>{
  const invoke=vi.fn(async(method:string)=>{
    if(method==='board')return {ok:true,data:{campaign:'c1',status:'ready',collection_writable:true,ui:words(),
      view:{investigators:party,clues:{discovered:[]},npcs:{journal:[]}},
      maps:[{map:'Public house map',name:'House',document:'ready',image}]}};
    if(method==='mods.document.collect')return {ok:false,error:{code:'not_owned',message:'Lease rejected'}};
    throw new Error('Unexpected operation');
  });
  render(<Board api={{invoke}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Save'}));
  const category=screen.getAllByRole('combobox')[1] as HTMLSelectElement;
  expect(screen.getByRole('combobox',{name:enSheet.identityTitle})).toBe(screen.getAllByRole('combobox')[0]);
  expect(Array.from(category.options).map(option=>option.value)).toEqual(['map','image']);
  expect(category.value).toBe('map');
  fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await screen.findByRole('alert');
  expect(invoke).toHaveBeenCalledWith('mods.document.collect',{actor:'alice',handout:'Public house map',presentation:'map'});
});

test('the backpack keeps reference identity across asynchronous completion and opens only the readonly reference',async()=>{
  let status='queued',notify=()=>{};
  const reference={id:'same-id',actor_id:'alice',worldline:'line',name:'House reference',handout:'House',presentation:'map',editing:'read_only'};
  const invoke=vi.fn(async(method:string,params:any)=>{
    if(method==='sheet')return {ok:true,data:{campaign:'c1',ui:words(),view:{investigators:party}}};
    if(method==='mods.document.references')return {ok:true,data:{references:params.actor==='alice'?[{...reference,status}]:[]}};
    if(method==='mods.document.view')return {ok:true,data:{name:reference.name,presentation:'map',editing:'read_only',image,actor:'Alice'}};
    throw new Error('Reference must not call the physical editor');
  });
  const {container}=render(<Panel api={{invoke,subscribeExt:(listener:()=>void)=>{notify=listener;return()=>{};}}}/>);
  await waitFor(()=>expect(container.querySelector('[data-reference-id="same-id"]')?.getAttribute('data-reference-status')).toBe('queued'));
  expect(screen.queryByRole('button',{name:/House reference/})).toBeNull();
  expect(container.querySelector('.coc-inventory-group')?.textContent).toBe('Maps');
  status='ready';
  await act(async()=>{notify();});
  const open=await screen.findByRole('button',{name:/House reference/});
  expect(container.querySelectorAll('[data-reference-id="same-id"]')).toHaveLength(1);
  fireEvent.click(open);
  const dialog=await screen.findByRole('dialog',{name:'House reference'});
  await waitFor(()=>expect(dialog.querySelector('img')?.getAttribute('src')).toBe(image));
  expect(invoke).toHaveBeenCalledWith('mods.document.view',{actor:'alice',reference_id:'same-id'});
  expect(dialog.querySelector('textarea')).toBeNull();
  expect(screen.queryByRole('button',{name:'Save',exact:true})).toBeNull();
  expect(screen.queryByRole('button',{name:'Restore acquisition original'})).toBeNull();
  expect(invoke.mock.calls.some(([method])=>['mods.document.apply','mods.document.request','sendPrompt'].includes(method))).toBe(false);
});

test('actor selection excludes another owner and a refused reference cannot be opened or edited',async()=>{
  const invoke=vi.fn(async(method:string,params:any)=>{
    if(method==='sheet')return {ok:true,data:{campaign:'c1',ui:words(),view:{investigators:party}}};
    if(method==='mods.document.references')return {ok:true,data:{references:[
      {id:'a',actor_id:'alice',name:'Alice image',presentation:'image',status:'ready'},
      {id:'b',actor_id:'ben',name:'Ben image',presentation:'image',status:'refused'},
    ]}};
    throw new Error('Unexpected view or write');
  });
  const {container}=render(<Panel api={{invoke}}/>);
  await screen.findByRole('button',{name:/Alice image/});
  expect(screen.queryByText('Ben image')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Ben',exact:true}));
  await screen.findByText('Ben image');
  expect(screen.queryByText('Alice image')).toBeNull();
  expect(screen.queryByRole('button',{name:/Ben image/})).toBeNull();
  expect(container.querySelector('[data-reference-id="b"]')?.getAttribute('data-reference-status')).toBe('refused');
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith('mods.document.references',{actor:'ben'});
});
