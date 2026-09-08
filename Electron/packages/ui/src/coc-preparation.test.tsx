// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/preparation.js';
const Preparation=createComponent(React);

type Row=Record<string,any>;
function harness(job:Row|null){
  let current:Row|null=job&&{ok:true,data:{current_import:job}};
  const listeners=new Set<()=>void>();
  const invoke=vi.fn(async(_method:string,params:Row)=>{
    if(params.action==='hide'){current={ok:true,data:{current_import:{...job!,hidden:true}}};for(const listener of listeners)listener();}
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
  expect(screen.getByText('Verifying opening sources')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Hide preparation status'})).toBeNull();
});

it('hides the finished overlay and keeps it hidden',async()=>{
  const {api,invoke}=harness(ready());
  render(<Preparation api={api} sessionId="s1"/>);
  fireEvent.click(screen.getByRole('button',{name:'Hide preparation status'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('onboarding',{action:'hide',id:'job-1'}));
  await waitFor(()=>expect(screen.queryByText('Opening ready')).toBeNull());
});

it('stays out of the way once play begins',()=>{
  const {api}=harness(ready({playing:true}));
  const {container}=render(<Preparation api={api} sessionId="s1"/>);
  expect(container.querySelector('.coc-preparation-overlay')).toBeNull();
});
