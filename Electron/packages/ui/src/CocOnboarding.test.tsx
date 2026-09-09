// @vitest-environment jsdom
/**
 * The wizard's own words (§23). It shipped in one language with an `en` option beside it that only
 * changed what the Keeper would later write, so choosing English left the whole screen in Chinese.
 * Every caption now comes from the answer's `ui`, and the picker lists `content/languages.json`.
 */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import playLanguages from '../../../../content/languages.json';
import {CocOnboarding} from './CocOnboarding';
import {say,ui} from './fixtures/coc-ui-words';

type Row=Record<string,any>;
const zh=(key:string)=>say('zh-Hans','onboarding',key);
const DEFAULT=playLanguages.default;

/** Every onboarding answer carries the words for the language it was asked in. */
const answer=(data:Row,tag=DEFAULT)=>({ok:true,data:{ui:ui(tag),...data}});

afterEach(()=>{cleanup();localStorage.clear()});
it('shows three scenario entries and an honest empty prepared library',async()=>{
  const invokeExtension=vi.fn(async()=>answer({presets:[],modules:[],occupations:[]}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))});
  expect(screen.getByRole('button',{name:new RegExp(zh('source.pdf.title'))})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:new RegExp(zh('source.module.title'))}));
  await waitFor(()=>expect(screen.getByText(zh('emptyLibrary'))).toBeTruthy());
  expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'catalog',play_language:DEFAULT},{sessionId:'new'});
});

/**
 * The picker is the language list, by each language's own name for itself, and it opens at the
 * file's declared default. A hardcoded pair of `<option>`s meant a third language could ship its
 * whole content directory and never appear.
 */
it('lists every declared play language by its autonym and opens at the declared default',async()=>{
  const invokeExtension=vi.fn(async()=>answer({presets:[],modules:[],occupations:[]}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  const picker=await screen.findByLabelText(zh('playLanguage')) as HTMLSelectElement;
  expect(Array.from(picker.options).map(option=>option.value)).toEqual(Object.keys(playLanguages.languages));
  expect(Array.from(picker.options).map(option=>option.textContent))
    .toEqual(Object.values(playLanguages.languages).map(row=>(row as {autonym:string}).autonym));
  expect(picker.value).toBe(DEFAULT);
});

it('lists a starter by its authored blurb, not its folder slug, and re-reads the catalog in the chosen play language',async()=>{
  const cards:Record<string,Row[]>={'zh-Hans':[{id:'the-haunting',title:'鬼屋',blurb:'1920 年的波士顿，房东雇你查清一栋没人住得下去的老宅。'}],
    en:[{id:'the-haunting',title:'The Haunting',blurb:'Boston, 1920. A landlord hires you to find out what is wrong with the house nobody will keep.'}]};
  const invokeExtension=vi.fn(async(_id:string,_method:string,p:any)=>answer({presets:cards[p.play_language]||[],modules:[],occupations:[]},p.play_language));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  fireEvent.click(await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))}));
  expect(await screen.findByText('鬼屋')).toBeTruthy();
  expect(screen.getByText(/1920 年的波士顿/)).toBeTruthy();
  expect(screen.queryByText(/预设 · the-haunting/)).toBeNull();
  fireEvent.change(screen.getByLabelText(zh('playLanguage')),{target:{value:'en'}});
  expect(await screen.findByText('The Haunting')).toBeTruthy();
  expect(screen.getByText(/A landlord hires you/)).toBeTruthy();
  expect(screen.queryByText('鬼屋')).toBeNull();
});

/** The chrome follows the answer, not only the catalog rows: choosing English translates the page. */
it('switches its own captions with the language the answer carries',async()=>{
  const invokeExtension=vi.fn(async(_id:string,_method:string,p:any)=>answer({presets:[],modules:[],occupations:[]},p.play_language));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  await screen.findByText(zh('lede.start'));
  fireEvent.change(screen.getByLabelText(zh('playLanguage')),{target:{value:'en'}});
  await screen.findByText(say('en','onboarding','lede.start'));
  expect(screen.queryByText(zh('lede.start'))).toBeNull();
});

it('automatically opens the existing conversation after preparation without a character form',async()=>{
  const invokeExtension=vi.fn(async(_id,_method,p)=>answer(p.action==='catalog'?{presets:[{id:'the-haunting',title:'The Haunting'}],modules:[],occupations:[]}:p.action==='select'?{id:'import',name:'The Haunting',state:'ready'}:{id:'import',name:'The Haunting',state:'conversing'}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  fireEvent.click(await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))}));
  fireEvent.click(await screen.findByRole('button',{name:/The Haunting/}));
  await waitFor(()=>expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'converse',id:'import'},{sessionId:'new'}));
  expect(screen.queryByLabelText('调查员姓名')).toBeNull();
  expect(screen.queryByLabelText('职业')).toBeNull();
  expect(screen.queryByRole('button',{name:'创建角色'})).toBeNull();
});

it('restores paused preparation from the server without browser storage',async()=>{
  const invokeExtension=vi.fn(async()=>answer({presets:[],modules:[],occupations:[],current_import:{id:'retained',name:'Masks.pdf',state:'paused',pages:669,indexed:12}}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="same-session"/>);
  expect(await screen.findByRole('heading',{name:zh('pausedTitle')})).toBeTruthy();
  expect(screen.getByText('Masks.pdf')).toBeTruthy();
  expect(screen.getByRole('button',{name:zh('resume')})).toBeTruthy();
});

it.each(['restored','failed-chunk'])('can cancel a %s upload and return to scenario selection',async(origin)=>{
  const job={id:'interrupted',name:'Masks.pdf',state:'uploading',size:8,received:0};
  const catalog={presets:[],modules:[],occupations:[],...(origin==='restored'?{current_import:job}:{})};
  const invokeExtension=vi.fn(async(_id,_method,p)=>{
    if(p.action==='catalog')return answer(catalog);
    if(p.action==='begin')return answer(job);
    if(p.action==='chunk')return {ok:false,error:{code:'upload_retry',message:'Upload connection interrupted'}};
    if(p.action==='pause')return answer({...job,state:'paused'});
    if(p.action==='dismiss')return answer({...job,state:'paused',dismissed:true});
    throw new Error('Unexpected onboarding operation');
  });
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="interrupted-session"/>);
  await screen.findByLabelText(zh('choosePdf'));
  if(origin==='failed-chunk'){
    fireEvent.change(screen.getByLabelText(zh('choosePdf')),{target:{files:[new File(['%PDF-1.7'],'Masks.pdf',{type:'application/pdf'})]}});
    // The code is the caption; the host's English sentence is folded away, not printed at the player.
    const alert=await screen.findByRole('alert');
    await waitFor(()=>expect(alert.textContent).toContain(say('zh-Hans','errors','upload_retry')));
    expect(alert.querySelector('details')?.textContent).toContain('Upload connection interrupted');
  }
  fireEvent.click(await screen.findByRole('button',{name:zh('cancelUpload')}));
  await screen.findByRole('heading',{name:zh('pausedTitle')});
  expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'pause',id:'interrupted'},{sessionId:'interrupted-session'});
  fireEvent.click(screen.getByRole('button',{name:new RegExp(zh('back').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}));
  await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))});
  expect(screen.getByRole('button',{name:new RegExp(zh('source.pdf.title'))})).toBeTruthy();
  expect(screen.getByRole('button',{name:new RegExp(zh('source.module.title'))})).toBeTruthy();
});
