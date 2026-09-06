/**
 * 守秘人只见的七个动词。参数镜像 docs/kernel-rpc.md 第 5 节，
 * 但 `campaign` 与 `call_id` 由扩展补，模型看不见也写不了。
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { type TSchema, Type } from "typebox";

export const COC_TOOL_NAMES = ["look", "lookup", "recall", "resolve", "apply", "ask", "narrate"] as const;
export type CocToolName = (typeof COC_TOOL_NAMES)[number];

/** 会改状态的调用：铸造 `call_id`，且在回合关闭时被拒。 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["resolve", "apply", "ask", "narrate"]);

export interface CocToolSpec {
	name: CocToolName;
	label: string;
	method: string;
	description: string;
	promptSnippet: string;
	parameters: TSchema;
}

const MoveEffect = Type.Object({
	kind: StringEnum(["move"] as const, { description: "走到另一个场景" }),
	to: Type.String({ description: "目的地场景名，必须是当前场景可达的出口之一" }),
	travel_minutes: Type.Optional(Type.Integer({ description: "路上花的分钟数；省略则取图上这条边的值" })),
	label: Type.Optional(Type.String({ description: "目的地在玩家语言里的短名，用于【变化】行；省略则用场景名" })),
});

const ClueEffect = Type.Object({
	kind: StringEnum(["clue"] as const, { description: "调查员拿到一条线索" }),
	clue: Type.String({ description: "线索名，必须是当前场景可得的线索" }),
	how: Type.Optional(Type.String({ description: "一句话：他们是怎么拿到的" })),
	label: Type.Optional(Type.String({ description: "这条线索在玩家语言里的短名，用于【变化】行；省略则用线索名" })),
});

const TimeEffect = Type.Object({
	kind: StringEnum(["time"] as const, { description: "世界时钟往前走" }),
	minutes: Type.Integer({ description: "推进的分钟数" }),
	why: Type.Optional(Type.String({ description: "一句话：时间花在哪了" })),
});

/** 保留种类：切片 0 内核一律回 not_implemented，形状先留着。 */
const ReservedEffect = Type.Object({
	kind: StringEnum(["handout", "item", "cash", "npc", "flag", "note", "ruling"] as const, {
		description: "保留种类，本切片内核会回 not_implemented",
	}),
	name: Type.Optional(Type.String()),
	value: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
});

const ResolveAction = Type.Object({
	actor: Type.Optional(
		Type.String({
			description: "谁在动手：调查员名或 id；替 NPC 行动（比如战斗里 NPC 的回合、NPC 的防御）时写 NPC 名；只有一位调查员且是他动手时省略",
		}),
	),
	intent: StringEnum(
		[
			"investigate",
			"social",
			"move",
			"combat",
			"flee",
			"cast",
			"idle",
			"meta",
			"stuck",
			"ambiguous",
			"montage",
		] as const,
		{ description: "这次行动属于哪一类；内核按它挑规则族" },
	),
	goal: Type.String({ description: "一句话：玩家想达成什么" }),
	method: Type.String({ description: "一句话：他怎么做；通常含技能名" }),
	target: Type.Optional(Type.String({ description: "对谁或对什么：NPC 名或物件名" })),
	stakes: Type.Optional(Type.String({ description: "一句话：失败会付出什么" })),
	modifiers: Type.Optional(
		Type.Object({
			bonus_dice: Type.Optional(Type.Integer({ description: "奖励骰数量，0 到 2" })),
			penalty_dice: Type.Optional(Type.Integer({ description: "惩罚骰数量，0 到 2" })),
			difficulty: Type.Optional(StringEnum(["regular", "hard", "extreme"] as const)),
		}),
	),
	skill: Type.Optional(Type.String({ description: "显式技能或特征名，优先于从 method 推断" })),
	weapon: Type.Optional(
		Type.String({ description: "攻击用的武器名，徒手写 unarmed；intent 为 combat 时必给，缺了内核会报 needs 并列出他持有的武器" }),
	),
	spell: Type.Optional(Type.String({ description: "法术名；施法（intent 为 cast）或从典籍里学法术时给" })),
	defense: Type.Optional(
		StringEnum(["dodge", "fight_back", "none"] as const, {
			description: "回应上一次结果里的待决防御：闪避、反击或放弃防御；玩家的防御先用 ask 问他，NPC 的防御你配 actor 自己定",
		}),
	),
	push: Type.Optional(
		Type.Boolean({ description: "对上一次失败的检定推骰；为 true 时 stakes 必填，写明推失败要付的代价" }),
	),
	luck: Type.Optional(Type.Integer({ description: "花掉的幸运点数，把上一次差一点的检定补成通过" })),
	choice: Type.Optional(
		Type.Object({
			pending: Type.String({ description: "待决名，来自上一回合 ask 的 pending_choice" }),
			option: Type.String({ description: "玩家选中的选项" }),
		}),
	),
	decision: Type.Optional(Type.String({ description: "内核报 needs_choice 时，从候选里挑一个的名字" })),
});

export const COC_TOOLS: readonly CocToolSpec[] = [
	{
		name: "look",
		label: "Look",
		method: "table.look",
		description:
			"看当前场面。不给参数就是看场景：戏剧问题、压力动作、出口、可用的着力点、在场者。focus 给 npc 加 name 时返回这个 NPC 的守秘人视图（企图、恐惧、秘密、声音、关系、已知事实）；focus 给 investigator 返回当前调查员表与运行时数值；focus 给 clues 返回已发现的与此地可得的线索；focus 给 time 返回世界时钟。每回合开场先 look 再动手，返回的一切都是守秘人专属，不能照抄进玩家文字。",
		promptSnippet: "看场面、NPC、调查员、线索或时钟的守秘人视图",
		parameters: Type.Object({
			focus: Type.Optional(
				StringEnum(["scene", "npc", "investigator", "clues", "time"] as const, {
					description: "看哪一面，缺省 scene",
				}),
			),
			name: Type.Optional(Type.String({ description: "focus 为 npc 时要看的实体名" })),
		}),
	},
	{
		name: "lookup",
		label: "Lookup",
		method: "table.lookup",
		description:
			"查模组。kind 为 module 时按名字或别名在模组图上找实体，最多回 8 条，每条给摘要、可见性与关系，用来确认玩家说的东西在不在这本模组里；kind 为 secret 时回当前场景的守秘人简报：戏剧问题、压力动作、守秘人笔记、尚未被发现的线索、NPC 的秘密与企图，scope 给 module 则回整本的秘密与结局节点。玩家提到你不确定的名字、或者你需要知道这里还藏着什么时用它。kind 的 rule 与 catalog 本切片会回 not_implemented。",
		promptSnippet: "在模组图上查实体，或调当前场景的守秘人秘密简报",
		parameters: Type.Object({
			kind: StringEnum(["module", "secret", "rule", "catalog"] as const, {
				description: "查什么；rule 与 catalog 本切片未实现",
			}),
			query: Type.Optional(Type.String({ description: "名字或问题；kind 为 secret 时可以省略" })),
			scope: Type.Optional(
				StringEnum(["scene", "module"] as const, { description: "kind 为 secret 时的范围，缺省 scene" }),
			),
		}),
	},
	{
		name: "recall",
		label: "Recall",
		method: "table.recall",
		description:
			"翻逐字记录。what 为 transcript 时回指定回合区间的原文，缺省最近 3 回合，可以用 role 只要玩家或只要守秘人的那一半。玩家提到「刚才」「你说过」，或者你要接上几回合前的线头时用它，不要凭印象编造已经发生过的事。what 的 memory 与 history 本切片会回 not_implemented。",
		promptSnippet: "翻最近几回合的逐字记录",
		parameters: Type.Object({
			what: StringEnum(["transcript", "memory", "history"] as const, {
				description: "翻什么；memory 与 history 本切片未实现",
			}),
			turns: Type.Optional(
				Type.Array(Type.Integer(), {
					minItems: 2,
					maxItems: 2,
					description: "回合区间 [起, 止]，缺省最近 3 回合",
				}),
			),
			role: Type.Optional(StringEnum(["player", "keeper"] as const, { description: "只要哪一方的记录" })),
		}),
	},
	{
		name: "resolve",
		label: "Resolve",
		method: "table.resolve",
		description:
			"把一次行动交给规则裁决。你只描述行动，规则由内核挑：写清谁、想达成什么、怎么做、对谁、赌什么，它选决策、取目标值、掷骰，回来是收据、成功等级，以及可能的会话（战斗、追逐、理智发作）与可接的后续。你不掷骰、不算数、不改数值；日常无争议的行动不要用它。攻击写 intent 为 combat 加 target 与 weapon（徒手写 unarmed）；内核报 needs_choice 时它已把候选和各自适用的场合列出来，挑一个写进 decision 再调一次；结果里的待决防御若是玩家的，用 ask 把闪避还是反击交回他，他答了下一回合再用 defense 解，若是 NPC 的就你自己配 actor 与 defense 定；失败的检定想推骰就 push 为 true 并在 stakes 里写明推失败的代价，想花幸运就给 luck。技能认不出来时内核报 needs 并给候选，补上 skill 再调一次；intent 为 idle、meta、stuck、ambiguous 时不掷骰只回一句判断。",
		promptSnippet: "掷骰裁决一次行动，回来是收据、成功等级与会话状态",
		parameters: Type.Object({
			action: ResolveAction,
		}),
	},
	{
		name: "apply",
		label: "Apply",
		method: "table.apply",
		description:
			"把这一回合世界的改变落地。本切片认三种：move 走到另一个场景，clue 让调查员拿到一条线索，time 推进世界时钟。整批先校验后写，任一条不成立整批都不写，所以可以一次把这回合发生的事全列上。叙述里发生了却没 apply 的事等于没发生：走了要写 move，看见了要写 clue，花了时间要写 time。目的地不可达报 not_reachable 并给可达列表，线索不在此地报 not_here。",
		promptSnippet: "落地本回合的世界改变：移动、线索、时间",
		parameters: Type.Object({
			effects: Type.Array(Type.Union([MoveEffect, ClueEffect, TimeEffect, ReservedEffect]), {
				minItems: 1,
				description: "这一回合要落地的改变，按发生顺序排",
			}),
		}),
	},
	{
		name: "ask",
		label: "Ask",
		method: "table.ask",
		description:
			"把一个选择交回给玩家，并以此收尾本回合。玩家的声明含糊到你无法继续、或者剧情要他当场拍板时用它：prompt 就是交付给玩家的文字，options 是他可以挑的选项。调完这一次回合就关了，不要再 narrate、也不要再写任何正文；玩家的回答会作为下一回合的输入带着待决回来。",
		promptSnippet: "把一个选择交回玩家，并以此关闭本回合",
		parameters: Type.Object({
			text: Type.Optional(Type.String({ description: "问题之前的叙述：这回合发生了什么，让玩家看完再选；不要写【明骰】【变化】行" })),
			prompt: Type.String({ description: "给玩家的问题；内核把 text、这回合的明骰行、问题与选项一起交付" }),
			options: Type.Array(Type.String(), { minItems: 2, description: "玩家可以挑的选项" }),
			binds: Type.Optional(Type.String({ description: "这个选择绑定的待决名" })),
		}),
	},
	{
		name: "narrate",
		label: "Narrate",
		method: "table.narrate",
		description:
			"交付本回合的叙述并关闭回合。每回合以一次 narrate 收尾（或者以一次 ask 收尾），先把该 resolve 的骰掷完、该 apply 的改变落完再调它。text 只写叙述：不要写【明骰】或【变化】行，内核会按本回合的收据自己渲染并插进合适的位置，placement 给 end 时一律追加在末尾。调完之后不要再写任何正文，也不要再调任何工具，内核渲染后的文本就是玩家看到的全部。",
		promptSnippet: "交付本回合叙述并关闭回合",
		parameters: Type.Object({
			text: Type.String({ description: "本回合的叙述正文，只写叙述" }),
			placement: Type.Optional(
				StringEnum(["auto", "end"] as const, { description: "机制块放哪，缺省 auto" }),
			),
		}),
	},
];
