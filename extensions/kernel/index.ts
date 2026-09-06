/**
 * pi-coc 内核扩展：拉起 Python 内核，把七个动词接到 RPC 上，
 * 并在扩展侧镜像回合状态机。职责见 docs/kernel-rpc.md 第 8 节。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { KernelClient, KernelError } from "./client.ts";
import { COC_TOOLS, COC_TOOL_NAMES, type CocToolSpec, WRITE_TOOLS } from "./tools.ts";

type TurnState = "awaiting_player" | "open" | "acting" | "asked" | "committed";

interface OpenResult {
	campaign?: { id?: string; title?: string };
	turn?: { number?: number; state?: TurnState };
	investigators?: Array<Record<string, unknown>>;
	scene?: { name?: string; display_name?: string };
	pending_turn?: {
		player_text?: string;
		receipts?: unknown[];
		owed?: string[];
		since?: string;
		last_call_ordinal?: number;
	} | null;
	opening_needed?: boolean;
}

/**
 * `resolve` 结果里的会话摘要（契约 §11.5）与待决（§11.3、§11.5）。
 * 扩展只读它做状态行与遥测，不解释规则；字段缺失时按「没有」处理。
 */
type SessionSummary = {
	kind?: string;
	round?: number;
	status?: string;
	ended?: boolean;
	/** 轮到谁；契约没定字段名，两种写法都收。 */
	turn_of?: string;
	active_actor?: string;
	pending_defense?: { for?: string; defender?: string; options?: string[] } | null;
};

type PendingChoice = {
	name?: string;
	for?: string;
	prompt?: string;
	options?: string[];
};

type ResolveResult = {
	outcome?: { kind?: string };
	session?: SessionSummary | null;
	pending_choice?: PendingChoice | null;
};

interface CampaignRow {
	id: string;
	title?: string;
	module_id?: string;
	status?: string;
	turn?: number;
}

interface TableState {
	kernel: KernelClient;
	campaign: string;
	telemetryPath: string;
	turn: number;
	state: TurnState;
	/** 本回合已铸造的会改状态调用序号。 */
	callOrdinal: number;
	/** turn 0：开桌尚未 narrate，此时允许从 awaiting_player 直接 narrate。 */
	openingPending: boolean;
	/** narrate/ask 已回 rendered_text，等着替换助手消息交付。 */
	renderedText?: string;
	deliveryToolCallId?: string;
	/** 最近一次 resolve 回来的会话（战斗、追逐、理智发作）；null 表示当前没有会话。 */
	session: SessionSummary | null;
	/** 最近一次 resolve 留下的待决；`for` 是 player 时守秘人该用 ask 把它交回玩家。 */
	pendingChoice: PendingChoice | null;
	/** 本轮 agent run 里回合是否已经被 narrate/ask 关掉。 */
	closedThisRun: boolean;
	steeredThisTurn: boolean;
	roundTrips: number;
	mintedCallIds: Map<string, string>;
}

const PKG_ROOT = packageRoot();
const CLOSED_STATES: ReadonlySet<TurnState> = new Set<TurnState>(["awaiting_player", "committed", "asked"]);
const TURN_CLOSED_REASON = "回合已关闭，等待玩家";

let table: TableState | undefined;
let startupError: string | undefined;

function packageRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolvePath(here, "..", "..");
}

/** 启动命令：缺省是契约第 1 节的 uv 命令，测试用 PI_COC_KERNEL_CMD（JSON 数组）换掉。 */
function kernelCommand(workspace: string): string[] {
	const override = process.env.PI_COC_KERNEL_CMD?.trim();
	if (override) {
		const parsed: unknown = JSON.parse(override);
		if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string")) {
			throw new Error("PI_COC_KERNEL_CMD 必须是非空的字符串 JSON 数组");
		}
		return parsed as string[];
	}
	return [
		"uv",
		"run",
		"--frozen",
		"python",
		"-m",
		"coc.rpc",
		"--workspace",
		workspace,
		"--content",
		join(PKG_ROOT, "content"),
	];
}

function normalizeName(value: unknown): unknown {
	if (typeof value !== "string") return value;
	return value.trim().replace(/\s+/g, " ");
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * `details` 只到扩展和界面，模型看到的只有工具结果的正文。
 * 所以 `needs` 的可选值与 `needs_choice` 的候选必须落进正文，
 * 否则守秘人被告知「有候选」却看不见候选，补不出 decision（契约 §11.3）。
 */
function errorDetailLines(details: Record<string, unknown> | undefined): string[] {
	if (!details) return [];
	const lines: string[] = [];
	const needs = details.needs as { field?: string; options?: unknown[] } | undefined;
	if (needs?.field) {
		const options = (needs.options ?? []).map((option) => String(option)).join("、");
		lines.push(options ? `缺 ${needs.field}，可选：${options}` : `缺 ${needs.field}`);
	}
	const candidates = details.candidates;
	if (Array.isArray(candidates) && candidates.length > 0) {
		lines.push("候选：");
		for (const candidate of candidates) {
			if (typeof candidate === "string") {
				lines.push(`- ${candidate}`);
				continue;
			}
			const row = (candidate ?? {}) as Record<string, unknown>;
			// 候选的字段名契约没定死：语义名与「何时适用」各收几种写法。
			const name = asString(row.name) ?? asString(row.id) ?? asString(row.decision) ?? "?";
			const when = asString(row.when) ?? asString(row.summary) ?? asString(row.description);
			lines.push(when ? `- ${name}：${when}` : `- ${name}`);
		}
	}
	const exits = details.exits;
	if (Array.isArray(exits) && exits.length > 0) {
		lines.push(`可达：${exits.map((exit) => (typeof exit === "string" ? exit : JSON.stringify(exit))).join("、")}`);
	}
	return lines;
}

/** resolve 的遥测多两列：这次裁决属于哪一族，落在哪个会话里（契约 §11.6）。 */
function resolveTelemetry(result: ResolveResult): Record<string, unknown> {
	const outcomeKind = asString(result.outcome?.kind);
	const sessionKind = asString(result.session?.kind ?? undefined);
	return {
		...(outcomeKind ? { outcome_kind: outcomeKind } : {}),
		...(sessionKind ? { session_kind: sessionKind } : {}),
	};
}

function errorText(error: unknown): string {
	if (!(error instanceof KernelError)) {
		return error instanceof Error ? error.message : String(error);
	}
	return [error.toToolText(), ...errorDetailLines(error.details)].join("\n");
}

export default function (pi: ExtensionAPI) {
	// ---- 遥测 -------------------------------------------------------------

	async function record(entry: Record<string, unknown>): Promise<void> {
		const line = { turn: table?.turn ?? null, ...entry };
		try {
			pi.appendEntry("coc-telemetry", line);
		} catch {
			/* 遥测不该弄坏一回合 */
		}
		const path = table?.telemetryPath;
		if (!path) return;
		try {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
		} catch {
			/* 同上 */
		}
	}

	// ---- 宿主消息 ---------------------------------------------------------

	/** 宿主自己发的消息带标记：它不是玩家输入，不进 table.player_input。 */
	function sendHost(content: string, kind: string): void {
		pi.sendMessage(
			{ customType: "coc-host", content, display: false, details: { coc_host: true, kind } },
			{ triggerTurn: true },
		);
	}

	// ---- 回合镜像 ---------------------------------------------------------

	function applyOpen(open: OpenResult): void {
		if (!table) return;
		table.turn = typeof open.turn?.number === "number" ? open.turn.number : table.turn;
		table.state = open.turn?.state ?? table.state;
		table.openingPending = open.opening_needed === true;
		// 恢复的回合接着死掉的进程铸序号，否则第一次写就撞 idempotency_conflict。
		table.callOrdinal = open.pending_turn?.last_call_ordinal ?? 0;
		table.mintedCallIds.clear();
		table.renderedText = undefined;
		table.deliveryToolCallId = undefined;
		table.closedThisRun = false;
		table.steeredThisTurn = false;
	}

	function mintCallId(state: TableState): string {
		state.callOrdinal += 1;
		return `t${state.turn}-c${state.callOrdinal}`;
	}

	/** 铸造过就用铸造的那个；tool_call 没跑到时兜底铸一个。 */
	function takeCallId(state: TableState, toolCallId: string): string {
		const minted = state.mintedCallIds.get(toolCallId);
		if (minted) {
			state.mintedCallIds.delete(toolCallId);
			return minted;
		}
		return mintCallId(state);
	}

	/**
	 * `resolve` 的结果可能带会话与待决（契约 §11.5）。回合状态机不因此多一个状态：
	 * 会话把回合留在 `acting`，守秘人接着用 ask 把玩家的防御选择交回去，
	 * 或者用 actor 加 defense 替 NPC 作答。这里只镜像摘要，供状态行与遥测用。
	 */
	function noteResolve(state: TableState, result: ResolveResult): void {
		const session = result.session;
		state.session = session && typeof session === "object" ? session : null;
		const pending = result.pending_choice;
		state.pendingChoice = pending && typeof pending === "object" ? pending : null;
		pi.events.emit("coc:resolve", {
			campaign: state.campaign,
			turn: state.turn,
			result,
		});
	}

	function applyToolSuccess(state: TableState, tool: string, toolCallId: string, result: Record<string, unknown>): void {
		switch (tool) {
			case "look":
			case "lookup":
			case "recall":
				if (state.state === "open") state.state = "acting";
				break;
			case "resolve":
				state.state = "acting";
				noteResolve(state, result as ResolveResult);
				break;
			case "apply":
				state.state = "acting";
				break;
			case "ask":
				state.state = "asked";
				// 待决已经交回玩家了，回合欠的不再是 ask。
				state.pendingChoice = null;
				state.closedThisRun = true;
				state.renderedText = asString(result.rendered_text);
				state.deliveryToolCallId = toolCallId;
				break;
			case "narrate":
				state.state = "awaiting_player";
				state.openingPending = false;
				state.closedThisRun = true;
				state.renderedText = asString(result.rendered_text);
				state.deliveryToolCallId = toolCallId;
				break;
		}
	}

	// ---- 工具 -------------------------------------------------------------

	async function runTool(
		spec: CocToolSpec,
		toolCallId: string,
		params: Record<string, unknown>,
	): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
		const state = table;
		if (!state) {
			throw new Error(startupError ?? "内核还没就位，这张桌子开不了");
		}
		const payload: Record<string, unknown> = { campaign: state.campaign, ...params };
		if (WRITE_TOOLS.has(spec.name)) {
			payload.call_id = takeCallId(state, toolCallId);
		}
		const startedAt = new Date().toISOString();
		const began = Date.now();
		try {
			const result = (await state.kernel.call<Record<string, unknown>>(spec.method, payload)) ?? {};
			applyToolSuccess(state, spec.name, toolCallId, result);
			await record({
				tool: spec.name,
				call_id: payload.call_id ?? null,
				started_at: startedAt,
				ms: Date.now() - began,
				ok: true,
				...(spec.name === "resolve" ? resolveTelemetry(result as ResolveResult) : {}),
			});
			if (spec.name === "narrate" || spec.name === "ask") {
				// 会话里的一回合算账要分得出来：战斗的回合往返数跟调查的回合不是一回事。
				await record({
					tool: spec.name,
					event: "turn-closed",
					round_trips: state.roundTrips,
					ok: true,
					...(state.session?.kind ? { session_kind: state.session.kind } : {}),
				});
			}
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		} catch (error) {
			const code = error instanceof KernelError ? error.code : "internal";
			await record({
				tool: spec.name,
				call_id: payload.call_id ?? null,
				started_at: startedAt,
				ms: Date.now() - began,
				ok: false,
				code,
			});
			return {
				content: [{ type: "text", text: errorText(error) }],
				details: {
					coc_error: {
						code,
						message: error instanceof Error ? error.message : String(error),
						...(error instanceof KernelError && error.fix ? { fix: error.fix } : {}),
						...(error instanceof KernelError && error.details ? { details: error.details } : {}),
					},
				},
			};
		}
	}

	for (const spec of COC_TOOLS) {
		pi.registerTool({
			name: spec.name,
			label: spec.label,
			description: spec.description,
			promptSnippet: spec.promptSnippet,
			parameters: spec.parameters,
			// 一回合的动作有先后：串行执行，narrate 之后的同批调用才拦得住。
			executionMode: "sequential",
			execute: async (toolCallId, params) => runTool(spec, toolCallId, params as Record<string, unknown>),
		});
	}

	// AgentToolResult 没有 isError 字段，错误旗只能在 tool_result 上翻。
	pi.on("tool_result", async (event) => {
		if (!COC_TOOL_NAMES.includes(event.toolName as never)) return;
		const details = event.details as { coc_error?: unknown } | undefined;
		if (details?.coc_error) return { isError: true };
	});

	// ---- 开桌 -------------------------------------------------------------

	async function pickCampaign(kernel: KernelClient, ctx: ExtensionContext): Promise<string> {
		const fromEnv = process.env.PI_COC_CAMPAIGN?.trim();
		if (fromEnv) return fromEnv;
		const listed = await kernel.call<{ campaigns?: CampaignRow[] }>("campaign.list");
		const campaigns = listed.campaigns ?? [];
		if (campaigns.length === 0) {
			throw new Error("这个工作区里还没有战役：先建一个，或者用 PI_COC_CAMPAIGN 指定一个已有的。");
		}
		const ids = campaigns.map((row) => row.id).join("、");
		if (!ctx.hasUI) {
			throw new Error(`没有界面可以问：用 bin/pi-coc --campaign <id> 或 PI_COC_CAMPAIGN 指定战役。现有：${ids}`);
		}
		const labels = campaigns.map(
			(row) => `${row.id}　${row.title ?? ""}（第 ${row.turn ?? 0} 回合，${row.status ?? "?"}）`,
		);
		const chosen = await ctx.ui.select("选一张桌子", labels);
		const index = chosen ? labels.indexOf(chosen) : -1;
		if (index < 0) {
			throw new Error(`没有选战役，这次不开桌。现有：${ids}`);
		}
		return campaigns[index].id;
	}

	async function shutdownKernel(): Promise<void> {
		const current = table;
		table = undefined;
		if (current) await current.kernel.close();
	}

	pi.on("session_start", async (_event, ctx) => {
		await shutdownKernel();
		startupError = undefined;
		let kernel: KernelClient | undefined;
		try {
			kernel = new KernelClient({
				command: kernelCommand(ctx.cwd),
				cwd: PKG_ROOT,
				env: { PYTHONPATH: join(PKG_ROOT, "kernel") },
				onDiagnostic: (message) => {
					if (ctx.hasUI) ctx.ui.setStatus("coc-kernel", message.slice(0, 120));
				},
				onRestart: async () => {
					const state = table;
					if (!state) return;
					await state.kernel.callImmediate("kernel.hello");
					const reopened = await state.kernel.callImmediate<OpenResult>("table.open", {
						campaign: state.campaign,
					});
					applyOpen(reopened);
				},
			});
			kernel.start();
			await kernel.call("kernel.hello");
			const campaign = await pickCampaign(kernel, ctx);
			table = {
				kernel,
				campaign,
				telemetryPath: join(ctx.cwd, ".coc", "campaigns", campaign, "telemetry.jsonl"),
				turn: 0,
				state: "awaiting_player",
				callOrdinal: 0,
				openingPending: false,
				session: null,
				pendingChoice: null,
				closedThisRun: false,
				steeredThisTurn: false,
				roundTrips: 0,
				mintedCallIds: new Map(),
			};
			const open = await kernel.call<OpenResult>("table.open", { campaign });
			applyOpen(open);
			// 工具面固定：只这七个，之后不再变形。
			pi.setActiveTools([...COC_TOOL_NAMES]);
			pi.events.emit("coc:table-open", { campaign, open });

			if (ctx.hasUI) {
				const title = open.campaign?.title ?? campaign;
				const scene = open.scene?.display_name ?? open.scene?.name ?? "未知场景";
				ctx.ui.notify(`COC 已开桌：${title}｜第 ${table.turn} 回合（${table.state}）｜${scene}`, "info");
			}

			const pending = open.pending_turn;
			if (pending) {
				const owed = (pending.owed ?? []).join("、") || "narrate";
				sendHost(
					`上次会话在回合中途断了，这一回合还没交付。玩家原文：${pending.player_text ?? "（无）"}。` +
						`已落收据：${JSON.stringify(pending.receipts ?? [])}。还欠：${owed}。` +
						`先 look 看清现在的场面，把这一回合做完，再用 narrate 交付。`,
					"recovery",
				);
			} else if (open.opening_needed) {
				sendHost(
					"开桌：这一回合没有玩家输入。先用 look 看开场场面（需要背景就 lookup），再用一次 narrate 交付开场。",
					"opening",
				);
			}
		} catch (error) {
			startupError = `内核没能开桌：${errorText(error)}`;
			await kernel?.close();
			table = undefined;
			if (ctx.hasUI) ctx.ui.notify(startupError, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		await shutdownKernel();
	});

	// ---- 回合 -------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		const state = table;
		if (!state) return;
		const text = event.prompt;
		const startedAt = new Date().toISOString();
		const began = Date.now();
		try {
			const result = await state.kernel.call<{ turn?: number; state?: TurnState; capsule?: unknown }>(
				"table.player_input",
				{ campaign: state.campaign, text },
			);
			state.turn = typeof result.turn === "number" ? result.turn : state.turn + 1;
			state.state = result.state ?? "open";
			state.callOrdinal = 0;
			state.mintedCallIds.clear();
			state.renderedText = undefined;
			state.deliveryToolCallId = undefined;
			state.closedThisRun = false;
			state.steeredThisTurn = false;
			state.roundTrips = 0;
			await record({
				tool: "table.player_input",
				started_at: startedAt,
				ms: Date.now() - began,
				ok: true,
			});
			return {
				message: {
					customType: "coc-capsule",
					content: JSON.stringify(result.capsule ?? {}),
					display: false,
					details: { coc_host: true, turn: state.turn },
				},
			};
		} catch (error) {
			await record({
				tool: "table.player_input",
				started_at: startedAt,
				ms: Date.now() - began,
				ok: false,
				code: error instanceof KernelError ? error.code : "internal",
			});
			return {
				message: {
					customType: "coc-host",
					content: `内核没有接下这次玩家输入：${errorText(error)}`,
					display: false,
					details: { coc_host: true, kind: "player-input-failed" },
				},
			};
		}
	});

	pi.on("agent_start", async () => {
		if (table) table.closedThisRun = false;
	});

	pi.on("turn_start", async () => {
		if (table) table.roundTrips += 1;
	});

	pi.on("tool_call", async (event) => {
		const name = event.toolName;
		if (!COC_TOOL_NAMES.includes(name as never)) return;
		const input = event.input as Record<string, unknown>;
		normalizeToolInput(name, input);

		const state = table;
		if (!state) {
			return { block: true, reason: startupError ?? "内核没有就位，这张桌子还没开" };
		}
		if (state.closedThisRun) {
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: TURN_CLOSED_REASON });
			return { block: true, reason: TURN_CLOSED_REASON };
		}
		if (!WRITE_TOOLS.has(name)) return;

		// 会话（战斗、追逐、理智发作）不是回合状态：它把回合留在 acting，
		// 所以待决防御交回玩家的那次 ask 走的是常规路径，这里不因为有会话在跑就拦。
		const openingNarrate = name === "narrate" && state.openingPending && state.state === "awaiting_player";
		if (!openingNarrate && CLOSED_STATES.has(state.state)) {
			const reason =
				state.state === "asked"
					? "回合已经用 ask 交给玩家了，等他回答"
					: `当前回合状态是 ${state.state}，不能改状态：等玩家开口，或者先只用 look、lookup、recall`;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "turn_state", reason });
			return { block: true, reason };
		}
		if (name === "ask" && !input.binds && state.pendingChoice?.for === "player" && state.pendingChoice.name) {
			// 契约 §11.9：守秘人漏填 binds 时用内核最近一条给玩家的待决名补上。
			input.binds = state.pendingChoice.name;
		}
		state.mintedCallIds.set(event.toolCallId, mintCallId(state));
	});

	/** 实体名做空白归一化；大小写留给内核，它按图上的名字与别名匹配。 */
	function normalizeToolInput(name: string, input: Record<string, unknown>): void {
		if (name === "look") {
			if (input.name !== undefined) input.name = normalizeName(input.name);
			return;
		}
		if (name === "resolve") {
			const action = input.action as Record<string, unknown> | undefined;
			if (!action) return;
			// actor 现在也可能是 NPC 名，weapon/spell 同样要在图与装备表上匹配（契约 §11.1、§11.4）。
			for (const key of ["actor", "target", "skill", "decision", "weapon", "spell"]) {
				if (action[key] !== undefined) action[key] = normalizeName(action[key]);
			}
			const choice = action.choice as Record<string, unknown> | undefined;
			if (choice) {
				for (const key of ["pending", "option"]) {
					if (choice[key] !== undefined) choice[key] = normalizeName(choice[key]);
				}
			}
			return;
		}
		if (name === "apply") {
			const effects = input.effects;
			if (!Array.isArray(effects)) return;
			for (const effect of effects) {
				if (!effect || typeof effect !== "object") continue;
				const row = effect as Record<string, unknown>;
				for (const key of ["to", "clue", "name"]) {
					if (row[key] !== undefined) row[key] = normalizeName(row[key]);
				}
			}
		}
	}

	pi.on("message_end", async (event) => {
		const state = table;
		if (!state || event.message.role !== "assistant") return;
		const blocks = (event.message.content ?? []) as Array<Record<string, unknown>>;
		const hasToolCalls = blocks.some((b) => b.type === "toolCall");
		if (hasToolCalls) {
			// 带工具调用的助手消息只保留调用：守秘人在调用前写的过程话
			// （「先核对线索再叙述」）不是台词，玩家可见文字只由 narrate/ask 交付。
			const withoutText = blocks.filter((b) => b.type !== "text");
			if (withoutText.length !== blocks.length) {
				return { message: { ...event.message, content: withoutText } };
			}
			return;
		}
		let rendered = state.renderedText;
		if (!rendered) {
			// 守秘人写了台词却没调 narrate：这段正文就是叙述。宿主替它关回合，
			// 玩家看到的仍是内核渲染的文本，收据一条不少。
			const prose = blocks
				.filter((b) => b.type === "text" && typeof b.text === "string")
				.map((b) => String(b.text))
				.join("")
				.split("\n")
				.filter((line) => !/^\s*【(明骰|变化|第 ?\d+ ?轮)】/.test(line))
				.join("\n")
				.trim();
			const canClose = state.state === "open" || state.state === "acting"
				|| (state.state === "awaiting_player" && state.openingPending);
			if (!prose || !canClose || state.closedThisRun) return;
			// 内核留了给玩家的待决（战斗的防御）而守秘人只写了叙述：宿主替它把问题接上，
			// 叙述是 ask 的 text，问题与选项是内核的。
			const pending = state.pendingChoice;
			const asPlayerAsk = pending?.for === "player" && typeof pending.prompt === "string"
				&& Array.isArray(pending.options) && pending.options.length >= 2;
			const tool = asPlayerAsk ? "ask" : "narrate";
			const callId = mintCallId(state);
			const startedAt = new Date().toISOString();
			const began = Date.now();
			try {
				const params: Record<string, unknown> = asPlayerAsk
					? { campaign: state.campaign, call_id: callId, text: prose, prompt: pending!.prompt, options: pending!.options, binds: pending!.name }
					: { campaign: state.campaign, call_id: callId, text: prose };
				const result = (await state.kernel.call<Record<string, unknown>>(`table.${tool}`, params)) ?? {};
				applyToolSuccess(state, tool, "implicit", result);
				await record({ tool, call_id: callId, started_at: startedAt, ms: Date.now() - began, ok: true, implicit: true });
				await record({ tool, event: "turn-closed", round_trips: state.roundTrips, ok: true, implicit: true });
				rendered = asString(result.rendered_text);
			} catch (error) {
				await record({
					tool, call_id: callId, started_at: startedAt, ms: Date.now() - began, ok: false, implicit: true,
					code: error instanceof KernelError ? error.code : "internal",
				});
				return;
			}
			if (!rendered) return;
		}
		const next: Array<Record<string, unknown>> = [];
		let placed = false;
		for (const block of blocks) {
			if (block.type === "text") {
				if (!placed) {
					next.push({ type: "text", text: rendered });
					placed = true;
				}
				continue;
			}
			next.push(block);
		}
		if (!placed) next.push({ type: "text", text: rendered });

		state.renderedText = undefined;
		state.deliveryToolCallId = undefined;
		state.callOrdinal = 0;
		state.mintedCallIds.clear();
		state.steeredThisTurn = false;
		return { message: { ...event.message, content: next } };
	});

	pi.on("agent_end", async () => {
		const state = table;
		if (!state) return;
		if (state.closedThisRun || state.renderedText) return;
		if (state.steeredThisTurn) return;
		if (state.state !== "open" && state.state !== "acting") return;
		state.steeredThisTurn = true;
		// 会话里留了个给玩家的待决（比如战斗的防御）时，回合欠的是 ask，不是 narrate。
		const pending = state.pendingChoice;
		if (pending?.for === "player") {
			sendHost(
				`内核在等玩家自己选：${pending.prompt ?? pending.name ?? "上一次裁决留下的待决"}。` +
					`用一次 ask 把它交回玩家，他的回答会作为下一回合的输入回来。`,
				"steer",
			);
			return;
		}
		sendHost("这一回合还没关：用一次 narrate 把它交付给玩家，或者用一次 ask 把选择交回去。", "steer");
	});
}
