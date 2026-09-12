// @vitest-environment jsdom
import React from 'react';
import {cleanup, render} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/timeline.js';

const TimelinePanel = createComponent(React);

afterEach(cleanup);

test('mounts while the first timeline answer is pending', () => {
  const invoke = vi.fn(() => new Promise(() => {}));
  const {container} = render(<TimelinePanel api={{invoke}} />);

  expect(container.querySelector('.coc-tl')).not.toBeNull();
  expect(container.textContent).toContain('…');
});
