/**
 * The play language is open and player-visible words are data (host decision 2026-09-09, contract
 * §23): the kernel reads only the default and the suggested tags from content/languages.json,
 * accepts any tag-shaped play_language, refuses no delivery by its script, the glossary is the
 * union of every localized_labels row in the rules data, and no kernel prose or handle reaches a
 * player field. Each case here fails when its fix is reverted: fixture content roots name tags the
 * code has never heard of, so a literal tag, a membership check or a file list cannot pass.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { KernelClient } from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content'), RPC = join(ROOT, 'build/kernel/rpc.mjs');
const RULES = join(CONTENT, 'rulesets/coc7/rules-json');
const evidence = join(ROOT, '.coc/playtests/ts-i18n-node');
await mkdir(evidence, { recursive: true });
const output = await mkdtemp(join(evidence, 'entry-'));
await symlink(join(ROOT, 'node_modules'), join(output, 'node_modules'), 'dir');
await build({ stdin: { contents: [
  `export {createKernelContext} from ${JSON.stringify(join(ROOT, 'kernel-ts/context.ts'))};`,
  `export {playLanguages, playLanguageOf} from ${JSON.stringify(join(ROOT, 'kernel-ts/read/languages.ts'))};`,
  `export {markersFor} from ${JSON.stringify(join(ROOT, 'kernel-ts/write/text.ts'))};`,
  `export {normalizeText, kebab} from ${JSON.stringify(join(ROOT, 'kernel-ts/read/values.ts'))};`,
  `export {playerGlossary} from ${JSON.stringify(join(ROOT, 'kernel-ts/read/handlers.ts'))};`,
  `export {manifestFrom} from ${JSON.stringify(join(ROOT, 'kernel-ts/read/mods.ts'))};`,
  `export {Catalog} from ${JSON.stringify(join(ROOT, 'kernel-ts/rules/catalog.ts'))};`,
  `export {RuleTables} from ${JSON.stringify(join(ROOT, 'kernel-ts/rules/tables.ts'))};`,
  `export {SkillResolver} from ${JSON.stringify(join(ROOT, 'kernel-ts/rules/skills.ts'))};`,
  `export {defaultInvestigatorId} from ${JSON.stringify(join(ROOT, 'kernel-ts/setup/chargen.ts'))};`,
  `export {ChaseSession} from ${JSON.stringify(join(ROOT, 'kernel-ts/chase/session.ts'))};`,
  `export {PythonRandom} from ${JSON.stringify(join(ROOT, 'kernel-ts/random.ts'))};`,
  `export {stageClue} from ${JSON.stringify(join(ROOT, 'kernel-ts/apply/entities.ts'))};`,
].join('\n'), sourcefile: 'i18n-test-api.ts', resolveDir: ROOT, loader: 'ts' }, outfile: join(output, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
const api = await import(pathToFileURL(join(output, 'api.mjs')).href);

/** A default and a suggestion no code names, and nothing else: the set is open, so there is no list to declare. */
const FIXTURE_LANGUAGES = { contract: 'coc.play-languages.v2', default: 'xx', suggested: ['xx', 'yy'] };

/**
 * A content root that is the real one except for languages.json and, when given, extra rules
 * files or a starter's guidance bundles (`{ [starter]: { [fileName]: text } }` replacing its
 * `character-guidance` directory). It sits beside a link to the real mods directory, as the
 * product's content root does.
 */
async function contentRoot(languages, extraRules = {}, bundles = {}) {
  const home = await mkdtemp(join(evidence, 'content-'));
  const content = join(home, 'content');
  await mkdir(content);
  await symlink(join(ROOT, 'mods'), join(home, 'mods'), 'dir');
  for (const name of await readdir(CONTENT)) {
    if (name === 'languages.json') continue;
    if (name === 'rulesets' && Object.keys(extraRules).length) continue;
    if (name === 'starters' && Object.keys(bundles).length) continue;
    await symlink(join(CONTENT, name), join(content, name));
  }
  await writeFile(join(content, 'languages.json'), JSON.stringify(languages, null, 2));
  if (Object.keys(bundles).length) {
    const starters = join(content, 'starters');
    await mkdir(starters);
    for (const id of await readdir(join(CONTENT, 'starters'))) {
      if (!Object.hasOwn(bundles, id)) { await symlink(join(CONTENT, 'starters', id), join(starters, id)); continue; }
      await mkdir(join(starters, id));
      for (const name of await readdir(join(CONTENT, 'starters', id)))
        if (name !== 'character-guidance') await symlink(join(CONTENT, 'starters', id, name), join(starters, id, name));
      await mkdir(join(starters, id, 'character-guidance'));
      for (const [name, text] of Object.entries(bundles[id])) await writeFile(join(starters, id, 'character-guidance', name), text);
    }
  }
  if (Object.keys(extraRules).length) {
    const coc7 = join(content, 'rulesets/coc7');
    await mkdir(coc7, { recursive: true });
    for (const name of await readdir(join(CONTENT, 'rulesets/coc7')))
      if (name !== 'rules-json') await symlink(join(CONTENT, 'rulesets/coc7', name), join(coc7, name));
    const rules = join(coc7, 'rules-json');
    await mkdir(rules);
    for (const name of await readdir(RULES)) await symlink(join(RULES, name), join(rules, name));
    for (const [name, value] of Object.entries(extraRules)) await writeFile(join(rules, name), JSON.stringify(value));
  }
  return content;
}
async function context(content) {
  const home = await mkdtemp(join(evidence, 'ws-'));
  return api.createKernelContext({ workspace: home, content, env: environment() });
}
function environment(extra = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_AUTHOR_DATE: '2000-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2000-01-02T03:04:05Z',
    COC_TEST_CLOCK: '2000-01-02T03:04:05Z', NODE_OPTIONS: `--require ${JSON.stringify(join(ROOT, 'tests/kernel/rpc_clock.cjs'))}`, TZ: 'UTC', ...extra };
}
async function table(t, content = CONTENT, extra = {}) {
  const home = await mkdtemp(join(evidence, 'rpc-'));
  const client = new KernelClient({ command: [process.execPath, RPC, '--workspace', home, '--content', content], cwd: ROOT, env: environment(extra), inheritEnv: false, timeoutMs: 20000 });
  t.after(() => client.close());
  return { home, client };
}
async function opened(t, campaign, language, content = CONTENT) {
  const { home, client } = await table(t, content, { COC_KERNEL_SEED: 'i18n' });
  await client.call('campaign.create', { id: campaign, module: 'the-haunting', pregen: 'thomas-hayes', play_language: language });
  await client.call('table.open', { campaign });
  return { home, client };
}

test('the default and the suggested tags come from content/languages.json; any tag-shaped play_language opens a table', async t => {
  const content = await contentRoot(FIXTURE_LANGUAGES), ctx = await context(content);
  t.after(() => ctx.git.close());
  const known = await api.playLanguages(ctx);
  assert.equal(known.default, 'xx');
  assert.deepEqual([...known.suggested], ['xx', 'yy']);
  assert.ok(!('tags' in known) && !('languages' in known), 'the kernel keeps no accepted set');
  assert.equal(await api.playLanguageOf(ctx, {}), 'xx');
  assert.equal(await api.playLanguageOf(ctx, { play_language: 'pt-BR' }), 'pt-BR');
  assert.equal(await api.playLanguageOf(ctx, { play_language: 'Not A Tag' }), 'xx');
  const { home, client } = await table(t, content);
  // A malformed tag is refused by shape: the fix names the shape and details.suggested the picker's
  // first offers; there is no list of accepted tags to offer.
  await assert.rejects(client.call('campaign.create', { id: 'bad', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'Not A Tag' }),
    error => error.code === 'invalid_params' && error.details.field === 'play_language' && assert.deepEqual(error.details.suggested, ['xx', 'yy']) === undefined
      && !('options' in error.details) && error.fix.includes('BCP-47'));
  // A tag no data names opens a table in that tag; a bare create takes the default.
  await client.call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'pt-BR' });
  assert.equal(JSON.parse(await readFile(join(home, '.coc/campaigns/c1/campaign.json'), 'utf8')).play_language, 'pt-BR');
  assert.equal((await client.call('table.view', { campaign: 'c1' })).play_language, 'pt-BR');
  await client.call('campaign.create', { id: 'c2', module: 'the-haunting', pregen: 'thomas-hayes' });
  assert.equal((await client.call('table.view', { campaign: 'c2' })).play_language, 'xx');
});

test('no delivery is refused by its script: narrate and ask deliver any text on any tag', async t => {
  // Latin-only prose and options on the shipped default table, which obliged a CJK script before.
  const { client } = await opened(t, 'c1', 'zh-Hans');
  const text = 'Nothing but Latin letters, and the Keeper is not refused.';
  assert.equal((await client.call('table.narrate', { campaign: 'c1', call_id: 't0-c1', text })).rendered_text, text);
  await client.call('table.player_input', { campaign: 'c1', text: 'I look around.' });
  const asked = await client.call('table.ask', { campaign: 'c1', call_id: 't1-c1', prompt: 'What now?', options: ['留下', 'Leave'] });
  assert.equal(asked.state, 'asked');
  assert.deepEqual(asked.interaction.options, ['留下', 'Leave']);
  // Han prose on a tag no data names.
  const other = await opened(t, 'c2', 'xx-Latn', await contentRoot(FIXTURE_LANGUAGES));
  const han = '开场。诺特把钥匙放在桌上。';
  assert.equal((await other.client.call('table.narrate', { campaign: 'c2', call_id: 't0-c1', text: han })).rendered_text, han);
});

test('a starter registers whichever guidance bundles it ships, named by tag, with no list to keep in step', async t => {
  const shipped = JSON.parse(await readFile(join(CONTENT, 'starters/the-haunting/character-guidance/en.json'), 'utf8'));
  const bundle = tag => JSON.stringify({ ...shipped, play_language: tag });
  // The real starter with its bundles replaced by one for a tag no data names, beside a file that is not a bundle.
  const content = await contentRoot(FIXTURE_LANGUAGES, {}, { 'the-haunting': { 'pt-BR.json': bundle('pt-BR'), 'notes.md': 'not a bundle' } });
  const { home, client } = await table(t, content);
  await client.call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'pt-BR' });
  const meta = JSON.parse(await readFile(join(home, '.coc/modules/the-haunting/module.json'), 'utf8'));
  assert.equal(meta.bundled_guidance_required, true);
  assert.deepEqual(Object.values(meta.character_guidance).map(reference => reference.play_language), ['pt-BR']);
  const [key] = Object.keys(meta.character_guidance);
  assert.equal(JSON.parse(await readFile(join(home, '.coc/modules/the-haunting/character-guidance', key, 'accepted.json'), 'utf8')).play_language, 'pt-BR');
  // A bundle not named by a tag is a release defect, not a language.
  const broken = await contentRoot(FIXTURE_LANGUAGES, {}, { 'the-haunting': { 'Not A Tag.json': bundle('en') } });
  const second = await table(t, broken);
  await assert.rejects(second.client.call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes' }),
    error => error.code === 'invalid_params' && error.details.file === 'Not A Tag.json');
});

test('normalizeText keeps every script, so ids, markers and aliases work beyond Latin and Han', async () => {
  assert.equal(api.normalizeText('Hello, World!'), 'hello world');
  assert.equal(api.kebab('Spot Hidden'), 'spot-hidden');
  assert.equal(api.kebab('侦查'), '侦查');
  assert.equal(api.kebab('Поиск Скрытого'), 'поиск-скрытого');
  assert.equal(api.kebab('カタカナ ひらがな'), 'カタカナ-ひらがな');
  assert.equal(api.kebab('한글 이름'), '한글-이름');
  assert.equal(api.kebab('كتاب قديم'), 'كتاب-قديم');
  // Investigator ids: an English name slugs, any other script keeps the ordinal id as before.
  assert.equal(api.defaultInvestigatorId('Thomas Hayes', 1), 'thomas-hayes');
  assert.equal(api.defaultInvestigatorId('李明', 2), 'inv-2');
  assert.equal(api.defaultInvestigatorId('Иван Петров', 3), 'inv-3');
  // Markers stay ASCII: a non-Latin skill keeps the bare prefix exactly as a Han one did.
  const roll = (id, skill) => ({ id, kind: 'roll', form: 'check', skill, roll: 12, target: 50, passed: true, level: 'regular' });
  const markers = api.markersFor([roll('r1', 'Spot Hidden'), roll('r2', '侦查'), roll('r3', 'Поиск скрытого')]);
  assert.deepEqual([...markers.values()], ['check:spot-hidden', 'check', 'check-2']);
});

test('skill aliases resolve for a Cyrillic label as they do for a Han one', async t => {
  const ctx = await context(CONTENT);
  t.after(() => ctx.git.close());
  const skills = { 'Spot Hidden': { base_chance: 25, group: null, localized_labels: { 'zh-Hans': '侦查', ru: 'Поиск скрытого' } } };
  const resolver = new api.SkillResolver(new api.RuleTables(ctx), { skills: { 'Spot Hidden': 60 }, characteristics: {} }, skills, {}, {});
  assert.equal(resolver.resolveExplicit('侦查'), 'Spot Hidden');
  assert.equal(resolver.resolveExplicit('поиск скрытого'), 'Spot Hidden');
  assert.deepEqual(resolver.findInText('Я использую Поиск скрытого у двери'), ['Spot Hidden']);
});

test('the glossary is the union of every localized_labels row, keyed as the panel looks a term up', async t => {
  const ctx = await context(CONTENT);
  t.after(() => ctx.git.close());
  const zh = await api.playerGlossary(ctx, 'zh-Hans');
  // What shipped before stays word for word.
  assert.equal(zh.STR, '力量'); assert.equal(zh.POW, '意志'); assert.equal(zh.Appearance, '外貌');
  assert.equal(zh.LUCK, '幸运'); assert.equal(zh.Luck, '幸运');
  assert.equal(zh['Library Use'], '图书馆使用'); assert.equal(zh['Spot Hidden'], '侦查');
  assert.ok(!('MOV' in zh));
  // The kernel's own closed words, wherever the data files them.
  assert.equal(zh.intact, '完好'); assert.equal(zh.sanity_bout, '疯狂发作'); assert.equal(zh.hp, '生命值'); assert.equal(zh.HP, '生命值');
  assert.equal(zh.SAN, '理智'); assert.equal(zh['SAN Loss'], '理智损失'); assert.equal(zh.personal_description, '个人描述');
  assert.equal(zh.critical, '大成功'); assert.equal(zh.hard, '困难'); assert.equal(zh.regular, '常规');
  assert.equal(zh.Antiquarian, '古物学家'); assert.equal(zh['1920s'], '1920 年代'); assert.equal(zh.charges, '剩余次数');
  assert.ok(Object.values(zh).every(value => typeof value === 'string' && value));
  // English has rows only where the key is an identifier; a canonical English word has none.
  const en = await api.playerGlossary(ctx, 'en');
  assert.ok(!('STR' in en) && !('Spot Hidden' in en) && !('Antiquarian' in en));
  assert.equal(en.intact, 'Intact'); assert.equal(en.sanity_bout, 'Bout of madness'); assert.equal(en.hard, 'Hard');
  // A row in a file and nesting no code has heard of is found: by its key, its name, its abbreviation; first claim keeps a key.
  const fixture = await context(await contentRoot(FIXTURE_LANGUAGES, {
    'aa-first.json': { shared: { localized_labels: { xx: 'first' } } },
    'bb-second.json': { shared: { localized_labels: { xx: 'second' } }, deep: { rows: [{ name: 'Widget', abbreviation: 'WG', localized_labels: { xx: 'W' } }], thing: { localized_labels: { xx: 'T' } } } },
  }));
  t.after(() => fixture.git.close());
  const xx = await api.playerGlossary(fixture, 'xx');
  assert.equal(xx.shared, 'first'); assert.equal(xx.Widget, 'W'); assert.equal(xx.WG, 'W'); assert.equal(xx.thing, 'T');
  assert.ok(!('deep' in xx) && !('rows' in xx));
});

test('a clue applied without a label files the graph display name, never the handle', async t => {
  const { client } = await opened(t, 'c1', 'zh-Hans');
  await client.call('table.narrate', { campaign: 'c1', call_id: 't0-c1', text: '开场。诺特把钥匙放在桌上。' });
  await client.call('table.player_input', { campaign: 'c1', text: '我看看桌上的文件。' });
  await client.call('table.apply', { campaign: 'c1', call_id: 't1-c1', effects: [{ kind: 'clue', clue: 'knott-commission' }] });
  const receipt = (await client.call('table.status', { campaign: 'c1' })).receipts.find(row => row.kind === 'clue');
  assert.equal(receipt.clue, 'knott-commission');
  assert.notEqual(receipt.label, 'knott-commission');
  assert.equal(receipt.label, (await client.call('table.view', { campaign: 'c1' })).clues.discovered[0].label);
});

test('revealing an echo requires a label, because its summary is the kernel\'s sentence', async () => {
  const echo = { id: 'echo:x', summary: 'a kernel sentence', scene: 's', line: 'other', loop: 1, turn: 3, kind: 'clue' };
  const stub = () => ({ world: {}, graph: {}, turn: { turn: 1 }, callId: 'c1', campaign: { readSave: async () => ({ echoes: [echo] }) } });
  await assert.rejects(api.stageClue(stub(), { kind: 'clue', clue: 'echo:x' }),
    error => error.code === 'invalid_params' && assert.deepEqual(error.details.fields, ['label']) === undefined && error.fix.includes('label'));
  const { receipt } = await api.stageClue(stub(), { kind: 'clue', clue: 'echo:x', label: '回声' });
  assert.equal(receipt.label, '回声');
});

test('a chase session carries the campaign language, and a bare one the data default', async t => {
  const fixture = await context(await contentRoot(FIXTURE_LANGUAGES));
  t.after(() => fixture.git.close());
  const tables = new api.RuleTables(fixture, RULES);
  assert.equal((await api.ChaseSession.create('chase:test', new api.PythonRandom('seed'), tables)).playLanguage, 'xx');
  assert.equal((await api.ChaseSession.create('chase:test', new api.PythonRandom('seed'), tables, undefined, { playLanguage: 'yy' })).playLanguage, 'yy');
  // Through the pipeline: an English table's flight files an English chase, not the default.
  const { home, client } = await opened(t, 'c2', 'en');
  await client.call('table.narrate', { campaign: 'c2', call_id: 't0-c1', text: 'The house waits on Chapel Street.' });
  await client.call('table.player_input', { campaign: 'c2', text: 'I go down.' });
  let n = 1;
  for (const scene of ['corbitt-house-ground', 'basement-rites', 'corbitt-confrontation'])
    await client.call('table.apply', { campaign: 'c2', call_id: `t1-c${n++}`, effects: [{ kind: 'move', to: scene }] });
  const fled = await client.call('table.resolve', { campaign: 'c2', call_id: `t1-c${n}`, action: { intent: 'flee', goal: 'I run for the stairs', method: 'sprint', target: 'Walter Corbitt' } });
  assert.equal(fled.decision, 'chase:start');
  assert.equal(JSON.parse(await readFile(join(home, '.coc/campaigns/c2/save/chase.json'), 'utf8')).play_language, 'en');
});

test('catalogue records carry localized_names by tag and match on any of them', async t => {
  const ctx = await context(CONTENT);
  t.after(() => ctx.git.close());
  const catalog = new api.Catalog(new api.RuleTables(ctx));
  const [hit] = (await catalog.search('侦查', { kinds: ['skill'] })).candidates;
  assert.equal(hit.name, 'Spot Hidden');
  assert.deepEqual(hit.localized_names, { 'zh-Hans': '侦查' });
  assert.ok(hit.match_reasons.includes('exact_localized_name'));
  assert.ok(!('localized_name' in hit));
});

test('a Mod manifest names itself per play language, and mods.list passes the object through', async t => {
  const manifest = (name, description = 'Words.') => ({ id: 'fixture-mod', version: '1.0.0', game_api: 'pipicoc.game.v1', state_version: 1, name, description, author: 'Test',
    default_enabled: false, requires: [], dependencies: {}, conflicts: [], settings: {}, contributes: {} });
  const files = value => new Map([['mod.json', Buffer.from(JSON.stringify(value))]]);
  assert.equal(api.manifestFrom(files(manifest('Plain'))).name, 'Plain');
  assert.deepEqual(api.manifestFrom(files(manifest({ 'zh-Hans': '名字', en: 'Name' }))).name, { 'zh-Hans': '名字', en: 'Name' });
  for (const bad of [{ en: 3 }, {}, { en: ' ' }, ['Name'], 7])
    assert.throws(() => api.manifestFrom(files(manifest(bad))), error => error.code === 'invalid_params' && error.message.includes('name'));
  assert.throws(() => api.manifestFrom(files(manifest('Plain', { en: null }))), error => error.code === 'invalid_params' && error.message.includes('description'));
  const { client } = await table(t);
  const rows = (await client.call('mods.list', {})).mods;
  const natural = rows.find(row => row.id === 'natural-npc'), items = rows.find(row => row.id === 'enhanced-items');
  assert.equal(natural.name['zh-Hans'], '自然 NPC 行为'); assert.equal(natural.name.en, 'Natural NPC');
  assert.equal(items.name['zh-Hans'], '物品增强'); assert.equal(items.description.en, 'Generate executable item parameters from the story; keep ownership and remaining uses.');
});
