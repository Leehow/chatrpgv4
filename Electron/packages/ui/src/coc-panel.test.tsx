// @vitest-environment jsdom
/**
 * The investigator panel's player-facing words.
 *
 * Three things shipped wrong and are guarded here. The panel's three "no sheet" states were written
 * as Chinese literals, so an `en` table read them in a language it had not chosen; every rules term
 * fell back to canonical English because `table.view.labels` was an empty map, which is invisible in
 * a test that renders the happy path only; and the chrome itself was a two-column table in the
 * renderer, so it is now the answer's own `ui` block (§23) and these tests read the shipped words
 * rather than transcribing them.
 */
import React from 'react';
import weaponCatalog from '../../../../content/rulesets/coc7/rules-json/weapons.json';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createComponent } from '../../../../pipicoc/panel.js';
import { say, ui } from './fixtures/coc-ui-words';

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

/**
 * One `invoke` that answers `sheet` with whatever the test hands it, in order.
 *
 * A host attaches `ui` to every sheet answer (§23), so a bound view gets one here at its own play
 * language. An answer with no view is left alone on purpose: that is how a test says "this failure
 * carried no words", which is the case the panel's remembered `ui` exists for.
 */
function host(...answers: unknown[]) {
  const dressed = answers.map(answer => {
    const data = (answer as {data?: Record<string, unknown>})?.data;
    const view = data?.view as {play_language?: string} | null | undefined;
    if (!data || 'ui' in data || !view) return answer;
    return {...(answer as object), data: {...data, ui: ui(view.play_language ?? 'zh-Hans')}};
  });
  const invoke = vi.fn(async () => dressed[Math.min(invoke.mock.calls.length, dressed.length) - 1]);
  return { invoke };
}

/**
 * Before any answer the panel has no words, so it may draw none.
 *
 * The old first mount printed the English table's "Reading the table…" whatever language the table
 * was in -- one English sentence at the top of every Chinese session, and invisible to a test that
 * only ever asserted on the settled panel.
 */
it('draws an ellipsis before the first answer, never a language', () => {
  const pending = { invoke: () => new Promise<never>(() => {}) };
  const { container } = render(<Panel api={pending} />);
  expect(container.querySelector('.coc-sheet-note')?.textContent).toBe('…');
  expect(container.textContent).not.toContain(say('en', 'sheet', 'loading'));
  expect(container.textContent).not.toContain(say('zh-Hans', 'sheet', 'loading'));
});

it('keeps passport words live, the era unlabelled and decoration across refreshes', async () => {
  const data={campaign:'c1',view:view({investigators:[{...investigator,era:'1920s',occupation:'Farmer',age:34}]}),
    ui:ui('en',{sheet:{identityTitle:'Projected credential title'}})};
  const api=host({ok:true,data:{...data,identity_art:{backplate:'data:image/png;base64,AA==',portrait:'data:image/png;base64,Ag==',seal:'data:image/png;base64,AQ=='}}},
    {ok:true,data:{...data,view:view({investigators:[{...investigator,era:'modern'}],labels:{modern:'Projected modern era'}})}});
  const {container}=render(<Panel api={api}/>);
  await screen.findByText('Projected credential title');
  expect(container.querySelector('.coc-sheet-era')?.textContent).toBe('1920');
  expect(container.querySelector('.coc-sheet-fields')?.textContent).not.toContain('Era');
  // A developed photograph is static artwork again: no button, no casual regeneration.
  expect(container.querySelector('button.coc-sheet-portrait')).toBeNull();
  expect(container.querySelector('.coc-sheet-identity button')).toBeNull();
  const mount=container.querySelector('.coc-sheet-art');
  expect(mount?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelector('.coc-sheet-seal')?.getAttribute('alt')).toBe('');
  expect(container.querySelector('.coc-sheet-avatar')?.getAttribute('src')).toContain('Ag==');
  expect(Array.from(container.querySelector('.coc-sheet-identity')?.children ?? []).slice(0,3).map(node=>node.className))
    .toEqual(['coc-sheet-art','coc-sheet-avatar','coc-sheet-seal']);
  expect(api.invoke).toHaveBeenLastCalledWith('sheet',{include_identity_art:true});
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  await screen.findByText('Projected modern era');
  expect(api.invoke).toHaveBeenLastCalledWith('sheet',{retry_projection:true});
  expect(container.querySelector('.coc-sheet-art')?.getAttribute('style')).toBe(mount?.getAttribute('style'));
  expect(container.querySelector('.coc-sheet-seal')?.getAttribute('src')).toContain('AQ==');
});

/**
 * The credential's dateline is the setting's year, never the finance column's table key (§23.4).
 *
 * A book set in 1895 is costed off the `1920s` column because the rulebook tabulates no 1895
 * prices, and the sheet says so in `setting_era`. Drawing `sheet.era` regardless headed a
 * credential `1920` on a panel whose clock read 1895年1月25日 — the same document disagreeing with
 * itself about the century. The authored setting is prose the contract forbids string-matching, so
 * the year comes from `clock.at`, which the kernel derives from the module's own start stamp.
 */
describe('the credential is dated by the setting, not the finance table', () => {
  const substituted = { ...investigator, era: '1920s', setting_era: '1895 (default); investigators then enter 1287' };
  const answer = (over: Record<string, unknown>) =>
    ({ ok: true, data: { status: 'ready', campaign: 'c1', view: view(over) } });

  it('takes the year from the in-world clock when the era is a stand-in key', async () => {
    const { container } = render(<Panel api={host(answer({ investigators: [substituted], clock: { minutes: 75, at: '1895-01-25T02:00' } }))} />);
    await screen.findByText(say('zh-Hans', 'sheet', 'identityTitle'));
    expect(container.querySelector('.coc-sheet-era')?.textContent).toBe('1895');
    expect(container.querySelector('.coc-sheet-era')?.textContent).not.toBe('1920');
  });

  it('keeps the authored setting in the book\'s own words when the module named no clock', async () => {
    // No stamp to derive a year from, and no licence to read one out of the sentence: the card
    // prints the setting it was given rather than a table key that is not the setting at all.
    const { container } = render(<Panel api={host(answer({ investigators: [substituted], clock: { minutes: 75 } }))} />);
    await screen.findByText(say('zh-Hans', 'sheet', 'identityTitle'));
    expect(container.querySelector('.coc-sheet-era')?.textContent).toBe(substituted.setting_era);
  });

  it('still draws the rulebook era when nothing was substituted for it', async () => {
    // The ordinary campaign: `era` is the setting, and the clock does not get to overrule it.
    const { container } = render(<Panel api={host(answer({ investigators: [{ ...investigator, era: '1920s' }], clock: { minutes: 75, at: '1925-06-02T09:30' } }))} />);
    await screen.findByText(say('zh-Hans', 'sheet', 'identityTitle'));
    expect(container.querySelector('.coc-sheet-era')?.textContent).toBe('1920');
  });
});

it('looks the investigator sex up in the lane words, falling back to the sheet\'s own word', async () => {
  // The identity lane projects the setup model's word per play language: a projection in the
  // labels shows, an unprojected word falls back to the sheet's own, and a sheet without a sex
  // shows no row and no dangling label.
  const projected = view({ investigators: [{ ...investigator, age: 34, sex: 'Female' }],
    labels: { ...view().labels, Female: '女' } });
  const first = render(<Panel api={host({ ok: true, data: { status: 'ready', view: projected, campaign: 'c1' } })} />);
  await screen.findByText(say('zh-Hans', 'sheet', 'sexKey'));
  const fields = first.container.querySelector('.coc-sheet-fields')!;
  expect(fields.textContent).toContain('女');
  expect(fields.textContent).not.toContain('Female');
  first.unmount();
  const raw = view({ investigators: [{ ...investigator, age: 34, sex: 'Female' }] });
  const second = render(<Panel api={host({ ok: true, data: { status: 'ready', view: raw, campaign: 'c1' } })} />);
  await screen.findByText(say('zh-Hans', 'sheet', 'sexKey'));
  expect(second.container.querySelector('.coc-sheet-fields')!.textContent).toContain('Female');
  second.unmount();
  const bare = view({ investigators: [{ ...investigator, age: 34 }] });
  const third = render(<Panel api={host({ ok: true, data: { status: 'ready', view: bare, campaign: 'c1' } })} />);
  await screen.findByText(say('zh-Hans', 'sheet', 'ageKey'));
  expect(third.container.querySelector('.coc-sheet-fields')?.textContent ?? '').not.toContain(say('zh-Hans', 'sheet', 'sexKey'));
});

it('leaves an empty credential unstamped until an investigator exists', async () => {
  const answer={status:'ready',campaign:'c1',view:view({investigators:[]}),
    identity_art:{backplate:'data:image/png;base64,AA==',seal:'data:image/png;base64,AQ=='}};
  const {container}=render(<Panel api={host({ok:true,data:answer})}/>);
  await screen.findByText(say('zh-Hans','sheet','noInvestigator'));
  expect(container.querySelector('.coc-sheet-art')).toBeTruthy();
  expect(container.querySelector('.coc-sheet-seal')).toBeNull();
  expect(container.querySelector('button.coc-sheet-portrait')).toBeNull();
});

/**
 * The mount is a host control once an investigator exists (contract §22.7): clicking it asks the
 * sheet lane for a portrait and renders what comes back beneath the seal; a refusal leaves the
 * mount empty and names it, in the sheet's own words.
 */
it('develops a portrait when the mount is clicked', async () => {
  const data={campaign:'c1',view:view()};
  const generated={...data,identity_art:{backplate:'data:image/png;base64,AA==',portrait:'data:image/png;base64,Ag==',seal:'data:image/png;base64,AQ=='}};
  const api=host({ok:true,data},{ok:true,data:generated});
  const {container}=render(<Panel api={api}/>);
  await screen.findByText(say('zh-Hans','sheet','identityTitle'));
  expect(container.querySelector('.coc-sheet-avatar')).toBeNull();
  fireEvent.click(container.querySelector('button.coc-sheet-portrait')!);
  expect(api.invoke).toHaveBeenLastCalledWith('sheet',{portrait:'generate'});
  await waitFor(()=>expect(container.querySelector('.coc-sheet-avatar')?.getAttribute('src')).toContain('Ag=='));
  // Once the photograph exists the mount stops being a button.
  expect(container.querySelector('button.coc-sheet-portrait')).toBeNull();
});

/**
 * The empty mount invites the click: one line centered in the photograph's own box (the avatar
 * geometry), so it centers in the frame whatever the mount button's height. What is missing is
 * said only after the click that found it missing (portrait_no_model, below).
 */
it('writes a one-line invitation on the empty mount', async () => {
  const {container}=render(<Panel api={host({ok:true,data:{campaign:'c1',view:view()}})}/>);
  const mount=await screen.findByText(say('zh-Hans','sheet','portraitCta'));
  expect(mount.className).toBe('coc-sheet-portrait-hint');
  expect(mount.getAttribute('aria-hidden')).toBe('true');
  expect(mount.parentElement?.className).toBe('coc-sheet-identity');
  expect(container.querySelector('button.coc-sheet-portrait')).toBeTruthy();
  expect(container.querySelector('.coc-sheet-portrait-note')).toBeNull();
});

it('leaves the mount empty and says so when a portrait cannot be developed', async () => {
  const data={campaign:'c1',view:view()};
  const refused={status:'error',view:null,campaign:'c1',code:'portrait_unavailable',reason:'no credential',ui:ui('zh-Hans')};
  const api=host({ok:true,data},{ok:true,data:refused});
  const {container}=render(<Panel api={api}/>);
  await screen.findByText(say('zh-Hans','sheet','identityTitle'));
  fireEvent.click(container.querySelector('button.coc-sheet-portrait')!);
  await screen.findByText(say('zh-Hans','sheet','portraitFailed'));
  expect(container.querySelector('.coc-sheet-avatar')).toBeNull();
});

/**
 * The settings hint is the answer to a click that found no image model (portrait_no_model),
 * never a static caption on the frame: the player reads it when it applies to them.
 */
it('pops the settings hint after a click that found no image model', async () => {
  const data={campaign:'c1',view:view()};
  const refused={status:'error',view:null,campaign:'c1',code:'portrait_no_model',reason:'no image model is configured',ui:ui('zh-Hans')};
  const api=host({ok:true,data},{ok:true,data:refused});
  const {container}=render(<Panel api={api}/>);
  await screen.findByText(say('zh-Hans','sheet','portraitCta'));
  fireEvent.click(container.querySelector('button.coc-sheet-portrait')!);
  await screen.findByText(say('zh-Hans','sheet','portraitHint'));
  // While the hint note shows, the invitation steps aside instead of doubling the text.
  expect(screen.queryByText(say('zh-Hans','sheet','portraitCta'))).toBeNull();
  expect(container.querySelector('.coc-sheet-avatar')).toBeNull();
});

/**
 * A caption the language does not carry renders as its key.
 *
 * A key is an identifier a player can quote in a report; the alternative -- falling through to
 * whichever language shipped first -- puts one English line in a Chinese panel and looks deliberate.
 */
it('renders the key itself for a caption the language is missing', async () => {
  const gapped = ui('zh-Hans', { sheet: { clues: undefined } });
  render(<Panel api={host({ ok: true, data: { status: 'ready', view: view(), campaign: 'c1', ui: gapped } })} />);
  await screen.findByText('图书馆使用');
  // The jump rail's chip carries the same caption, so the assertion names the heading's role.
  expect(screen.getByRole('heading', { name: 'clues' })).toBeTruthy();
  expect(screen.queryByText(say('en', 'sheet', 'clues'))).toBeNull();
});

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

describe('icons restate the stable rules keys, never the words', () => {
  it('marks vitals and known characteristics with decorative glyphs, and guesses none', async () => {
    // A glyph keys off the machine name (HP, STR), not the localized word, so one render covers
    // every language the panel may be in. HOMEBREW stands in for a characteristic the map does
    // not know: it must draw no icon at all, because a guessed glyph is a wrong caption.
    const sheet = {
      ...investigator,
      hp: 9, san: 46, mp: 10, luck: 60,
      derived: { HP: 9, SAN: 50, MP: 10, MOV: 9, DB: 'none', BUILD: 0 },
      characteristics: { STR: 60, CON: 40, SIZ: 50, DEX: 65, APP: 70, INT: 70, POW: 50, EDU: 75, HOMEBREW: 33 },
    };
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: view({ investigators: [sheet] }), campaign: 'c1' } })} />);
    await screen.findByText('力量');
    const vitals = Array.from(container.querySelectorAll('.coc-vital'));
    expect(vitals.map(el => el.querySelector('svg.coc-icon')?.getAttribute('data-icon')))
      .toEqual(['heart', 'brain', 'sparkles', 'clover']);
    for (const vital of vitals) {
      expect(vital.querySelector('svg.coc-icon')?.getAttribute('aria-hidden')).toBe('true');
    }
    const iconOf = (name: string) =>
      screen.getByText(name).closest('.coc-char')?.querySelector('svg.coc-icon')?.getAttribute('data-icon');
    expect(iconOf('力量')).toBe('dumbbell');
    expect(iconOf('CON')).toBe('shield');
    expect(iconOf('MOV')).toBe('wind');
    expect(iconOf('DB')).toBe('sword');
    expect(iconOf('BUILD')).toBe('body');
    expect(iconOf('HOMEBREW')).toBeUndefined();
  });

  it('gives each section heading its own glyph', async () => {
    const sheet = { ...investigator, hp: 9, derived: { HP: 9 } };
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: view({ investigators: [sheet] }), campaign: 'c1' } })} />);
    await screen.findByText('力量');
    const headings = Array.from(container.querySelectorAll('.coc-sheet-heading'))
      .map(el => [el.textContent, el.querySelector('svg.coc-icon')?.getAttribute('data-icon')]);
    expect(headings).toContainEqual(['时间', 'clock']);
    expect(headings).toContainEqual(['状态', 'pulse']);
    expect(headings).toContainEqual(['属性', 'gauge']);
    expect(headings).toContainEqual(['技能（2）', 'target']);
    expect(headings).toContainEqual(['物品', 'backpack']);
    expect(headings).toContainEqual(['线索', 'search']);
  });
});

describe('the jump rail mirrors the rendered sections', () => {
  it('offers one chip per rendered section and scrolls to it on click', async () => {
    // The rail is read off the rendered DOM, so its chips are exactly the sections that drew:
    // this sheet has no finance, backstory or weapons, and those chips must not exist.
    const scrolled: string[] = [];
    window.HTMLElement.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolled.push(this.getAttribute('data-anchor') || '');
    });
    const sheet = { ...investigator, hp: 9, derived: { HP: 9 } };
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: view({ investigators: [sheet] }), campaign: 'c1' } })} />);
    await screen.findByText('力量');
    await waitFor(() => expect(container.querySelectorAll('.coc-sheet-nav-chip').length).toBeGreaterThan(0));
    const chips = Array.from(container.querySelectorAll('.coc-sheet-nav-chip')).map(el => el.textContent);
    expect(chips).toEqual(['时间', '状态', '属性', '技能（2）', '物品', '线索', '人物']);
    expect(chips).not.toContain('财务');
    expect(chips).not.toContain('背景');
    fireEvent.click(screen.getByRole('button', { name: '线索' }));
    expect(scrolled).toEqual(['clues']);
  });

  it('lists only what actually rendered, even on a bare sheet', async () => {
    // Time (the turn count) and Clues (its empty state) always render; a bare sheet's rail is
    // exactly those two, and none of the sections that chose not to draw.
    const bare = view({ investigators: [{ id: 'inv-2', name: '空卡' }], clues: { discovered: [] } });
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: bare, campaign: 'c1' } })} />);
    await screen.findByText('空卡');
    await waitFor(() => expect(container.querySelectorAll('.coc-sheet-nav-chip').length).toBeGreaterThan(0));
    const chips = Array.from(container.querySelectorAll('.coc-sheet-nav-chip')).map(el => el.textContent);
    // Equipment and the NPC journal render their empty states even on a bare sheet, so they keep their chips.
    expect(chips).toEqual(['时间', '物品', '线索', '人物']);
  });
});

describe('a discovered clue is named, not handled', () => {
  it('shows the label the table gave it rather than the kernel handle', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: view(), campaign: 'c1' } })} />);
    await screen.findByText('诺特的委托合同');
    expect(screen.queryByText('knott-commission')).toBeNull();
  });

  it('unfolds a clue with the table account, and keeps a bare one a plain row', async () => {
    const withDetail = view({ clues: { discovered: [
      { clue: 'knott-commission', label: '诺特的委托合同',
        how: '诺特当面委托调查科比特宅。' },
      { clue: 'bare-clue', label: '空线索' },
    ] } });
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: withDetail, campaign: 'c1' } })} />);
    await screen.findByText('诺特的委托合同');
    const folds = container.querySelectorAll('details.coc-clue-fold');
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain('诺特的委托合同');
    expect(folds[0].textContent).toContain('诺特当面委托调查科比特宅。');
    expect(folds[0].querySelector('summary')?.textContent).not.toContain('科比特宅');
    expect(screen.getByText('空线索')).toBeTruthy();
  });

  it('renders a table-authored clue account verbatim instead of sending it through the glossary', async () => {
    const how = '克兰当面出价，请调查克罗宅。';
    const withDetail = view({
      clues: { discovered: [{ clue: 'crane-commission', label: '克兰的佣金', how }] },
      labels: { ...view().labels, [how]: '不应替换这句桌上记录。' },
    });
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: withDetail, campaign: 'c1' } })} />);
    await screen.findByText('克兰的佣金');
    const body = container.querySelector('details.coc-clue-fold .coc-clue-body');
    expect(body?.textContent).toBe(how);
  });

  it("projects an NPC's name and the scene stamped on an exchange, and leaves the lane's own prose alone", async () => {
    const description = '一位律师，办公室的主人家。';
    const summary = '他收回被误拿的租约。';
    const met = view({
      npcs: { journal: [{ name: 'Steven Knott', description, dead_since_turn: null,
        exchanges: [{ turn: 1, scene: "Knott's Office", summary }] }] },
      labels: { ...view().labels, 'Steven Knott': '史蒂文·诺特', "Knott's Office": '诺特的办公室' },
    });
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: met, campaign: 'c1' } })} />);
    await screen.findByText('史蒂文·诺特');
    expect(screen.queryByText('Steven Knott')).toBeNull();
    const npc = container.querySelector('details.coc-npc')!;
    expect(npc.querySelector('.coc-npc-exchange-scene')?.textContent).toBe('诺特的办公室');
    expect(npc.textContent).toContain(description);
    expect(npc.textContent).toContain(summary);
    expect(npc.textContent).not.toContain("Knott's Office");
  });

  it('reads a clue label through the glossary too, so a graph name the Keeper never renamed is projected', async () => {
    const withGraphName = view({
      clues: { discovered: [{ clue: 'blood-pool-manifest', label: 'Pools of blood' }] },
      labels: { ...view().labels, 'Pools of blood': '血泊' },
    });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: withGraphName, campaign: 'c1' } })} />);
    await screen.findByText('血泊');
    expect(screen.queryByText('Pools of blood')).toBeNull();
    expect(screen.queryByText('blood-pool-manifest')).toBeNull();
  });
});

describe('the time section reads the clock in the fiction', () => {
  it('prints the date and hour the module put the table at', async () => {
    const dated = view({ clock: { minutes: 15, elapsed: '0 h 15 min', at: '1920-10-12T10:05', day_part: 'morning' } });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: dated, campaign: 'c1' } })} />);
    // The minute keeps its padding; the date does not carry any.
    await screen.findByText('1920年10月12日 10:05');
    expect(screen.queryByText(/已过/)).toBeNull();
  });

  it('falls back to elapsed time for a module that never said when it opens', async () => {
    const undated = view({ clock: { minutes: 95, elapsed: '1 h 35 min' } });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: undated, campaign: 'c1' } })} />);
    await screen.findByText('已过 1 小时 35 分');
  });

  it('drops a zero hour and keeps turn and scene as quiet meta pills', async () => {
    const v = view({
      clock: { minutes: 55, elapsed: '0 h 55 min' }, turn: 5,
      scene: { name: 'crowe-house-ground' },
      standing_labels: { 'crowe-house-ground': '克罗屋一楼' },
    });
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: v, campaign: 'c1' } })} />);
    await screen.findByText('已过 55 分');
    const pills = Array.from(container.querySelectorAll('.coc-standing-meta .coc-standing-item'))
      .map(el => el.textContent);
    expect(pills).toEqual(['回合5', '场景克罗屋一楼']);
    // Nothing live at this table, so no accent rows under the meta line.
    expect(container.querySelectorAll('.coc-standing-line')).toHaveLength(0);
  });

  it('reads an en table in en', async () => {
    const dated = view({ play_language: 'en', clock: { minutes: 15, at: '1920-10-12T10:05' } });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: dated, campaign: 'c1' } })} />);
    await screen.findByText('1920-10-12 10:05');
  });
});

describe('the background section speaks the play language', () => {
  it('routes item trait names and values through the glossary (lane-ready)', async () => {
    const withGear = {
      ...investigator,
      equipment: [{ name: '宅钥圈', quantity: 1 }],
      objects: [{ name: '宅钥圈', category: 'gear',
        traits: [{ name: 'length', value: 12, unit: 'cm' }, { name: 'material', value: 'iron' }],
        state: { condition: 'intact' } }],
    };
    const localized = view({
      investigators: [withGear],
      labels: { ...view().labels, length: '长度', material: '材质', condition: '成色', intact: '完好' },
    });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: localized, campaign: 'c1' } })} />);
    await screen.findByText('宅钥圈');
    expect(screen.getByText('长度')).toBeTruthy();
    expect(screen.getByText('材质')).toBeTruthy();
    expect(screen.getByText('完好')).toBeTruthy();
  });

  it('reads a trait unit and a string value through the glossary, like the name beside them', async () => {
    const withGear = { ...investigator, equipment: [{ name: '相机', quantity: 1 }],
      objects: [{ name: '相机', category: 'gear', traits: [{ name: 'length', value: 22, unit: 'cm' }, { name: 'material', value: 'mahogany' }], state: { condition: 'intact' } }] };
    const localized = view({ investigators: [withGear],
      labels: { ...view().labels, length: '长度', cm: '厘米', material: '材质', mahogany: '桃花心木', condition: '状态', intact: '完好' } });
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: localized, campaign: 'c1' } })} />);
    const row = (await screen.findByText('相机')).closest('li')!;
    const values = Object.fromEntries(Array.from(row.querySelectorAll('dl>div')).map(el => [el.querySelector('dt')?.textContent, el.querySelector('dd')?.textContent]));
    expect(values).toEqual({ '长度': '22 厘米', '材质': '桃花心木', '状态': '完好' });
  });

  it('labels its chrome in zh-Hans instead of English literals', async () => {
    const withStory = {
      ...investigator,
      backstory: { concept: '记者' },
      own_language: '粤语',
      key_connection: { summary: '妹妹的失踪' },
    };
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: view({ investigators: [withStory] }), campaign: 'c1' } })} />);
    await screen.findByText('背景');
    expect(screen.getByText('语言')).toBeTruthy();
    expect(screen.getByText('关键羁绊')).toBeTruthy();
    expect(screen.queryByText('Language')).toBeNull();
    expect(screen.queryByText('Key connection')).toBeNull();
    expect(screen.queryByText('Background')).toBeNull();
  });
});

describe('the three states with no sheet', () => {
  it('tells an English table it has no campaign, in English', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'unbound', view: null, campaign: null, ui: ui('en') } })} />);
    await screen.findByText(say('en', 'sheet', 'unboundTitle'));
    expect(screen.getByRole('button', { name: say('en', 'sheet', 'retry') })).toBeTruthy();
  });

  /**
   * A failure names its code, and the host's English sentence stays behind a fold.
   *
   * The panel used to print `reason` as the whole explanation, so a player reading a Chinese table
   * met a line of English kernel prose where the product should have spoken. The message still
   * travels -- it is what a bug report needs -- but it is not the sentence.
   */
  it('captions a failed read by its code and folds the English message away', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'error', view: null, campaign: 'c1',
      error: { code: 'kernel_error', message: 'kernel went away' }, ui: ui('en') } })} />);
    await screen.findByText(say('en', 'sheet', 'errorTitle'));
    const detail = screen.getByRole('status');
    expect(detail.textContent).toBe(say('en', 'errors', 'kernel_error'));
    expect(detail.textContent).not.toContain('kernel went away');
    expect(screen.getByText(say('en', 'sheet', 'errorTitle'))).toBeTruthy();
    const fold = screen.getByText('kernel went away').closest('details');
    expect(fold?.querySelector('summary')?.textContent).toBe(say('en', 'errors', 'details'));
  });

  it('falls back to the generic caption for a code no language has a word for', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'error', view: null, campaign: 'c1',
      error: { code: 'a_code_from_a_later_kernel', message: 'something new' }, ui: ui('en') } })} />);
    await screen.findByText(say('en', 'sheet', 'errorTitle'));
    expect(screen.getByRole('status').textContent).toBe(say('en', 'errors', 'unknown'));
  });

  it('keeps the language of the table the player was just reading when a later read fails', async () => {
    const api = host(
      { ok: true, data: { status: 'ready', view: view(), campaign: 'c1' } },
      // No view and no `ui`: a refusal this panel raised itself, with no words of its own.
      { ok: true, data: { status: 'error', view: null, campaign: 'c1' } },
    );
    const { rerender } = render(<Panel api={api} />);
    await screen.findByText('图书馆使用');
    // The panel re-reads whenever it is told something changed; a new api object is the same
    // trigger the host's own mount/session change is.
    rerender(<Panel api={{ ...api }} />);
    await waitFor(() => expect(screen.getByText(say('zh-Hans', 'sheet', 'errorTitle'))).toBeTruthy());
    expect(screen.getByRole('button', { name: say('zh-Hans', 'sheet', 'retry') })).toBeTruthy();
    expect(screen.queryByText(say('en', 'sheet', 'errorTitle'))).toBeNull();
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
    await screen.findByText('伤害加值');
    expect(screen.getByText('伤害加值').parentElement?.textContent).toBe('伤害加值0');
    expect(screen.queryByText('无')).toBeNull();
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

it('shows the whole character background and keeps cash only in finance',async()=>{
 const snapshot=view({investigators:[{...investigator,backstory:{concept:'角色概念',personal_description:'长脸，深棕短发。',traits:'谨慎',significant_people:'编辑朋友',scenario_bound:'应邀调查房屋'},own_language:'English',key_connection:{summary:'编辑是她最信任的人'},equipment:['Some cash','Wallet','Collectible coin'],finance:{cash:{amount:60,currency:'USD'}}}],finance_equipment:['Some cash'],labels:{Background:'背景',personal_description:'外貌描述',traits:'特质',significant_people:'重要之人',scenario_bound:'模组关联',Language:'语言','Key connection':'关键联系',English:'英语',USD:'美元',Wallet:'钱包','Collectible coin':'收藏硬币','Some cash':'适量现金'}});
 const before=JSON.stringify(snapshot);
 render(<Panel api={host({ok:true,data:{status:'ready',view:snapshot,campaign:'c1'}})}/>);
 await screen.findByRole('heading',{name:'背景'});
 for(const text of ['长脸，深棕短发。','谨慎','编辑朋友','应邀调查房屋','英语','编辑是她最信任的人','钱包','收藏硬币','60 美元'])expect(screen.getByText(text)).toBeTruthy();
 expect(screen.queryByText('适量现金')).toBeNull();expect(screen.queryByText('Some cash')).toBeNull();
 expect(JSON.stringify(snapshot)).toBe(before);
});

it('keeps the sheet readable while equipment projection is pending and refreshes on completion',async()=>{
 const base=view({investigators:[{...investigator,equipment:['Some cash','Wallet'],finance:{cash:{amount:60,currency:'USD'}}}],labels:{Wallet:'钱包'}});
 let notify:(event:unknown)=>void=()=>{};
 const api={...host({ok:true,data:{status:'ready',view:{...base,presentation_status:'pending'},campaign:'c1'}},{ok:true,data:{status:'ready',view:{...base,finance_equipment:['Some cash']},campaign:'c1'}}),subscribeExt:(listener:any)=>{notify=listener;return()=>{}}};
 render(<Panel api={api}/>);
 await screen.findByText('正在读桌上的状态……');
 expect(screen.queryByText('Some cash')).toBeNull();expect(screen.getByText('60 USD')).toBeTruthy();
 await act(async()=>notify({type:'sheet_changed'}));
 await screen.findByText('钱包');expect(screen.queryByText('Some cash')).toBeNull();
});
it('retries a failed equipment projection only on an explicit retry',async()=>{
 const api=host({ok:true,data:{status:'ready',view:view({presentation_status:'failed'}),campaign:'c1'}});
 render(<Panel api={api}/>);
 fireEvent.click(await screen.findByRole('button',{name:'重试'}));
 await waitFor(()=>expect(api.invoke).toHaveBeenLastCalledWith('sheet',expect.objectContaining({retry_projection:true})));
});

it('renders a canonical weapon as a read-only entry with separate labeled parameters',async()=>{
 const weapon={name:'revolver_45',...weaponCatalog.weapons.revolver_45,ammo:0,quantity:1};
 const snapshot=view({investigators:[{...investigator,weapons:[weapon],equipment:['Notebook']}],labels:{'.45 Revolver':'.45转轮手枪','Firearms (Handgun)':'火器（手枪）',Notebook:'笔记本'}});
 const before=JSON.stringify(snapshot);
 render(<Panel api={host({ok:true,data:{status:'ready',view:snapshot,campaign:'c1'}})}/>);
 const row=(await screen.findByText('.45转轮手枪')).closest('li')!;
 expect(row.querySelector('button')).toBeNull();
 expect(row.querySelector('dl')).toBeTruthy();
 const values=Object.fromEntries(Array.from(row.querySelectorAll('dl>div')).map(el=>[el.querySelector('dt')?.textContent,el.querySelector('dd')?.textContent]));
 expect(values).toMatchObject({'基础伤害':weapon.damage_die,'基础射程（码）':'15','每轮攻击':'1 (3)','弹匣容量':'6','当前弹药':'0','故障值':'100','使用技能':'火器（手枪）','计入伤害加值':'否'});
 expect(screen.queryByText('revolver_45')).toBeNull();
 expect(screen.getByText('笔记本').closest('li')?.querySelector('dl')).toBeNull();
 expect(JSON.stringify(snapshot)).toBe(before);
});
it('distinguishes multiple combat usages of the same physical object',async()=>{
 const weapon=(usage:string)=>({name:'长柄钢撬棍',object_id:'crowbar-1',weapon_id:`usage-${usage}`,usage,damage:'1D8'});
 render(<Panel api={host({ok:true,data:{status:'ready',view:view({investigators:[{...investigator,weapons:[weapon('挥砸撬棍'),weapon('直捅撬棍')]}]}),campaign:'c1'}})}/>);
 await screen.findByText('长柄钢撬棍 · 挥砸撬棍');
 expect(screen.getByText('长柄钢撬棍 · 直捅撬棍')).toBeTruthy();
 expect(screen.queryAllByText('长柄钢撬棍')).toHaveLength(0);
});
it('supports legacy weapon fields and preserves supplied quantities without inventing missing parameters',async()=>{
 render(<Panel api={host({ok:true,data:{status:'ready',view:view({investigators:[{...investigator,weapons:[{name:'Old pistol',damage:'1D6',range:10,attacks:1,ammo:0,quantity:2}]}]}),campaign:'c1'}})}/>);
 const row=(await screen.findByText('Old pistol')).closest('li')!;
 expect(row.textContent).toContain('x2');
 expect(row.textContent).toContain('伤害1D6');
 expect(row.textContent).toContain('当前弹药0');
 expect(row.textContent).not.toContain('弹匣容量');
});

/**
 * A paper's public view is a paragraph of description, a condition and a few traits, and three of
 * them filled the sidebar. Everything past the name now folds away by default, the way a clue
 * folds; the description, which the definition also lists among its player fields, is printed
 * once; and the paper button stays on the folded line, because a fold must never stand between
 * the player and their own writing.
 */
describe('a possession folds everything past its name', () => {
  const paper = { name: '林岚的记事本', category: 'document', description: '一本口袋记事本，内页全空。',
    parameters: { description: '一本口袋记事本，内页全空。' }, state: { condition: 'intact' }, traits: [],
    document: { presentation: 'plain', modified: false } };
  const carrying = () => view({ investigators: [{ ...investigator,
    equipment: ['大衣', { name: '林岚的记事本', quantity: 1 }], objects: [paper] }] });

  it('keeps name, count and the paper button on the line and folds the rest away closed', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: carrying(), campaign: 'c1' } })} />);
    const row = (await screen.findByText('林岚的记事本')).closest('li')!;
    const fold = row.querySelector('details.coc-inventory-fold') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    const summary = fold.querySelector('summary')!;
    expect(summary.textContent).toContain('x1');
    expect(summary.querySelector('button.coc-inventory-document')?.textContent).toContain('翻阅与书写');
    expect(fold.querySelector('.coc-inventory-body')?.textContent).toContain('intact');
    // A bare entry has nothing to open into and stays a plain line.
    expect(screen.getByText('大衣').closest('li')!.querySelector('details')).toBeNull();
  });

  it('prints the description once, not again as a parameter', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: carrying(), campaign: 'c1' } })} />);
    const row = (await screen.findByText('林岚的记事本')).closest('li')!;
    expect(row.textContent!.split('一本口袋记事本，内页全空。').length - 1).toBe(1);
    expect(Array.from(row.querySelectorAll('dt')).map(el => el.textContent)).not.toContain('描述');
  });

  it('opens the paper from the folded line without unfolding it', async () => {
    render(<Panel api={host({ ok: true, data: { status: 'ready', view: carrying(), campaign: 'c1' } })} />);
    const row = (await screen.findByText('林岚的记事本')).closest('li')!;
    const fold = row.querySelector('details') as HTMLDetailsElement;
    fireEvent.click(row.querySelector('summary')!);
    expect(fold.open).toBe(true);
    fireEvent.click(row.querySelector('summary')!);
    expect(fold.open).toBe(false);
    fireEvent.click(row.querySelector('button.coc-inventory-document')!);
    expect(fold.open).toBe(false);
    await screen.findByText('随身纸面');
  });
});

it('draws a carried weapon once, under the box its combat profile lives in', async () => {
  // The sheet keeps a gun twice on purpose -- a combat profile in `weapons`, an inventory row in
  // `equipment` -- and a live sheet drew the same pistol under 武器 and again under 物品.
  const carried = {
    ...investigator,
    weapons: [{name: '柯尔特.45自动手枪', object_id: 'object-45-4', damage: '1D10+2', magazine: 7, ammo: 7, quantity: 1}],
    equipment: [
      {name: '柯尔特.45自动手枪', object_id: 'object-45-4', quantity: 1},
      {name: '黄铜怀表'},
    ],
  };
  render(<Panel api={host({ok: true, data: {status: 'ready', view: view({investigators: [carried]}), campaign: 'c1'}})} />);
  await screen.findByText('黄铜怀表');
  expect(screen.getAllByText('柯尔特.45自动手枪')).toHaveLength(1);
  // …and it is the weapons box it stayed in, not the inventory one.
  expect(screen.getByText('柯尔特.45自动手枪').closest('li')?.querySelector('dl')).toBeTruthy();
});
