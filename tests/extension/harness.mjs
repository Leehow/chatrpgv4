/**
 * 扩展接缝的测试台：真的 Pi 会话 + 脚本化的假模型 + 假内核。
 * 走的是产品路径（DefaultResourceLoader 加载 extensions/kernel、extensions/memory 与 extensions/table），
 * 不手搓扩展内部状态。
 *
 * Pi 0.85.1 在这里逼出来的三处将就，换 Pi 版本时先看这里：
 * 1. `createAgentSession()` 不发 `session_start`，那是运行模式在 `bindExtensions()` 里发的，
 *    所以开桌发生在 openTable 的 bindExtensions 之后，不是 createAgentSession 之后。
 * 2. `AgentSession.dispose()` 不发 `session_shutdown`（只有 AgentSessionRuntime 发），
 *    `emitSessionShutdownEvent` 又没从包根导出，只能借会话私有的 `_extensionRunner` 收尾；
 *    不收尾内核子进程会挂着，`node --test` 不退出。
 * 3. `pi.getActiveTools()` 只在扩展里够得着，所以挂一个 inline 探针扩展把 `pi` 取出来。
 *
 * 另外 Node 24 的 `node --test <目录>` 把目录当成测试文件，要用
 * `node --test "tests/extension/**\/*.test.mjs"`（即 npm run test:ext）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
export const FAKE_KERNEL = join(HERE, "fixtures", "fake-kernel.mjs");
/**
 * 真内核模式：在工作区里先建一张桌子。走的是内核自己的 RPC，不碰它的文件布局。
 */
export function createRealCampaign(workspace, campaign, { module = "the-haunting", pregen = "thomas-hayes" } = {}) {
	const request = JSON.stringify({
		id: "create",
		method: "campaign.create",
		params: { id: campaign, module, pregen, play_language: "zh-Hans", title: `${campaign} (extension seam)` },
	});
	const run = spawnSync(
		"uv",
		["run", "--frozen", "python", "-m", "coc.rpc", "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, env: { ...process.env, PYTHONPATH: join(REPO, "kernel") }, input: `${request}\n`, encoding: "utf8" },
	);
	const line = run.stdout.split("\n").find((row) => row.trim());
	const response = line ? JSON.parse(line) : null;
	if (!response?.ok) {
		throw new Error(`campaign.create failed: ${run.stderr}\n${line ?? ""}`);
	}
	return response.result;
}

function setEnv(values) {
	const previous = new Map();
	for (const [key, value] of Object.entries(values)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return () => {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

/**
 * 假的 ctx.ui：hasUI 由「有没有 uiContext」决定，所以给了它就等于有界面。
 * `selections` 是 `select` 依次的答案，`inputs` 是 `input` 依次的答案（问完就空，空了回 undefined
 * ——等于人按了取消）。
 */
export function createFakeUI({ selections = [], inputs = [] } = {}) {
	const notifications = [];
	const prompts = [];
	/** setStatus 的调用序列：{key, text}，text 为 undefined 表示摘掉那一行。 */
	const statuses = [];
	const queue = [...selections];
	const answers = [...inputs];
	const noop = () => undefined;
	const context = {
		select: async (title, options) => {
			prompts.push({ kind: "select", title, options });
			const next = queue.shift();
			if (next === undefined) return undefined;
			return typeof next === "number" ? options[next] : next;
		},
		confirm: async () => true,
		input: async (title, placeholder) => {
			prompts.push({ kind: "input", title, placeholder });
			return answers.shift();
		},
		notify: (message, type) => notifications.push({ message, type }),
		onTerminalInput: () => noop,
		setStatus: (key, text) => statuses.push({ key, text }),
		setWorkingMessage: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		setHiddenThinkingLabel: noop,
		setWidget: noop,
		setFooter: noop,
		setHeader: noop,
		setTitle: noop,
		custom: async () => undefined,
		pasteToEditor: noop,
		setEditorText: noop,
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: noop,
		setEditor: noop,
	};
	return { context, notifications, prompts, statuses };
}

/**
 * 起一张桌子。
 *
 * @param {object} options
 * @param {import("@earendil-works/pi-ai").AssistantMessage[]} options.responses 假模型按顺序吐的回答
 * @param {string|null} [options.campaign] PI_COC_CAMPAIGN，传 null 表示不设（走 campaign.list 选择）
 * @param {Record<string,string>} [options.env] 追加给假内核与扩展的环境变量
 * @param {object|null} [options.ui] createFakeUI() 的结果；传 null 表示没有界面
 * @param {boolean} [options.realKernel] 用真的 Python 内核而不是假内核；会先在工作区里 campaign.create
 * @param {"play"|"setup"} [options.mode] PI_COC_MODE：建卡进程用 setup（契约 §14.4）
 * @param {{memory?: any[], verifier?: any[]}} [options.laneResponses] 两条车道的假模型在开桌**之前**就装好的回答；
 *   记忆车道的补抽（#20）在 `session_start` 就起跑，来不及等测试体里再 setResponses
 * @param {"tui"|"rpc"|"json"|"print"} [options.uiMode] `bindExtensions` 的运行模式，也就是 `ctx.mode`。
 *   缺省 `print`；`/coc` 命令（契约 §19.1）只在 `tui` 下工作，验降级的用例保持缺省即可
 * @param {object} [options.settings] 合并进 `SettingsManager.inMemory` 的设置。压缩相关的用例要调
 *   `compaction`（缺省整个关掉，回合才确定）
 */
export async function openTable({
	responses = [],
	campaign = "test-camp",
	env = {},
	ui = createFakeUI(),
	realKernel = false,
	mode = "play",
	laneResponses = {},
	uiMode = "print",
	settings = {},
} = {}) {
	const workspace = mkdtempSync(join(tmpdir(), "pi-coc-ext-"));
	const requestLog = join(workspace, "kernel-requests.jsonl");
	const restoreEnv = setEnv({
		PI_COC_KERNEL_CMD: realKernel ? undefined : JSON.stringify([process.execPath, FAKE_KERNEL]),
		PI_COC_CAMPAIGN: campaign ?? undefined,
		PI_COC_MODE: mode,
		FAKE_KERNEL_LOG: requestLog,
		PI_OFFLINE: "1",
		// 两条车道各有一个专属的假 provider，各有各的回答队列：
		// 不这么分的话车道会从守秘人的队列里抢答案，回合就不确定了。
		// 想验「缺省与桌子同模型」的用例把这两个变量显式删掉即可。
		PI_COC_VERIFIER_MODEL: "verifier/v1",
		PI_COC_MEMORY_MODEL: "memory/m1",
		...env,
	});

	if (realKernel) createRealCampaign(workspace, campaign);

	const faux = fauxProvider();
	faux.setResponses(responses);
	const verifierFaux = fauxProvider({ provider: "verifier", models: [{ id: "v1" }] });
	const memoryFaux = fauxProvider({ provider: "memory", models: [{ id: "m1" }] });
	// 开桌之前就装好：补抽（#20）在 session_start 里就要模型，晚一步就抓空。
	if (laneResponses.memory) memoryFaux.setResponses(laneResponses.memory);
	if (laneResponses.verifier) verifierFaux.setResponses(laneResponses.verifier);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(workspace, "models-store.json"),
		refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	modelRuntime.registerNativeProvider(verifierFaux.provider);
	modelRuntime.registerNativeProvider(memoryFaux.provider);
	const model = faux.getModel();

	let api;
	/** 总线上的提交载荷（契约 §12.8）：探针扩展在加载时就订阅，早于任何 session_start。 */
	const committed = [];
	/** 总线上的机制投影（契约 §16.2 的 `coc:mechanics`），按到达顺序。 */
	const mechanics = [];
	/** 模组构建那几条总线事件，按到达顺序：{channel, data}。 */
	const bus = [];
	const runtimeBridges = [];
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
		...settings,
	});
	// 会话条目由 sessionManager 保管：测试从这里读 `coc-mechanics`（契约 §16.2）。
	const sessionManager = SessionManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: join(workspace, "agent"),
		settingsManager,
		additionalExtensionPaths: [
			join(REPO, "extensions", "kernel"),
			join(REPO, "extensions", "onboarding"),
			join(REPO, "extensions", "module"),
			join(REPO, "extensions", "memory"),
			join(REPO, "extensions", "table"),
		],
		extensionFactories: [
			{
				name: "probe",
				factory: (pi) => {
					api = pi;
					pi.events.on("coc:turn-committed", (data) => committed.push(data));
					pi.events.on("coc:mechanics", (data) => mechanics.push(data));
					pi.events.on("coc:kernel-bridge", (data) => runtimeBridges.push(data));
					// 模组车道的总线（契约 §14.5）：构建起没起、开场就绪没有，测试从这里看。
					for (const channel of [
						// PDF 摄入那四条（契约 §20.2）。
						"coc:module-ingest",
						"coc:module-ingest-progress",
						"coc:module-ingest-done",
						"coc:module-ingest-failed",
					]) {
						pi.events.on(channel, (data) => bus.push({ channel, data }));
					}
				},
			},
		],
	});
	await resourceLoader.reload();

	const created = await createAgentSession({
		cwd: workspace,
		agentDir: join(workspace, "agent"),
		model,
		modelRuntime,
		thinkingLevel: "off",
		noTools: "builtin",
		resourceLoader,
		sessionManager,
		settingsManager,
	});

	// session_start（也就是开桌）是 bindExtensions 发出来的，运行模式各自负责。
	const extensionErrors = [...created.extensionsResult.errors];
	await created.session.bindExtensions({
		mode: uiMode,
		...(ui ? { uiContext: ui.context } : {}),
		onError: (error) => extensionErrors.push({ path: error.extensionPath, error: error.error }),
	});

	const table = {
		workspace,
		session: created.session,
		extensionsResult: created.extensionsResult,
		faux,
		/** 两条车道的假模型：各自 setResponses，跟守秘人的队列互不干扰。 */
		lanes: { verifier: verifierFaux, memory: memoryFaux },
		ui,
		/** 扩展加载与事件里出的错，测试里当断言用。 */
		extensionErrors,
		activeTools: () => api?.getActiveTools() ?? [],
		/** 总线上 `coc:turn-committed` 的载荷，按到达顺序。 */
		committed: () => [...committed],
		/** 总线上 `coc:mechanics` 的载荷（契约 §16.2），按到达顺序。 */
		mechanics: () => [...mechanics],
		/**
		 * 会话条目（`pi.appendEntry` 写的那种），按到达顺序。机制投影就是这么进
		 * Pi RPC 事件流的（`entry_appended`），驾驭器据此落证据。
		 */
		entries: (customType) =>
			sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && (!customType || entry.customType === customType))
				.map((entry) => entry.data),
		/**
		 * 会话的全部条目原样（`message`、`custom_message`、`custom`、`compaction`……）。
		 * 上下文折叠（契约 §19.2）验的是「按类型与回合距离丢对了没有」，只能看这一层。
		 */
		rawEntries: () => sessionManager.getEntries(),
		/** 模组车道的总线事件，按到达顺序。 */
		bus: (channel) => (channel ? bus.filter((row) => row.channel === channel) : [...bus]),
		runtimeBridges: () => [...runtimeBridges],
		/**
		 * 往总线上发一条（探针扩展借的是同一条 `pi.events`）。
		 * The probe shares the same bus as the reading and kernel extensions,
		 * so a transport test can replace a bridge without inventing another host.
		 */
		emit: (channel, data) => api?.events.emit(channel, data),
		/** 假内核收到的请求，按到达顺序。 */
		kernelRequests: () =>
			existsSync(requestLog)
				? readFileSync(requestLog, "utf8")
						.split("\n")
						.filter((line) => line.trim())
						.map((line) => JSON.parse(line))
				: [],
		telemetry: (campaignId = campaign) => {
			const path = join(workspace, ".coc", "campaigns", campaignId, "telemetry.jsonl");
			return existsSync(path)
				? readFileSync(path, "utf8")
						.split("\n")
						.filter((line) => line.trim())
						.map((line) => JSON.parse(line))
				: [];
		},
		async dispose() {
			// AgentSession.dispose() 不发 session_shutdown（只有 AgentSessionRuntime 发），
			// 而 emitSessionShutdownEvent 没从包根导出，所以这里直接借会话的 runner 收尾，
			// 否则内核子进程会一直挂着，node --test 不退出。
			const runner = created.session._extensionRunner;
			if (runner?.hasHandlers?.("session_shutdown")) {
				await runner.emit({ type: "session_shutdown", reason: "quit" });
			}
			created.session.dispose();
			restoreEnv();
			// 车道（记忆、校验、深读、构建）都是 fire-and-forget 的，关机那一刻可能还有一行
			// 遥测正往工作区里写：删目录撞上它就是 ENOTEMPTY。重试几次，别把它算成用例失败。
			rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
		},
	};
	return table;
}

/**
 * 等一个条件成立。车道是 fire-and-forget 的（契约 §12.5、§12.8：不阻塞交付），
 * 所以断言车道结果要等，不能在 prompt 返回的那一刻就看。
 */
export async function waitFor(predicate, { timeoutMs = 10_000, label = "条件" } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await predicate();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`等 ${label} 超时（${timeoutMs} 毫秒）`);
}

/** 等宿主自己发起的那一轮（开桌、恢复、催收）跑完。 */
export async function waitForIdle(session, { timeoutMs = 15_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	// 宿主消息是 fire-and-forget，先等它把流开起来。
	while (Date.now() < deadline && !session.isStreaming) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		if (session.messages.length > 0 && !session.isStreaming) break;
	}
	while (Date.now() < deadline && session.isStreaming) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	await new Promise((resolve) => setTimeout(resolve, 50));
}

export function assistantTexts(session) {
	return session.messages
		.filter((message) => message.role === "assistant")
		.map((message) =>
			(message.content ?? [])
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join(""),
		);
}

export function toolResultTexts(session) {
	return session.messages
		.filter((message) => message.role === "toolResult")
		.map((message) => JSON.stringify(message));
}

export function customMessages(session, customType) {
	return session.messages.filter(
		(message) => message.role === "custom" && (!customType || message.customType === customType),
	);
}
