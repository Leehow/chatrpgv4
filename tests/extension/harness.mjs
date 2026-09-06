/**
 * 扩展接缝的测试台：真的 Pi 会话 + 脚本化的假模型 + 假内核。
 * 走的是产品路径（DefaultResourceLoader 加载 extensions/kernel 与 extensions/table），
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

/** 假的 ctx.ui：hasUI 由「有没有 uiContext」决定，所以给了它就等于有界面。 */
export function createFakeUI({ selections = [] } = {}) {
	const notifications = [];
	const prompts = [];
	const queue = [...selections];
	const noop = () => undefined;
	const context = {
		select: async (title, options) => {
			prompts.push({ kind: "select", title, options });
			const next = queue.shift();
			if (next === undefined) return undefined;
			return typeof next === "number" ? options[next] : next;
		},
		confirm: async () => true,
		input: async () => undefined,
		notify: (message, type) => notifications.push({ message, type }),
		onTerminalInput: () => noop,
		setStatus: noop,
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
	return { context, notifications, prompts };
}

/**
 * 起一张桌子。
 *
 * @param {object} options
 * @param {import("@earendil-works/pi-ai").AssistantMessage[]} options.responses 假模型按顺序吐的回答
 * @param {string|null} [options.campaign] PI_COC_CAMPAIGN，传 null 表示不设（走 campaign.list 选择）
 * @param {Record<string,string>} [options.env] 追加给假内核与扩展的环境变量
 * @param {object|null} [options.ui] createFakeUI() 的结果；传 null 表示没有界面
 */
export async function openTable({ responses = [], campaign = "test-camp", env = {}, ui = createFakeUI() } = {}) {
	const workspace = mkdtempSync(join(tmpdir(), "pi-coc-ext-"));
	const requestLog = join(workspace, "kernel-requests.jsonl");
	const restoreEnv = setEnv({
		PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, FAKE_KERNEL]),
		PI_COC_CAMPAIGN: campaign ?? undefined,
		FAKE_KERNEL_LOG: requestLog,
		PI_OFFLINE: "1",
		...env,
	});

	const faux = fauxProvider();
	faux.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(workspace, "models-store.json"),
		refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const model = faux.getModel();

	let api;
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: join(workspace, "agent"),
		settingsManager,
		additionalExtensionPaths: [join(REPO, "extensions", "kernel"), join(REPO, "extensions", "table")],
		extensionFactories: [
			{
				name: "probe",
				factory: (pi) => {
					api = pi;
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
		sessionManager: SessionManager.inMemory(),
		settingsManager,
	});

	// session_start（也就是开桌）是 bindExtensions 发出来的，运行模式各自负责。
	const extensionErrors = [...created.extensionsResult.errors];
	await created.session.bindExtensions({
		mode: "print",
		...(ui ? { uiContext: ui.context } : {}),
		onError: (error) => extensionErrors.push({ path: error.extensionPath, error: error.error }),
	});

	const table = {
		workspace,
		session: created.session,
		extensionsResult: created.extensionsResult,
		faux,
		ui,
		/** 扩展加载与事件里出的错，测试里当断言用。 */
		extensionErrors,
		activeTools: () => api?.getActiveTools() ?? [],
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
			rmSync(workspace, { recursive: true, force: true });
		},
	};
	return table;
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
