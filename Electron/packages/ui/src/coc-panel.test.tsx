// @vitest-environment jsdom
/**
 * The investigator panel's player-facing words.
 *
 * Two things shipped wrong and are guarded here. The panel's three "no sheet" states were written
 * as Chinese literals, so an `en` table read them in a language it had not chosen; and every rules
 * term fell back to canonical English because `table.view.labels` was an empty map, which is
 * invisible in a test that renders the happy path only.
 */
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createComponent } from '../../../../pipicoc/panel.js';

const Panel = createComponent(React);
afterEach(cleanup);

const investigator = {
  id: 'inv-1',
  name: '托马斯·海斯',
  characteristics: { STR: 70, POW: 40 },
  skills: { 'Library Use': 50, 'Spot Hidden': 27 },
};

function view(overrides: Record<string, unknown> = {}) {
  return {
    play_language: 'zh-Hans',
    turn: 4,
    state: 'awaiting_player',
    investigators: [investigator],
    clues: { discovered: [{ clue: 'knott-commission', label: '诺特的委托合同' }] },
    labels: { STR: '力量', POW: '意志', 'Library Use': '图书馆使用', 'Spot Hidden': '侦查' },
    ...overrides,
  };
}

/** One `invoke` that answers `sheet` with whatever the test hands it, in order. */
function host(...answers: unknown[]) {
  const invoke = vi.fn(async () => answers[Math.min(invoke.mock.calls.length, answers.length) - 1]);
  return { invoke };
}

describe('rules terms come from the kernel glossary', () => {
  it('renders skills and characteristics in the play language', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: view(), campaign: 'c1' } })} />);
    await screen.findByText('图书馆使用');
    expect(screen.getByText('侦查')).toBeTruthy();
    expect(screen.getByText('力量')).toBeTruthy();
    expect(screen.queryByText('Library Use')).toBeNull();
  });

  it('falls back to the canonical name for a term the glossary does not carry', async () => {
    const bare = view({ labels: { STR: '力量' } });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: bare, campaign: 'c1' } })} />);
    await screen.findByText('Library Use');
    expect(screen.getByText('力量')).toBeTruthy();
  });
});

describe('a discovered clue is named, not handled', () => {
  it('shows the label the table gave it rather than the kernel handle', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: view(), campaign: 'c1' } })} />);
    await screen.findByText('诺特的委托合同');
    expect(screen.queryByText('knott-commission')).toBeNull();
  });
});

describe('the three states with no sheet', () => {
  it('tells an English table it has no campaign, in English', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'unbound', view: null, campaign: null } })} />);
    await screen.findByText('No campaign on this session');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the reason a read failed instead of a generic apology', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'error', view: null, campaign: 'c1', reason: 'kernel went away' } })} />);
    await screen.findByText('kernel went away');
    expect(screen.getByText('The sheet could not be read')).toBeTruthy();
  });

  it('keeps the language of the table the player was just reading when a later read fails', async () => {
    const api = host(
      { ok: true, data: { status: 'ready', view: view(), campaign: 'c1' } },
      { ok: true, data: { status: 'error', view: null, campaign: 'c1' } },
    );
    const { rerender } = render(<Panel api={api} />);
    await screen.findByText('图书馆使用');
    // The panel re-reads whenever it is told something changed; a new api object is the same
    // trigger the host's own mount/session change is.
    rerender(<Panel api={{ ...api }} />);
    await waitFor(() => expect(screen.getByText('人物数据读取失败')).toBeTruthy());
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});

it('shows current Luck once and does not disclose canonical NPC identities', async () => {
  const privateView = view({present:['Concealed identity'], investigators:[{
    ...investigator, luck:43, characteristics:{STR:70,POW:40,LUCK:45},
  }]});
  render(<Panel api={host({ok:true,data:{status:'ready',view:privateView,campaign:'c1'}})} />);
  await screen.findByText('43');
  expect(screen.queryByText('45')).toBeNull();
  expect(screen.queryByText('Concealed identity')).toBeNull();
});
