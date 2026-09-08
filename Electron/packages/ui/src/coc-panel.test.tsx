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
import weaponCatalog from '../../../../content/rulesets/coc7/rules-json/weapons.json';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
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

  it('unfolds a clue with a summary into what it says, and keeps a bare one a plain row', async () => {
    const withDetail = view({ clues: { discovered: [
      { clue: 'knott-commission', label: '诺特的委托合同',
        summary: 'Landlord Steven Knott pays $20/day to examine the Corbitt House.' },
      { clue: 'bare-clue', label: '空线索' },
    ] } });
    const { container } = render(<Panel api={host({ ok: true, data: { status: 'ready', view: withDetail, campaign: 'c1' } })} />);
    await screen.findByText('诺特的委托合同');
    const folds = container.querySelectorAll('details.coc-clue-fold');
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain('诺特的委托合同');
    expect(folds[0].textContent).toContain('Corbitt House');
    expect(folds[0].querySelector('summary')?.textContent).not.toContain('Corbitt House');
    expect(screen.getByText('空线索')).toBeTruthy();
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
 await waitFor(()=>expect(api.invoke).toHaveBeenLastCalledWith('sheet',{retry_projection:true}));
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
it('supports legacy weapon fields and preserves supplied quantities without inventing missing parameters',async()=>{
 render(<Panel api={host({ok:true,data:{status:'ready',view:view({investigators:[{...investigator,weapons:[{name:'Old pistol',damage:'1D6',range:10,attacks:1,ammo:0,quantity:2}]}]}),campaign:'c1'}})}/>);
 const row=(await screen.findByText('Old pistol')).closest('li')!;
 expect(row.textContent).toContain('x2');
 expect(row.textContent).toContain('伤害1D6');
 expect(row.textContent).toContain('当前弹药0');
 expect(row.textContent).not.toContain('弹匣容量');
});
