// @vitest-environment jsdom
/**
 * The action buttons' words come from the delivery, not from a `zh ? … : …` table in the renderer
 * (§23): the six mechanics options are rows in `content/ui/<tag>/choices.json`, and a seventh a
 * kernel grows shows its own key until someone authors one.
 */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/choices.js';
import {say,ui} from './fixtures/coc-ui-words';
const Choice=createComponent(React);
afterEach(cleanup);
it('renders mechanical actions without a prose question and submits a typed choice',async()=>{
  const select=vi.fn(async()=>{});
  render(<Choice details={{kind:'mechanics',prompt:'This must not become a question',play_language:'zh-Hans',ui:ui('zh-Hans'),options:['push','spend_luck','accept']}} onSelectOption={select}/>);
  expect(screen.queryByText('This must not become a question')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:say('zh-Hans','choices','option.accept')}));
  await waitFor(()=>expect(select).toHaveBeenCalledWith('accept'));
  await waitFor(()=>expect((screen.getByRole('button',{name:say('zh-Hans','choices','option.push')}) as HTMLButtonElement).disabled).toBe(true));
});

it('offers the same options in English when the delivery carries English words',()=>{
  render(<Choice details={{kind:'mechanics',play_language:'en',ui:ui('en'),options:['push','dodge','flee']}} onSelectOption={async()=>{}}/>);
  for(const option of ['option.push','option.dodge','option.flee'])
    expect(screen.getByRole('button',{name:say('en','choices',option)})).toBeTruthy();
  expect(screen.queryByRole('button',{name:say('zh-Hans','choices','option.push')})).toBeNull();
  expect((screen.getByRole('button',{name:say('en','choices','option.dodge')}) as HTMLButtonElement).disabled).toBe(true);
});

it('retains historical defense words without permitting another submission',()=>{
  const select=vi.fn();
  render(<Choice details={{kind:'mechanics',binds:'defense:attacker-r1',ui:ui('en'),options:['dodge','fight_back','flee']}} onSelectOption={select}/>);
  for(const option of ['dodge','fight_back','flee']) {
    const button=screen.getByRole('button',{name:say('en','choices',`option.${option}`)}) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
  }
  expect(select).not.toHaveBeenCalled();
});

it('retains ordinary flee choices but retires a defense-bound story choice',async()=>{
  const select=vi.fn(async()=>{});
  const rendered=render(<Choice details={{kind:'mechanics',ui:ui('en'),options:['flee','accept']}} onSelectOption={select}/>);
  fireEvent.click(screen.getByRole('button',{name:say('en','choices','option.flee')}));
  await waitFor(()=>expect(select).toHaveBeenCalledWith('flee'));
  rendered.unmount();
  render(<Choice details={{kind:'story',binds:'defense:attacker-r1',ui:ui('en'),options:['Run away']}} onSelectOption={select}/>);
  expect((screen.getByRole('button',{name:'Run away'}) as HTMLButtonElement).disabled).toBe(true);
});

/** An option no language has a word for shows its own key: a gap a player can quote. */
it('shows the option key itself when no word is authored for it',()=>{
  render(<Choice details={{kind:'mechanics',play_language:'zh-Hans',ui:ui('zh-Hans'),options:['parley']}} onSelectOption={async()=>{}}/>);
  expect(screen.getByRole('button',{name:'option.parley'})).toBeTruthy();
});

/**
 * A refusal is captioned by its code, never by the host's English sentence. The message still
 * reaches the player -- folded away -- because that is what a bug report needs.
 */
it('captions a refused choice by its code and folds the English message away',async()=>{
  const refuse=vi.fn(async()=>{throw Object.assign(new Error('choice 3 is no longer offered'),{code:'stale_choice'})});
  render(<Choice details={{kind:'mechanics',play_language:'zh-Hans',ui:ui('zh-Hans'),options:['accept']}} onSelectOption={refuse}/>);
  fireEvent.click(screen.getByRole('button',{name:say('zh-Hans','choices','option.accept')}));
  const alert=await screen.findByRole('alert');
  expect(alert.firstChild?.textContent).toBe(say('zh-Hans','errors','stale_choice'));
  expect(alert.querySelector('summary')?.textContent).toBe(say('zh-Hans','errors','details'));
  expect(alert.querySelector('details')?.textContent).toContain('choice 3 is no longer offered');
});
