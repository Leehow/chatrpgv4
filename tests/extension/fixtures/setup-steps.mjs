#!/usr/bin/env node
/**
 * 七步表（契约 §14.4 的那张表）。它本来住在内核的 `content/setup/steps.json` 里，
 * 由内核经 `setup.steps` 交给建卡进程；假内核回的就是这一份，测试也从这一份生成用例——
 * 「顺序信息只写一次」这条法则在测试里也照办：断言不抄步骤名与前置，都从这里读。
 *
 * 抄的是形状不是文字：`needs` 可以是数组，也可以按来源分岔；`applies_to` 说这一步只在
 * 哪种来源里出现；一步可以有两次调用（`bind-source` 是 `module.bind` 再 `module.plan`）。
 */

export const SETUP_STEPS = [
	{
		id: "choose-source",
		kind: "ask",
		needs: [],
		params: ["kind?", "module?", "bundle?"],
		receipt: "source",
		label: "选来源",
		instruction: "问玩家玩哪一本：内置 starter（名单在 starters 里）或者一个 PDF 资料包目录。",
	},
	{
		id: "build-bundle",
		kind: "external",
		applies_to: ["pdf"],
		needs: { pdf: ["choose-source"] },
		params: [{ name: "bundle", from: "source.bundle" }],
		receipt: "bundle_path",
		label: "产出资料包",
	},
	{
		id: "create-campaign",
		kind: "op",
		needs: ["choose-source"],
		op: "campaign.create",
		params: [{ name: "module", from: "source.module_id", required: false }, "title?", "play_language", "register?"],
		receipt: "campaign_id",
		label: "建战役",
	},
	{
		id: "bind-source",
		kind: "op",
		applies_to: ["pdf"],
		needs: { pdf: ["build-bundle", "create-campaign"] },
		ops: [
			{ method: "module.bind", params: [{ name: "bundle", from: "source.bundle" }, "module_id?"] },
			{ method: "module.plan", params: ["module_id"] },
		],
		receipt: "module_id",
		label: "绑定资料包",
	},
	{
		id: "build-opening",
		kind: "op",
		applies_to: ["pdf"],
		needs: { pdf: ["bind-source"] },
		op: "module.build",
		params: ["module_id"],
		receipt: "opening_ready",
		label: "读开场",
	},
	{
		id: "create-investigator",
		kind: "op",
		needs: { starter: ["create-campaign"], pdf: ["build-opening"] },
		ops: [
			{ method: "setup.occupations", params: [] },
			{ method: "setup.investigator", params: ["name", "occupation", "concept?", "age?", "sex?", "method?"] },
		],
		receipt: "investigator_id",
		label: "建调查员",
	},
	{
		id: "complete",
		kind: "op",
		needs: ["create-investigator"],
		op: "setup.complete",
		params: [],
		receipt: "handoff",
		label: "交桌",
	},
];
