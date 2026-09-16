/**
 * The chat bench (docs/specs/npc-voice-mask.md §4): one start scene, nine people from nine stations,
 * each holding one fragment of last night's sinking, so a table can talk all evening without advancing
 * anything. Emits content/starters/voice-bench/module-graph.json in the coc.module-graph.v3 shape the
 * shipped starters use. Run: node tests/play/fixtures/voice-bench/build.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = resolve(ROOT, 'content/starters/voice-bench/module-graph.json');
const MODULE = 'module-voice-bench';
const SECTION = 'section-curated-bench';
const SCENE = 'scene-sanyi-teahouse';
const DOCK = 'scene-haihe-dock';

/** Nine mouths. `agenda`/`fear`/`secret`/`voice` are the contract's dossier keys (wants/fears/hides/voice). */
const CAST = [
  { id: 'npc-wang-tiezhu', name: '王铁柱', role: 'stranger', agenda: '明天码头还有活干，今晚把这壶茶喝完就回窝棚。', fear: '把头翻脸，把他从扛包的名单上划掉。', secret: '昨夜他在福顺号靠岸的木栈上看见两个人扭打，其中一个被推下了水，他没敢喊。', voice: '码头扛包的苦力，三十五岁，没念过书，嗓门大，性子直，话不多，不高兴了会骂人。', clue: '昨夜福顺号靠岸的木栈上，有两个人扭打，一个被推下了水。', tag: 'docker' },
  { id: 'npc-zhou-jingzhi', name: '周敬之', role: 'stranger', agenda: '有人肯听他讲一讲当年的功名，顺便揽一桩写状子的生意。', fear: '被人当众叫破他现在靠代写状纸糊口。', secret: '船主上个月请他写过一张福顺号的保单，货物写的是「棉纱」，他知道不是。', voice: '前清秀才，五十八岁，如今给人代写状纸。读书人的口气，爱掉书袋，喜欢把话说得体面。', clue: '福顺号上个月保过险，保单上写的货物是棉纱。', tag: 'licentiate' },
  { id: 'npc-liu-guizhi', name: '刘桂芝', role: 'stranger', agenda: '雨夜客人多，多卖几壶茶，别让人在她店里闹事。', fear: '巡捕房找她的茬，说她窝藏什么人。', secret: '昨夜后半夜有个浑身湿透的男人在她后院柴棚躲了一宿，天不亮就走了，留了一块银元。', voice: '茶馆老板娘，四十四岁，市井出身，嘴甜手快，心里一直在算账。', clue: '昨夜后半夜有个浑身湿透的男人在茶馆后院柴棚躲了一宿，天不亮走的。', tag: 'proprietress' },
  { id: 'npc-xiao-douzi', name: '小豆子', role: 'stranger', agenda: '把手里最后几份晚报卖掉，换一个铜子买热包子。', fear: '报馆的把头说他偷懒，不再给他报纸卖。', secret: '今早他在河湾边捡到一只沾泥的皮鞋，鞋里塞着一张湿透的纸条，他藏在裤腰里。', voice: '报童，十二岁，机灵，快嘴，爱学大人说话的腔调。', clue: '今早河湾边漂上来一只皮鞋，鞋里塞着一张湿透的纸条。', tag: 'newsboy' },
  { id: 'npc-zhao-xunzhang', name: '赵巡长', role: 'authority', agenda: '今晚别出事，明早向上头交一份没有问题的报告。', fear: '上头怪他把事情捅大，把他调去管渣土。', secret: '上头今早传话下来，福顺号的事按「风大翻船」写，不许提船上有人。', voice: '华界巡警巡长，四十岁，官场混出来的，说话打官腔，不把话说满。', clue: '巡捕房今早接到上头的话，福顺号的事按风大翻船办。', tag: 'constable' },
  { id: 'npc-chen-maiban', name: '陈买办', role: 'stranger', agenda: '打听福顺号的货有没有捞上来，别让人知道货是他的。', fear: '洋行东家知道他拿行里的名义走私货。', secret: '福顺号上那批「棉纱」是他用洋行名义夹带的私货，船沉了他一分钱保险也不敢去领。', voice: '洋行买办，三十八岁，在洋人手下做事，自负，喜欢显摆见过世面，偶尔冒一两个英文词。', clue: '福顺号上的货是走洋行名义夹带的，货主不敢去领保险。', tag: 'comprador' },
  { id: 'npc-tiekou-zhang', name: '铁口张', role: 'stranger', agenda: '在茶馆里给人算一卦换茶钱，天亮前不必回观里。', fear: '有人问起他昨夜不在观里的事。', secret: '他昨夜根本不在白云观，他在河湾的赌棚里输光了，看见有人抬着东西往河边走。', voice: '走江湖的算命先生，六十二岁，靠嘴吃饭，爱把事往卦上引，从不把话说死。', clue: '昨夜有人从河湾的赌棚方向抬着东西往河边走。', tag: 'fortune-teller' },
  { id: 'npc-mary-stone', name: '玛丽·斯通', role: 'stranger', agenda: '找到昨夜没有回教会的那个学生，问清楚他去了哪里。', fear: '教会知道她私下借钱给一个中国学生。', secret: '福顺号上没上来的那个人是她夜校的学生阿福，她借给过他一笔钱，他说是要去汉口做生意。', voice: '英国教会的女教师，三十岁，中文说得认真但不地道，礼貌过头。', clue: '福顺号上没上来的那个人叫阿福，是教会夜校的学生，说过要去汉口做生意。', tag: 'mission-teacher' },
  { id: 'npc-ya-cui', name: '哑巴老崔', role: 'stranger', agenda: '把船篷补好，等雨停。', fear: '船被人拿去顶债。', secret: '昨夜是他把那个落水的人从河里捞上来的，那人塞给他一块银元就走了，往茶馆方向去的。', voice: '摆渡的船工，五十岁，天生哑巴，不会说话，只会点头摇头和比划，急了就拍桌子。', clue: '昨夜落水的人是被船工从河里捞上来的，上岸就往茶馆方向去了。', tag: 'mute-boatman' },
];

const claims = [], relations = [];
let n = 0;
function relate(kind, from, to, truth = 'authored-fact') {
  n += 1;
  const claim_id = `claim-${kind}-${n}`;
  claims.push({ claim_id, subject_id: from, predicate: kind, object: { node_id: to }, truth_status: truth, visibility: 'keeper-only', evidence_span_ids: [], asserted_by_ids: [], known_by_ids: [], validity: null, confidence: 1, reason: 'Curated chat bench.' });
  relations.push({ relation_id: `relation-${kind}-${n}`, relation_kind: kind, from_node_id: from, to_node_id: to, claim_id, properties: {} });
}
const node = (node_id, node_kind, name, summary, properties, visibility = 'keeper-only') => ({ node_id, node_kind, name, visibility, aliases: [], summary, evidence_span_ids: [], properties, source_refs: [] });

const meta = {
  schema_version: 1, scenario_id: 'voice-bench', source_language: 'zh-Hans',
  runtime_projection_contract: 'coc.module-graph-runtime-projection.v1',
  title: '三义茶馆的雨夜',
  opening_scene: '雨夜的三义茶馆里坐满了躲雨的人，福顺号昨夜沉在河湾，谁肯开口？',
  one_liner: '1926 年天津海河码头，一个雨夜，一间茶馆，九张嘴，各自知道昨夜沉船的一角。',
  structure_type: 'hub_sandbox', era: '1920s',
  setting_tags: ['urban-civilian', 'dockside', '1920s', 'chat-bench'],
  content_flags: ['test-module', 'chat-bench'],
  win_condition: '弄清福顺号昨夜为什么沉、船上那个没上来的人去了哪里。这是聊天台，不必推进。',
  start_clock: { calendar_mode: 'gregorian', local_datetime: '1926-10-19T20:00:00', timezone: 'Asia/Shanghai', display: '1926-10-19 20:00' },
  summary: '聊天台：九个不同出身的人在一间茶馆里躲雨，每个人知道昨夜沉船的一角。用来测 NPC 口吻，不推剧情。',
  player_safe_summary: '1926 年 10 月，天津。海河码头边的三义茶馆里，雨下了一整天。昨夜一条叫福顺号的驳船在河湾翻了，据说船上有人没上来。茶馆里坐着躲雨的人，谁都知道点什么。',
  keeper_secret_summary: '福顺号装的是买办夹带的私货，船上起了争执，一个人被推下水，被摆渡的哑巴船工捞起，躲进了茶馆后院。巡捕房奉命压下此事。',
  license: 'Apache-2.0', author: 'chatrpgv4 contributors', attribution: 'Original test content.', copyright_notice: [],
};

const nodes = [
  node(MODULE, 'module', '三义茶馆的雨夜', meta.one_liner, {
    asset_root_id: null, source_binding: {},
    runtime_projection: { contract_id: 'coc.module-graph-runtime-projection.v1', documents: [{ filename: 'module-meta.json', root: meta }] },
  }),
  node(SCENE, 'scene', '三义茶馆', '海河码头边的老茶馆，雨夜里挤满了躲雨的人。', {
    runtime_projection: { document: 'story-graph.json', collection: 'scenes', record: {
      scene_id: 'sanyi-teahouse', is_start: true,
      location_tags: ['teahouse', 'dockside', 'indoor', 'public', 'crowd', '茶馆'],
      scene_type: 'social', origin: 'source',
      dramatic_question: '茶馆里的九个人，谁肯把昨夜沉船的那一角说出来？',
      entry_conditions: [], exit_conditions: [],
      available_clues: CAST.map(p => `clue-${p.tag}`),
      npc_ids: CAST.map(p => p.id),
      pressure_moves: ['雨越下越大，没人想出门', '老板娘催茶钱', '巡长时不时扫一眼门口'],
      storylet_tags: ['social', 'gossip'],
      affordances: CAST.map(p => ({ id: `talk-${p.tag}`, cue: `跟${p.name}搭话。`, grants_clue_ids: [`clue-${p.tag}`], route_type: 'npc_question', status: 'open' })),
      tone: ['damp', 'crowded', 'low-voiced'],
      allowed_improvisation: ['invent the teahouse furniture, the weather, the other customers', 'never_invent that anyone here saw the whole sinking'],
      scene_edges: [{ to: 'haihe-dock', kind: 'travel', when: { kind: 'always' } }],
    } },
  }),
  node(DOCK, 'scene', '海河码头', '雨里的木栈和泊着的驳船，福顺号的桅杆还露在水面上。', {
    runtime_projection: { document: 'story-graph.json', collection: 'scenes', record: {
      scene_id: 'haihe-dock', is_start: false,
      location_tags: ['dock', 'river', 'outdoor', '码头'],
      scene_type: 'investigation', origin: 'source',
      dramatic_question: '河湾里露出水面的桅杆下面还有什么？',
      entry_conditions: [], exit_conditions: [], available_clues: [], npc_ids: [],
      pressure_moves: ['雨大风急，木栈湿滑'], storylet_tags: ['investigation'], affordances: [],
      tone: ['wet', 'dark'], allowed_improvisation: ['invent the boats and the rain'],
      scene_edges: [{ to: 'sanyi-teahouse', kind: 'travel', when: { kind: 'always' } }],
    } },
  }),
  node('quest-fushun', 'quest', '弄清福顺号昨夜为什么沉，船上没上来的人去了哪里。', '聊天台的松散目标。', {
    runtime_projection: { document: 'quests.json', collection: 'quests', record: {
      quest_id: 'quest-fushun', title: '福顺号', player_safe_summary: '弄清福顺号昨夜为什么沉，船上没上来的人去了哪里。',
      quest_kinds: ['investigate'], importance: 'core', giver: null,
      brief: 'Keeper-only: 聊天台，目标是松的。九个人各知一角，凑齐就算清楚。',
      target_refs: CAST.map(p => ({ kind: 'clue', ref_id: `clue-${p.tag}` })), destination_scene_id: null, deadline: null,
    } },
  }),
];
relate('contains', MODULE, SCENE); relate('contains', MODULE, DOCK); relate('contains', MODULE, 'quest-fushun');
relate('route-to', SCENE, DOCK); relate('route-to', DOCK, SCENE);
for (const p of CAST) {
  const clue = `clue-${p.tag}`;
  nodes.push(node(p.id, 'npc', p.name, p.voice, {
    runtime_projection: { document: 'npc-agendas.json', collection: 'npcs', record: {
      npc_id: p.id, name: p.name, origin: 'source', agenda: p.agenda, fear: p.fear, secret: p.secret, voice: p.voice,
      relationship_to_investigators: p.role,
      known_fact_ids: [`fact-${p.tag}`], revealable_fact_ids: [`fact-${p.tag}`], disclosure_order: [`fact-${p.tag}`],
      facts: [{ fact_id: `fact-${p.tag}`, clue_id: clue, min_trust: 0 }],
      lie_options: [], deflect_options: [], leverage_ids: [], active_reactions: [],
      availability: { status: 'available' }, schedule: [{ schedule_id: `${p.tag}-evening`, scene_ids: ['sanyi-teahouse'], status: 'available' }],
      keeper_note: p.tag === 'mute-boatman' ? '不会说话；点头摇头、比划、拍桌子。永远不要给他台词。' : '聊天台：让他用自己的嘴说话，答玩家刚说的话，把话头留给玩家。',
    } },
    agenda: p.agenda, fear: p.fear, secret: p.secret, voice: p.voice, relationship_to_investigators: p.role,
  }));
  nodes.push(node(clue, 'clue', p.clue, p.clue, { delivery_kind: 'conversation', handout_asset_id: null }, 'revealable'));
  relate('contains', MODULE, p.id); relate('contains', MODULE, clue);
  relate('present-in', p.id, SCENE); relate('knows', p.id, clue); relate('discoverable-at', clue, SCENE);
  relate('supports', clue, 'quest-fushun');
}
const domains = ['structure', 'world', 'actors', 'relationships', 'events', 'knowledge', 'causal', 'mechanics', 'assets', 'direction'];
const coverage = Object.fromEntries(domains.map(d => [d, 'accepted']));
const graph = {
  contract_id: 'coc.module-graph.v3', schema_version: 3, module_id: MODULE, source_languages: ['zh-Hans'],
  section_ids: [SECTION], coverage, coverage_by_section: { [SECTION]: coverage }, node_refs_by_section: { [SECTION]: nodes.map(x => x.node_id) },
  nodes, claims, relations, source_refs: [],
};
writeFileSync(OUT, JSON.stringify(graph, null, 1) + '\n');
console.log(`wrote ${OUT}: ${nodes.length} nodes, ${relations.length} relations`);
