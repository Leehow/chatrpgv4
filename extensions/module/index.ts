/**
 * 模组扩展：无人值守构建的驱动循环（契约 §14.5）与按需深读车道（契约 §14.6）。
 *
 * 它不注册任何工具。两个模式各跑一件事：
 * - setup：onboarding 的 `build-opening` 那一步在总线上发 `coc:module-build`，
 *   这里跑 `buildModule`，`opening_ready` 一到发 `coc:module-opening-ready`，
 *   整本读完发 `coc:module-build-done`（失败发 `coc:module-build-failed`，
 *   免得建卡那一步干等）。
 * - play：一条后台车道认领 `module.deepen.claim` 给的 section，跑同一个读者，
 *   review／accept／assemble，然后 `module.deepen.complete`。同一时刻一个，
 *   回合在飞的时候不开新的（契约 §14.6：不阻塞回合），关机就停。
 *
 * 内核 RPC 只有一份（契约 §1），跟记忆扩展一样从总线上的 `coc:kernel-bridge` 拿。
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocMode } from "../lanes/host.ts";
import { type BuildContext, buildModule, type KernelCall, readSection, resetReviewProbe } from "./build.ts";

/** 构建并发上限（契约 §14.5），缺省 1。 */
function buildParallel(): number {
	const raw = Number.parseInt(process.env.PI_COC_BUILD_PARALLEL?.trim() ?? "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** 读者一轮的上限，测试用它把假读者的等待压到秒级。 */
function readerTimeoutMs(): number | undefined {
	const raw = Number.parseInt(process.env.PI_COC_READER_TIMEOUT_MS?.trim() ?? "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/** 读者的模型（契约 §14.5）：环境变量点名的那个，没点名就跟桌子同模型。 */
function readerModel(ctx: ExtensionContext | undefined): string | undefined {
	const raw = process.env.PI_COC_BUILD_MODEL?.trim();
	if (raw) return raw;
	const current = ctx?.model;
	return current ? `${current.provider}/${current.id}` : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default function (pi: ExtensionAPI) {
	const setupMode = cocMode() === "setup";

	let ctx: ExtensionContext | undefined;
	let bridge: { campaign?: string; call: KernelCall } | undefined;
	let lanes = new AbortController();
	let stopped = false;
	/** 同一时刻只跑一件事：构建循环或一条深读。 */
	let busy = false;
	/** 回合在飞（宿主已经把玩家输入交给内核，助手还没跑完）：深读不开新的。 */
	let turnInFlight = false;
	/** 刚提交过一回合，队列可能长了东西；等这一轮结束去认领一次。 */
	let pendingClaim = false;
	/** play 模式下当前战役的模组，从 `coc:table-open` 来。 */
	let moduleId: string | undefined;
	let campaign: string | undefined;

	// ---- 遥测 -------------------------------------------------------------

	/** 构建遥测：模组的 `build.jsonl`（契约 §14.1），外加会话记录与战役遥测各一行。 */
	function record(module: string, row: Record<string, unknown>): void {
		const line = { lane: "module", module_id: module, at: new Date().toISOString(), ...row };
		try {
			pi.appendEntry("coc-telemetry", line);
		} catch {
			/* 遥测不该弄坏一条车道 */
		}
		let cwd: string | undefined;
		try {
			// 会话 dispose 之后 ctx 的 getter 会抛（docs/pi-host-contract.md 第 5 节）。
			cwd = ctx?.cwd;
		} catch {
			cwd = undefined;
		}
		if (!cwd) return;
		void appendJsonl(join(cwd, ".coc", "modules", module, "build.jsonl"), line);
		if (campaign) void appendJsonl(join(cwd, ".coc", "campaigns", campaign, "telemetry.jsonl"), line);
	}

	/**
	 * 车道要的那份上下文。整个身子在 try 里：会话 dispose 之后 ctx 的每个 getter 都抛
	 * （docs/pi-host-contract.md 第 5 节），而车道完全可能在那之后才轮到自己。
	 */
	function context(call: KernelCall): BuildContext | undefined {
		try {
			const cwd = ctx?.cwd;
			if (!cwd) return undefined;
			const timeout = readerTimeoutMs();
			const model = readerModel(ctx);
			return {
				call,
				workspace: cwd,
				...(model ? { model } : {}),
				signal: lanes.signal,
				record,
				stopped: () => stopped,
				...(timeout ? { readerTimeoutMs: timeout } : {}),
			};
		} catch {
			return undefined;
		}
	}

	// ---- 构建（setup 模式） -----------------------------------------------

	async function runBuild(request: { module_id: string; campaign?: string }): Promise<void> {
		const current = bridge;
		const build = current ? context(current.call) : undefined;
		if (!current || !build) {
			pi.events.emit("coc:module-build-failed", { module_id: request.module_id, detail: "内核桥不在，构建起不来" });
			return;
		}
		if (busy) return;
		busy = true;
		try {
			const report = await buildModule(build, request.module_id, {
				parallel: buildParallel(),
				onOpeningReady: (status) => {
					pi.events.emit("coc:module-opening-ready", {
						module_id: request.module_id,
						...(request.campaign ? { campaign: request.campaign } : {}),
						status,
					});
				},
			});
			pi.events.emit("coc:module-build-done", { module_id: request.module_id, report });
		} catch (error) {
			const detail = errorText(error);
			record(request.module_id, { section_id: null, round: 0, reason: "build", accepted: false, detail });
			pi.events.emit("coc:module-build-failed", { module_id: request.module_id, detail });
		} finally {
			busy = false;
		}
	}

	// ---- 按需深读（play 模式） --------------------------------------------

	/**
	 * 认领一段就读一段，读完再认领下一段；回合一开就停手，关机也停。
	 * 认领与完成之间不放第二次认领：契约 §14.6「同一时刻一个」。
	 */
	async function pumpDeepen(): Promise<void> {
		if (busy || stopped || turnInFlight) return;
		const current = bridge;
		if (!current) return;
		const deepen = context(current.call);
		if (!deepen) return;
		busy = true;
		try {
			while (!stopped && !turnInFlight && !lanes.signal.aborted) {
				let claim: Record<string, unknown>;
				try {
					claim = asRecord(
						await current.call("module.deepen.claim", moduleId ? { module_id: moduleId } : { campaign }),
					);
				} catch (error) {
					record(moduleId ?? "unknown", {
						section_id: null,
						round: 0,
						reason: "deepen",
						accepted: false,
						detail: `module.deepen.claim ${errorText(error)}`,
					});
					return;
				}
				const sectionId = asString(claim.section_id);
				if (!sectionId) return;
				const target = asString(claim.module_id) ?? moduleId;
				if (!target) return;
				const outcome = await readSection(deepen, target, sectionId, "deepen");
				try {
					await current.call("module.deepen.complete", {
						module_id: target,
						section_id: sectionId,
						status: outcome.accepted ? "accepted" : "failed",
						...(outcome.detail ? { detail: outcome.detail } : {}),
					});
				} catch (error) {
					record(target, {
						section_id: sectionId,
						round: outcome.rounds,
						reason: "deepen",
						accepted: outcome.accepted,
						detail: `module.deepen.complete ${errorText(error)}`,
					});
					return;
				}
			}
		} finally {
			busy = false;
		}
	}

	/** 排过队才去认领，而且等到 `agent_end`：回合真的结束了才动内核。 */
	function kickDeepen(): void {
		if (setupMode || !pendingClaim) return;
		pendingClaim = false;
		void pumpDeepen().catch(() => undefined);
	}

	// ---- 总线 -------------------------------------------------------------

	// 内核扩展在 session_start 里发桥；本扩展在加载时就订阅，两种加载顺序都接得住。
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = asRecord(data) as { campaign?: string; call?: KernelCall };
		bridge = typeof payload.call === "function" ? { ...(payload.campaign ? { campaign: payload.campaign } : {}), call: payload.call } : undefined;
		if (bridge?.campaign) campaign = bridge.campaign;
	});

	pi.events.on("coc:table-open", (data) => {
		const payload = asRecord(data);
		campaign = asString(payload.campaign) ?? campaign;
		const open = asRecord(payload.open);
		moduleId = asString(asRecord(open.campaign).module_id) ?? moduleId;
	});

	/**
	 * 认领只排在「刚提交过一回合」之后（契约 §14.6：`move` 成功后内核入队）。
	 * 开桌时入的那一段（起始场景，reason `opening`）也等得起：开场那一回合一提交就轮到它，
	 * 这样开桌路上不多一次内核往返，回合里也不会突然插进来一条车道。
	 */
	pi.events.on("coc:turn-committed", () => {
		pendingClaim = true;
	});

	// 建卡进程的 `build-opening` 那一步发起构建（契约 §14.4 的第五步）。
	pi.events.on("coc:module-build", (data) => {
		const payload = asRecord(data);
		const target = asString(payload.module_id);
		if (!target || stopped) return;
		campaign = asString(payload.campaign) ?? campaign;
		void runBuild({
			module_id: target,
			...(asString(payload.campaign) ? { campaign: asString(payload.campaign) as string } : {}),
		}).catch(() => undefined);
	});

	// 回合期间不开新的深读（契约 §14.6：不阻塞回合）。回合的边界用宿主自己的钩子，
	// 不用总线：`before_agent_start` 是玩家输入进内核那一刻，`agent_end` 是这一轮真的结束了。
	pi.on("before_agent_start", async () => {
		turnInFlight = true;
	});

	pi.on("agent_end", async () => {
		turnInFlight = false;
		kickDeepen();
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		stopped = false;
		turnInFlight = false;
		pendingClaim = false;
		lanes = new AbortController();
		resetReviewProbe();
	});

	pi.on("session_shutdown", async () => {
		// 关机不等构建：在飞的读者子进程掐断，没读完的 section 留在 `sections.json` 里等下次。
		stopped = true;
		lanes.abort();
		bridge = undefined;
		ctx = undefined;
	});
}
