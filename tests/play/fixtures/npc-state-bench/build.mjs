/**
 * The NPC state bench (contract §259): a seeded scene for the host-settled NPC state, not a story. A grain shop on a
 * river town's main street in 1926: the shopkeeper keeps a printed routine (the shop by day, a forty-in-a-hundred chance
 * of the teahouse back room at night, else home), his brother is tied to him on the graph, and each knows one thing.
 * It stages what the shipped starters lack: a book routine with a printed chance (§259.7), two people one death shakes
 * (§259.6), a person the investigator can promise something to (§259.2). Emits content/starters/npc-state-bench/
 * module-graph.json in the coc.module-graph.v3 shape the shipped starters use. Run:
 * node tests/play/fixtures/npc-state-bench/build.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = resolve(ROOT, 'content/starters/npc-state-bench/module-graph.json');
const MODULE = 'module-npc-state-bench';
const SECTION = 'section-curated-bench';
const SHOP = 'scene-grain-shop';
const TEAHOUSE = 'scene-teahouse-back-room';

/** The shopkeeper's routine, as a book would print it (§259.7's shape): first entry whose hours hold wins. */
const ROUTINE = [
  { when: { clock_range: { from: '08:00', to: '18:00' } }, where: '粮店', doing: '在柜台后面称米记账', reachable: true },
  { when: { day_part: ['evening', 'night'] }, where: '茶馆后屋', doing: '和人推牌九', reachable: true, probability: 40 },
  { when: { day_part: ['evening', 'night'] }, where: '粮店后面的家', doing: '吃饭，早早睡下', reachable: false },
];
const CAST = [
  { id: 'npc-qian-laoban', name: '钱老板', tag: 'qian', role: 'informant', agenda: '把这季的米价稳住，别让人知道他压了一仓陈米。',
    fear: '欠下的赌债传到镇上。', secret: '他夜里在茶馆后屋输了钱，拿粮店的仓单作押。', voice: '说话慢，爱用算盘打比方。',
    clue: '镇东的旧码头上周夜里有人卸过一船不记账的货。', schedule: ROUTINE },
  { id: 'npc-qian-laoer', name: '钱老二', tag: 'qian-er', role: 'stranger', agenda: '替哥哥看着铺子，攒钱娶亲。',
    fear: '哥哥的赌债落到他头上。', secret: '他知道哥哥把仓单押出去了。', voice: '嗓门大，话短。',
    clue: '仓单押在茶馆的掌柜手里。' },
];

const claims = [], relations = [];
let n = 0;
function relate(kind, from, to, truth = 'authored-fact') {
  n += 1;
  const claim_id = `claim-${kind}-${n}`;
  claims.push({ claim_id, subject_id: from, predicate: kind, object: { node_id: to }, truth_status: truth, visibility: 'keeper-only', evidence_span_ids: [], asserted_by_ids: [], known_by_ids: [], validity: null, confidence: 1, source_refs: [] });
  relations.push({ relation_id: `relation-${kind}-${n}`, relation_kind: kind, from_node_id: from, to_node_id: to, claim_id, properties: {} });
}
const node = (node_id, node_kind, name, summary, properties, visibility = 'keeper-only') => ({ node_id, node_kind, name, visibility, aliases: [], summary, evidence_span_ids: [], properties, source_refs: [] });

const meta = {
  schema_version: 1, scenario_id: 'npc-state-bench', source_language: 'zh-Hans',
  runtime_projection_contract: 'coc.module-graph-runtime-projection.v1',
  title: '河镇粮店', opening_scene: '河镇正街的粮店里，钱老板在柜台后面拨着算盘。',
  one_liner: '1926 年一个河边小镇的粮店，两兄弟，一份印着作息的人物卡。',
  structure_type: 'hub_sandbox', era: '1920s',
  setting_tags: ['rural-town', '1920s', 'state-bench'], content_flags: ['test-module', 'state-bench'],
  win_condition: '测试台，不必推进。',
  start_clock: { calendar_mode: 'gregorian', local_datetime: '1926-10-20T10:00:00', timezone: 'Asia/Shanghai', display: '1926-10-20 10:00' },
  summary: 'NPC 状态测试台：一个带书面作息的店主和他有关系的兄弟。用来测态度、请求、失败冻结、恐惧压力和日程，不推剧情。',
  player_safe_summary: '1926 年 10 月，一个河边小镇。正街上的粮店开着门，店主钱老板在柜台后面。',
  keeper_secret_summary: '钱老板夜里赌钱，把粮店仓单押给了茶馆掌柜；他弟弟知道。',
  license: 'Apache-2.0', author: 'chatrpgv4 contributors', attribution: 'Original test content.', copyright_notice: [],
};
const scene = (id, name, summary, start, sceneId, to) => node(id, 'scene', name, summary, {
  runtime_projection: { document: 'story-graph.json', collection: 'scenes', record: {
    scene_id: sceneId, is_start: start, location_tags: ['town', 'indoor'], scene_type: 'social', origin: 'source',
    dramatic_question: '谁肯说实话？', entry_conditions: [], exit_conditions: [],
    available_clues: start ? CAST.map(p => `clue-${p.tag}`) : [], npc_ids: start ? CAST.map(p => p.id) : [],
    pressure_moves: [], storylet_tags: ['social'], affordances: [], tone: ['quiet'], allowed_improvisation: ['invent the shop furniture'],
    scene_edges: [{ to, kind: 'travel', when: { kind: 'always' } }],
  } },
});
const nodes = [
  node(MODULE, 'module', meta.title, meta.one_liner, {
    asset_root_id: null, source_binding: {},
    runtime_projection: { contract_id: 'coc.module-graph-runtime-projection.v1', documents: [{ filename: 'module-meta.json', root: meta }] },
  }),
  scene(SHOP, '粮店', '正街上的粮店，米袋堆到房梁。', true, 'grain-shop', 'teahouse-back-room'),
  scene(TEAHOUSE, '茶馆后屋', '茶馆后面烟气腾腾的小屋。', false, 'teahouse-back-room', 'grain-shop'),
];
relate('contains', MODULE, SHOP); relate('contains', MODULE, TEAHOUSE);
relate('route-to', SHOP, TEAHOUSE); relate('route-to', TEAHOUSE, SHOP);
for (const p of CAST) {
  const clue = `clue-${p.tag}`;
  nodes.push(node(p.id, 'npc', p.name, p.voice, {
    runtime_projection: { document: 'npc-agendas.json', collection: 'npcs', record: {
      npc_id: p.id, name: p.name, origin: 'source', agenda: p.agenda, fear: p.fear, secret: p.secret, voice: p.voice,
      relationship_to_investigators: p.role, known_fact_ids: [`fact-${p.tag}`], revealable_fact_ids: [`fact-${p.tag}`],
      disclosure_order: [`fact-${p.tag}`], facts: [{ fact_id: `fact-${p.tag}`, clue_id: clue, min_trust: 0 }],
      lie_options: [], deflect_options: [], leverage_ids: [], active_reactions: [], availability: { status: 'available' },
    } },
    agenda: p.agenda, fear: p.fear, secret: p.secret, voice: p.voice, relationship_to_investigators: p.role,
    ...(p.schedule ? { schedule: p.schedule } : {}),
  }));
  nodes.push(node(clue, 'clue', p.clue, p.clue, { delivery_kind: 'conversation', handout_asset_id: null }, 'revealable'));
  relate('contains', MODULE, p.id); relate('contains', MODULE, clue);
  relate('present-in', p.id, SHOP); relate('knows', p.id, clue); relate('discoverable-at', clue, SHOP);
}
// The brothers: a tie the graph reads both ways (§17.2), so one's death shakes the other (§259.6).
relate('allied-with', 'npc-qian-laoban', 'npc-qian-laoer');
const domains = ['structure', 'world', 'actors', 'relationships', 'events', 'knowledge', 'causal', 'mechanics', 'assets', 'direction'];
const coverage = Object.fromEntries(domains.map(d => [d, 'accepted']));
const graph = {
  contract_id: 'coc.module-graph.v3', schema_version: 3, module_id: MODULE, source_languages: ['zh-Hans'],
  section_ids: [SECTION], coverage, coverage_by_section: { [SECTION]: coverage }, node_refs_by_section: { [SECTION]: nodes.map(x => x.node_id) },
  nodes, claims, relations, source_refs: [],
};
writeFileSync(OUT, JSON.stringify(graph, null, 1) + '\n');
console.log(`wrote ${OUT}: ${nodes.length} nodes, ${relations.length} relations`);
