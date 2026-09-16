#!/usr/bin/env node
/**
 * 脚本化的假内核：只说 docs/kernel-rpc.md 第 1 节的协议，不做任何规则。
 * 真内核由另一条线在写，扩展接缝的测试用它把两边解耦。
 *
 * 环境变量：
 *   FAKE_KERNEL_LOG        收到的每个请求追加一行 JSON 到这个文件
 *   FAKE_KERNEL_OPENING    "1" 时 table.open 回 opening_needed: true
 *   FAKE_KERNEL_PENDING    "1" 时 table.open 回 pending_turn
 *   FAKE_KERNEL_RESUME     "1" 时 table.open 回 resume（续行检查点，契约 §12.2）
 *   FAKE_KERNEL_MAP_WORDS  JSON 字符串数组：table.open 回 authored_map_words（契约 §39.2）
 *   FAKE_KERNEL_MODS_UNREADABLE JSON 数组：table.open 回 mods_unreadable（契约 §28.9 的构建落后）
 *   FAKE_KERNEL_CAMPAIGNS  campaign.list 的 JSON 数组
 *   FAKE_KERNEL_ERRORS     {"<method>": {"code","message","fix"?}} 的 JSON，命中就回错误信封
 *   FAKE_KERNEL_ERRORS_ONCE "1" 时 FAKE_KERNEL_ERRORS 每个方法只答一次错，之后照常（验「一次失败是波动」）
 *   FAKE_KERNEL_EXIT_AFTER 收到第 N 个请求后直接退出（测重启）
 *   FAKE_KERNEL_NO_FACTS   "1" 时 narrate 不回 facts/extraction（切片 0、1 的内核）
 *   FAKE_KERNEL_DIRECTOR   JSON 对象，合并进胶囊的 `director` 节（用来摆出 override 之类的分支）
 *   FAKE_KERNEL_NO_DIRECTOR "1" 时胶囊不带 `director` 节（切片 0–2 的内核）
 *   FAKE_KERNEL_CHECK_FAILS "1" 时普通检定判失败（用来摆出「障碍没挪动」的回合）
 *   FAKE_KERNEL_STRICT_TURN "1" rejects player_input while the current turn remains open or acting
 *   FAKE_KERNEL_EMPTY_RENDER "1" makes narrate succeed but return no rendered_text (contract §34.14/§34.18)
 *   FAKE_KERNEL_MATERIAL_PENDING "1" makes the first table.apply request one detail read before replay
 *   FAKE_KERNEL_HANDOUT    JSON 对象，`apply` 带 handout 效果时作为 `attachment` 回（契约 §14.8）
 *   FAKE_KERNEL_CASH       调查员起始现金，缺省 50（`apply` 的 cash 效果按它算前后，契约 §5）
 *   FAKE_KERNEL_BACKFILL   JSON 整数数组：还没抽过的回合，`memory.job` 的缺省派发按序取（#20 补抽）；
 *                          空了就回 job_id: null
 *   FAKE_KERNEL_MODULE     JSON 对象，配模组存储那一面（契约 §14.1、§14.3）：
 *                          {"module_id", "sections": [{id,title,priority,kind,status}],
 *                           "review_pass": {"<section>": <第几轮过，缺省 1；给大数就是永远不过>},
 *                           "opening_after": <接受几片算开场就绪，缺省 1>,
 *                           "deepen": ["<按需深读队列里的 section>"]}
 *   FAKE_KERNEL_INVESTIGATORS  JSON 数组，`investigator.list` 的库名册（契约 §21.2 的
 *                          summary_row 形状：library_id、name、occupation、era、
 *                          current_hp、current_san、last_campaign、last_turn、
 *                          updated_at），不给就是「库是空的」；`/coc investigator` 读它
 *                          （契约 §21.5，票 #31）。`investigator.save` 每次调用回一个
 *                          新铸的 library_id，不真的把桌上的卡写进这份名册。
 */

import { appendFileSync } from "node:fs";
import { dirname, join } from 'node:path';
import { SETUP_STEPS, SETUP_TABLE } from "./setup-steps.mjs";

const LOG = process.env.FAKE_KERNEL_LOG;
const ERRORS = process.env.FAKE_KERNEL_ERRORS ? JSON.parse(process.env.FAKE_KERNEL_ERRORS) : {};
const CAMPAIGNS = process.env.FAKE_KERNEL_CAMPAIGNS
	? JSON.parse(process.env.FAKE_KERNEL_CAMPAIGNS)
	: [{ id: "test-camp", title: "闹鬼的房子", module_id: "the-haunting", status: "active", turn: 0 }];
const EXIT_AFTER = process.env.FAKE_KERNEL_EXIT_AFTER ? Number(process.env.FAKE_KERNEL_EXIT_AFTER) : 0;
const DIRECTOR_PATCH = process.env.FAKE_KERNEL_DIRECTOR ? JSON.parse(process.env.FAKE_KERNEL_DIRECTOR) : {};
const WORKSPACE=LOG?dirname(LOG):process.argv[process.argv.indexOf('--workspace')+1];

let received = 0;
let turn = 0;
let state = "awaiting_player";
let materialPending = process.env.FAKE_KERNEL_MATERIAL_PENDING === "1";

// 契约第 4 节：能回 pending_turn，说明上次进程死在回合中途，状态是 open 或 acting。
if (process.env.FAKE_KERNEL_PENDING === "1") {
	turn = 1;
	state = "acting";
}

const SCENE = { name: "corbitt-house", display_name: "科比特宅" };
const INVESTIGATOR = "托马斯·海耶斯";

/**
 * 物品与现金（契约 §5 的 item、cash，#19）。真内核写的是 `party/<id>.json` 的
 * `equipment[]`／`weapons[]` 与 `finance.cash`；这里只留够投影 mechanics 的那点账。
 */
let cash = process.env.FAKE_KERNEL_CASH ? Number(process.env.FAKE_KERNEL_CASH) : 50;
/**
 * 本回合收据的语言中立投影（契约 §16.2）。内核不再渲染任何机制行：narrate／ask 把它
 * 随结果给出去，扩展落成 `coc-mechanics` 会话条目，交付的正文一个字都不动。
 */
let turnMechanics = [];

/** 一条收据进投影。正文里要不要出现它的数字，内核不管（§16.3，2026-09-09）。 */
function mechanic(row) {
	turnMechanics.push(row);
}

/**
 * The campaign's play language, carried into the interactions the way the kernel carries it.
 *
 * There is no script check here any more. The real kernel refused a delivery whose player-facing
 * fields carried none of the tag's character class until §23 (2026-09-09): the tag set is open, a
 * character class is a detector, and an open set has no table to look in. Whether a delivery is in
 * the player's language is the verifier lane's reading now, filed as an advisory finding.
 */
let playLanguage = "zh-Hans";

/** 收据 id 里的物品 slug：只做空白归一化，语义判断不在假内核里做。 */
function slug(name) {
	return String(name ?? "").trim().replace(/\s+/g, "-").toLowerCase();
}

// ---------------------------------------------------------------------------
// 建卡与模组存储（契约 §14）
// ---------------------------------------------------------------------------

const MODULE = process.env.FAKE_KERNEL_MODULE ? JSON.parse(process.env.FAKE_KERNEL_MODULE) : {};
const MODULE_ID = MODULE.module_id ?? "they-did-not-think-it-too-many";
/**
 * `module.list` 的存储名册（契约 §20.3 的 `/coc module` 读它）：
 * 每行 {module_id, title, source, status, page_count?, opening_ready?, sections?}，
 * 不给就是「存储里只有这一本」。
 */
const LIBRARY = MODULE.library ?? null;

// ---------------------------------------------------------------------------
// 调查员库（契约 §21，`/coc investigator` 读它，票 #31）
// ---------------------------------------------------------------------------

/** `investigator.list` 的名册；每行是契约 §21.2 的 summary_row 形状。 */
const INVESTIGATORS = process.env.FAKE_KERNEL_INVESTIGATORS ? JSON.parse(process.env.FAKE_KERNEL_INVESTIGATORS) : [];
let investigatorSaveSeq = 0;
let adaptationStatusCalls = 0;

let moduleStatus = MODULE.status ?? "installed";
let generation = 1;
let campaignSeq = 0;
let investigatorSeq = 0;

/**
 * 开场候选（契约 §14.14）：书里抽出不止一个开场时，`module.status` 的 `opening.choice`
 * 把候选交出来，`module.opening.choose` 才定得下来——内核不猜。
 * `FAKE_KERNEL_MODULE.opening_candidates: [{node_id, scene, name}]`。
 */
const OPENING_CANDIDATES = MODULE.opening_candidates ?? [];
let chosenStartScene = null;

function openingReady() {
	if (MODULE.opening_ready === false) return false;
	return OPENING_CANDIDATES.length === 0 || chosenStartScene !== null;
}

/** 与内核 `opening_check` 同形的那一份（契约 §14.14）。 */
function openingReport() {
	if (openingReady()) {
		return { opening_ready: true, start_scene: chosenStartScene, missing: [], findings: [], finding_counts: {} };
	}
	const report = { opening_ready: false, start_scene: null, missing: [], findings: [], finding_counts: {} };
	if (OPENING_CANDIDATES.length > 1 && chosenStartScene === null) {
		report.missing = [`start_scene_ambiguous:${OPENING_CANDIDATES.map((row) => row.node_id).join(",")}`];
		report.choice = {
			field: "start_scene",
			reason: "start_scene_ambiguous",
			candidates: OPENING_CANDIDATES,
			method: "module.opening.choose",
			ask: "The book declares more than one opening scene.",
		};
	}
	return report;
}

/** 已经抽过或已经落 backlog 的回合：`memory.job` 不再自动派发（契约 §12.3）。 */
const settledJobs = new Set();

/**
 * 缺省派发（`memory.job` 不带 turn）能取到的回合队列：站在真内核「尚未完成任务
 * 且不在 backlog 里的已提交回合」那个位置上（契约 §12.3、§12.8 的 #20 补抽）。
 * 取走一个就出队，所以失败落 backlog 的那个不会被再派一次。
 */
const BACKFILL_QUEUE = process.env.FAKE_KERNEL_BACKFILL ? JSON.parse(process.env.FAKE_KERNEL_BACKFILL) : [];

function jobTurn(jobId) {
	const match = /t(\d+)$/.exec(String(jobId ?? ""));
	return match ? Number(match[1]) : -1;
}

/** 抽取任务包（契约 §12.3）：只有名字与两段文字，没有 commit、收据 id 之外的机器键。 */
function jobPacket(campaign, target) {
	const packet = {
		job_id: `extract:${campaign}:t${target}`,
		turn: target,
		commit: "abc1234",
		scene: SCENE,
		present: ["看门人"],
		investigators: [{ id: "thomas-hayes", name: "托马斯·海耶斯" }],
		player_text: "我检查地窖门的门框",
		keeper_text: "门框上有一道深深的抓痕。",
		committed_facts: ["托马斯·海耶斯用侦查看门框，通过。", "地点：科比特宅。"],
		known_entities: [
			{ name: "托马斯·海耶斯", kind: "investigator" },
			{ name: "看门人", kind: "npc" },
			{ name: "科比特宅", kind: "scene" },
		],
		prior: [],
		budget: { max_candidates: 12, max_statement_chars: 400 },
		instruction: "只写这一回合新出现的事实、知晓、信念、关系、玩家断言；主语用可用名字里的名字；不写数值与骰面。",
	};
	if (process.env.FAKE_KERNEL_STORY === "1") packet.story_context = {
		threads: [{ thread: "house-haunting", claim: "The house tragedies share one cause.", importance: "core",
			supporting: [{evidence: "scratches", delivery_turn: 1}], contradicting: [] }],
		last_assessment: null,
	};
	return packet;
}

/** 契约 §13.1 的头一句：说清胶囊里已经装了什么，`look`/`lookup` 只查它没答的。 */
const HEAD = "以下是本回合开始时的全部场面，已含时钟、本场景未发现的线索、在场者的秘密与来路；胶囊里有的不必再 look/lookup。";

/** 契约 §13.3 的 `director` 节：节拍、一句理由、信号、依据、前三名的分。 */
function director() {
	if (process.env.FAKE_KERNEL_NO_DIRECTOR === "1") return undefined;
	return {
		beat: "REVEAL",
		reason: "这一场还有没被翻出来的东西",
		because: ["intent = investigate", "undiscovered_here = 1", "structure_type = branching_investigation"],
		grounded_by: ["core-check:ordinary-check"],
		scores: { REVEAL: 0.6, DEEPEN: 0.36, PRESSURE: 0.24 },
		reveal: [{ clue: "地窖的抓痕", gate: "spot" }],
		...DIRECTOR_PATCH,
	};
}

/**
 * 契约 §13.1 的九节胶囊：where、present、known、pressures、obligations、director、
 * situations、memory、style，外加不计预算的 head 与 turn，以及 recent。
 */
function capsule(playerText) {
	const beat = director();
	return {
		head: HEAD,
		turn: { number: turn, state, pending_choice: null, player_text: playerText ?? null },
		where: {
			scene: SCENE.name,
			display_name: SCENE.display_name,
			dramatic_question: "谁还留在这栋房子里？",
			pressure_moves: ["地板在头顶上响"],
			exits: [{ to: "front-lawn", travel_minutes: 1 }],
			back: [{ to: "front-lawn", display_name: "前院" }],
			affordances: [{ id: "cellar-door", cue: "地窖门虚掩着" }],
			keeper_notes: ["科比特在地窖下面"],
			assets: [],
			clock: { minutes: 555, elapsed: "9 小时 15 分钟", at: "1925-06-01T09:15", day_part: "上午" },
			session: null,
		},
		present: [
			{
				name: "看门人",
				relationship: "陌生",
				agenda: "把人赶走",
				voice: "沙哑",
				known_facts: ["房子空了三十年"],
				secret: "他知道地窖下面有东西",
				fear: "地窖",
			},
		],
		known: {
			discovered_clues: [],
			clues_here: [{ name: "地窖的抓痕", summary: "门框上有指甲划痕", delivery_kind: "spot", discovered: false }],
			investigator: {
				name: "托马斯·海耶斯",
				occupation: "记者",
				hp: 12,
				san: 55,
				mp: 11,
				luck: 60,
				skills_of_note: [{ name: "侦查", value: 55 }],
			},
		},
		// 契约 §13.2：两本账都是结构性来源，假内核只把形状摆出来。
		pressures: [
			{ kind: "threat", name: "地窖里的东西", state: "还没露面", cue: "地板在头顶上响" },
		],
		obligations: [
			{ kind: "quest", name: "查清科比特宅出了什么事", who: "keeper", state: "进行中" },
		],
		...(beat ? { director: beat } : {}),
		// 契约 §11.10：无需意图、由状态事实激活的硬门决策。
		situations: [
			{
				decision: "sanity:check",
				family: "sanity",
				label: "理智检定",
				investigator: "thomas-hayes",
				because: ["sanity.exposed_to_horror = True"],
			},
		],
		memory: [],
		style: {
			language: "zh-Hans",
			register: "purist",
			axes: ["感官先于解释", "留白胜过说明"],
			directives: [{ id: "reveal-through-detail", line: "把线索藏进一个具体的东西里，别直接报答案。" }],
		},
		recent: [],
		warnings: [],
		truncated: [],
	};
}

/**
 * 切片 1 的 resolve（契约第 11 节）：按进来的 action 走几条固定分支。
 * 规则一概不算，只把契约里那几种结果形状摆出来给扩展接。
 * - goal 里带「歧义」且没给 decision：needs_choice，details.candidates 给候选
 * - intent 为 combat 且没给 weapon：needs，details.needs 列出可选武器
 * - 给了 defense：这次防御把战斗结了，session 回 null
 * - intent 为 combat：战斗结果，带 session 与给玩家的 pending_choice
 * - push 为 true：推骰结果
 * - 其余：切片 0 的普通检定
 */
function resolve(params) {
	const action = params.action ?? {};
	if (typeof action.goal === "string" && action.goal.includes("歧义") && !action.decision) {
		return {
			ok: false,
			error: {
				code: "needs_choice",
				message: "这一下有两种规则都接得住",
				fix: "在 action.decision 里点名一个候选，再调一次 resolve",
				details: {
					candidates: [
						{ name: "core-check:ordinary-check", when: "只是想看清楚，失败就是没看见" },
						{ name: "psychology:observe-concealed", when: "想读出他藏着的情绪，失败会被他察觉" },
					],
				},
			},
		};
	}
	if (action.intent === "combat" && !action.defense && !action.weapon) {
		return {
			ok: false,
			error: {
				code: "needs",
				message: "这次攻击没说用什么打",
				fix: "在 action.weapon 里写武器名，徒手写 unarmed",
				details: { needs: { field: "weapon", options: ["点三八左轮", "撬棍", "unarmed"] } },
			},
		};
	}
	if (action.defense) {
		mechanic({ kind: "roll", actor: INVESTIGATOR, skill: "Dodge", roll: 18, target: 40, level: "regular", passed: true, visibility: "public" });
		return {
			ok: true,
			result: {
				receipt: `roll:dodge-${params.call_id}`,
				outcome: { kind: "combat", skill: "Dodge", target: 40, roll: 18, level: "regular", passed: true, effects: [] },
				session: null,
				pending_choice: null,
				continuations: [],
				rule_refs: ["combat"],
			},
		};
	}
	if (action.intent === "combat") {
		mechanic({ kind: "roll", actor: INVESTIGATOR, skill: "Fighting (Brawl)", roll: 31, target: 50, level: "regular", passed: true, visibility: "public" });
		return {
			ok: true,
			result: {
				receipt: `roll:fighting-brawl-${params.call_id}`,
				outcome: {
					kind: "combat",
					skill: "Fighting (Brawl)",
					target: 50,
					roll: 31,
					level: "regular",
					passed: true,
					effects: [],
				},
				session: {
					kind: "combat",
					round: 1,
					turn_of: "看门人",
					pending_defense: { for: "player", defender: "托马斯·海耶斯", options: ["dodge", "fight_back"] },
				},
				pending_choice: {
					name: `combat-defense-t${turn}`,
					for: "player",
					// Kernel-minted pending prompts are keeper-facing English (contract §16.1); the player
					// only ever reads what the Keeper writes in the campaign's play language.
					prompt: "The caretaker swings the crowbar at you. How do you respond? (dodge / fight_back)",
					options: ["dodge", "fight_back"],
				},
				continuations: [],
				rule_refs: ["combat", "percentile-check"],
			},
		};
	}
	if (action.push === true) {
		mechanic({ kind: "roll", actor: INVESTIGATOR, skill: "Spot Hidden", roll: 12, target: 55, level: "hard", passed: true, pushed: true, visibility: "public" });
		return {
			ok: true,
			result: {
				receipt: `roll:spot-hidden-${params.call_id}`,
				outcome: {
					kind: "push",
					skill: "Spot Hidden",
					target: 55,
					roll: 12,
					level: "hard",
					passed: true,
					pushed: true,
					stakes: action.stakes ?? null,
					effects: [],
				},
				session: null,
				pending_choice: null,
				continuations: [],
				rule_refs: ["pushed-roll"],
			},
		};
	}
	// FAKE_KERNEL_CHECK_FAILS: the ordinary check comes back failed, so a turn can be about an obstacle
	// that did not move. A push (above) still succeeds: it is the rulebook's own retry, not this check again.
	const checkPassed = process.env.FAKE_KERNEL_CHECK_FAILS !== "1";
	mechanic(
		{
			kind: "roll",
			actor: INVESTIGATOR,
			skill: "Spot Hidden",
			roll: checkPassed ? 42 : 87,
			target: 55,
			threshold: 55,
			difficulty: "regular",
			level: checkPassed ? "regular" : "failure",
			passed: checkPassed,
			visibility: "public",
		},
	);
	return {
		ok: true,
		result: {
			receipt: `roll:spot-hidden-${params.call_id}`,
			outcome: {
				kind: "check",
				skill: "Spot Hidden",
				target: 55,
				difficulty: "regular",
				threshold: 55,
				roll: checkPassed ? 42 : 87,
				level: checkPassed ? "regular" : "failure",
				passed: checkPassed,
				bonus: 0,
				penalty: 0,
			},
			session: null,
			pending_choice: null,
			continuations: [],
			rule_refs: ["percentile-check"],
		},
	};
}

/**
 * Contract §40.2: the say spans a delivery marked. Only a test that asks for them gets them --
 * FAKE_KERNEL_SPEECH carries the rows as JSON -- so every other turn test keeps the result it had.
 */
function speechRows() {
	const raw = process.env.FAKE_KERNEL_SPEECH;
	if (!raw) return {};
	try {
		return { speech: JSON.parse(raw) };
	} catch {
		return {};
	}
}

function handle(method, params) {
	if (ERRORS[method]) {
		const error = ERRORS[method];
		if (process.env.FAKE_KERNEL_ERRORS_ONCE === "1") delete ERRORS[method];
		return { ok: false, error };
	}
	switch (method) {
		case "kernel.hello":
			return {
				ok: true,
				result: {
					kernel_version: "fake-0",
					content: { rulesets: ["coc7"], modules: ["the-haunting"] },
				},
			};
		case "campaign.list":
			return { ok: true, result: { campaigns: CAMPAIGNS } };
		// ---- 建卡（契约 §14.4、§14.7） ------------------------------------
		case "setup.steps":
			return {
				ok: true,
				result: {
					...SETUP_TABLE,
					steps: SETUP_STEPS,
					completed: [],
					state: {},
				},
			};
		case "mods.context":
			// During setup the kernel answers with the setup shape (contract §26); the sentinel lets a test see the instruction land in the prompt.
			return { ok: true, result: params?.campaign
				? { active: [{ id: "guided-creation", version: "1.0.0" }], capabilities: ["setup.aptitude.v1", "setup.guidance.v1"],
					setup: [{ mod: "guided-creation", version: "1.0.0", settings: { max_guided_turns: 3 }, instruction: "FAKE-SETUP-INSTRUCTION: ask one situational question before drafting." }],
					slots: process.env.FAKE_SETUP_SLOTS !== "1" ? [] : [
						{ id: "trade", required: true, purpose: "what this person does for a living", ask: "the occupation concept", mod: "guided-creation", version: "1.0.0" },
						{ id: "built_for", required: true, purpose: "what this person leans on", ask: "what people say they are best at", mod: "guided-creation", version: "1.0.0" },
						{ id: "not_good_at", required: false, purpose: "what they were never good at", ask: "never asked", mod: "guided-creation", version: "1.0.0" }] }
				: { active: [], capabilities: [], setup: [], slots: [] } };
		case "setup.note": {
			// Contract §26: notes live in the kernel; the fake keeps them per campaign for the length of the process.
			const store = (globalThis.__fakeNotes ??= new Map());
			const notes = store.get(params.campaign) ?? { slots: {}, turns: 0 };
			if (params.advance === true) notes.turns += 1;
			else if (typeof params.slot !== "string" || typeof params.value !== "string" || !params.value.trim())
				return { ok: false, error: { code: "invalid_params", message: "note needs slot and value" } };
			else notes.slots[params.slot] = { value: params.value, origin: params.origin ?? "player", turn: notes.turns };
			store.set(params.campaign, notes);
			return { ok: true, result: { notes } };
		}
		case "setup.occupations":
			// 职业清单原样给建卡进程，由模型按玩家那句话挑 id；内核只认 id（契约 §14.7）。
			return {
				ok: true,
				result: {
					occupations: [
						{ id: "journalist", name: "记者", skill_points: "EDU × 4", credit_rating: [9, 30] },
						{ id: "antiquarian", name: "古董商", skill_points: "EDU × 4", credit_rating: [30, 70] },
						{ id: "police-detective", name: "警探", skill_points: "EDU × 2 + (DEX 或 STR) × 2", credit_rating: [20, 50] },
					],
				},
			};
        case "setup.draft":
            return {ok:true,result:{revision:1,sheet:{name:params.profile.name,occupation:params.profile.occupation,creation:{seed:"private-seed",method:"rolled",characteristics:{multiplier:5,rolls:{STR:{dice:"3d6",faces:[1,1,2],total:4}}},age:{edu_improvement_checks:[{roll:30,edu:50}]},skills:{occupation:{budget:{formula:"EDU*4",total:200},allocations:{Law:25}},interest:{budget:{formula:"INT*2",total:130},allocations:{Law:10}}}}},profile:params.profile,completeness:{valid:true,issues:[]}}};
        case "setup.previewed":
            return {ok:true,result:{previewed:true}};
        case "setup.confirm":
            return {ok:true,result:{committed:true,investigator_id:"inv-1"}};
		case "setup.investigator": {
			if (!params.name || !params.occupation) {
				return { ok: false, error: { code: "invalid_params", message: "建卡要名字与职业 id" } };
			}
			investigatorSeq += 1;
			const id = `inv-${investigatorSeq}`;
			return {
				ok: true,
				result: {
					investigator_id: id,
					receipt: `investigator:${id}`,
					sheet: { name: params.name, occupation: params.occupation, hp: 12, san: 55, luck: 60 },
				},
			};
		}
		case "setup.complete":
			return {
				ok: true,
				result: {
					handoff: {
						campaign: params.campaign,
						module_id: MODULE_ID,
						module_generation: generation,
						investigators: [`inv-${investigatorSeq}`],
					},
					status: "ready_for_table",
				},
			};
		case "campaign.create": {
			// 闭合词表的拒绝要带候选（契约 §1、§14.15）：内核给 fix 与 details.options，
			// 建卡工具必须把它们原样交出来，模型才不用连猜 zh、zh-CN 再放弃（#33）。
			if (params.play_language !== undefined && !["zh-Hans", "en"].includes(params.play_language)) {
				return {
					ok: false,
					error: {
						code: "invalid_params",
						message: `unsupported play_language '${params.play_language}'`,
						fix: "one of details.options",
						details: { field: "play_language", options: ["zh-Hans", "en"] },
					},
				};
			}
			campaignSeq += 1;
			const id = params.id ?? `camp-${campaignSeq}`;
			playLanguage = params.play_language ?? "zh-Hans";
			return {
				ok: true,
				result: {
					campaign: {
						id,
						title: params.title ?? "新战役",
						module_id: params.module ?? MODULE_ID,
						play_language: params.play_language ?? "zh-Hans",
						status: "setting_up",
					},
				},
			};
		}
		// ---- 模组存储与无人值守构建（契约 §14.1、§14.3、§14.6） -----------
		case "module.list": {
			const rows = LIBRARY ?? [{ module_id: MODULE_ID, title: "模组", source: "pdf", status: moduleStatus, generation }];
			return { ok: true, result: { modules: rows.map((row) => ({ generation, ...row })) } };
		}
		case "module.status": {
			// 名册里点了名的书按它自己那一行回，其余按这个假内核正在构建的那一本回。
			const listed = (LIBRARY ?? []).find((row) => row.module_id === params.module_id);
			if (listed) {
				return {
					ok: true,
					result: {
						module_id: listed.module_id,
						title: listed.title,
						source: listed.source,
						status: listed.status,
						generation,
						page_count: listed.page_count,
						opening_ready: listed.opening_ready ?? false,
						sections: listed.sections ?? [],
					},
				};
			}
			return {
				ok: true,
				result: {
					module_id: params.module_id ?? MODULE_ID,
					status: moduleStatus,
					generation,
					opening_ready: openingReady(),
					opening: openingReport(),
					playability: { status: "playable", finding_counts: {} },
					sections: [],
                    opening_candidates: OPENING_CANDIDATES,
				},
			};
		}
		case "investigator.list":
			return { ok: true, result: { investigators: INVESTIGATORS } };
		case "investigator.save": {
			investigatorSaveSeq += 1;
			const investigatorId = params.investigator ?? "thomas-hayes";
			const libraryId = `${investigatorId}-${investigatorSaveSeq}`;
			return {
				ok: true,
				result: {
					library_id: libraryId,
					investigator: investigatorId,
					name: INVESTIGATOR,
					created: investigatorSaveSeq === 1,
					play: {
						last_campaign: params.campaign,
						last_turn: turn || null,
						updated_at: "2026-01-01T00:00:00Z",
						campaigns: [params.campaign],
					},
				},
			};
		}
		case "module.opening.choose": {
			const wanted = String(params.scene ?? "").trim().toLowerCase();
			const picked = OPENING_CANDIDATES.find((row) =>
				[row.node_id, row.scene, row.name].some((value) => String(value ?? "").toLowerCase() === wanted),
			);
			if (!picked) {
				return {
					ok: false,
					error: {
						code: "needs_choice",
						message: `${params.scene} 不是这本书的开场之一`,
						fix: "name one of details.candidates",
						details: { field: "start_scene", candidates: OPENING_CANDIDATES },
					},
				};
			}
			chosenStartScene = picked.node_id;
			generation += 1;
			return {
				ok: true,
				result: {
					module_id: params.module_id ?? MODULE_ID,
					start_scene: picked.node_id,
					opening_ready: openingReady(),
					opening: openingReport(),
					generation,
					candidates: OPENING_CANDIDATES,
				},
			};
		}
		case "module.read.request":
			// FAKE_KERNEL_READING=1: the source is still being read and no host gets to claim the job,
			// so a foreground wait runs out (contract §22.4's `reading_timeout`) on the real reading service.
			if (process.env.FAKE_KERNEL_READING === "1") return { ok: true, result: { state: "reading", job_id: "read-7", generation } };
            return { ok: true, result: { state: "ready", generation } };
		case "module.read.claim":
            return { ok: true, result: { job_id: null } };
		// §61: the last waiter left, so the job gives back the foreground lease and keeps running.
		case "module.read.unwait":
			return { ok: true, result: { job_id: params.job_id, foreground: false } };
		case "adaptation.prepare":
			return { ok: true, result: { name: params.name, status: process.env.FAKE_KERNEL_ADAPTATION_PENDING === "1" ? "pending" : "ready" } };
		case "adaptation.status": {
			if (!params.name) {
				const retained = process.env.FAKE_KERNEL_RETAINED_ADAPTATION_STATUS;
				return {ok: true, result: retained ? {name: "athens-study", status: retained, retained: true} : {status: "none"}};
			}
			adaptationStatusCalls += 1;
			const ready = process.env.FAKE_KERNEL_ADAPTATION_READY_ON_SECOND_STATUS === "1" && adaptationStatusCalls >= 2;
			// FAKE_KERNEL_ADAPTATION_STALE_ON_SECOND_STATUS=1: the job the first status reported as
			// pending was abandoned afterwards — the pin's world moved, the retained creator's next
			// kernel call was refused, and the real kernel writes `stale` on the next read (§36.15).
			// The real kernel's own stale view is covered over RPC in stale-adaptation.test.mjs.
			if (process.env.FAKE_KERNEL_ADAPTATION_STALE_ON_SECOND_STATUS === "1" && adaptationStatusCalls >= 2)
				return { ok: true, result: { name: params.name, status: "stale", reason: "the pinned world moved",
					instruction: "Preparation is the only thing that revives it." } };
			// FAKE_KERNEL_ADAPTATION_FAILED_ON_SECOND_STATUS=1: the retained creator or its independent
			// reviewer gave up, and the real kernel keeps the refusal as `error` and reports it as
			// `reason` (§60). Retained tables t9 (`game-ef8e60aa`) and t4 (`game-1c0faba5`) are this row.
			if (process.env.FAKE_KERNEL_ADAPTATION_FAILED_ON_SECOND_STATUS === "1" && adaptationStatusCalls >= 2)
				return { ok: true, result: { name: params.name, status: "failed",
					reason: "the reviewer refused the placement" } };
			return { ok: true, result: { name: params.name, status: ready ? "ready" : process.env.FAKE_KERNEL_ADAPTATION_PENDING === "1" ? "pending" : "ready" } };
		}
		case "adaptation.cancel":
			return { ok: true, result: { name: params.name, status: "cancelled" } };
		case "table.open": {
			const opening = process.env.FAKE_KERNEL_OPENING === "1";
			const pending = process.env.FAKE_KERNEL_PENDING === "1";
			const resume = process.env.FAKE_KERNEL_RESUME === "1";
			return {
				ok: true,
				result: {
					campaign: { id: params.campaign, title: "闹鬼的房子", module_id: "the-haunting", play_language: "zh-Hans" },
					// 契约 §39.2：模组自己写的地图字，交给宿主的展示车道投影。
					...(process.env.FAKE_KERNEL_MAP_WORDS ? { authored_map_words: JSON.parse(process.env.FAKE_KERNEL_MAP_WORDS) } : {}),
					// 契约 §28.9：这套内核读不了的包，开桌时一并交出来，宿主据此给运维一条通知。
					...(process.env.FAKE_KERNEL_MODS_UNREADABLE ? { mods_unreadable: JSON.parse(process.env.FAKE_KERNEL_MODS_UNREADABLE) } : {}),
					turn: { number: turn, state },
					investigators: [
						{ id: "thomas-hayes", name: "托马斯·海耶斯", occupation: "记者", hp: 12, san: 55, mp: 11, luck: 60 },
					],
					scene: SCENE,
					pending_turn: pending
						? { player_text: "我下地窖", receipts: [{ id: "roll:spot-hidden-t1-c1", kind: "roll" }], owed: ["narrate"], since: "2026-01-01T00:00:00Z", last_call_ordinal: 1 }
						: null,
					resume: resume
						? {
								turn: 0,
								commit: "abc1234",
								scene: SCENE,
								clock: { minutes: 555 },
								session: null,
								one_line: "第 0 回合：科比特宅，09:15；上回合：门厅里落满灰。",
								rebuilt: false,
							}
						: null,
					opening_needed: opening,
				},
			};
		}
		case "table.player_input": {
			const strandedRelease = params.release === "stranded" && (state === "open" || state === "acting");
			if (process.env.FAKE_KERNEL_STRICT_TURN === "1" && state !== "awaiting_player" && state !== "asked" && !strandedRelease) {
				return { ok: false, error: { code: "turn_state", message: `table.player_input is not allowed while the turn is '${state}'`,
					fix: "finish the current turn with narrate or ask first" } };
			}
			turn += 1;
			state = "open";
			turnMechanics = [];
			return { ok: true, result: { turn, state, capsule: capsule(params.text) } };
		}
		case "table.capsule":
			return { ok: true, result: capsule(null) };
		case "table.status":
			// Contract §16.2: `table.status` carries this turn's mechanics projection too.
			return { ok: true, result: { turn, state, receipts: [], pending_choice: null, mechanics: [...turnMechanics] } };
		case "table.look":
			if (state === "open") state = "acting";
			if (process.env.FAKE_KERNEL_LOOK_MAPS) {
				return { ok: true, result: { map_views: JSON.parse(process.env.FAKE_KERNEL_LOOK_MAPS) } };
			}
			return { ok: true, result: { where: capsule(null).where, present: capsule(null).present } };
		case "table.lookup":
			if (state === "open") state = "acting";
			return { ok: true, result: { entities: [{ name: params.query ?? "科比特", display_name: params.query ?? "科比特",
				kind: params.expected_kind ?? "npc", summary: params.expected_kind === 'scene' ? `Registered scene ${params.query}` : "旧主人" }] } };
		case "table.recall":
			if (state === "open") state = "acting";
			return { ok: true, result: { transcript: [] } };
		case "table.resolve":
			state = "acting";
			return resolve(params);
		case "table.apply": {
			state = "acting";
			if (materialPending) {
				materialPending = false;
				return { ok: false, error: { code: "needs", message: "the destination material is not ready",
					fix: "read the requested source material, then retry the original action",
					details: { reason: "material_pending", read: { purpose: "detail", focus: "farm", question: "" } } } };
			}
			const effects = params.effects ?? [];
			// 整批先校验后写（契约 §5）：任一条不成立整批不写，收据也不发。
			for (let index = 0; index < effects.length; index += 1) {
				const effect = effects[index];
				if (effect.kind === "item" && !effect.name) {
					return { ok: false, error: { code: "invalid_params", message: "item 要物品名", details: { index } } };
				}
				if (effect.kind === "cash" && typeof effect.delta !== "number") {
					return { ok: false, error: { code: "invalid_params", message: "cash 要带正负号的 delta", details: { index } } };
				}
			}
			// Every receipt joins this turn's mechanics projection (contract §16.2). The kernel renders no
			// lines and looks for no number in the prose: the prose is the Keeper's, and the front end
			// and the driver read this JSON.
			for (const effect of effects) {
				if (effect.kind === "item") {
					const quantity = typeof effect.quantity === "number" ? effect.quantity : 1;
					mechanic(
						{
							kind: "item",
							name: effect.name,
							...(effect.label ? { label: effect.label } : {}),
							quantity,
							to: effect.to ?? INVESTIGATOR,
						},
					);
				}
				if (effect.kind === "cash") {
					const before = cash;
					cash += effect.delta;
					mechanic({ kind: "cash", subject: effect.subject ?? INVESTIGATOR, before, after: cash });
				}
				if (effect.kind === "move") {
					mechanic(
						{
							kind: "scene",
							from: SCENE.name,
							to: effect.to,
							...(typeof effect.travel_minutes === "number" ? { minutes: effect.travel_minutes } : {}),
						},
					);
				}
				if (effect.kind === "clue") {
					mechanic({ kind: "clue", clue: effect.clue, ...(effect.label ? { label: effect.label } : {}) });
				}
				if (effect.kind === "time") {
					mechanic({ kind: "time", minutes: effect.minutes });
				}
				if (effect.kind === "map") {
					mechanic({kind:'map',receipt:`map:${params.call_id}`,map:effect.name,name:effect.label??effect.name,
						regions:(effect.regions??[]).map(id=>({id,label:effect.region_labels?.[id]??id,level:Object.values(effect.level_labels??{})[0]??null})),source_revision:'fixture'});
				}
			}
			// Handouts (contract §14.8): the projection carries only the name, and the extension fills in
			// where the file is from `attachment` (§16.2).
			const handout = effects.find((effect) => effect.kind === "handout");
			if (handout) {
				mechanic({ kind: "handout", name: handout.label ?? handout.name });
			}
			const attachment = handout
				? (process.env.FAKE_KERNEL_HANDOUT
						? JSON.parse(process.env.FAKE_KERNEL_HANDOUT)
						: {
								path: `/tmp/pi-coc-assets/${MODULE_ID}/handout-1.png`,
								media_type: "image/png",
								name: handout.label ?? handout.name ?? "手卡",
								receipt: `handout:${handout.name ?? "handout-1"}`,
							})
				: undefined;
			const map=effects.find(effect=>effect.kind==='map');
			const mapViews=map&&process.env.FAKE_KERNEL_MAP==='1'?[{receipt:`map:${params.call_id}`,map:map.name,name:map.label??map.name,label:map.label,
				source_revision:'fixture',regions:(map.regions??[]).map(id=>({id,label:map.region_labels?.[id]??id,level:Object.values(map.level_labels??{})[0]??null})),available:true,render:{layers:(map.regions??[]).map(id=>({region:id,label:map.region_labels?.[id]??id,level:Object.values(map.level_labels??{})[0]??null,
					path:join(WORKSPACE,'.coc/modules/the-haunting/map.png'),placement:[0,0,1,1],source_box:[0,0,1,1],redactions:[]}))}}]:undefined;
			return {
				ok: true,
				result: {
					// 契约 §5：item 的收据带物品 slug，cash 的只带回合与序号。
					receipts: effects.map((effect) =>
						effect.kind === "item"
							? `item:${slug(effect.name)}-${params.call_id}`
							: `${effect.kind}:${params.call_id}`,
					),
					world: { active_scene: SCENE.name, clock: "1925-06-01T09:15" },
					material_ready: true,
					...(attachment ? { attachment } : {}),
					...(mapViews ? { map_views: mapViews } : {}),
				},
			};
		}
		case "table.ask": {
			state = "asked";
			// Delivery = text (optional) plus the prompt plus language-neutral numbered options; mechanics travel only in `mechanics`.
			const askBody = params.kind==='mechanics' ? (params.text||'') : [
				...(params.text ? [params.text] : []),
				params.prompt,
				(params.options ?? []).map((o, i) => `${i + 1}. ${o}`).join("\n"),
			].join("\n");
			const askMechanics = [...turnMechanics];
			turnMechanics = [];
			return {
				ok: true,
				result: {
					pending_choice: {
						name: `ask-choice-t${turn}`,
						prompt: params.prompt,
						options: params.options,
						binds: params.binds ?? null,
					},
					interaction:{name:`ask-choice-t${turn}`,kind:params.kind||'story',prompt:params.prompt||'',options:params.options,play_language:playLanguage},
                    rendered_text: askBody,
					mechanics: askMechanics,
					...speechRows(),
					turn,
					state,
				},
			};
		}
		case "table.narrate": {
			const closed = turn;
			state = "awaiting_player";
			const facts = process.env.FAKE_KERNEL_NO_FACTS === "1"
				? {}
				: {
						// 契约 §12.5：确定性地从收据与世界状态生成的两份清单。
						facts: {
							committed: [
								"托马斯·海耶斯用侦查看门框，通过。",
								"地点：科比特宅。",
								"在场：看门人。",
							],
							keeper_only: ["未发现的线索：地窖的抓痕——门框上有指甲划痕。", "看门人的秘密：他知道地窖下面有东西。"],
						},
						extraction: { job_id: `extract:${params.campaign}:t${closed}` },
					};
			// Contract §16.2: `rendered_text` is the text verbatim, and the mechanics are a language-neutral JSON projection.
			const mechanics = [...turnMechanics];
			turnMechanics = [];
			return {
				ok: true,
				result: {
					rendered_text: process.env.FAKE_KERNEL_EMPTY_RENDER === "1" ? "" : params.text,
					mechanics,
					...speechRows(),
					turn: closed,
					receipt: `turn:${closed}`,
					commit: "abc1234",
					...facts,
				},
			};
		}
		// 两条车道的 RPC（契约 §12.8）：不带 call_id、不看回合状态，晚到也收。
		case "table.warn":
			return { ok: true, result: { recorded: (params.findings ?? []).length, dropped: 0 } };
		case "memory.job": {
			// 缺省派发（不给 turn）：取还没抽过、也不在 backlog 里的那个回合（契约 §12.3）。
			// 取走就出队，队空了回 job_id: null——补抽据此收手（#20）。
			if (typeof params.turn !== "number") {
				while (BACKFILL_QUEUE.length > 0 && settledJobs.has(BACKFILL_QUEUE[0])) BACKFILL_QUEUE.shift();
				if (BACKFILL_QUEUE.length === 0) return { ok: true, result: { job_id: null, turn } };
				return { ok: true, result: jobPacket(params.campaign, BACKFILL_QUEUE.shift()) };
			}
			// 已经抽过或已经进 backlog 的回合不再自动派发（契约 §12.3）。
			if (settledJobs.has(params.turn)) return { ok: true, result: { job_id: null, turn: params.turn } };
			return { ok: true, result: jobPacket(params.campaign, params.turn) };
		}
		case "memory.submit":
			settledJobs.add(jobTurn(params.job_id));
			return { ok: true, result: { written: (params.candidates ?? []).length, superseded: 0 } };
		case "memory.fail":
			settledJobs.add(jobTurn(params.job_id));
			return { ok: true, result: { backlogged: true } };
		default:
			return { ok: false, error: { code: "unknown_method", message: `假内核不认识 ${method}` } };
	}
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		index = buffer.indexOf("\n");
		if (!line.trim()) continue;
		let request;
		try {
			request = JSON.parse(line);
		} catch (error) {
			process.stderr.write(`fake-kernel: 收到非 JSON：${error.message}\n`);
			continue;
		}
		received += 1;
		const params = request.params ?? {};
		if (EXIT_AFTER && received >= EXIT_AFTER) {
			if (LOG) appendFileSync(LOG, `${JSON.stringify({ method: request.method, params })}\n`);
			process.exit(7);
		}
		const outcome = handle(request.method, params);
		if (LOG) {
			// 回了胶囊的请求另记一份内核这边实际序列化出来的原文：扩展不得对它做
			// 二次渲染（契约 §13.9），测试拿这一行跟注入的 coc-capsule 消息逐字节比。
			const body = outcome.ok ? (outcome.result ?? {}) : {};
			const capsuleJson = body.capsule
				? JSON.stringify(body.capsule)
				: request.method === "table.capsule"
					? JSON.stringify(body)
					: undefined;
			appendFileSync(
				LOG,
				`${JSON.stringify({ method: request.method, params, ...(capsuleJson ? { capsule_json: capsuleJson } : {}) })}\n`,
			);
		}
		process.stdout.write(`${JSON.stringify({ id: request.id, ...outcome })}\n`);
	}
});
process.stdin.on("end", () => process.exit(0));
