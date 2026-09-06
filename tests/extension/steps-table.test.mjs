/**
 * 内核的真表（content/setup/steps.json）必须能被建卡扩展的闸门读懂：
 * 顺序信息只写一次，所以这里断言的是「按表算出来的允许步」，不抄步骤名。
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { allowedSteps, declaredSources, missingNeeds, normalizeSteps, sourceKinds } from "../../extensions/onboarding/steps.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(readFileSync(join(HERE, "..", "..", "content", "setup", "steps.json"), "utf8"));

test("真表：starter 车道建完战役就能建调查员，pdf 车道要先读开场", () => {
	const steps = normalizeSteps(TABLE.steps);
	assert.equal(steps.length, TABLE.steps.length);
	const byId = new Map(steps.map((s) => [s.id, s]));
	const investigator = byId.get("create-investigator");
	assert.ok(investigator);

	const starter = { completed: new Set(["choose-source", "create-campaign"]), sourceKind: "starter" };
	assert.deepEqual(missingNeeds(investigator, starter, steps), [], "build-opening 在 starter 车道不出现，视为已满足");
	assert.ok(allowedSteps(steps, starter).some((s) => s.id === "create-investigator"));
	assert.ok(!allowedSteps(steps, starter).some((s) => s.id === "build-opening"), "only_for: pdf 的步不进 starter 车道");

	const pdf = { completed: new Set(["choose-source", "create-campaign"]), sourceKind: "pdf" };
	assert.deepEqual(missingNeeds(investigator, pdf, steps), ["build-opening"]);
	assert.ok(allowedSteps(steps, pdf).some((s) => s.id === "build-bundle"));
});

test("真表：来源词表取自表自己声明的 sources，不从步骤反推（#32）", () => {
	const steps = normalizeSteps(TABLE.steps);
	const declared = declaredSources(TABLE);
	assert.deepEqual(declared, TABLE.sources, "表声明什么就是什么");
	assert.ok(declared.includes("starter") && declared.includes("module") && declared.includes("pdf"));

	// 反推只看得见 only_for，而只有 pdf 专属的步骤带这个键：starter 与 module 会整个消失，
	// 于是「选了 starter」被判成 pdf，玩家被要求去找一份他没有的资料包。
	const inferred = sourceKinds(steps);
	assert.ok(!inferred.includes("starter"), "反推确实丢了 starter，这就是 #32 的根因");
	assert.deepEqual(sourceKinds(steps, declared), TABLE.sources, "给了声明就用声明");
	assert.deepEqual(sourceKinds(steps, []), inferred, "没有声明才退回反推");
});

test("真表：参数的必选与可省从表读，不靠猜", () => {
	const steps = normalizeSteps(TABLE.steps);
	const create = steps.find((s) => s.id === "create-campaign");
	const params = create.ops[0].params;
	const required = new Set(params.filter((p) => p.required).map((p) => p.name));
	assert.ok(required.has("id") && required.has("module"));
	assert.ok(!required.has("title") && !required.has("register"), "title/register 在表里标了可省");
});
