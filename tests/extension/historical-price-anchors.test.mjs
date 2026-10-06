/** Paid-search policy seam, not a Keeper playtest. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HistoricalReference, EXA_ENV} from '../../runtime/historical-reference.ts';
import {HistoricalReferenceLibrary} from '../../runtime/historical-reference-library.ts';

const excerpt = 'Boston, 1920. Prices in US dollars: a cup of coffee $0.05; a plain sandwich $0.15; an ordinary daily wage $4.';
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'coc-price-anchors-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const requests = [], batches = [];
  const control = {kind: 'price_anchor', challenge: false, compatible: true, qualified: true, unavailable: false};
  const decide = async batch => {
    batches.push(batch);
    if (control.unavailable) return {status: 'unavailable', answers: {}};
    return {status: 'complete', answers: Object.fromEntries(batch.questions.map(q => [q.key,
      q.key === 'query_kind' ? {status: 'answered', type: 'choice', choice: control.kind, confidence: 1}
        : q.key === 'price_disputed' ? {status: 'answered', type: 'noul', noul: control.challenge ? 0.99 : 0.01}
        : q.key.startsWith('anchor_') ? {status: 'answered', type: 'noul', noul: control.compatible ? 0.95 : 0.01}
        : q.key.startsWith('price_anchor_') ? {status: 'answered', type: 'noul', noul: control.qualified ? 0.99 : 0.01}
        : q.key.startsWith('period_') ? {status: 'answered', type: 'noul', noul: 0.99}
        : q.type === 'noul' ? {status: 'answered', type: 'noul', noul: 0.01}
        : {status: 'answered', type: 'choice', choice: 'analogous'}]))};
  };
  const env = {[EXA_ENV]: 'fixture-exa', TYPESAFE_API_KEY: 'fixture-jev'};
  const create = (patch = {}) => new HistoricalReference({home, env, background:false, decide, fetcher: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({results: [{title: 'Representative Boston prices, 1920', url: 'https://example.org/1920-prices', highlights: [excerpt]}]});
  }, ...patch});
  const input = {binding: 'first', scope: {owner: 'test', campaign: 'prices', audience: 'keeper', worldline: 'main', loop: 0},
    turn: 1, enabled: true, allowed: true, query: '1920 Boston representative wages and everyday price anchors',
    player_input: 'What would ordinary shopping cost here?', context: {period: '1920', region: 'Boston'},
    signal: new AbortController().signal, current: () => true};
  return {home, requests, batches, control, create, input};
}

test('one baseline funds many different quotations, including forced web attempts and restart without Exa', async t => {
  const f = await fixture(t);
  const baseline = await f.create().search(f.input);
  assert.equal(baseline.status, 'ready');
  assert.equal(baseline.materials[0].price_anchor, true);
  f.control.kind = 'item_price';
  for (const [index, query] of ['1920 Boston wool coat price', '1920 Boston room rental price', '1920 Boston pencil price'].entries()) {
    const result = await f.create().search({...f.input, binding: `item-${index}`, turn: index + 2, query, reference_mode: 'web'});
    assert.equal(result.origin, 'library');
    assert.equal(result.pricing.strategy, 'estimate_from_anchors');
    assert.deepEqual(result.materials[0].excerpts, [excerpt]);
  }
  const restored = await f.create({env: {TYPESAFE_API_KEY: 'fixture-jev'}}).search({...f.input,
    binding: 'reopened', turn: 6, query: '1920 Boston taxi fare', allowed: false});
  assert.equal(restored.status, 'ready');
  assert.equal(f.requests.length, 2);
  const list = await f.create({env: {}}).search({...f.input, query: '', reference_mode: 'catalog'});
  assert.equal(list.catalogue[0].price_anchor, true);
});

test('a concrete player challenge permits a targeted item check, but a query cannot grant that permission', async t => {
  const f = await fixture(t); await f.create().search(f.input); f.control.kind = 'item_price';
  const ordinary = await f.create().search({...f.input, binding: 'ordinary', query: 'The player disputes a 1920 coffee quote; search the exact price',
    player_input: 'I order coffee.', reference_mode: 'web'});
  assert.equal(ordinary.pricing.strategy, 'estimate_from_anchors');
  assert.equal(f.requests.length, 2);
  assert.equal(f.batches.findLast(b => b.questions.some(q => q.key === 'price_disputed')).state.player_input, 'I order coffee.');
  f.control.challenge = true;
  const checked = await f.create().search({...f.input, binding: 'challenge', turn: 3, query: 'Boston 1920 coffee menu price',
    player_input: 'Ten dollars for coffee in 1920? That quotation seems wrong; check it.', reference_mode: 'web'});
  assert.equal(checked.pricing.strategy, 'check_challenged_quote');
  assert.equal(checked.origin, 'web');
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests.at(-1).query, 'Boston 1920 coffee menu price');
});

test('no anchor does not authorize an ordinary item search; a different market may establish a new baseline', async t => {
  const f = await fixture(t); f.control.kind = 'item_price';
  const missing = await f.create().search({...f.input, query: '1920 Boston shoe price'});
  assert.equal(missing.reason, 'price_anchors_needed'); assert.equal(f.requests.length, 0);
  f.control.kind = 'price_anchor'; await f.create().search(f.input);
  f.control.compatible = false;
  await f.create().search({...f.input, binding: 'other-market', query: '1880 London representative wages and everyday price anchors', context: {period: '1880', region: 'London'}});
  assert.equal(f.requests.length, 4);
});

test('unqualified excerpts do not become anchors and an unavailable policy spends no Exa credit', async t => {
  const f = await fixture(t); f.control.qualified = false;
  const result = await f.create().search(f.input);
  assert.equal(result.status, 'empty');
  const list = await f.create({env: {}}).search({...f.input, query: '', reference_mode: 'catalog'});
  assert.equal(list.catalogue[0].price_anchor, false);
  f.control.unavailable = true;
  const blocked = await f.create().search({...f.input, binding: 'policy-failed', query: 'another baseline', reference_mode: 'web'});
  assert.equal(blocked.reason, 'search_policy_unavailable');
  assert.equal(f.requests.length, 2);
});

test('legacy price packets are qualified from their originals without another search', async t => {
  const f = await fixture(t); await f.create().search(f.input);
  const directory = new HistoricalReferenceLibrary(f.home).directory(f.input.scope);
  for (const name of await readdir(directory)) {
    const path = join(directory, name), packet = JSON.parse(await readFile(path, 'utf8'));
    delete packet.price_anchors; await writeFile(path, JSON.stringify(packet));
  }
  f.control.kind = 'item_price';
  const result = await f.create().search({...f.input, binding: 'legacy', query: '1920 Boston hat price'});
  assert.equal(result.pricing.strategy, 'estimate_from_anchors');
  assert.equal(result.materials[0].price_anchor, true);
  assert.equal(f.requests.length, 2);
});

test('a prior estimated-item query does not turn an unrelated anchor into exact evidence for a later challenge', async t => {
  const f = await fixture(t); await f.create().search(f.input); f.control.kind = 'item_price';
  const query = '1920 Boston hat price';
  await f.create().search({...f.input, binding: 'estimate', query});
  f.control.challenge = true;
  const result = await f.create().search({...f.input, binding: 'check', query,
    player_input: 'That hat quotation seems wrong. Please check it.'});
  assert.equal(result.origin, 'web');
  assert.equal(f.requests.length, 3);
});

test('saved anchors survive many newer non-price references in the bounded candidate window', async t => {
  const f = await fixture(t); await f.create().search(f.input);
  const library = new HistoricalReferenceLibrary(f.home);
  for (let i = 0; i < 30; i++) await library.save({...f.input, query: `unrelated topic ${i}`}, [{
    title: `Unrelated source ${i}`, url: `https://example.org/unrelated/${i}`, excerpts: ['A description of period wallpaper.'],
    published_at: null, retrieved_at: new Date().toISOString(),
  }]);
  const result = await f.create().search({...f.input, binding: 'later', query: '1920 Boston general price and wage anchors after a long investigation', reference_mode: 'web'});
  assert.deepEqual(result.materials[0].excerpts, [excerpt]);
  assert.equal(result.reason, 'price_anchor_reused');
  assert.equal(f.requests.length, 2);
});
