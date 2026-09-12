/**
 * DeepSeek Extended provider 扩展（契约 §23 的第七个扩展，从 PipiUI 上游移植）。
 *
 * 只验行为，不起真会话：注册了什么、hosted `web_search` 按什么注入、别的 provider
 * 为什么原样放行、清单与代码里的模型目录是不是同一份。真会话加载（`DefaultResourceLoader`
 * 走 `pi.extensions` 那条路）与 App 侧通用注册器分别由 `deepseek-port` 的集成验证与
 * `Electron/packages/pi-backend/test/deepseek-provider-contract.test.ts` 守着。
 */

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	buildResponsesBody,
	DEEPSEEK_WEB_SEARCH_BUILTIN,
	mergeHostedWebSearchTool,
	responsesUrl,
} from "../../extensions/deepseek/agent/client.js";
import { resolveDeepSeekApiKey } from "../../extensions/deepseek/agent/conversation.js";
import agent from "../../extensions/deepseek/agent/index.js";
import {
	DEEPSEEK_CONVERSATION_MODELS,
	DEEPSEEK_PROVIDER_ID,
	modelSupportsHostedWebSearch,
} from "../../extensions/deepseek/agent/models.js";
import { createDeepSeekProvider } from "../../extensions/deepseek/agent/provider.js";

// 目录缓存的位置由扩展自身的安装根推导；测试固定指向一个不存在的路径，
// 断言的才是随包发布的兜底目录，而不是某台机器上刷新出来的缓存。
process.env.PIPIUI_DEEPSEEK_CATALOG_CACHE = join(dirname(fileURLToPath(import.meta.url)), "no-such-catalog-cache.json");

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
	readFileSync(join(REPO, "extensions", "deepseek", "pipiui-extension.json"), "utf8"),
);

/** 用假的 `pi` 挂一次扩展，拿回注册结果与钩子。 */
function mount() {
	const providers = new Map();
	const hooks = [];
	agent({
		registerProvider: (id, config) => providers.set(id, config),
		on: (event, handler) => hooks.push({ event, handler }),
	});
	return {
		providers,
		hook: hooks.find((item) => item.event === "before_provider_request"),
	};
}

function clientWebSearchTool() {
	return { type: "function", name: "web_search", description: "local search", parameters: { type: "object" } };
}

function browserSearchTool(name) {
	return { type: "function", name, description: "local browser route", parameters: { type: "object" } };
}

function nestedFunctionTool(name) {
	return { type: "function", function: { name, parameters: { type: "object" } } };
}

function responsesBodyWithTools() {
	return buildResponsesBody({
		model: "deepseek-v4-flash",
		input: [{ role: "user", content: "search for it" }],
		extra: {
			tools: [
				{ type: "function", function: { name: "bash", parameters: { type: "object" } } },
				clientWebSearchTool(),
				{ type: "function", function: { name: "read", parameters: { type: "object" } } },
			],
		},
	});
}

function toolSummaries(tools) {
	return tools.map((tool) =>
		tool.type === "function" ? `function:${tool.name ?? tool.function?.name}` : String(tool.type),
	);
}

function functionNameOf(tool) {
	if (tool.type !== "function") return null;
	if (typeof tool.name === "string") return tool.name;
	return typeof tool.function?.name === "string" ? tool.function.name : null;
}

test("扩展注册 deepseek-extended 并挂上 before_provider_request", () => {
	const { providers, hook } = mount();
	assert.deepEqual([...providers.keys()], ["deepseek-extended"]);
	assert.equal(DEEPSEEK_PROVIDER_ID, "deepseek-extended");
	const registered = providers.get(DEEPSEEK_PROVIDER_ID);
	assert.equal(registered.name, "DeepSeek Extended");
	assert.equal(registered.api, "openai-responses");
	assert.deepEqual(
		registered.models.map((model) => model.id),
		["deepseek-flash", "deepseek-v4-pro"],
	);
	assert.ok(hook, "before_provider_request 钩子必须挂上");
});

test("每个模型都声明 hosted web_search，且只声明它", () => {
	const { providers } = mount();
	for (const model of providers.get(DEEPSEEK_PROVIDER_ID).models) {
		assert.deepEqual(model.capabilities?.hostedTools?.tools, ["web_search"]);
		assert.deepEqual(model.capabilities?.nativeSearch?.tools, ["web_search"]);
		assert.equal(model.capabilities?.structuredOutputs, true);
	}
});

test("清单与代码里的模型目录是同一份", () => {
	const provider = MANIFEST.auth.provider;
	assert.equal(provider.id, "deepseek-extended");
	assert.equal(provider.api, "openai-responses");
	assert.deepEqual(
		provider.models.map((model) => model.id),
		DEEPSEEK_CONVERSATION_MODELS.map((model) => model.id),
	);
	assert.ok(provider.models.every((model) => model.capabilities?.hostedTools?.tools?.includes("web_search")));
	assert.equal(MANIFEST.defaultEnabled, true, "app-origin 扩展缺省是关的，必须显式打开");
});

test("思考档位贴官方集合：low/high/max 开放，minimal/medium 隐藏", () => {
	// 官方（api-docs.deepseek.com/guides/thinking_mode）：思考档是 low/high/max，
	// 服务端把 minimal→low、medium→high、xhigh→high、ultra→max 折叠。
	// low 是独立的一档（更便宜的推理），不许再被藏掉。
	const expected = { minimal: null, low: "low", medium: null, high: "high", max: "max" };
	for (const model of DEEPSEEK_CONVERSATION_MODELS) {
		assert.deepEqual(model.thinkingLevelMap, expected, model.id);
	}
	for (const model of MANIFEST.auth.provider.models) {
		assert.deepEqual(model.thinkingLevelMap, expected, model.id);
	}
});

test("hosted web_search 支持只按声明的模型能力判定", () => {
	assert.equal(responsesUrl("https://api.deepseek.com"), "https://api.deepseek.com/responses");
	// 退役别名 DeepSeek 仍然受理（转由 V4.1 Flash 服务、按 Flash 价计费），
	// 所以它们留在核定表里，被钉住旧 id 的会话不会掉回本地搜索工具。
	for (const id of ["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
		assert.equal(modelSupportsHostedWebSearch(id), true, id);
	}
	// 那个限期 beta 已经从官方文档消失，核定表里也不再有它。
	for (const id of ["deepseek-v4.1-flash-expires-on-0910", "deepseek-v4.1-flash", "deepseek-flash-preview", "deepseek-chat", "deepseek-reasoner", "totally-unknown", undefined, 42]) {
		assert.equal(modelSupportsHostedWebSearch(id), false, String(id));
	}
});

test("注入恰好一个内建 web_search，本地搜索函数工具全部去掉", () => {
	const body = responsesBodyWithTools();
	const next = mergeHostedWebSearchTool(body, true);
	assert.deepEqual(toolSummaries(next.tools), ["function:bash", "function:read", "web_search"]);
	assert.equal(next.tools.filter((tool) => tool.type === "web_search").length, 1);
	assert.deepEqual(next.tools.at(-1), { type: "web_search" });
	assert.deepEqual(DEEPSEEK_WEB_SEARCH_BUILTIN, { type: "web_search" });

	body.tools = [
		clientWebSearchTool(),
		nestedFunctionTool("web_search"),
		browserSearchTool("browser_search"),
		nestedFunctionTool("browser_fetch"),
		nestedFunctionTool("bash"),
		{ type: "function", name: "web_search_preview", parameters: { type: "object" } },
		// 同名但不是函数工具：必须活下来。
		{ type: "custom", name: "web_search" },
		{ type: "custom", name: "browser_search" },
	];
	const shaped = mergeHostedWebSearchTool(body, true);
	const names = shaped.tools.map(functionNameOf).filter((name) => name !== null);
	for (const local of ["web_search", "browser_search", "browser_fetch"]) {
		assert.equal(names.filter((name) => name === local).length, 0, local);
	}
	assert.ok(names.includes("bash"));
	assert.ok(names.includes("web_search_preview"));
	assert.ok(shaped.tools.some((tool) => tool.type === "custom" && tool.name === "web_search"));
	assert.equal(shaped.tools.filter((tool) => tool.type === "web_search").length, 1);
});

test("重复注入是幂等的，没有 tools 数组也能建出内建工具", () => {
	const once = mergeHostedWebSearchTool(responsesBodyWithTools(), true);
	const twice = mergeHostedWebSearchTool(once, true);
	assert.deepEqual(twice.tools, once.tools);
	assert.equal(twice.tools.filter((tool) => tool.type === "web_search").length, 1);

	const bare = mergeHostedWebSearchTool(buildResponsesBody({ model: "deepseek-v4-flash", input: [] }), true);
	assert.deepEqual(bare.tools, [{ type: "web_search" }]);
});

test("不支持的模型原样放行，不假装支持", () => {
	const body = responsesBodyWithTools();
	const untouched = mergeHostedWebSearchTool(body, false);
	assert.equal(untouched, body);
	assert.ok(toolSummaries(untouched.tools).includes("function:web_search"));
});

test("before_provider_request 只改写 deepseek-extended 的请求", async () => {
	const { hook } = mount();
	assert.ok(hook);

	for (const provider of ["openai", "deepseek"]) {
		const other = await hook.handler(
			{ type: "before_provider_request", payload: { messages: [{ role: "user", content: "x" }] } },
			{ model: { provider } },
		);
		assert.equal(other, undefined, `${provider} 不该被碰`);
	}

	const payload = {
		model: "deepseek-v4-flash",
		input: [{ role: "user", content: "hi" }],
		tools: [
			{ type: "function", function: { name: "bash", parameters: { type: "object" } } },
			clientWebSearchTool(),
			nestedFunctionTool("read"),
			{ type: "custom", name: "web_search" },
		],
	};
	const rewritten = await hook.handler(
		{ type: "before_provider_request", payload },
		{ model: { provider: "deepseek-extended", id: "deepseek-v4-flash" } },
	);
	const names = rewritten.tools.map(functionNameOf).filter((name) => name !== null);
	assert.ok(!names.includes("web_search"));
	assert.deepEqual(names, ["bash", "read"]);
	assert.equal(rewritten.tools.filter((tool) => tool.type === "web_search").length, 1);
	assert.ok(rewritten.tools.some((tool) => tool.type === "custom" && tool.name === "web_search"));

	// 目录外的模型：不注入、也不删。
	const unknown = await hook.handler(
		{ type: "before_provider_request", payload },
		{ model: { provider: "deepseek-extended", id: "unknown-future-model" } },
	);
	assert.deepEqual(unknown, payload);
	assert.ok(!unknown.tools.some((tool) => tool.type === "web_search"));
});

test("凭据链：设置兜底优先，缺 key 时是英文的可行动错误", () => {
	const previous = process.env.PIPIUI_EXT_SETTINGS_DEEPSEEK;
	try {
		process.env.PIPIUI_EXT_SETTINGS_DEEPSEEK = JSON.stringify({ "ext.deepseek.apiKey": "sk-settings" });
		assert.equal(resolveDeepSeekApiKey(), "sk-settings");
		assert.equal(resolveDeepSeekApiKey({ key: "sk-stored" }), "sk-stored");
		// 存了但解析不出来，设置里有就落到设置。
		assert.equal(resolveDeepSeekApiKey({}), "sk-settings");

		delete process.env.PIPIUI_EXT_SETTINGS_DEEPSEEK;
		assert.throws(() => resolveDeepSeekApiKey(), /DeepSeek API key/);
	} finally {
		if (previous === undefined) delete process.env.PIPIUI_EXT_SETTINGS_DEEPSEEK;
		else process.env.PIPIUI_EXT_SETTINGS_DEEPSEEK = previous;
	}
});

test("非 HTTPS 的 baseUrl 直接拒绝", () => {
	assert.throws(() => createDeepSeekProvider({ baseUrl: "http://api.deepseek.com" }), /HTTPS/);
});

test("移植过来的源码保持全英文", () => {
	// 这份包是从 PipiUI 上游 vendored 过来的，而上游的用户可见串是中文的。
	// 重新同步时整体覆盖会把翻译悄悄冲掉，而按具体文案写的断言（例如
	// /DeepSeek API key/）中英文都能匹配、拦不住。所以这里一次性守住全部文件。
	const root = join(REPO, "extensions", "deepseek", "agent");
	const offenders = [];
	for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
		const path = join(entry.parentPath ?? entry.path, entry.name);
		for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
			if (/[\u4e00-\u9fff]/.test(line)) {
				offenders.push(`${path.slice(root.length + 1)}:${index + 1}  ${line.trim().slice(0, 70)}`);
			}
		}
	}
	assert.deepEqual(offenders, [], `移植的源码里出现中文（多半是从上游整体覆盖导致的）：\n${offenders.join("\n")}`);
});
