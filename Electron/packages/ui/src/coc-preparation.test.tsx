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
 * A stalled preparation names its code where the player reads it; the host's English message is a
 * log line and goes behind `details`.
 */
it('captions a failed phase by its code and keeps the English message inside the fold',()=>{
  const failed=ready({preparation:{guidance:{state:'ready'},
    opening:{state:'failed',stage:'verify',error:{code:'preparation_failed',message:'reader pool exhausted'}}}});
  const {api}=harness(failed);
  render(<Preparation api={api} sessionId="s1"/>);
  // A stopped phase opens itself (see below), so the body is already the place to read.
  expect(screen.getByText(say('en','errors','preparation_failed'))).toBeTruthy();
  const fold=screen.getByText('reader pool exhausted').closest('details')!;
  expect(fold.querySelector('summary')?.textContent).toBe(say('en','errors','details'));
});

/**
 * BUG-039. Every standing line in this body says the opening arrives by itself -- "play will
 * continue when the opening is ready", "create your investigator while it prepares in the
 * background". A stopped phase is the one state where that is false, and a real table read it
 * beside a Resume control it therefore had no reason to touch: zero turns taken, and the player's
 * first sentence kept nowhere. A stopped phase says its own reason instead.
 */
it('a stopped phase never promises that the opening is still coming on its own',()=>{
  for(const state of ['failed','paused']){
    const {api}=harness(ready({character:{state:'confirmed'},
      preparation:{guidance:{state:'ready'},opening:{state,stage:'verify',
        error:{code:'preparation_failed',message:'reader pool exhausted'}}}}));
    render(<Preparation api={api} sessionId="s1"/>);
    for(const line of ['body.preparing','body.confirmed','body.ready','body.handoff'])
      expect(screen.queryByText(say('en','preparation',line))).toBeNull();
    expect(screen.getByText(say('en','errors','preparation_failed'))).toBeTruthy();
    expect(screen.getAllByRole('button',{name:say('en','preparation','resume')}).length).toBeGreaterThan(0);
    cleanup();
  }
});

/** The same panel while it is running still tells the player they can go on making a card. */
it('a running phase does say the opening is preparing in the background',()=>{
  const {api}=harness(ready({preparation:{guidance:{state:'ready'},opening:{state:'running',stage:'verify'}}}));
  render(<Preparation api={api} sessionId="s1"/>);
  fireEvent.click(screen.getByRole('button',{name:new RegExp(say('en','preparation','stage.verify'))}));
  expect(screen.getByText(say('en','preparation','body.preparing'))).toBeTruthy();
});

/**
 * BUG-005. A 669-page module sat seventeen minutes behind one folded line reading "preparing the
 * opening" while the panel already held a 12/13 count, a pause control, and a phase that had stopped
 * and was waiting to be resumed by hand. Nothing about any of that was visible without opening the
 * fold, and nothing about the collapsed line said there was anything to open it for. These three pin
 * the collapsed head, which is the only surface a waiting player actually looks at.
 */
const running=(over:Row={}):Row=>ready({preparation:{guidance:{state:'ready'},
  opening:{state:'running',stage:'verify',progress:{stage:'verify',reviewed:12,review_total:13}}},...over});

it('shows the source count and a determinate bar without the fold being opened',()=>{
  const {api}=harness(running());
  const {container}=render(<Preparation api={api} sessionId="s1"/>);
  expect(container.querySelector('.coc-preparation-body')).toBeNull();
  expect(container.querySelector('.coc-preparation-head .coc-preparation-count')?.textContent).toBe('12/13');
  const bar=container.querySelector('progress.coc-preparation-track') as HTMLProgressElement|null;
  expect(bar).toBeTruthy();
  expect(bar!.max).toBe(13);
  expect(bar!.value).toBe(12);
  // The digits are the count; the words naming them are still the shipped caption, in the snapshot's
  // language, so the guard cannot pass on a hand-written label.
  expect(bar!.getAttribute('aria-label')).toBe(say('en','preparation','reviewed').replace('{done}','12').replace('{total}','13'));
});

it('keeps resume in the head, so a stopped preparation is actionable with the fold closed',async()=>{
  const stopped=running({preparation:{guidance:{state:'ready'},
    opening:{state:'paused',stage:'verify',progress:{stage:'verify',reviewed:12,review_total:13}}}});
  const {api,invoke}=harness(stopped);
  const {container}=render(<Preparation api={api} sessionId="s1"/>);
  // Close the fold the stall opened: the affordance must survive a player who folds it away again.
  fireEvent.click(container.querySelector('.coc-preparation-toggle')!);
  expect(container.querySelector('.coc-preparation-body')).toBeNull();
  const resume=container.querySelector('.coc-preparation-head .coc-preparation-act') as HTMLButtonElement;
  expect(resume?.textContent).toBe(say('en','preparation','resume'));
  fireEvent.click(resume);
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('onboarding',{action:'resume',id:'job-1',target:'opening'}));
});

it('opens itself when a phase stops, and stays closed once the player folds it away',()=>{
  const stopped=running({preparation:{guidance:{state:'ready'},
    opening:{state:'failed',stage:'verify',progress:{stage:'verify',reviewed:12,review_total:13}}}});
  const {api}=harness(stopped);
  const {container}=render(<Preparation api={api} sessionId="s1"/>);
  expect(container.querySelector('.coc-preparation-body')).toBeTruthy();
  fireEvent.click(container.querySelector('.coc-preparation-toggle')!);
  expect(container.querySelector('.coc-preparation-body')).toBeNull();
});

it('leaves a running preparation folded: only a stall opens itself',()=>{
  const {api}=harness(running());
  const {container}=render(<Preparation api={api} sessionId="s1"/>);
  expect(container.querySelector('.coc-preparation-body')).toBeNull();
  expect(container.querySelector('.coc-preparation-head .coc-preparation-act')).toBeNull();
});
