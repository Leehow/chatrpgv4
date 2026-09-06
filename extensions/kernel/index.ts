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
	pending_turn?: { player_text?: string; receipts?: unknown[]; owed?: string[]; since?: string } | null;
	opening_needed?: boolean;
}

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

function errorText(error: unknown): string {
	if (error instanceof KernelError) return error.toToolText();
	return error instanceof Error ? error.message : String(error);
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
		table.callOrdinal = 0;
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

	function applyToolSuccess(state: TableState, tool: string, toolCallId: string, result: Record<string, unknown>): void {
		switch (tool) {
			case "look":
			case "lookup":
			case "recall":
				if (state.state === "open") state.state = "acting";
				break;
			case "resolve":
			case "apply":
				state.state = "acting";
				break;
			case "ask":
				state.state = "asked";
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
			});
			if (spec.name === "narrate" || spec.name === "ask") {
				await record({ tool: spec.name, event: "turn-closed", round_trips: state.roundTrips, ok: true });
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

		const openingNarrate = name === "narrate" && state.openingPending && state.state === "awaiting_player";
		if (!openingNarrate && CLOSED_STATES.has(state.state)) {
			const reason =
				state.state === "asked"
					? "回合已经用 ask 交给玩家了，等他回答"
					: `当前回合状态是 ${state.state}，不能改状态：等玩家开口，或者先只用 look、lookup、recall`;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "turn_state", reason });
			return { block: true, reason };
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
			for (const key of ["actor", "target", "skill", "decision"]) {
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
		const rendered = state.renderedText;
		if (!rendered) return;
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
		sendHost("这一回合还没关：用一次 narrate 把它交付给玩家，或者用一次 ask 把选择交回去。", "steer");
	});
}
