// @vitest-environment jsdom
/**
 * The preparation overlay's words come from the snapshot's own `ui` (§23). It shipped English-only,
 * which read as a language rule nobody had chosen, so both languages are exercised here.
 */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/preparation.js';
import {say,ui} from './fixtures/coc-ui-words';
const Preparation=createComponent(React);

type Row=Record<string,any>;
function harness(job:Row|null,tag='en'){
  let current:Row|null=job&&{ok:true,data:{current_import:job,ui:ui(tag)}};
  const listeners=new Set<()=>void>();
  const invoke=vi.fn(async(_method:string,params:Row)=>{
    if(params.action==='hide'){current={ok:true,data:{current_import:{...job!,hidden:true},ui:ui(tag)}};for(const listener of listeners)listener();}
    return {ok:true,data:{}};
  });
  const api={invoke,observe:()=>({subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)},
    snapshot:()=>current,refresh:async()=>{}})};
  return {api,invoke};
}
const ready=(over:Row={}):Row=>({id:'job-1',name:'Mystery House',campaign:'game-1',playing:false,
  character:{state:'draft'},preparation:{guidance:{state:'ready'},opening:{state:'ready'}},...over});

afterEach(cleanup);

it('offers to hide the overlay only once the opening is ready',()=>{
  const running=ready({preparation:{guidance:{state:'ready'},opening:{state:'running',stage:'verify'}}});
  const {api}=harness(running);
  render(<Preparation api={api} sessionId="s1"/>);
  expect(screen.getByText(say('en','preparation','stage.verify'))).toBeTruthy();
  expect(screen.queryByRole('button',{name:say('en','preparation','hide')})).toBeNull();
});

it('hides the finished overlay and keeps it hidden',async()=>{
  const {api,invoke}=harness(ready());
  render(<Preparation api={api} sessionId="s1"/>);
  fireEvent.click(screen.getByRole('button',{name:say('en','preparation','hide')}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('onboarding',{action:'hide',id:'job-1'}));
  await waitFor(()=>expect(screen.queryByText(say('en','preparation','ready'))).toBeNull());
});

it('stays out of the way once play begins',()=>{
  const {api}=harness(ready({playing:true}));
  const {container}=render(<Preparation api={api} sessionId="s1"/>);
  expect(container.querySelector('.coc-preparation-overlay')).toBeNull();
});

/** The same snapshot in the other language reads in that language, with nothing left in English. */
it('reads a zh-Hans snapshot in zh-Hans',()=>{
  const running=ready({preparation:{guidance:{state:'ready'},opening:{state:'running',stage:'verify'}}});
  const {api}=harness(running,'zh-Hans');
  render(<Preparation api={api} sessionId="s1"/>);
  expect(screen.getByText(say('zh-Hans','preparation','stage.verify'))).toBeTruthy();
  expect(screen.queryByText(say('en','preparation','stage.verify'))).toBeNull();
});

/**
 * A stalled preparation names its code; the host's English sentence goes inside the fold, not into
 * the summary a player reads.
 */
it('captions a failed phase by its code and keeps the English message inside the fold',()=>{
  const failed=ready({preparation:{guidance:{state:'ready'},
    opening:{state:'failed',stage:'verify',error:{code:'preparation_failed',message:'reader pool exhausted'}}}});
  const {api}=harness(failed);
  render(<Preparation api={api} sessionId="s1"/>);
  fireEvent.click(screen.getByRole('button',{name:new RegExp(say('en','preparation','failed'))}));
  const fold=screen.getByText('reader pool exhausted').closest('details')!;
  expect(fold.querySelector('summary')?.textContent).toBe(say('en','errors','preparation_failed'));
});
