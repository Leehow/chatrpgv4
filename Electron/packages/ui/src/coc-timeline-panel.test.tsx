// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/timeline.js';
import {say, ui} from './fixtures/coc-ui-words';
import timelineWords from '../../../../content/ui/zh-Hans/timeline.json';

const TimelinePanel = createComponent(React);

afterEach(cleanup);

test('mounts while the first timeline answer is pending', () => {
  const invoke = vi.fn(() => new Promise(() => {}));
  const {container} = render(<TimelinePanel api={{invoke}} />);

  expect(container.querySelector('.coc-tl')).not.toBeNull();
  expect(container.textContent).toContain('…');
});

test('renders an undated node with the sheet day-clock words', async () => {
  const when = {day: 2, hh: 1, mm: 5};
  const invoke = vi.fn(async () => ({ok: true, data: {
    active: 'main', truncated: false, ui: ui('zh-Hans', {timeline: timelineWords}),
    anchors: [{commit: 'abc'}],
    lines: [{name: 'main', kind: 'main', status: 'active', last_commit: 'abc'}],
    nodes: [{sha: 'abc', turn: 1, kind: 'turn', title: 'The wait ends.',
      clock: 965, when, parents: ['parent'], tip_of: ['main']},
    {sha: 'parent', turn: 0, kind: 'turn', title: 'The wait begins.',
      clock: 899, when: {day: 1, hh: 23, mm: 59}, parents: [], tip_of: []}],
  }}));
  const {container} = render(<TimelinePanel api={{invoke}} />);
  const caption = say('zh-Hans', 'sheet', 'day.clock')
    .replace('{d}', '2').replace('{hh}', '01').replace('{mm}', '05');
  const node = await screen.findByRole('button', {name: new RegExp(caption)});
  expect(node.getAttribute('aria-label')).toContain(caption);
  fireEvent.mouseEnter(node);
  expect(container.querySelector('.coc-tl-tip-time')?.textContent).toBe(caption);
  const previous = say('zh-Hans', 'sheet', 'day.clock')
    .replace('{d}', '1').replace('{hh}', '23').replace('{mm}', '59');
  expect(Array.from(container.querySelectorAll('.coc-tl-caption'), node => node.textContent))
    .toEqual([`${previous} – 23:59`, `${caption} – 01:05`]);
});
