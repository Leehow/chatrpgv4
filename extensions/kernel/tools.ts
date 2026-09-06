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

const DamageEffect = Type.Object({
	kind: StringEnum(["damage"] as const, { description: "没有攻击者的伤害：摔落、火烧、坠物、窒息" }),
	dice: Type.String({ description: "规则书给的伤害骰，如 1D6；内核来掷" }),
	subject: Type.Optional(Type.String({ description: "受伤者，缺省当前调查员" })),
	why: Type.Optional(Type.String({ description: "一句话：怎么伤的" })),
});

const TimeEffect = Type.Object({
	kind: StringEnum(["time"] as const, { description: "世界时钟往前走" }),
	minutes: Type.Integer({ description: "推进的分钟数" }),
	why: Type.Optional(Type.String({ description: "一句话：时间花在哪了" })),
});

/** 物品易手（契约 §5 的 `item`，#19）：叙述里到手或失去的东西由此进调查员表。 */
const ItemEffect = Type.Object({
	kind: StringEnum(["item"] as const, { description: "东西易手：到手、交出、消耗、被夺" }),
	name: Type.String({ description: "物品名；武器与规则表里的东西按表上的名字写" }),
	to: Type.Optional(Type.String({ description: "东西归谁，缺省当前调查员" })),
	from: Type.Optional(Type.String({ description: "东西从谁那儿来：NPC 名" })),
	weapon: Type.Optional(
		Type.String({
			description:
				"这件东西是武器时写规则表里的武器 profile 名（点三八左轮、猎枪这类）；写了内核才取得到伤害、射程、弹容，之后 resolve 的 weapon 才认得它、战斗开局才按它排弹药。表上没有这个 profile 时内核会报 needs 并列出可用的",
		}),
	),
	quantity: Type.Optional(Type.Integer({ description: "数量，缺省 1；负数是失去（消耗、交出、被夺）" })),
	label: Type.Optional(Type.String({ description: "这件东西在玩家语言里的短名，用于【变化】行；省略则用物品名" })),
	why: Type.Optional(Type.String({ description: "一句话：怎么到手的，或怎么没的" })),
});

/** 现金增减（契约 §5 的 `cash`，#19）：写调查员表上的 finance.cash。 */
const CashEffect = Type.Object({
	kind: StringEnum(["cash"] as const, { description: "手里的钱变多或变少" }),
	subject: Type.Optional(Type.String({ description: "谁的钱，缺省当前调查员" })),
	delta: Type.Integer({ description: "带正负号的变动额，货币单位随时代；花出去写负数，收进来写正数" }),
	why: Type.Optional(Type.String({ description: "一句话：钱花在哪了，或从哪来的" })),
});

/** 保留种类：切片 0 内核一律回 not_implemented，形状先留着。 */
const ReservedEffect = Type.Object({
	kind: StringEnum(["handout", "npc", "flag", "note", "ruling"] as const, {
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
	san_loss: Type.Optional(
		Type.String({ description: "理智检定的损失表达式，成功/失败，如 0/1D6；见到恐怖之物做 sanity:check 时必给，目标 NPC 档案里写了的可以省略" }),
	),
	involuntary: Type.Optional(
		Type.String({
			description: "理智检定失败时的失控行为，五选一：faint、flee、scream、freeze、attack；sanity:check 必给，由你按场面定",
		}),
	),
	outcome: Type.Optional(
		StringEnum(["investigators_win", "monsters_win", "fled", "stalemate"] as const, {
			description: "结束战斗时给：谁赢了、逃了、还是僵持",
		}),
	),
	skills: Type.Optional(
		Type.Array(Type.String(), { description: "合并检定用到的两个以上技能或特征名" }),
	),
	mode: Type.Optional(StringEnum(["any", "all"] as const, { description: "合并检定过一项即可还是全过" })),
	motive: Type.Optional(
		Type.Object({
			direction: StringEnum(["support", "neutral", "oppose"] as const, { description: "NPC 对这个目标是支持、中立还是抵触" }),
			intensity: Type.Optional(Type.Integer({ description: "0 到 2，越大越强" })),
		}, { description: "社交判定时 NPC 对玩家目标的倾向；省略视为中立" }),
	),
	support: Type.Optional(Type.String({ description: "社交判定里玩家拿出来的实证：一条已发现线索的名字" })),
	interrupted: Type.Optional(Type.Boolean({ description: "施法被打断" })),
	rest: Type.Optional(
		Type.Object({
			complete_rest: Type.Optional(Type.Boolean()),
			poor_environment: Type.Optional(Type.Boolean()),
		}, { description: "每周重伤恢复时的休养条件" }),
	),
	ending: Type.Optional(Type.String({ description: "结束会话时的结局种类；省略视为 conclusion" })),
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
			"看胶囊没答的那一面。回合胶囊已经带着这些的当前值：世界时钟、场面与出口、来路（走过的场景，由近到远）、此地尚未被发现的线索与它们的获取方式、在场者的企图与秘密、以及正压着的东西——这些不必再 look 一遍，胶囊就是最新的。胶囊没有的才用它：不给参数是重看场景（戏剧问题、压力动作、出口、着力点、在场者）；focus 给 npc 加 name 看某个胶囊没列的实体的守秘人视图（企图、恐惧、秘密、声音、关系、已知事实）；focus 给 investigator 看调查员表的细目；focus 给 clues 看已发现的与此地可得的线索；focus 给 time 看世界时钟。开桌那一回合没有胶囊，先 look 看开场场面。返回的一切都是守秘人专属，不能照抄进玩家文字。",
		promptSnippet: "看胶囊没答的那一面：场面、NPC、调查员、线索或时钟",
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
			"查模组图上胶囊没答的东西。kind 为 secret、scope 为 scene 的那份简报——本场景尚未被发现的线索、在场者的秘密与企图、守秘人笔记——胶囊里已经带着了，别再查一遍；要整本的秘密与结局节点时才用 scope 给 module。kind 为 module 时按名字或别名在模组图上找实体，最多回 8 条，每条给摘要、可见性与关系，用来确认玩家提到的名字在不在这本模组里；匹配的是图上的名字与句柄，用模组里的中文名或胶囊里出现过的名字去查，英文关键词查不到。kind 的 rule 与 catalog 本切片会回 not_implemented。",
		promptSnippet: "在模组图上查胶囊没答的实体，或调整本的秘密与结局",
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
			"回看过去，三条路。memory：过去回合抽出的往事断言，缺省给跟当前在场者与调查员相关的，用 about 点名别人，用 kinds 收窄种类；断言是候选，可能过时、可能只是某人的信念，信不信你判断。transcript：逐字原文，不带 read 时给候选卡（哪一回合、谁说的、开头 80 字），看准了再用 read 把那一段整段读出来，回来会说这段原文跟回合记录对不对得上。history：时间线，每回合的场景、时钟、收据条数与交付开头，用 types 只要某几类事件，用 diff 问两个回合之间到底变了什么。玩家提到「刚才」「你说过」，或者你要接上几回合前的线头时用它，不要凭印象编造已经发生过的事。",
		promptSnippet: "回看往事：memory 断言、transcript 原文、history 时间线",
		parameters: Type.Object({
			what: StringEnum(["transcript", "memory", "history"] as const, {
				description: "回看哪一路：往事断言、逐字原文、还是时间线",
			}),
			turns: Type.Optional(
				Type.Array(Type.Integer(), {
					minItems: 2,
					maxItems: 2,
					description: "回合区间 [起, 止]；transcript 缺省最近 3 回合",
				}),
			),
			role: Type.Optional(StringEnum(["player", "keeper"] as const, { description: "transcript：只要哪一方的记录" })),
			read: Type.Optional(
				Type.Object(
					{
						turn: Type.Integer({ description: "哪一回合" }),
						role: StringEnum(["player", "keeper"] as const, { description: "玩家原文还是守秘人交付" }),
					},
					{ description: "transcript：把某一回合某一方的原文整段读出来；不给时只回候选卡" },
				),
			),
			about: Type.Optional(
				Type.Array(Type.String(), {
					description: "memory：只要跟这些名字有关的往事；缺省取当前在场者加调查员",
				}),
			),
			kinds: Type.Optional(
				Type.Array(
					StringEnum(
						[
							"world_event",
							"knowledge",
							"belief",
							"relationship",
							"player_assertion",
							"player_preference",
							"keeper_correction",
						] as const,
					),
					{ description: "memory：只要这几类断言" },
				),
			),
			include_superseded: Type.Optional(
				Type.Boolean({ description: "memory：连已经被后来的关系关掉的旧条一起给" }),
			),
			limit: Type.Optional(Type.Integer({ description: "memory：最多给几条，上限 30" })),
			types: Type.Optional(
				Type.Array(
					StringEnum(
						[
							"turn-started",
							"player-declared",
							"roll-resolved",
							"scene-moved",
							"clue-discovered",
							"time-advanced",
							"resource-changed",
							"decision-settled",
							"session-changed",
							"choice-asked",
							"memory-written",
							"turn-finalized",
						] as const,
					),
					{ description: "history：只要这几类事件" },
				),
			),
			diff: Type.Optional(
				Type.Array(Type.Integer(), {
					minItems: 2,
					maxItems: 2,
					description: "history：两个回合之间变了什么 [起, 止]",
				}),
			),
		}),
	},
	{
		name: "resolve",
		label: "Resolve",
		method: "table.resolve",
		description:
			"把一次行动交给规则裁决。你只描述行动，规则由内核挑：写清谁、想达成什么、怎么做、对谁、赌什么，它选决策、取目标值、掷骰，回来是收据、成功等级，以及可能的会话（战斗、追逐、理智发作）与可接的后续。你不掷骰、不算数、不改数值；日常无争议的行动不要用它。攻击写 intent 为 combat 加 target 与 weapon（徒手写 unarmed）；内核报 needs_choice 时它已把候选和各自适用的场合列出来，挑一个写进 decision 再调一次；本该报 needs_choice 但候选里只有一条对得上本回合胶囊建议的节拍时，内核直接替你结算并在结果里写 decision_source 为 director——那一次已经算数了，不要再为它调第二次；结果里的待决防御若是玩家的，用 ask 把闪避还是反击交回他，他答了下一回合再用 defense 解，若是 NPC 的就你自己配 actor 与 defense 定；失败的检定想推骰就 push 为 true 并在 stakes 里写明推失败的代价，想花幸运就给 luck。技能认不出来时内核报 needs 并给候选，补上 skill 再调一次；intent 为 idle、meta、stuck、ambiguous 时不掷骰只回一句判断。",
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
			"把这一回合世界的改变落地：move 走到另一个场景（结果里直接带目的地场面，不必再 look），clue 让调查员拿到一条线索，time 推进世界时钟，damage 让调查员按规则书的骰子受伤（摔落、火烧、窒息这类没有攻击者的伤），item 让东西易手，cash 让钱增减。整批先校验后写，任一条不成立整批都不写，所以可以一次把这回合发生的事全列上。叙述里发生了却没 apply 的事等于没发生：走了要写 move，看见了要写 clue，花了时间要写 time，东西到手或交出要写 item，钱进出要写 cash。捡起、买到、被夺、用光的东西都是 item，它进的是调查员表；是武器就顺手给 weapon 写上规则表里的 profile 名，不给的话那把枪之后开不了火。花钱、拿到报酬、贿赂出去的钱是 cash，delta 带正负号，内核自己算前后。目的地可以是当前场景的出口，也可以是来时经过的任何场景（where.back 按由近到远列着，退出没有出口的巢穴就靠它）；不可达报 not_reachable 并给两份列表，线索不在此地报 not_here。",
		promptSnippet: "落地本回合的世界改变：移动、线索、时间、物品、现金",
		parameters: Type.Object({
			effects: Type.Array(
				Type.Union([MoveEffect, ClueEffect, TimeEffect, DamageEffect, ItemEffect, CashEffect, ReservedEffect]),
				{ minItems: 1, description: "这一回合要落地的改变，按发生顺序排" },
			),
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
