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

/**
 * A generated investigator starts with `equipment: []` — the kernel refuses to invent a kit —
 * and the panel used to drop the whole section on an empty list. The player then had no way to
 * tell "I am carrying nothing" from "this sheet does not track what I carry".
 */
describe('the possessions box is on the sheet even when it is empty', () => {
  it('names the box and says the investigator is carrying nothing', async () => {
    const empty = view({ investigators: [{ ...investigator, equipment: [] }] });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: empty, campaign: 'c1' } })} />);
    await screen.findByText('物品');
    expect(screen.getByText('身上还没有东西。')).toBeTruthy();
  });

  it('lists what the Keeper handed over, bare strings included', async () => {
    const carried = view({ investigators: [{
      ...investigator,
      equipment: ['flashlight', { name: 'Corbitt House keys', label: '科比特宅的钥匙', quantity: 2 }],
    }] });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: carried, campaign: 'c1' } })} />);
    await screen.findByText('科比特宅的钥匙');
    expect(screen.getByText('flashlight')).toBeTruthy();
    expect(screen.getByText('x2')).toBeTruthy();
    expect(screen.queryByText('身上还没有东西。')).toBeNull();
  });

  it('keeps the weapons box off the page when there is none', async () => {
    const empty = view({ investigators: [{ ...investigator, equipment: [], weapons: [] }] });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: empty, campaign: 'c1' } })} />);
    await screen.findByText('物品');
    expect(screen.queryByText('武器')).toBeNull();
  });
});

describe('derived values and visible identities use their text projections', () => {
  it('renders no damage bonus, scene and present names without changing numeric mechanics', async () => {
    const snapshot = view({
      investigators: [{ ...investigator, characteristics: { STR: 20, SIZ: 65 }, derived: { DB: 'none', BUILD: 0 } }],
      scene: { name: 'office-id', display_name: "Knott's Office" }, present: ['Steven Knott'],
      labels: { STR: '力量', SIZ: '体型', DB: '伤害加值', BUILD: '体格', none: '无' },
      standing_labels: { "Knott's Office": '诺特的办公室', 'Steven Knott': '史蒂文·诺特' },
    });
    const original = JSON.stringify(snapshot);
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: snapshot, campaign: 'c1' } })} />);
    await screen.findByText('无');
    expect(screen.getByText('诺特的办公室')).toBeTruthy();
    expect(screen.queryByText('史蒂文·诺特')).toBeNull();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('65')).toBeTruthy();
    for (const leaked of ['none', "Knott's Office", 'Steven Knott']) expect(screen.queryByText(leaked)).toBeNull();
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it('keeps untranslated live names behind placeholders while their projection is unavailable', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: view({scene:{name:"Knott's Office"},present:['Steven Knott']}), campaign: 'c1' } })} />);
    await screen.findByText('图书馆使用');
    expect(screen.queryByText("Knott's Office")).toBeNull();
    expect(screen.queryByText('Steven Knott')).toBeNull();
  });
});
