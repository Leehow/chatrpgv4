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
 *   FAKE_KERNEL_CAMPAIGNS  campaign.list 的 JSON 数组
 *   FAKE_KERNEL_ERRORS     {"<method>": {"code","message","fix"?}} 的 JSON，命中就回错误信封
 *   FAKE_KERNEL_EXIT_AFTER 收到第 N 个请求后直接退出（测重启）
 *   FAKE_KERNEL_NO_FACTS   "1" 时 narrate 不回 facts/extraction（切片 0、1 的内核）
 *   FAKE_KERNEL_DIRECTOR   JSON 对象，合并进胶囊的 `director` 节（用来摆出 override 之类的分支）
 *   FAKE_KERNEL_NO_DIRECTOR "1" 时胶囊不带 `director` 节（切片 0–2 的内核）
 */

import { appendFileSync } from "node:fs";

const LOG = process.env.FAKE_KERNEL_LOG;
const ERRORS = process.env.FAKE_KERNEL_ERRORS ? JSON.parse(process.env.FAKE_KERNEL_ERRORS) : {};
const CAMPAIGNS = process.env.FAKE_KERNEL_CAMPAIGNS
	? JSON.parse(process.env.FAKE_KERNEL_CAMPAIGNS)
	: [{ id: "test-camp", title: "闹鬼的房子", module_id: "the-haunting", status: "active", turn: 0 }];
const EXIT_AFTER = process.env.FAKE_KERNEL_EXIT_AFTER ? Number(process.env.FAKE_KERNEL_EXIT_AFTER) : 0;
const DIRECTOR_PATCH = process.env.FAKE_KERNEL_DIRECTOR ? JSON.parse(process.env.FAKE_KERNEL_DIRECTOR) : {};

let received = 0;
let turn = 0;
let state = "awaiting_player";

// 契约第 4 节：能回 pending_turn，说明上次进程死在回合中途，状态是 open 或 acting。
if (process.env.FAKE_KERNEL_PENDING === "1") {
	turn = 1;
	state = "acting";
}

const SCENE = { name: "corbitt-house", display_name: "科比特宅" };

/** 已经抽过或已经落 backlog 的回合：`memory.job` 不再自动派发（契约 §12.3）。 */
const settledJobs = new Set();

function jobTurn(jobId) {
	const match = /t(\d+)$/.exec(String(jobId ?? ""));
	return match ? Number(match[1]) : -1;
}

/** 抽取任务包（契约 §12.3）：只有名字与两段文字，没有 commit、收据 id 之外的机器键。 */
function jobPacket(campaign, target) {
	return {
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
			clock: { minutes: 555, elapsed: "9 小时 15 分钟", day_part: "上午" },
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
					prompt: "撬棍朝你的肩膀砸下来，你怎么办？",
					options: ["dodge", "fight_back"],
				},
				continuations: [],
				rule_refs: ["combat", "percentile-check"],
			},
		};
	}
	if (action.push === true) {
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
				roll: 42,
				level: "regular",
				passed: true,
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

function handle(method, params) {
	if (ERRORS[method]) {
		return { ok: false, error: ERRORS[method] };
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
		case "table.open": {
			const opening = process.env.FAKE_KERNEL_OPENING === "1";
			const pending = process.env.FAKE_KERNEL_PENDING === "1";
			const resume = process.env.FAKE_KERNEL_RESUME === "1";
			return {
				ok: true,
				result: {
					campaign: { id: params.campaign, title: "闹鬼的房子", module_id: "the-haunting", play_language: "zh-Hans" },
					turn: { number: turn, state },
					investigators: [
						{ id: "thomas-hayes", name: "托马斯·海耶斯", occupation: "记者", hp: 12, san: 55, mp: 11, luck: 60 },
					],
					scene: SCENE,
					pending_turn: pending
						? { player_text: "我下地窖", receipts: ["roll:spot-hidden-t1-c1"], owed: ["narrate"], since: "2026-01-01T00:00:00Z", last_call_ordinal: 1 }
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
		case "table.player_input":
			turn += 1;
			state = "open";
			return { ok: true, result: { turn, state, capsule: capsule(params.text) } };
		case "table.capsule":
			return { ok: true, result: capsule(null) };
		case "table.status":
			return { ok: true, result: { turn, state, receipts: [], pending_choice: null } };
		case "table.look":
			if (state === "open") state = "acting";
			return { ok: true, result: { where: capsule(null).where, present: capsule(null).present } };
		case "table.lookup":
			if (state === "open") state = "acting";
			return { ok: true, result: { entities: [{ name: params.query ?? "科比特", kind: "npc", summary: "旧主人" }] } };
		case "table.recall":
			if (state === "open") state = "acting";
			return { ok: true, result: { transcript: [] } };
		case "table.resolve":
			state = "acting";
			return resolve(params);
		case "table.apply":
			state = "acting";
			return {
				ok: true,
				result: {
					receipts: (params.effects ?? []).map((effect) => `${effect.kind}:${params.call_id}`),
					world: { active_scene: SCENE.name, clock: "1925-06-01T09:15" },
					material_ready: true,
				},
			};
		case "table.ask":
			state = "asked";
			return {
				ok: true,
				result: {
					pending_choice: {
						name: `ask-choice-t${turn}`,
						prompt: params.prompt,
						options: params.options,
						binds: params.binds ?? null,
					},
					rendered_text: `${params.prompt}\n${(params.options ?? []).map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
					turn,
					state,
				},
			};
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
			return {
				ok: true,
				result: {
					rendered_text: `${params.text}\n\n【明骰】侦查｜掷骰：42；基础值：55；门槛：普通（≤55）；结果：通过`,
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
			const target = typeof params.turn === "number" ? params.turn : turn;
			// 已经抽过或已经进 backlog 的回合不再自动派发（契约 §12.3）。
			if (settledJobs.has(target)) return { ok: true, result: { job_id: null, turn: target } };
			return { ok: true, result: jobPacket(params.campaign, target) };
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
