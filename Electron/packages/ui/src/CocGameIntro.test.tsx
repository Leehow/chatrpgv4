// @vitest-environment jsdom
/**
 * The intro card's words are data (§23): it draws whatever the session's `ui` block carries
 * for the `intro` surface -- imported here from the shipped authored file rather than
 * transcribed, so an edited caption has to travel to this test -- it draws a missing key as
 * the key itself so a gap can be named, and it draws nothing at all when there is no `ui`.
 */
import React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import enIntro from '../../../../content/ui/en/intro.json';
import {CocGameIntro} from './CocGameIntro';

const STORAGE_KEY = 'pipicoc.game-intro.collapsed';

afterEach(() => { cleanup(); localStorage.clear() });

it('renders the words from the ui map', () => {
  render(<CocGameIntro words={enIntro} />);
  expect(screen.getByText(enIntro.eyebrow)).toBeTruthy();
  expect(screen.getByText(enIntro.title)).toBeTruthy();
  expect(screen.getByText(enIntro.lede)).toBeTruthy();
  for (const [title, body] of [[enIntro.whatTitle, enIntro.whatBody], [enIntro.createTitle, enIntro.createBody], [enIntro.playTitle, enIntro.playBody]]) {
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
  }
  expect(screen.getByRole('button', {name: enIntro.hide})).toBeTruthy();
});

it('a missing key draws the key itself, a gap a player can name', () => {
  const words: Record<string, string> = {...enIntro};
  delete words.title;
  render(<CocGameIntro words={words} />);
  expect(screen.getByText('title')).toBeTruthy();
});

it('the collapse toggle flips and persists across mounts', () => {
  const first = render(<CocGameIntro words={enIntro} />);
  fireEvent.click(screen.getByRole('button', {name: enIntro.hide}));
  expect(screen.queryByText(enIntro.lede)).toBeNull();
  expect(screen.getByRole('button', {name: enIntro.show})).toBeTruthy();
  expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  first.unmount();

  render(<CocGameIntro words={enIntro} />);
  expect(screen.queryByText(enIntro.lede)).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: enIntro.show}));
  expect(screen.getByText(enIntro.lede)).toBeTruthy();
  expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
});

it('no ui words at all renders nothing, not a skeleton in a language nobody chose', () => {
  const {container} = render(<CocGameIntro words={undefined} />);
  expect(container.firstChild).toBeNull();
});
