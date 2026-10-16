// @vitest-environment jsdom
import React from 'react';
import {render,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {CocStreamingProse} from './CocStreamingProse';

afterEach(cleanup);
it('keeps an unlisted isolated-author speaker colored as a label without guessing an NPC',()=>{
  const mounted=render(<CocStreamingProse details={{chunks:['Before. {{say:Hugh Moore}}Morning.{{/say}} After.'],
    speakers:[{name:'Gatekeeper',who:{npc:'gatekeeper',name:'Gatekeeper'}}]}}/>);
  const speech=mounted.container.querySelector('.coc-say');
  expect(speech?.textContent).toBe('Morning.');
  expect(speech?.getAttribute('data-who')).toBe('label');
  expect(speech?.getAttribute('title')).toBe('Hugh Moore');
  expect(speech?.getAttribute('style')).toContain('--coc-say-ink:');
  expect(mounted.container.querySelector('[data-who="npc"]')).toBeNull();
  expect(mounted.container.textContent).toBe('Before. Morning. After.');
});
