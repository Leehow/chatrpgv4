/**
 * 建卡扩展（契约 §14.4）。只在 `PI_COC_MODE=setup` 的进程里注册工具，只注册一个：`setup`。
 *
 * 七步表在内核里（`content/setup/steps.json`，经 `setup.steps` 拿到）。这里做四件事：
 * 1. 闸门：`step` 不在表里、前置未满足、重复已完成的步 → 拒绝语与「下一步」都从表派生
 *    （见 `steps.ts`，顺序信息在本包里只写这一遍）。
 * 2. 执行：`op` 步按表点名的方法与参数调内核；一步两次调用的（`module.bind` 再 `module.plan`）
 *    按表里的顺序走，前一次的结果喂给后一次。
 * 3. 三种不是「调一次内核」的步：`ask`（选来源：starter 名单来自 `kernel.hello` 的 content
 *    与 `campaign.list`，或者玩家给一个资料包目录）、`external`（资料包还没有就告诉玩家
 *    怎么用宿主的 PDF 技能产出它，下次调用再看一眼）、`module.build`（构建循环在 module
 *    扩展里，这里发总线事件并等 `coc:module-opening-ready`）。
 * 4. 收尾：表里没有下一步了就把开桌命令交出去，让进程退出。
 *
 * 职业不由这里判断：`setup.occupations` 的清单原样进工具结果，由模型按玩家那句话挑一个 id
 * （契约 §14.7）。这一侧没有任何关键词表。
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { cocMode } from "../lanes/host.ts";
import {
	allowedSteps,
	gate,
	type GateState,
	instructionFor,
	nextStep,
	normalizeSteps,
	type OpSpec,
	progressLine,
	sourceKinds,
	type Step,
} from "./steps.ts";

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** 构建那一步等 `opening_ready` 的上限；到点就回「还在读」，玩家可以再调一次接着等。 */
const BUILD_WAIT_MS = Number.parseInt(process.env.PI_COC_BUILD_WAIT_MS?.trim() ?? "", 10) || 30 * 60 * 1000;

/** 内核错误信封的 code 用鸭子类型读：跨扩展 instanceof 靠不住（两份模块实例）。 */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** `source.module_id` 这样的取值路径。 */
function lookupPath(context: Record<string, unknown>, path: string): unknown {
	let cursor: unknown = context;
	for (const segment of path.split(".")) {
		if (!cursor || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

/**
 * 契约 §5：`table.*` 与 `setup.*` 的参数里 `campaign` 一律必填；
 * §14.3 的 `module.*` 是按模组 id 寻址的（多战役共享一个模组），不带 campaign。
 * 表没点名 `campaign` 时按这条补，别按方法名瞎猜。
 */
function wantsCampaign(method: string): boolean {
	return method.startsWith("setup.") || method.startsWith("table.");
}

export default function (pi: ExtensionAPI) {
	// 开桌进程里这个扩展什么都不注册（契约 §14.4）。
	if (cocMode() !== "setup") return;

	let ctx: ExtensionContext | undefined;
	let bridge: { call: KernelCall; hello?: Record<string, unknown> } | undefined;
	let steps: Step[] | undefined;
	let stepsError: string | undefined;
	let loading: Promise<void> | undefined;
	const completed = new Set<string>();
	/** 已完成步骤留下的东西：战役 id、模组 id、来源、调查员 id……参数从这里补。 */
	const context: Record<string, unknown> = {};
	/** 一步里已经跑过的 op（`setup.occupations` 这种查清单的不重复跑）。 */
	const opCache = new Map<string, unknown>();
	let sourceKind: string | undefined;
	/** 最后一步做完：等这一轮说完话再退出进程。 */
	let handoff: string | undefined;

	function state(): GateState {
		return { completed, ...(sourceKind ? { sourceKind } : {}) };
	}

	function paint(): void {
		try {
			if (!ctx?.hasUI || !steps) return;
			ctx.ui.setStatus("coc-setup", progressLine(steps, state()));
		} catch {
			/* 状态行不该弄坏一步 */
		}
	}

	// ---- 表 ---------------------------------------------------------------

	/**
	 * 表从内核来。`setup.steps` 若带 `completed`／`state`，就是接着上次的建卡走
	 * （`bin/pi-coc setup --campaign <id>`）。
	 */
	async function loadSteps(): Promise<void> {
		const current = bridge;
		if (!current) {
			stepsError = "内核桥还没就位，建卡表拿不到。";
			return;
		}
		try {
			const campaign = asString(context.campaign);
			const result = asRecord(await current.call("setup.steps", campaign ? { campaign } : {}));
			const rows = normalizeSteps(result);
			if (rows.length === 0) {
				stepsError = "内核回的建卡表是空的，没有步可走。";
				return;
			}
			steps = rows;
			stepsError = undefined;
			for (const done of Array.isArray(result.completed) ? result.completed : []) {
				const id = asString(done);
				if (id) completed.add(id);
			}
			const carried = asRecord(result.state);
			for (const [key, value] of Object.entries(carried)) {
				if (context[key] === undefined) context[key] = value;
			}
			const carriedSource = asRecord(carried.source);
			sourceKind = asString(carried.source_kind) ?? asString(carriedSource.kind) ?? sourceKind;
		} catch (error) {
			stepsError = `setup.steps 没回来：${errorCode(error) ?? "internal"}: ${errorText(error)}`;
		}
	}

	async function ensureSteps(): Promise<void> {
		if (steps) return;
		loading ??= loadSteps().finally(() => {
			loading = undefined;
		});
		await loading;
	}

	// ---- 参数 -------------------------------------------------------------

	/** 模型可以把参数摊在顶层，也可以塞进 `params`；两种都收。 */
	function mergeArgs(raw: Record<string, unknown>): Record<string, unknown> {
		const { step: _step, params, ...rest } = raw;
		return { ...rest, ...asRecord(params) };
	}

	interface Filled {
		params: Record<string, unknown>;
		missing: string[];
	}

	/** 值的来源依次是：这次调用的参数、表里点名的 `from` 路径、已完成步骤留下的同名值。 */
	function fillParams(op: OpSpec, args: Record<string, unknown>, isFirst: boolean): Filled {
		const params: Record<string, unknown> = {};
		const missing: string[] = [];
		for (const spec of op.params) {
			const value =
				args[spec.name] ?? (spec.from ? lookupPath(context, spec.from) : undefined) ?? context[spec.name];
			if (value === undefined || value === null || value === "") {
				if (spec.required) missing.push(spec.name);
				continue;
			}
			params[spec.name] = value;
		}
		// 表只给了一份步骤级参数时，后面的 op 至少要拿到身份键，否则内核不知道说的是哪一本书。
		if (!isFirst && op.params.length === 0) {
			const moduleId = asString(context.module_id);
			if (moduleId) params.module_id = moduleId;
		}
		const campaign = asString(context.campaign);
		if (campaign && wantsCampaign(op.method) && params.campaign === undefined) params.campaign = campaign;
		return { params, missing };
	}

	/** 结果里的标量进上下文；对象只挑契约点过名的那几个身份键，别把整本图塞进参数槽。 */
	function noteResult(result: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(result)) {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				context[key] = value;
			}
		}
		const campaign = asRecord(result.campaign);
		const campaignId = asString(result.campaign_id) ?? asString(campaign.id) ?? asString(result.campaign);
		if (campaignId) context.campaign = campaignId;
		const moduleId = asString(result.module_id) ?? asString(asRecord(result.module).id);
		if (moduleId) context.module_id = moduleId;
	}

	// ---- 三种不是「调一次内核」的步 ----------------------------------------

	/** starter 名单：`kernel.hello` 的 content 与 `campaign.list` 已有的战役。 */
	async function sourceCatalogue(): Promise<Record<string, unknown>> {
		const modules = asRecord(asRecord(bridge?.hello).content).modules;
		const starters = Array.isArray(modules) ? modules.filter((row) => typeof row === "string") : [];
		let campaigns: unknown[] = [];
		try {
			const listed = asRecord(await bridge?.call("campaign.list", {}));
			campaigns = Array.isArray(listed.campaigns) ? listed.campaigns : [];
		} catch {
			/* 列不出来不挡选书 */
		}
		return { starters, campaigns, kinds: sourceKinds(steps ?? []) };
	}

	/**
	 * 选来源（表里的 `ask` 步）：玩家要么点一个 starter，要么给一个资料包目录。
	 * 来源种类的词表从表来（`applies_to`），不在这里另立一套。
	 */
	async function runAsk(step: Step, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		const catalogue = await sourceCatalogue();
		const kinds = catalogue.kinds as string[];
		const module = asString(args.module) ?? asString(args.module_id) ?? asString(args.starter);
		const bundle = asString(args.bundle) ?? asString(args.bundle_path);
		let kind = asString(args.kind) ?? asString(args.source_kind);
		if (!kind) {
			// 没点名种类时从表推，不认死「pdf」这个字：表里带 `external` 步的那种来源
			// 就是要先产出东西的那种（资料包），另一种是拿现成的（starter）。
			const needsProducing = new Set(
				kinds.filter((row) => (steps ?? []).some((step) => step.kind === "external" && (step.appliesTo ?? []).includes(row))),
			);
			if (module) kind = kinds.find((row) => !needsProducing.has(row)) ?? kinds[0];
			else if (bundle) kind = kinds.find((row) => needsProducing.has(row)) ?? kinds[0];
		}
		if (!kind) {
			return {
				ok: false,
				step: step.id,
				needs: ["kind"],
				hint: `先跟玩家定来源：内置的 starter，还是一本 PDF 转出来的资料包。表里的来源种类是 ${kinds.join("、") || "starter、pdf"}。`,
				...catalogue,
			};
		}
		if (kinds.length > 0 && !kinds.includes(kind)) {
			return {
				ok: false,
				step: step.id,
				rejected: `建卡表里的来源种类只有 ${kinds.join("、")}，没有「${kind}」。`,
				...catalogue,
			};
		}
		const starters = catalogue.starters as string[];
		if (module) {
			if (starters.length > 0 && !starters.includes(module)) {
				return {
					ok: false,
					step: step.id,
					rejected: `内容目录里没有 starter「${module}」。`,
					candidates: starters,
					...catalogue,
				};
			}
			return { ok: true, source: { kind, module_id: module }, ...catalogue };
		}
		if (bundle) return { ok: true, source: { kind, bundle }, ...catalogue };
		return {
			ok: false,
			step: step.id,
			needs: [module === undefined && bundle === undefined ? "module 或 bundle" : "module"],
			hint: "starter 写 module（名单在 starters 里），资料包写 bundle（目录路径）。",
			...catalogue,
		};
	}

	/** 东西到位了没有：目录要有 `manifest.json`（资料包的形状，契约 §14.2），别的路径存在即可。 */
	function ready(path: string): boolean {
		try {
			if (!existsSync(path)) return false;
			return statSync(path).isDirectory() ? existsSync(join(path, "manifest.json")) : true;
		} catch {
			return false;
		}
	}

	/**
	 * 等宿主的技能产出东西（表里的 `external` 步）。本仓库不解析 PDF（契约 §14.2）：
	 * 资料包由宿主自己的 PDF 技能产出，这里只看它在不在，不在就把该怎么产出讲清楚，等下次再看。
	 */
	function runExternal(step: Step, args: Record<string, unknown>): Record<string, unknown> {
		const values: Record<string, string> = {};
		const missing: string[] = [];
		for (const spec of step.params) {
			const value = asString(args[spec.name]) ?? asString(spec.from ? lookupPath(context, spec.from) : undefined) ?? asString(context[spec.name]);
			if (!value) {
				if (spec.required) missing.push(spec.name);
				continue;
			}
			values[spec.name] = value;
		}
		if (missing.length > 0) {
			return { ok: false, step: step.id, needs: missing, hint: instructionFor(step) };
		}
		for (const [name, value] of Object.entries(values)) {
			// 看着像路径的才当路径查：别把 play_language 这种也拿去 stat。
			const looksLikePath = value.includes("/") || existsSync(value);
			if (!looksLikePath) continue;
			if (ready(value)) continue;
			return {
				ok: false,
				step: step.id,
				waiting_on: name,
				path: value,
				hint:
					`${value} 还不是一个资料包。资料包由宿主的 PDF 技能产出，本仓库不解析 PDF（契约 §14.2）：` +
					`让宿主把那本 PDF 读成 <目录>/manifest.json（契约 coc.pdf-bundle.v1）与 <目录>/pages/NNNN.md 每页一份 Markdown，` +
					`产出好了再调一次同一步。`,
			};
		}
		return { ok: true, ...values };
	}

	/**
	 * 构建那一步：循环在 module 扩展里（契约 §14.5，`module.build` 不是内核方法）。
	 * 这里发起并等 `opening_ready`；等到点了就回「还在读」，玩家可以再调一次接着等。
	 */
	async function runModuleBuild(params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const moduleId = asString(params.module_id) ?? asString(context.module_id);
		if (!moduleId) return { ok: false, needs: ["module_id"], hint: "先绑定资料包，构建才知道读哪一本。" };
		const campaign = asString(context.campaign);
		try {
			const status = asRecord(await bridge?.call("module.status", { module_id: moduleId }));
			if (status.opening_ready === true) return { ok: true, opening_ready: true, status };
		} catch {
			/* 状态查不到就照常起构建 */
		}

		// 总线的 `on` 回的是退订闭包（Pi 没有 `off`），三条订阅与定时器一起收。
		return await new Promise<Record<string, unknown>>((resolve) => {
			const disposers: Array<() => void> = [];
			const done = (payload: Record<string, unknown>) => {
				clearTimeout(timer);
				for (const dispose of disposers.splice(0)) dispose();
				resolve(payload);
			};
			const timer = setTimeout(
				() =>
					done({
						ok: false,
						opening_ready: false,
						still_building: true,
						hint: "还在读这本书。告诉玩家在等什么，过一会儿再调一次同一步接着等。",
					}),
				BUILD_WAIT_MS,
			);
			timer.unref?.();
			disposers.push(
				pi.events.on("coc:module-opening-ready", (data) => done({ ok: true, opening_ready: true, ...asRecord(data) })),
				pi.events.on("coc:module-build-failed", (data) =>
					done({ ok: false, opening_ready: false, failed: true, ...asRecord(data) }),
				),
				pi.events.on("coc:module-build-done", (data) => {
					// 整本读完了还没就绪：那是这本书的问题，报出去，别在这里干等。
					const payload = asRecord(data);
					if (asRecord(payload.report).opening_ready === true) return;
					done({ ok: false, opening_ready: false, ...payload });
				}),
			);
			pi.events.emit("coc:module-build", { module_id: moduleId, ...(campaign ? { campaign } : {}) });
		});
	}

	// ---- 一步 -------------------------------------------------------------

	/** 按表把这一步的 op 依次跑掉；缺参数就停在那儿，把已经拿到的结果交给模型去补。 */
	async function runOps(step: Step, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		const current = bridge;
		if (!current) return { ok: false, step: step.id, rejected: "内核桥不在，这一步做不了。" };
		const results: Record<string, unknown> = {};
		for (const [index, op] of step.ops.entries()) {
			const cacheKey = `${step.id} ${op.method}`;
			if (opCache.has(cacheKey)) {
				results[op.method] = opCache.get(cacheKey);
				continue;
			}
			const filled = fillParams(op, args, index === 0);
			if (filled.missing.length > 0) {
				return {
					ok: false,
					step: step.id,
					blocked_on: op.method,
					needs: filled.missing,
					results,
					hint:
						`${op.method} 还缺 ${filled.missing.join("、")}。` +
						`上面的 results 里有这一步已经查回来的东西（比如职业清单），从里面挑，或者问玩家。`,
				};
			}
			try {
				const result =
					op.method === "module.build"
						? await runModuleBuild(filled.params)
						: asRecord(await current.call(op.method, filled.params));
				if (result.ok === false) return { ...result, step: step.id, results };
				results[op.method] = result;
				opCache.set(cacheKey, result);
				noteResult(result);
			} catch (error) {
				return {
					ok: false,
					step: step.id,
					failed_on: op.method,
					code: errorCode(error) ?? "internal",
					message: errorText(error),
					results,
				};
			}
		}
		return { ok: true, ...results };
	}

	/** 一步做完：记账、更新来源、看看是不是最后一步。 */
	function settle(step: Step, outcome: Record<string, unknown>): void {
		completed.add(step.id);
		opCache.clear();
		const source = asRecord(outcome.source);
		if (Object.keys(source).length > 0) {
			context.source = source;
			sourceKind = asString(source.kind) ?? sourceKind;
			if (asString(source.module_id)) context.module = asString(source.module_id);
			if (asString(source.module_id)) context.module_id = asString(source.module_id);
			if (asString(source.bundle)) context.bundle = asString(source.bundle);
		}
		for (const [key, value] of Object.entries(outcome)) {
			if (key === "ok" || key === "step") continue;
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				context[key] = value;
			} else {
				noteResult(asRecord(value));
			}
		}
		paint();
	}

	async function execute(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
		await ensureSteps();
		if (!steps) {
			return { ok: false, error: stepsError ?? "建卡表还没到手。" };
		}
		const id = asString(raw.step);
		if (!id) {
			const next = nextStep(steps, state());
			return {
				ok: false,
				error: "要给 step：这一次做哪一步。",
				next: instructionFor(next),
				allowed: allowedSteps(steps, state()).map((row) => row.id),
			};
		}
		const verdict = gate(steps, state(), id);
		if (!verdict.ok) {
			return { ok: false, step: id, rejected: verdict.reason, allowed: allowedSteps(steps, state()).map((row) => row.id) };
		}
		const step = verdict.step;
		const args = mergeArgs(raw);
		const outcome =
			step.kind === "ask"
				? await runAsk(step, args)
				: step.kind === "external"
					? runExternal(step, args)
					: await runOps(step, args);

		if (outcome.ok !== true) {
			// 没做成的步不记账：同一步可以照着 hint 补参数再来一次。
			return { ...outcome, step: id, progress: progressLine(steps, state()) };
		}
		settle(step, outcome);
		const next = nextStep(steps, state());
		if (!next) finish();
		return {
			...outcome,
			step: id,
			completed: [...completed],
			progress: progressLine(steps, state()),
			next: instructionFor(next),
			...(handoff ? { handoff_command: handoff } : {}),
		};
	}

	/** 表里没有下一步了：把开桌命令交出去，等这一轮说完就退出进程（契约 §14.4 第七步）。 */
	function finish(): void {
		const campaign = asString(context.campaign);
		handoff = campaign ? `bin/pi-coc --campaign ${campaign}` : "bin/pi-coc";
		const line = `建卡完成。开桌：${handoff}`;
		try {
			pi.appendEntry("coc-setup-handoff", { campaign: campaign ?? null, command: handoff });
			if (ctx?.hasUI) ctx.ui.notify(line, "info");
		} catch {
			/* 交接的字打不出来也不该卡住退出 */
		}
	}

	// ---- 工具 -------------------------------------------------------------

	pi.registerTool({
		name: "setup",
		label: "建卡",
		description:
			"从零到开桌的唯一动作。`step` 写这一次要做哪一步，其余参数按上一次结果里 next 说的填" +
			"（也可以整包塞进 `params`）。步骤表、顺序、前置、每步要什么参数都由内核说了算：" +
			"第一次调用不知道写什么就随便给一个 step（比如 start），结果会把表里的第一步告诉你。" +
			"每次返回都带 next（下一步与它要的参数）、progress（进度）；做不成时带 rejected 或 needs，" +
			"照它说的改，不要原样重发。",
		promptSnippet: "建卡的唯一工具：走内核给的七步表，一次一步。",
		parameters: Type.Object(
			{
				step: Type.String({ description: "这一次做哪一步；步骤名来自内核的建卡表，上一次结果的 next 里有" }),
				params: Type.Optional(
					Type.Object({}, { additionalProperties: true, description: "这一步要的参数，也可以直接摊在顶层" }),
				),
			},
			{ additionalProperties: true },
		),
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const result = await execute(asRecord(params));
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});

	// ---- 生命周期 ---------------------------------------------------------

	// 内核扩展在 session_start 里发桥；这里在加载时就订阅，两种加载顺序都接得住。
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = asRecord(data) as { call?: KernelCall; hello?: Record<string, unknown>; campaign?: string };
		bridge = typeof payload.call === "function" ? { call: payload.call, ...(payload.hello ? { hello: asRecord(payload.hello) } : {}) } : undefined;
		if (payload.campaign && context.campaign === undefined) context.campaign = payload.campaign;
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		steps = undefined;
		completed.clear();
		opCache.clear();
		sourceKind = undefined;
		handoff = undefined;
		const campaign = process.env.PI_COC_CAMPAIGN?.trim();
		if (campaign) context.campaign = campaign;
		// 建卡进程的工具面就这一个（契约 §14.4）。
		pi.setActiveTools(["setup"]);
		// 内核扩展先加载时桥已经在了，这一步就把表拿到手；它排在后面时留给第一次工具调用去拿。
		if (bridge) await ensureSteps();
		paint();
		if (ctx.hasUI && steps) {
			ctx.ui.notify(`建卡：一共 ${steps.length} 步。${instructionFor(nextStep(steps, state()))}`, "info");
		}
	});

	// 最后一步做完之后，等这一轮把交接的话说完再退出（契约 §14.4：进程退出并打印开桌命令）。
	pi.on("agent_end", async () => {
		if (!handoff) return;
		const command = handoff;
		handoff = undefined;
		try {
			ctx?.shutdown();
			pi.appendEntry("coc-setup-exit", { command });
		} catch {
			/* 退不出去也别抛：命令已经打出去了 */
		}
	});

	pi.on("session_shutdown", async () => {
		ctx = undefined;
		bridge = undefined;
	});
}
