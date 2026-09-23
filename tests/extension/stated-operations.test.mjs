/**
 * Contract §136.24 (RD-03): the Keeper's tools carry `action.rule`, `action.step` and `stated`, and the fake kernel
 * answers them the way the real one does (a `stated` result; `stated_conflict` beside an amount).
 *
 * The kernel behaviour itself is `tests/kernel/test_stated_operations.py`, over the emitted kernel. Here: the tool
 * schema offers the fields (a field only the kernel reads is one the Keeper can never send, §88.5), keeps the old
 * shapes valid, and the extension passes them through to the kernel untouched.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Check } from "typebox/value";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { openTable, toolResultTexts, waitForIdle } from "./harness.mjs";

const tool = name => COC_TOOLS.find(entry => entry.name === name);
const ACTION = {intent: "move", goal: "keep their footing", method: "careful steps"};

test("resolve offers rule and step, and apply's five amount kinds offer stated", () => {
    const resolve = tool("resolve").parameters, apply = tool("apply").parameters;
    assert.ok(Check(resolve, {action: {...ACTION, rule: "chapel-floor", step: 1}}));
    assert.equal(Check(resolve, {action: {...ACTION, rule: "chapel-floor", step: 0.5}}), false);
    for (const effect of [{kind: "damage", stated: "chapel-floor"}, {kind: "time", stated: "long-search"},
        {kind: "threat", stated: "corbitt-haunting"}, {kind: "flag", stated: "knott-haggle"},
        {kind: "cash", stated: "victory-reward", with: "Steven Knott"}])
        assert.ok(Check(apply, {effects: [effect]}), JSON.stringify(effect));
    // The Keeper's own amounts are exactly what they were.
    for (const effect of [{kind: "damage", dice: "1D6"}, {kind: "time", minutes: 30}, {kind: "threat", name: "corbitt-haunting"},
        {kind: "flag", name: "door-barred"}, {kind: "cash", delta: -5, source: "found"}])
        assert.ok(Check(apply, {effects: [effect]}), JSON.stringify(effect));
    assert.match(tool("resolve").parameters.properties.action.properties.rule.description, /applies none of them/);
});

test("the tools carry rule, step and stated to the kernel, and the kernel's answer reaches the Keeper", async (t) => {
    const table = await openTable({responses: [
        fauxAssistantMessage([fauxToolCall("resolve", {action: {...ACTION, rule: "chapel-floor", step: 1}})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("apply", {effects: [{kind: "damage", stated: "chapel-floor", dice: "2D6"}]})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("apply", {effects: [{kind: "damage", stated: "chapel-floor"}]})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("narrate", {text: "The boards give."})], {stopReason: "toolUse"}),
        fauxAssistantMessage("done"),
    ], env: {FAKE_KERNEL_CHECK_FAILS: "1"}});
    t.after(() => table.dispose());
    await waitForIdle(table.session);
    await table.session.prompt("I cross the chapel floor.");
    const sent = table.kernelRequests().filter(request => ["table.resolve", "table.apply"].includes(request.method));
    assert.deepEqual(sent.map(request => request.method), ["table.resolve", "table.apply", "table.apply"]);
    assert.equal(sent[0].params.action.rule, "chapel-floor");
    assert.equal(sent[0].params.action.step, 1);
    assert.deepEqual(sent[2].params.effects, [{kind: "damage", stated: "chapel-floor"}]);
    const texts = toolResultTexts(table.session).join("\n");
    assert.match(texts, /"stated"/);
    assert.match(texts, /stated_conflict|give one/);
});
