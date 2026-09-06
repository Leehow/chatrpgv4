#!/usr/bin/env node
/**
 * 脚本化的假内核：只说 docs/kernel-rpc.md 第 1 节的协议，不做任何规则。
 * 真内核由另一条线在写，扩展接缝的测试用它把两边解耦。
 *
 * 环境变量：
 *   FAKE_KERNEL_LOG        收到的每个请求追加一行 JSON 到这个文件
 *   FAKE_KERNEL_OPENING    "1" 时 table.open 回 opening_needed: true
 *   FAKE_KERNEL_PENDING    "1" 时 table.open 回 pending_turn
 *   FAKE_KERNEL_CAMPAIGNS  campaign.list 的 JSON 数组
 *   FAKE_KERNEL_ERRORS     {"<method>": {"code","message","fix"?}} 的 JSON，命中就回错误信封
 *   FAKE_KERNEL_EXIT_AFTER 收到第 N 个请求后直接退出（测重启）
 */

import { appendFileSync } from "node:fs";

const LOG = process.env.FAKE_KERNEL_LOG;
const ERRORS = process.env.FAKE_KERNEL_ERRORS ? JSON.parse(process.env.FAKE_KERNEL_ERRORS) : {};
const CAMPAIGNS = process.env.FAKE_KERNEL_CAMPAIGNS
	? JSON.parse(process.env.FAKE_KERNEL_CAMPAIGNS)
	: [{ id: "test-camp", title: "闹鬼的房子", module_id: "the-haunting", status: "active", turn: 0 }];
const EXIT_AFTER = process.env.FAKE_KERNEL_EXIT_AFTER ? Number(process.env.FAKE_KERNEL_EXIT_AFTER) : 0;

let received = 0;
let turn = 0;
let state = "awaiting_player";

// 契约第 4 节：能回 pending_turn，说明上次进程死在回合中途，状态是 open 或 acting。
if (process.env.FAKE_KERNEL_PENDING === "1") {
	turn = 1;
	state = "acting";
}

const SCENE = { name: "corbitt-house", display_name: "科比特宅" };

function capsule(playerText) {
	return {
		turn: { number: turn, state, pending_choice: null, player_text: playerText ?? null },
		where: {
			scene: SCENE.name,
			display_name: SCENE.display_name,
			dramatic_question: "谁还留在这栋房子里？",
			pressure_moves: ["地板在头顶上响"],
			exits: [{ to: "front-lawn", travel_minutes: 1 }],
			affordances: [{ id: "cellar-door", cue: "地窖门虚掩着" }],
			keeper_notes: ["科比特在地窖下面"],
			assets: [],
		},
		present: [
			{
				name: "看门人",
				relationship: "陌生",
				agenda: "把人赶走",
				voice: "沙哑",
				known_facts: ["房子空了三十年"],
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
		recent: [],
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
			return {
				ok: true,
				result: {
					campaign: { id: params.campaign, title: "闹鬼的房子", module_id: "the-haunting" },
					turn: { number: turn, state },
					investigators: [
						{ id: "thomas-hayes", name: "托马斯·海耶斯", occupation: "记者", hp: 12, san: 55, mp: 11, luck: 60 },
					],
					scene: SCENE,
					pending_turn: pending
						? { player_text: "我下地窖", receipts: ["roll:spot-hidden-t1-1"], owed: ["narrate"], since: "2026-01-01T00:00:00Z" }
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
			return {
				ok: true,
				result: {
					rendered_text: `${params.text}\n\n【明骰】侦查｜掷骰：42；基础值：55；门槛：普通（≤55）；结果：通过`,
					turn: closed,
					receipt: `turn:${closed}`,
					commit: "abc1234",
				},
			};
		}
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
		if (LOG) {
			appendFileSync(LOG, `${JSON.stringify({ method: request.method, params })}\n`);
		}
		if (EXIT_AFTER && received >= EXIT_AFTER) {
			process.exit(7);
		}
		const outcome = handle(request.method, params);
		process.stdout.write(`${JSON.stringify({ id: request.id, ...outcome })}\n`);
	}
});
process.stdin.on("end", () => process.exit(0));
