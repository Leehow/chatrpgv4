// @vitest-environment jsdom
/**
 * A marked delivery reaches the player once, with each receipt where it happened (contract §16.6).
 *
 * Two halves, and both can fail silently, which is why they are pinned here. The card draws the
 * narration itself when it has `marked_text`, because only whoever holds both the text and the rows
 * can put a row at a sentence; and the plain copy of that same delivery -- the assistant message,
 * which stays prose because a terminal reads it too -- is folded away, or the narration prints
 * twice.
 */
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
// @ts-expect-error -- plain ESM pack asset, no type declarations
import { createComponent } from '../../../../pipicoc/mechanics.js'
import { foldMarkedDeliveries, liveDraftMessageId, withoutMechanicsMarkers, type ChatMessage } from './transcript-model'
import { say, ui } from './fixtures/coc-ui-words'
import { OpenedSlip } from './fixtures/opened-mechanics-slip'

const Card = createComponent(React)

/**
 * The card under test, with the `ui` block a host attaches to every delivery (§23).
 *
 * The words are the shipped ones for the delivery's own play language, so a caption renamed in
 * `content/ui/` has to travel here; a test that means to say something unusual about the words --
 * a language with a gap in it -- passes its own `ui` and this leaves it alone.
 */
const Delivery = ({details}: {details: Record<string, unknown>}) =>
  <OpenedSlip><Card details={{ui: ui(String(details.play_language ?? 'zh-Hans')), ...details}} /></OpenedSlip>

afterEach(cleanup)

const ROLL = {
  kind: 'roll', receipt: 'roll:library-use-t5-c1', actor: 'thomas-hayes', actor_label: '托马斯·海斯', actor_is_investigator: true,
  skill: 'Library Use', roll: 84, target: 50, threshold: 50, difficulty: 'regular', level: 'failure',
  passed: false, pushed: false, visibility: 'public', marker: 'check:library-use',
}
const TIME = { kind: 'time', receipt: 'time:t5-c2', minutes: 10, marker: 'time' }
const SHELF = { kind: 'clue', receipt: 'clue:shelf-t5', clue: 'shelf-scratches', label: '匣底刻痕', marker: 'clue:shelf' }
const CLUE = { kind: 'clue', receipt: 'clue:knott-keys-t5', clue: 'knott-keys', label: '宅子钥匙' }

const MARKED = '你翻遍了匣子{{check:library-use}}\n\n十分钟很快耗尽。{{time}}架子深处还有未开的匣。{{clue:shelf}}你把手电压低。'

describe('the card draws a marked delivery', () => {
  it.each([['chapter', '章节'], ['campaign', '战役']])('distinguishes the %s ending scope', (family, label) => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', mechanics:[{
      kind:'session', receipt:'ending', family, transition:'end', outcome:'completed',
    }]}} />);
    expect(container.textContent).toContain(`${label} 结束`);
  });
  it.each([
    ['zh-Hans', -1, '从林远的物品中移除'],
    ['zh-Hans', -2, '从林远的物品中移除'],
    ['en', -2, "removed from 林远's inventory"],
    ['zh-Hans', 1, '给 林远'],
    ['en', 2, 'to 林远'],
  ])('shows signed inventory direction (%s, quantity=%s)', (play_language, quantity, direction) => {
    const {container} = render(<Delivery details={{play_language, turn:57, mechanics:[{
      kind:'item', receipt:'item:gold-fragment-t57-c1', name:'Gold fragment', label:'金嵌板',
      quantity, to:'lin-yuan', to_label:'林远',
    }]}} />);
    expect(container.textContent).toContain(`金嵌板${Math.abs(Number(quantity)) > 1 ? ' ×2' : ''} ${direction}`);
    if (Number(quantity) < 0) expect(container.textContent).not.toContain('给 林远');
  });

  it.each([false, undefined])('keeps NPC and legacy names off visible mechanics (identity=%s)', identity => {
    const rows = [
      {...ROLL, actor:'jackson-elias', actor_label:'Jackson Elias', actor_is_investigator:identity},
      {kind:'dice', receipt:'roll:damage-t5-c2', actor:'jackson-elias', actor_label:'Jackson Elias', actor_is_investigator:identity,
        expression:'1D6', faces:[4], total:4, marker:'dice:damage'},
      {kind:'change', receipt:'delta:hp-t5-c2', subject:'jackson-elias', subject_label:'Jackson Elias', subject_is_investigator:identity,
        resource:'hp', before:12, after:8, marker:'change:hp'},
    ];
    const {container} = render(<Delivery details={{play_language:'en', turn:5,
      marked_text:'Hughes studies the shelves.{{check:library-use}}He catches his hand.{{dice:damage}}{{change:hp}}', mechanics:rows}} />);
    expect(container.textContent).toContain('Hughes studies the shelves.');
    expect(container.textContent).not.toMatch(/Jackson Elias|jackson-elias/);
    expect(container.querySelectorAll('.coc-mech-here')).toHaveLength(3);
    expect(container.textContent).toContain('84/50');
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('8');
  });

  /**
   * §16.5's middle tier, at the surface it exists for. `keeper` drops the row; `concealed` keeps a
   * row the player can see they earned and prints no number. The card is given the row the host
   * already stripped, plus the figures a careless host might leave on, so the renderer is pinned
   * as the second place that refuses to draw them rather than as the only one.
   */
  it('names a concealed check and draws no figure, pass stamp or grade for it', () => {
    const concealed = {kind:'roll', receipt:'roll:psychology-t5-c1', actor:'thomas-hayes', actor_label:'托马斯·海斯',
      actor_is_investigator:true, skill:'Psychology', visibility:'concealed', family:'psychology',
      roll:2, target:70, threshold:70, difficulty:'regular', level:'extreme', passed:true};
    const {container} = render(<Delivery details={{turn:5, mechanics:[concealed]}} />);
    expect(container.querySelectorAll('.coc-mech-row')).toHaveLength(1);
    expect(container.textContent).toContain('托马斯·海斯');
    expect(container.textContent).toContain(say('zh-Hans', 'mechanics', 'concealed'));
    expect(container.querySelector('.coc-mech-figure')).toBeNull();
    expect(container.querySelector('.coc-mech-lv')).toBeNull();
    expect(container.textContent).not.toContain(say('zh-Hans', 'mechanics', 'pass'));
    expect(container.textContent).not.toContain(say('zh-Hans', 'mechanics', 'level.extreme'));
    expect(container.textContent).not.toMatch(/\b(2|70)\b/);
  });

  it('draws nothing at all for a keeper roll, the tier the player was never told about', () => {
    const {container} = render(<Delivery details={{turn:5, mechanics:[{...ROLL, visibility:'keeper'}]}} />);
    expect(container.querySelectorAll('.coc-mech-row')).toHaveLength(0);
  });

  it('folds a ready handout carrying text and keeps a document-none handout a plain delivered row', () => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:9, mechanics:[
      {kind:'handout', receipt:'h1', name:'globe', label:'环球报未刊稿', document:'ready',
        path:'/tmp/x.md', media_type:'text/markdown', text:'正文第一段。\n\n正文第二段。'},
      {kind:'handout', receipt:'h2', name:'skull', label:'标题骷髅', document:'none'},
    ]}} />);
    const folds = container.querySelectorAll('details.coc-mech-fold');
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain('环球报未刊稿');
    expect(folds[0].textContent).toContain('正文第二段。');
    expect(container.querySelectorAll('div.coc-mech-row[data-kind="handout"]')).toHaveLength(1);
    expect(container.textContent).toContain('标题骷髅');
    expect(container.textContent).not.toContain('尚未交付');
  })

  it('keeps confirmed investigator names on roll, dice and change cards', () => {
    const {container} = render(<Delivery details={{play_language:'en', turn:5, mechanics:[
      ROLL,
      {kind:'dice', receipt:'d', actor:'inv', actor_label:'Mira', actor_is_investigator:true, expression:'1D6', faces:[4], total:4},
      {kind:'change', receipt:'c', subject:'inv', subject_label:'Mira', subject_is_investigator:true, resource:'hp', before:12, after:8},
    ]}} />);
    expect(container.textContent).toContain('托马斯·海斯');
    expect(screen.getAllByText(/Mira/)).toHaveLength(2);
  });

  it('localizes the resource name the glossary carries and leaves others canonical', () => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:7,
      labels: { LUCK: '幸运' },
      mechanics:[
        {kind:'change', receipt:'d1', resource:'luck', subject:'inv', subject_label:'林远', subject_is_investigator:true, before:45, after:38},
        {kind:'change', receipt:'d2', resource:'hp', subject:'inv', subject_label:'林远', subject_is_investigator:true, before:12, after:8},
      ]}} />);
    expect(container.textContent).toContain('幸运');
    expect(container.textContent).toContain('HP');
    expect(container.textContent).not.toContain('LUCK');
  })

  it('unfolds a clue with the table account and keeps a bare one a plain row', () => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:6, mechanics:[
      {kind:'clue', receipt:'clue:tide-t6', clue:'tide-marks', label:'潮痕',
        how:'第三级台阶的绿苔水位线比涨潮线高出一掌。'},
      CLUE,
    ]}} />);
    const folds = container.querySelectorAll('details.coc-mech-fold');
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain('潮痕');
    expect(folds[0].textContent).toContain('涨潮线');
    expect(container.querySelectorAll('div.coc-mech-row[data-kind="clue"]')).toHaveLength(1);
  })

  it('renders the table-authored clue account verbatim instead of sending it through the glossary', () => {
    const how = '第三级台阶的水线比涨潮线高出一掌。';
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:6,
      labels: { [how]: '不应替换这句桌上记录。' },
      mechanics:[{kind:'clue', receipt:'clue:tide-t6', clue:'tide-marks', label:'潮痕', how}]}} />);
    const body = container.querySelector('details.coc-mech-fold .coc-mech-fold-body');
    expect(body?.textContent).toBe(how);
  })

  /**
   * Every kernel-authored content field on this card goes through the campaign's glossary.
   *
   * The card printed a clue's name, an item's name, a scene's name, a currency and a die's caption
   * exactly as the receipt carried them, which is English wherever the kernel minted the word --
   * so a Chinese table read "Gold fragment", "USD" and "SAN Loss" beside its own prose. The lanes
   * project those fields into `labels`; the Keeper-authored clue account is already in the play
   * language and must stay verbatim.
   */
  it('reads every content field through the campaign glossary, die captions included', () => {
    const labels = {
      'Gold fragment': '金嵌板', "Knott's Office": '诺特的办公室', 'Crowe House': '克罗宅',
      USD: '美元', 'SAN Loss': '理智损失', 'Pools of blood': '血泊',
    }
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:11, labels, mechanics:[
      {kind:'clue', receipt:'c1', clue:'blood-pool', label:'Pools of blood',
        how:'水线比涨潮线高出一掌。'},
      {kind:'item', receipt:'i1', name:'gold-fragment', label:'Gold fragment', quantity:1, to:'lin', to_label:'林远'},
      {kind:'scene', receipt:'s1', from:'a', from_label:"Knott's Office", to:'b', to_label:'Crowe House'},
      {kind:'cash', receipt:'m1', subject:'lin', subject_label:'林远', before:60, after:40, currency:'USD'},
      {kind:'dice', receipt:'d1', label:'SAN Loss', expression:'1D6', faces:[4], total:4},
    ]}} />)
    for (const projected of Object.values(labels)) expect(container.textContent).toContain(projected)
    for (const canonical of Object.keys(labels)) expect(container.textContent).not.toContain(canonical)
    expect(container.textContent).toContain('水线比涨潮线高出一掌。')
  })

  /**
   * A receipt kind this file has not met names itself; it never dumps the row into the reading
   * surface. The JSON is still reachable for a bug report, on the row's `title`.
   */
  it('names an unknown kind rather than printing its JSON at the player', () => {
    const row = {kind:'augury', receipt:'a1', omen:'a crow on the sill'}
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:12,
      labels:{augury:'预兆'}, mechanics:[row]}} />)
    const rendered = container.querySelector('[data-kind="augury"]') as HTMLElement
    expect(rendered.querySelector('.coc-mech-body')?.textContent).toBe('预兆')
    expect(container.textContent).not.toContain('a crow on the sill')
    expect(rendered.getAttribute('title')).toContain('a crow on the sill')
  })

  it('captions a trailing fold from the delivery, and shows the key for a language that lacks it', () => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:13,
      ui: ui('zh-Hans', {mechanics: {'fold.clue': undefined}}), mechanics:[CLUE]}} />)
    // The caption word alone: the toggle beside it also counts the rows, which is chrome, not a word.
    expect(container.querySelector('.coc-mech-cap .coc-mech-list-name')?.textContent).toBe('fold.clue')
    expect(container.textContent).not.toContain(say('en', 'mechanics', 'fold.clue'))
  })

  it('keeps the prose in order and puts each placed receipt at its point', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, marked_text: MARKED, mechanics: [ROLL, TIME, SHELF] }} />,
    )
    const blocks = [...container.querySelectorAll('.coc-mech-para, .coc-mech-here')]
      .map(node => (node.className === 'coc-mech-para' ? 'text' : 'row'))
    expect(blocks).toEqual(['text', 'row', 'text', 'row', 'text'])
    expect(container.textContent).not.toContain('{{')
    expect(screen.getByText(/你翻遍了匣子/)).toBeTruthy()
  })

  it('never draws a time receipt: the clock is the panel\'s, not the transcript\'s', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, marked_text: MARKED, mechanics: [ROLL, TIME] }} />,
    )
    // Neither where the Keeper placed it nor in the trailing group, and the prose around its
    // marker stays one paragraph rather than splitting around a hole.
    expect(container.querySelector('[data-kind="time"]')).toBeNull()
    expect(container.textContent).not.toContain('10 分钟')
    expect(container.querySelector('.coc-mech-list')).toBeNull()
    expect(screen.getByText('十分钟很快耗尽。架子深处还有未开的匣。你把手电压低。')).toBeTruthy()
  })

  it('groups a receipt the Keeper did not place instead of losing it', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, marked_text: MARKED, mechanics: [ROLL, TIME, SHELF, CLUE] }} />,
    )
    expect(container.querySelectorAll('.coc-mech-here')).toHaveLength(2)
    expect(container.querySelector('.coc-mech-list')?.textContent).toContain('宅子钥匙')
  })

  it('keeps the text whole around a marker whose row the projection hid', () => {
    // A keeper-visibility roll is stripped from the rows before the frontend sees them, but its
    // marker is still in the delivery. Nothing may be lost around it.
    const hidden = '你看了他一眼{{check:psychology}}，他移开了目光。'
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, marked_text: hidden, mechanics: [] }} />,
    )
    expect(container.querySelectorAll('.coc-mech-here')).toHaveLength(0)
    expect(container.textContent).toContain('你看了他一眼，他移开了目光。')
    expect(container.textContent).not.toContain('{{')
  })

  it('draws the plain card when no marker was placed, exactly as before', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, rendered_text: '一段叙事。', mechanics: [CLUE] }} />,
    )
    expect(container.querySelector('.coc-mech-inline')).toBeNull()
    expect(container.querySelector('.coc-mech-prose')?.textContent).toBe('一段叙事。')
  })
})

/**
 * The delta badge is base-10 arithmetic, because the player reads its digits (contract §16.2).
 *
 * A cash receipt carries only its endpoints — the kernel settles money exactly and hands over
 * `before: 9, after: 8.98` with no delta at all. The card made the difference itself with
 * `after - before`, and IEEE-754 answered `-0.019999999999999574`, which is what a player buying a
 * two-cent newspaper was shown. Both resource rows compute a delta, so both are pinned here.
 */
describe('a resource delta is drawn in the scale it was given', () => {
  const CASH = {
    kind: 'cash', receipt: 'cash:t50-c1', subject: 'investigator', subject_label: '哈里森·韦尔',
    before: 9, after: 8.98, currency: 'USD',
  }
  const CHANGE = {
    kind: 'change', receipt: 'delta:san-t50-c2', subject: 'investigator', subject_is_investigator: true,
    subject_label: '哈里森·韦尔', resource: 'san', before: 50, after: 45,
  }

  it.each([
    [9, 8.98, '-0.02'],
    [8.98, 9, '+0.02'],
    [0.3, 0.1, '-0.2'],
    [1.1, 1.3, '+0.2'],
    [10, 9.995, '-0.005'],
  ])('differences cash on its own digits (%s -> %s)', (before, after, badge) => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 50, mechanics: [{ ...CASH, before, after }] }} />,
    )
    expect(container.querySelector('.coc-mech-delta')?.textContent).toBe(badge)
    // The endpoints are the kernel's own and are printed untouched.
    expect(container.querySelector('.coc-mech-figure')?.textContent).toContain(String(after))
  })

  it.each([
    [50, 45, '-5'],
    [9, 8.98, '-0.02'],
    [0.3, 0.1, '-0.2'],
  ])('differences a resource change the same way (%s -> %s)', (before, after, badge) => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 50, mechanics: [{ ...CHANGE, before, after }] }} />,
    )
    expect(container.querySelector('.coc-mech-delta')?.textContent).toBe(badge)
  })

  it('draws no badge when nothing moved', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 50, mechanics: [{ ...CASH, before: 8.98, after: 8.98 }] }} />,
    )
    expect(container.querySelector('.coc-mech-delta')).toBeNull()
  })
})

/**
 * A check the difficulty moved is decided at a bar the card has to draw (contract §16.2).
 *
 * From a real table's turn 12: a hard Intimidate against a 15 is settled at 7, and a 10 failed.
 * The kernel had `difficulty` and `threshold` on the row the whole time and `mechanics.js` read
 * neither, so the player was shown `10 /15` under a failure stamp — which in CoC's one arithmetic
 * rule says the product cannot subtract. Every regular check on that table read correctly, so
 * nothing but a non-regular difficulty exposes it.
 *
 * The expectations are composed from the shipped captions rather than transcribed: renaming a
 * caption has to travel here, and a caption deleted from the surface must not silently pass.
 */
describe('a roll says what its difficulty demanded', () => {
  const HARD = {
    kind: 'roll', receipt: 'roll:intimidate-t12-c1', actor: 'edwin-crow', actor_label: '埃德温·克罗',
    actor_is_investigator: true, skill: 'Intimidate', roll: 10, target: 15, threshold: 7,
    difficulty: 'hard', level: 'failure', passed: false, pushed: false, visibility: 'public',
    family: 'social',
  }
  /** The chip the card owes, built from `content/ui/<tag>/mechanics.json` itself. */
  const need = (tag: string, difficulty: string, n: number) =>
    say(tag, 'mechanics', 'needs')
      .replace('{level}', say(tag, 'mechanics', `difficulty.${difficulty}`))
      .replace('{n}', String(n))

  it.each([
    ['zh-Hans', 'hard', 7],
    ['en', 'hard', 7],
    ['zh-Hans', 'extreme', 3],
    ['en', 'extreme', 3],
  ])('draws the bar the die was compared against (%s, %s)', (play_language, difficulty, threshold) => {
    const { container } = render(
      <Delivery details={{ play_language, turn: 12, mechanics: [{ ...HARD, difficulty, threshold }] }} />,
    )
    expect(container.querySelector('.coc-mech-need')?.textContent).toBe(need(play_language, difficulty, threshold))
    // The target stays: it is the investigator's own skill, and the row is its receipt.
    expect(container.querySelector('.coc-mech-target')?.textContent).toBe('/15')
    expect(container.querySelector('.coc-mech-stamp')?.textContent).toBe(say(play_language, 'mechanics', 'fail'))
  })

  it('stays silent when the difficulty moved nothing', () => {
    // `regular`'s threshold is the target already drawn, so a chip there would repeat a number
    // and teach the player that the chip means something it does not.
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, mechanics: [ROLL] }} />,
    )
    expect(container.querySelector('.coc-mech-need')).toBeNull()
    expect(container.querySelector('.coc-mech-target')?.textContent).toBe('/50')
  })

  it('never draws the bar for a roll the rules keep from the player', () => {
    // §16.5: a concealed roll prints no figure at all, and the threshold is a figure — half the
    // investigator's own skill, and the shape of the check they were not allowed to see.
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 12, mechanics: [{ ...HARD, visibility: 'concealed' }] }} />,
    )
    expect(container.querySelector('.coc-mech-need')).toBeNull()
    expect(container.textContent).not.toContain('7')
    expect(container.querySelector('.coc-mech-stamp')?.textContent).toBe(say('zh-Hans', 'mechanics', 'concealed'))
  })

  it('still prints the true bar for a difficulty the surface has no word for', () => {
    // The numbers are the test; the word is the gloss. A difficulty added to the rules data
    // before a caption exists must not take the figure down with it.
    const { container } = render(
      <OpenedSlip><Card details={{ ui: ui('zh-Hans', { mechanics: { 'difficulty.hard': undefined } }), play_language: 'zh-Hans',
        turn: 12, mechanics: [HARD] }} /></OpenedSlip>,
    )
    expect(container.querySelector('.coc-mech-need')?.textContent).toContain('7')
    expect(container.querySelector('.coc-mech-need')?.textContent).toContain('hard')
  })
})

/**
 * The two axes a roll row draws are told apart by their words (contract §16.2).
 *
 * `difficulty` is what the check demanded; `level` is what the die achieved. CoC spells three of
 * their values identically, and the card drew both of them bare — so H-MAIN's turn 68, a STR check
 * against 55 rolled as a 13 (`difficulty: regular, level: hard`), printed `力量 13 /55 困难 通过`
 * and every reader took that 困难 for the difficulty of a check the keeper had called regular. The
 * card was telling the truth about a field nobody could tell it was talking about.
 *
 * Nothing in the renderer can settle this: both chips ask for a caption and print what comes back.
 * So the fix is two vocabularies — the demanded word framed as a requirement, the achieved word
 * named as an outcome — and what is pinned here is that the frames survive on one row together.
 */
describe('a roll tells the difficulty it demanded apart from the grade it achieved', () => {
  /** H-MAIN turn 68, as the kernel wrote it: regular difficulty, hard success. */
  const GRADED = {
    kind: 'roll', receipt: 'roll:str-t68-c1', actor: 'harrison-wells', actor_label: '哈里森·韦尔',
    actor_is_investigator: true, skill: 'STR', roll: 13, target: 55, threshold: 55,
    difficulty: 'regular', level: 'hard', passed: true, pushed: false, visibility: 'public',
  }
  const need = (tag: string, difficulty: string, n: number) =>
    say(tag, 'mechanics', 'needs')
      .replace('{level}', say(tag, 'mechanics', `difficulty.${difficulty}`))
      .replace('{n}', String(n))

  it.each(['zh-Hans', 'en'])('keeps the achieved grade off the difficulty vocabulary (%s)', tag => {
    // The reported receipt itself. `regular` draws no requirement chip, so the grade chip stands
    // alone beside the figures — which is precisely why it was read as the difficulty.
    const { container } = render(<Delivery details={{ play_language: tag, turn: 68, mechanics: [GRADED] }} />)
    expect(container.querySelector('.coc-mech-need')).toBeNull()
    const grade = container.querySelector('.coc-mech-lv')?.textContent ?? ''
    expect(grade).toBe(say(tag, 'mechanics', 'level.hard'))
    for (const name of ['regular', 'hard', 'extreme'])
      expect(grade).not.toBe(say(tag, 'mechanics', `difficulty.${name}`))
  })

  it.each([
    ['zh-Hans', 'hard', 27],
    ['en', 'hard', 27],
    ['zh-Hans', 'extreme', 11],
    ['en', 'extreme', 11],
  ])('draws both axes on one row with neither chip swallowing the other (%s, %s)', (tag, difficulty, threshold) => {
    // The worst case for the collision: the demanded difficulty and the achieved grade carry the
    // same rules value, so the two chips sit side by side naming the same CoC word for two
    // different things. Containment, not inequality, is the assertion — the requirement chip wraps
    // its word in `needs … · ≤n`, so a bare grade chip beside it is the same ambiguity with a
    // number stapled on, and `toBe`-style inequality would call that a pass.
    const { container } = render(
      <Delivery details={{ play_language: tag, turn: 68,
        mechanics: [{ ...GRADED, difficulty, threshold, level: difficulty }] }} />,
    )
    const demanded = container.querySelector('.coc-mech-need')?.textContent ?? ''
    const achieved = container.querySelector('.coc-mech-lv')?.textContent ?? ''
    expect(demanded).toBe(need(tag, difficulty, threshold))
    expect(achieved).toBe(say(tag, 'mechanics', `level.${difficulty}`))
    expect(demanded).not.toContain(achieved)
    expect(achieved).not.toContain(demanded)
  })

  it('leaves the two grades that are not difficulties alone', () => {
    // `critical` and `fumble` name no difficulty, so they need no disambiguation and must not
    // acquire one: a fumble is the loudest thing on the card and reads as itself.
    for (const [level, passed] of [['critical', true], ['fumble', false]] as const) {
      const { container } = render(
        <Delivery details={{ play_language: 'zh-Hans', turn: 68, mechanics: [{ ...GRADED, level, passed }] }} />,
      )
      expect(container.querySelector('.coc-mech-lv')?.textContent).toBe(say('zh-Hans', 'mechanics', `level.${level}`))
      expect(container.querySelector('.coc-mech-row')?.getAttribute('data-grade')).toBe(level)
      cleanup()
    }
  })
})

describe('the plain copy of a drawn delivery is folded away', () => {
  const card = (marked: string): ChatMessage => ({
    id: 'm1', role: 'assistant', content: '', timestamp: 1,
    presentation: { renderer: 'coc-mechanics', details: { turn: 5, mechanics: [ROLL], marked_text: marked } },
  } as ChatMessage)
  const said = (content: string): ChatMessage => ({ id: 'a1', role: 'assistant', content, timestamp: 2 } as ChatMessage)

  it('drops the assistant copy of the same delivery', () => {
    const folded = foldMarkedDeliveries([card(MARKED), said(withoutMechanicsMarkers(MARKED))])
    expect(folded).toHaveLength(1)
    expect(folded[0].presentation?.renderer).toBe('coc-mechanics')
  })

  it('leaves a different assistant message alone', () => {
    const other = said('另一段完全不同的话。')
    expect(foldMarkedDeliveries([card(MARKED), other])).toHaveLength(2)
  })

  it('changes nothing when no delivery was marked', () => {
    const messages = [said('一段叙事。')]
    expect(foldMarkedDeliveries(messages)).toEqual(messages)
  })

  it('strips markers the way the kernel does, so the two texts can be compared at all', () => {
    expect(withoutMechanicsMarkers('你翻遍了匣子{{check:library-use}}。')).toBe('你翻遍了匣子。')
  })
})

/**
 * Every draft row draws the campaign's current draft (contract §23.4, §98), so after a re-draft
 * the transcript held two identical cards. One card per campaign: the row with the highest
 * revision is the card, and the rest become a line each -- so the id this names is the only row
 * that renders a full card. A host-side action bumps the revision on a row already there without
 * appending one, which is why the revision decides and not the position.
 */
describe('one draft row is the live card', () => {
  const draft = (id: string, revision: unknown): ChatMessage => ({
    id, role: 'assistant', content: '', timestamp: 1,
    presentation: { renderer: 'coc-character-draft', details: { revision, sheet: { name: 'Eileen' } } },
  } as ChatMessage)
  const said = (content: string): ChatMessage => ({ id: `said-${content}`, role: 'assistant', content, timestamp: 9 } as ChatMessage)

  it('names the highest revision, not the last row', () => {
    expect(liveDraftMessageId([draft('r1', 1), said('a'), draft('r2', 2)])).toBe('r2')
    expect(liveDraftMessageId([draft('r3', 3), said('a'), draft('r2', 2)])).toBe('r3')
  })

  it('names the single card a host-side action moved past', () => {
    expect(liveDraftMessageId([draft('r2', 2), said('a')])).toBe('r2')
  })

  it('gives a tie to the row the host wrote last', () => {
    expect(liveDraftMessageId([draft('first', 2), draft('second', 2)])).toBe('second')
  })

  it('still names a row whose payload carries no revision', () => {
    expect(liveDraftMessageId([draft('legacy', undefined)])).toBe('legacy')
    expect(liveDraftMessageId([draft('legacy', undefined), draft('r1', 1)])).toBe('r1')
  })

  it('names nothing when no draft card is present', () => {
    expect(liveDraftMessageId([said('a')])).toBeUndefined()
  })
})

/**
 * The document a handout opens into is the module's own prose, in the language the book was read
 * in (the graph contract's source_language_law), and the campaign projects it into a lane the same
 * way it projects a clue's sentence. The row's name went through the glossary from the start and
 * its body did not, so the card folded a play-language title over a column of the source language.
 */
describe('a handed-over handout opens in the play language', () => {
  const TEXT = '# Handout 2: Unpublished Boston Globe Story (1918)\n\nHOUSE ON SHEAFE STREET LEAVES A RECORD OF MISFORTUNE\n'
  const PROJECTED = '# 手卡二：环球报未刊稿（一九一八）\n\n希夫街的宅子留下一连串不幸\n'
  const HANDOUT = {
    kind: 'handout', receipt: 'handout:globe-unpublished-1918-t6', handout: 'globe-unpublished-1918',
    name: 'Handout 2: Unpublished Boston Globe Story (1918)', label: '环球报未刊稿（一九一八）',
    available: true, text: TEXT,
  }

  // The document keeps its own line breaks, which `getByText` would normalise away, so the fold's
  // body is read whole.
  const opened = (labels: Record<string, string>) =>
    render(<Delivery details={{turn: 6, mechanics: [HANDOUT], labels}} />)
      .container.querySelector('.coc-mech-fold-body')?.textContent

  it('draws the projection the campaign holds, not the book', () => {
    expect(opened({[TEXT]: PROJECTED})).toBe(PROJECTED)
    expect(screen.getByText('环球报未刊稿（一九一八）')).toBeTruthy()
  })

  it('draws the book itself while no projection has landed, rather than an empty card', () => {
    expect(opened({})).toBe(TEXT)
  })
})
