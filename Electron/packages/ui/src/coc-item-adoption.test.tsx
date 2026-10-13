// @vitest-environment jsdom
import React from 'react';
import {render,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
// @ts-expect-error -- shipped runtime asset
import {createComponent} from '../../../../pipicoc/mechanics.js';
import {ui} from './fixtures/coc-ui-words';
const Card=createComponent(React);afterEach(cleanup);
it('adoption names existing equipment without claiming a newly gained possession',()=>{
 const card=render(<Card details={{mechanics:[{kind:'item',name:'Hayes notebook',adopted:'notebook and stub pencil',definition:'pending'}],
  labels:{'Hayes notebook':'海斯的随身本子'},ui:ui('en')}}/>);
 expect(card.container.textContent).toContain('Items');
 expect(card.container.textContent).not.toContain('Items gained');
});
