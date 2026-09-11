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
import { foldMarkedDeliveries, withoutMechanicsMarkers, type ChatMessage } from './transcript-model'
import { say, ui } from './fixtures/coc-ui-words'

const Card = createComponent(React)

/**
 * The card under test, with the `ui` block a host attaches to every delivery (§23).
 *
 * The words are the shipped ones for the delivery's own play language, so a caption renamed in
 * `content/ui/` has to travel here; a test that means to say something unusual about the words --
 * a language with a gap in it -- passes its own `ui` and this leaves it alone.
 */
const Delivery = ({details}: {details: Record<string, unknown>}) =>
  <Card details={{ui: ui(String(details.play_language ?? 'zh-Hans')), ...details}} />

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

  it('folds a handout carrying text into a disclosure and keeps a textless one a plain row', () => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:9, mechanics:[
      {kind:'handout', receipt:'h1', name:'globe', label:'环球报未刊稿', available:true,
        path:'/tmp/x.md', media_type:'text/markdown', text:'正文第一段。\n\n正文第二段。'},
      {kind:'handout', receipt:'h2', name:'skull', label:'标题骷髅', available:false},
    ]}} />);
    const folds = container.querySelectorAll('details.coc-mech-fold');
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain('环球报未刊稿');
    expect(folds[0].textContent).toContain('正文第二段。');
    expect(container.querySelectorAll('div.coc-mech-row[data-kind="handout"]')).toHaveLength(1);
    expect(container.textContent).toContain('尚未交付');
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

  it('unfolds a clue with a summary and keeps a bare one a plain row', () => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:6, mechanics:[
      {kind:'clue', receipt:'clue:tide-t6', clue:'tide-marks', label:'潮痕',
        summary:'第三级台阶的绿苔水位线比涨潮线高出一掌。'},
      CLUE,
    ]}} />);
    const folds = container.querySelectorAll('details.coc-mech-fold');
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain('潮痕');
    expect(folds[0].textContent).toContain('涨潮线');
    expect(container.querySelectorAll('div.coc-mech-row[data-kind="clue"]')).toHaveLength(1);
  })

  it('renders the glossary projection of a clue summary when the delivery carries one', () => {
    const summary = 'The waterline on the third step sits a hand above high tide.';
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:6,
      labels: { [summary]: '第三级台阶的水线比涨潮线高出一掌。' },
      mechanics:[{kind:'clue', receipt:'clue:tide-t6', clue:'tide-marks', label:'潮痕', summary}]}} />);
    const body = container.querySelector('details.coc-mech-fold .coc-mech-fold-body');
    expect(body?.textContent).toBe('第三级台阶的水线比涨潮线高出一掌。');
  })

  /**
   * Every content field on this card goes through the campaign's glossary.
   *
   * The card printed a clue's name, an item's name, a scene's name, a currency and a die's caption
   * exactly as the receipt carried them, which is English wherever the kernel minted the word --
   * so a Chinese table read "Gold fragment", "USD" and "SAN Loss" beside its own prose. The lanes
   * project all five into `labels`; nothing here may skip that lookup.
   */
  it('reads every content field through the campaign glossary, die captions included', () => {
    const labels = {
      'Gold fragment': '金嵌板', "Knott's Office": '诺特的办公室', 'Crowe House': '克罗宅',
      USD: '美元', 'SAN Loss': '理智损失', 'Pools of blood': '血泊',
      'The waterline sits a hand above high tide.': '水线比涨潮线高出一掌。',
    }
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:11, labels, mechanics:[
      {kind:'clue', receipt:'c1', clue:'blood-pool', label:'Pools of blood',
        summary:'The waterline sits a hand above high tide.'},
      {kind:'item', receipt:'i1', name:'gold-fragment', label:'Gold fragment', quantity:1, to:'lin', to_label:'林远'},
      {kind:'scene', receipt:'s1', from:'a', from_label:"Knott's Office", to:'b', to_label:'Crowe House'},
      {kind:'cash', receipt:'m1', subject:'lin', subject_label:'林远', before:60, after:40, currency:'USD'},
      {kind:'dice', receipt:'d1', label:'SAN Loss', expression:'1D6', faces:[4], total:4},
    ]}} />)
    for (const projected of Object.values(labels)) expect(container.textContent).toContain(projected)
    for (const canonical of Object.keys(labels)) expect(container.textContent).not.toContain(canonical)
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

  it('captions the mechanics slip from the delivery, and shows the key for a language that lacks it', () => {
    const {container} = render(<Delivery details={{play_language:'zh-Hans', turn:13,
      ui: ui('zh-Hans', {mechanics: {mechanics: undefined}}), mechanics:[CLUE]}} />)
    expect(container.querySelector('.coc-mech-cap')?.textContent).toBe('mechanics')
    expect(container.textContent).not.toContain(say('en', 'mechanics', 'mechanics'))
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
