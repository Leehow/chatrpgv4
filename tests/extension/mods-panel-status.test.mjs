import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createComponent} from '../../pipicoc/mods-panel.js';
import {registerModsPanel} from '../../pipicoc/mods.ts';
import {EventEmitter} from 'node:events';

const words = {mods: JSON.parse(await readFile(new URL('../../content/ui/en/mods.json', import.meta.url), 'utf8'))};
const captions = {...words.mods, notAdded:'Not added to this campaign', disabled:'Disabled in this campaign',
  enabled:'Enabled in this campaign', lockedVersion:'Locked version', availableVersions:'Available versions'};
const row = (version, active = null, pending = null) => ({id:'test-mod', name:'Test Mod', description:'A test package',
  version, active, pending, compatible:true, default_enabled:false, settings:{tone:'plain'}, settings_schema:{}});
const answerFor = (mods, campaign = 'selected') => ({campaign, mods, order:['test-mod'], ui:{tag:'en', words:{mods:captions}}});

function panel(answer, invoke = async () => ({ok:true, data:answer})) {
  const states = [], refs = [], effects = [];
  let slot = 0, refSlot = 0, mounted = false, tree;
  const calls = [];
  const React = {
    createElement(type, props, ...children) { return {type, props:props ?? {}, children:children.flat(Infinity).filter(v=>v !== false && v != null)}; },
    useState(initial) {
      const index = slot++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => {states[index] = typeof value === 'function' ? value(states[index]) : value;}];
    },
    useRef(initial) { const index = refSlot++; return refs[index] ??= {current:initial}; },
    useEffect(effect) { if (!mounted) effects.push(effect); },
  };
  const api = {invoke:async (method, params) => {calls.push({method,params}); return invoke(method, params);}};
  const Component = createComponent(React);
  function render() {slot = 0; refSlot = 0; tree = Component({api}); return tree;}
  async function flush() {await new Promise(resolve=>setImmediate(resolve)); return render();}
  render(); mounted = true; for (const effect of effects) effect();
  return {calls, flush, get tree() {return tree;}};
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap(child=>nodes(child,predicate))];
}
function text(tree) {return typeof tree === 'object' ? tree.children.map(text).join('') : String(tree);}
function control(view, type, label) {return nodes(view.tree, node=>node.type === type && (node.props['aria-label'] === label || text(node) === label))[0];}
const campaignToggle = view => nodes(view.tree,node=>node.type === 'input' && node.props.type === 'checkbox')[0];

test('campaign absence, explicit disable and enable have different visible statuses without activation', async () => {
  for (const [active, caption, checked] of [[null,captions.notAdded,false],
    [{version:'1.0.0',enabled:false},captions.disabled,false], [{version:'1.0.0',enabled:true},captions.enabled,true]]) {
    const view = panel(answerFor([row('1.0.0',active)]));
    await view.flush();
    const statuses = nodes(view.tree, node=>node.props.role === 'status').map(text);
    assert.ok(statuses.includes(caption), `missing campaign status: ${caption}`);
    assert.equal(campaignToggle(view).props.checked,checked);
    assert.deepEqual(view.calls.map(call=>call.method),['mods.list'], 'display must never enroll a package');
  }
});

test('pending belongs to the package, survives version selection and does not pretend the lock changed', async () => {
  const active = {version:'1.0.0',enabled:false};
  const pending = {version:'2.0.0',enabled:true};
  const view = panel(answerFor([row('1.0.0',active,pending),row('2.0.0')]));
  await view.flush();
  control(view,'select','Test Mod Version').props.onChange({target:{value:'2.0.0'}});
  await view.flush();
  assert.match(text(view.tree), /Locked version: 1\.0\.0/);
  assert.match(text(view.tree), /Available versions: 2\.0\.0/);
  assert.ok(nodes(view.tree,node=>node.props.role === 'status').map(text).includes(captions.disabled));
  const notice = nodes(view.tree,node=>node.props.role === 'status').map(text).find(value=>value.includes(captions.pending));
  assert.ok(notice, 'pending must remain visible when the selected row has no pending field');
  assert.ok(notice.includes('2.0.0') && notice.includes(captions.enabled), 'show the queued target, separately from the active lock');
  assert.equal(campaignToggle(view).props.checked,false);
});

test('joining, upgrading and settings use the existing bound adapter; install and defaults remain separate', async () => {
  const symbol = Symbol.for('pipiui.ext-invoke.registry');
  const prior = globalThis[symbol], handlers = new Map(), kernelCalls = [];
  globalThis[symbol] = {version:1, register(_id,method,handler){handlers.set(method,handler); return ()=>{};}};
  try {
    const pi = {events:new EventEmitter(), on(){}};
    registerModsPanel(pi);
    let answer = answerFor([row('1.0.0'),row('2.0.0')]);
    pi.events.emit('coc:kernel-bridge', {campaign:'selected', call:async(method,params)=>{
      kernelCalls.push({method,params}); return method === 'mods.list' ? answer : {};
    }});
    const view = panel(answer, async(method,params)=>{
      const result = await handlers.get(method)({...params,campaign:'foreign'});
      return {ok:true,data:method === 'mods.list' ? answer : result};
    });
    await view.flush();
    campaignToggle(view).props.onChange({target:{checked:true}});
    await view.flush();
    assert.deepEqual(kernelCalls.find(call=>call.method === 'mods.configure').params,
      {campaign:'selected',id:'test-mod',version:'2.0.0',enabled:true});
    answer = answerFor([row('1.0.0',{version:'1.0.0',enabled:false}),row('2.0.0')]);
    control(view,'button',captions.refresh).props.onClick(); await view.flush();
    control(view,'select','Test Mod Version').props.onChange({target:{value:'2.0.0'}}); await view.flush();
    control(view,'button',captions.update).props.onClick(); await view.flush();
    assert.deepEqual(kernelCalls.filter(call=>call.method === 'mods.configure').at(-1).params,
      {campaign:'selected',id:'test-mod',version:'2.0.0'}, 'upgrading must not override an explicit disable');
    control(view,'input','tone').props.onBlur({target:{value:'warm'}}); await view.flush();
    assert.deepEqual(kernelCalls.filter(call=>call.method === 'mods.configure').at(-1).params,
      {campaign:'selected',id:'test-mod',version:'2.0.0',settings:{tone:'warm'}});
    nodes(view.tree,node=>node.type === 'input' && node.props.type === 'checkbox')[1].props.onChange({target:{checked:true}});
    await view.flush();
    assert.equal(kernelCalls.filter(call=>call.method === 'mods.defaults').at(-1).params.enabled,true);
    control(view,'button',captions.install).props.onClick(); await view.flush();
    control(view,'input',captions.path).props.onChange({target:{value:'/local/mod'}}); await view.flush();
    nodes(view.tree,node=>node.type === 'form')[0].props.onSubmit({preventDefault(){}}); await view.flush();
    assert.equal(kernelCalls.filter(call=>call.method === 'mods.install').at(-1).params.path,'/local/mod');
    assert.ok(kernelCalls.filter(call=>call.method === 'mods.configure').every(call=>call.params.campaign === 'selected'));
  } finally {globalThis[symbol] = prior;}
});

test('an unbound panel does not call a package absent from a campaign or permit campaign changes', async () => {
  const view = panel(answerFor([row('1.0.0')],null)); await view.flush();
  assert.ok(text(view.tree).includes(captions.unbound));
  assert.equal(text(view.tree).includes(captions.notAdded),false);
  assert.equal(campaignToggle(view).props.disabled,true);
});
