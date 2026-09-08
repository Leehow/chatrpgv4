// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {CocOnboarding} from './CocOnboarding';

afterEach(()=>{cleanup();localStorage.clear()});
it('shows three scenario entries and an honest empty prepared library',async()=>{
  const invokeExtension=vi.fn(async()=>({ok:true,data:{presets:[],modules:[],occupations:[]}}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  expect(screen.getByRole('button',{name:/选择预设剧本/})).toBeTruthy();
  expect(screen.getByRole('button',{name:/上传 PDF/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/选择已解析剧本/}));
  await waitFor(()=>expect(screen.getByText('还没有已解析的剧本')).toBeTruthy());
  expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'catalog'},{sessionId:'new'});
});
it('automatically opens the existing conversation after preparation without a character form',async()=>{
  const invokeExtension=vi.fn(async(_id,_method,p)=>({ok:true,data:p.action==='catalog'?{presets:[{id:'the-haunting',title:'The Haunting'}],modules:[],occupations:[]}:p.action==='select'?{id:'import',name:'The Haunting',state:'ready'}:{id:'import',name:'The Haunting',state:'conversing'}}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  fireEvent.click(screen.getByRole('button',{name:/选择预设剧本/}));
  fireEvent.click(await screen.findByRole('button',{name:/The Haunting/}));
  await waitFor(()=>expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'converse',id:'import'},{sessionId:'new'}));
  expect(screen.queryByLabelText('调查员姓名')).toBeNull();
  expect(screen.queryByLabelText('职业')).toBeNull();
  expect(screen.queryByRole('button',{name:'创建角色'})).toBeNull();
});

it('restores paused preparation from the server without browser storage',async()=>{
  const invokeExtension=vi.fn(async()=>({ok:true,data:{presets:[],modules:[],occupations:[],current_import:{id:'retained',name:'Masks.pdf',state:'paused',pages:669,indexed:12}}}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="same-session"/>);
  expect(await screen.findByRole('heading',{name:'准备已暂停'})).toBeTruthy();
  expect(screen.getByText('Masks.pdf')).toBeTruthy();
  expect(screen.getByRole('button',{name:'继续准备'})).toBeTruthy();
});

it.each(['restored','failed-chunk'])('can cancel a %s upload and return to scenario selection',async(origin)=>{
  const job={id:'interrupted',name:'Masks.pdf',state:'uploading',size:8,received:0};
  const catalog={presets:[],modules:[],occupations:[],...(origin==='restored'?{current_import:job}:{})};
  const invokeExtension=vi.fn(async(_id,_method,p)=>{
    if(p.action==='catalog')return {ok:true,data:catalog};
    if(p.action==='begin')return {ok:true,data:job};
    if(p.action==='chunk')return {ok:false,error:{message:'Upload connection interrupted'}};
    if(p.action==='pause')return {ok:true,data:{...job,state:'paused'}};
    if(p.action==='dismiss')return {ok:true,data:{...job,state:'paused',dismissed:true}};
    throw new Error('Unexpected onboarding operation');
  });
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="interrupted-session"/>);
  if(origin==='failed-chunk'){
    fireEvent.change(screen.getByLabelText('选择 PDF 剧本'),{target:{files:[new File(['%PDF-1.7'],'Masks.pdf',{type:'application/pdf'})]}});
    await screen.findByText('Upload connection interrupted');
  }
  fireEvent.click(await screen.findByRole('button',{name:'取消上传'}));
  await screen.findByRole('heading',{name:'准备已暂停'});
  expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'pause',id:'interrupted'},{sessionId:'interrupted-session'});
  fireEvent.click(screen.getByRole('button',{name:/返回选择剧本/}));
  await screen.findByRole('button',{name:/选择预设剧本/});
  expect(screen.getByRole('button',{name:/上传 PDF/})).toBeTruthy();
  expect(screen.getByRole('button',{name:/选择已解析剧本/})).toBeTruthy();
});
