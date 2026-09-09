// @vitest-environment jsdom
import React from 'react';
import {render, screen, fireEvent, cleanup, waitFor} from '@testing-library/react';
import {afterEach, test, expect, vi} from 'vitest';
import {createComponent, createDocumentEditor} from '../../../../pipicoc/panel.js';
import {say, ui} from './fixtures/coc-ui-words';

const Editor=createDocumentEditor(React), Panel=createComponent(React);
afterEach(cleanup);

test('localized reading waits without resubmitting a save and keeps the canonical handle',async()=>{
  let reads=0, saved=false;
  const snapshot={name:'Commission slip',display_name:'委托纸条',play_language:'zh-Hans',actor:'i',
    text:'每天 $20。',original:'每天 $20。',version:'one',editor:{renderer:'paper'}};
  const invoke=vi.fn(async(method:string,params:any)=>{
    if(method==='mods.document.apply'){saved=true;return {ok:true,data:{pending:true}};}
    reads++;
    return {ok:true,data:reads===1?{pending:true}:{...snapshot,...(saved?{text:'My note',version:'two'}:{})}};
  });
  render(<Editor api={{invoke}} name="Commission slip" actor="i" ui={ui("zh-Hans")} onClose={()=>{}}/>);
  const heading=await screen.findByRole('heading',{name:'委托纸条'},{timeout:2000});
  expect(heading).toBeTruthy();
  expect(screen.getByRole('dialog').getAttribute('lang')).toBe('zh-Hans');
  const body=screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(body.value).toBe('每天 $20。');
  fireEvent.change(body,{target:{value:'My note'}});
  fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));
  await waitFor(()=>expect(body.readOnly).toBe(false),{timeout:2000});
  expect(invoke.mock.calls.filter(([method])=>method==='mods.document.apply')).toHaveLength(1);
  expect(invoke).toHaveBeenCalledWith('mods.document.apply',expect.objectContaining({name:'Commission slip',text:'My note'}));
});

function host(original='Meet at the station.') {
  let value={name:'Notebook',actor:'Investigator',text:original,original,version:'v1',presentation:'notebook',editor:{renderer:'paper',provider:'enhanced-items'}};
  const invoke=vi.fn(async(method:string,params:any)=>{
    if(method==='mods.document.view')return {ok:true,data:{...value}};
    if(params.version!==value.version)return {ok:false,error:{code:'revision_conflict'}};
    value={...value,text:params.action==='reset'?value.original:params.text,version:value.version+'x'};
    return {ok:true,data:{...value}};
  });
  return {invoke};
}

test('edits persist on reopening and Reset uses the server acquisition original',async()=>{
  const api=host();const close=vi.fn();
  const first=render(<Editor api={api} name="Notebook" actor="i" ui={ui("en")} onClose={close}/>);
  const body=await screen.findByLabelText('Document text');
  await waitFor(()=>expect((body as HTMLTextAreaElement).value).toBe('Meet at the station.'));
  fireEvent.change(body,{target:{value:'<script>literal text</script>\nMy annotation'}});
  fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
  await waitFor(()=>expect(api.invoke).toHaveBeenCalledWith('mods.document.apply',expect.objectContaining({action:'save',text:'<script>literal text</script>\nMy annotation'})));
  await screen.findByText('Edited since acquisition');
  first.unmount();
  render(<Editor api={api} name="Notebook" actor="i" ui={ui("en")} onClose={close}/>);
  await waitFor(()=>expect((screen.getByLabelText('Document text') as HTMLTextAreaElement).value).toContain('My annotation'));
  fireEvent.click(screen.getByRole('button',{name:'Restore acquisition original'}));
  await waitFor(()=>expect((screen.getByLabelText('Document text') as HTMLTextAreaElement).value).toBe('Meet at the station.'));
  const reset=api.invoke.mock.calls.find(([,p])=>p?.action==='reset')?.[1];
  expect(reset).not.toHaveProperty('text');expect(reset).not.toHaveProperty('original');
});

test('blank papers accept multiline writing and closing protects an unsaved draft',async()=>{
  const api=host('');const close=vi.fn();
  render(<Editor api={api} name="Notebook" actor="i" ui={ui("en")} onClose={close}/>);
  await waitFor(()=>expect((screen.getByLabelText('Document text') as HTMLTextAreaElement).readOnly).toBe(false));
  fireEvent.change(screen.getByLabelText('Document text'),{target:{value:'First line\nSecond line'}});
  fireEvent.click(screen.getByRole('button',{name:'Close',exact:true}));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));
  expect((screen.getByLabelText('Document text') as HTMLTextAreaElement).value).toBe('First line\nSecond line');
  fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));
  fireEvent.click(screen.getByRole('button',{name:'Save and close'}));
  await waitFor(()=>expect(close).toHaveBeenCalledOnce());
});

test('a conflict retains the draft and reload obtains a fresh revision before saving',async()=>{
  let current='v1';
  const invoke=vi.fn(async(method:string,params:any)=>{
    if(method==='mods.document.view')return {ok:true,data:{text:'Remote writing',original:'Original',version:current,editor:{renderer:'plain'}}};
    if(current==='v1'){current='v2';return{ok:false,error:{code:'revision_conflict'}};}
    return {ok:true,data:{text:params.text,original:'Original',version:'v3',editor:{renderer:'plain'}}};
  });
  render(<Editor api={{invoke}} name="Notebook" actor="i" ui={ui("en")} onClose={()=>{}}/>);
  await waitFor(()=>expect((screen.getByLabelText('Document text') as HTMLTextAreaElement).value).toBe('Remote writing'));
  fireEvent.change(screen.getByLabelText('Document text'),{target:{value:'My retained draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
  // The conflict is a code now, so the caption is the `errors` surface's word for it rather than
  // whatever sentence the host happened to put in `message`.
  await screen.findByText(say('en','errors','revision_conflict'));
  expect((screen.getByLabelText('Document text') as HTMLTextAreaElement).value).toBe('My retained draft');
  fireEvent.click(screen.getByRole('button',{name:'Reload paper'}));
  await screen.findByText(/Latest version loaded/);
  expect((screen.getByLabelText('Document text') as HTMLTextAreaElement).value).toBe('My retained draft');
  fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.document.apply',expect.objectContaining({version:'v2',text:'My retained draft'})));
});

test('inventory clicks use the document capability rather than an item-name keyword',async()=>{
  const invoke=vi.fn(async(method:string)=> method==='sheet'?{ok:true,data:{campaign:'c1',ui:ui('en'),view:{play_language:'en',investigators:[{
    id:'i',name:'Investigator',equipment:[{name:'Folded leaf'},{name:'Notebook-shaped box'}],weapons:[],objects:[
      {name:'Folded leaf',category:'item',parameters:{},state:{},document:{presentation:'paper'}},
      {name:'Notebook-shaped box',category:'item',parameters:{},state:{}}]}]}}}:
    {ok:true,data:{text:'Known note',original:'Known note',version:'v1',editor:{renderer:'paper'}}});
  render(<Panel api={{invoke}}/>);
  await screen.findByText('Folded leaf');
  expect(screen.queryByRole('button',{name:/Notebook-shaped box/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Folded leaf/}));
  await screen.findByRole('dialog',{name:'Folded leaf'});
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('mods.document.view',{name:'Folded leaf',actor:'i'}));
});
