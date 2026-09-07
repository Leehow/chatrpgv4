// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/choices.js';
const Choice=createComponent(React);
afterEach(cleanup);
it('renders mechanical actions without a prose question and submits a typed choice',async()=>{
  const select=vi.fn(async()=>{});
  render(<Choice details={{kind:'mechanics',prompt:'This must not become a question',play_language:'zh-Hans',options:['push','spend_luck','accept']}} onSelectOption={select}/>);
  expect(screen.queryByText('This must not become a question')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'接受结果'}));
  await waitFor(()=>expect(select).toHaveBeenCalledWith('accept'));
  await waitFor(()=>expect((screen.getByRole('button',{name:'孤注一掷'}) as HTMLButtonElement).disabled).toBe(true));
});
