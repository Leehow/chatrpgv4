/**
 * Contract §138.4 (BR-01): the Keeper's `apply` tool carries `band` on `time` and `damage`, and the fake kernel
 * answers it the way the real one does (a banded time lands; `band_conflict` beside an amount or `stated`; `band_none`
 * on any other kind).
 *
 * The kernel behaviour itself is `tests/kernel/test_band_operations.py`, over the emitted kernel. Here: the tool
 * schema offers the field on exactly the two kinds (a field only the kernel reads is one the Keeper can never send,
 * §88.5), keeps the old shapes valid, and the extension passes `band` through to the kernel untouched.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Check } from "typebox/value";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { openTable, toolResultTexts, waitForIdle } from "./harness.mjs";

const tool = name => COC_TOOLS.find(entry => entry.name === name);
const effectSchemas = () => tool("apply").parameters.properties.effects.items.anyOf;
const schemaOf = kind => effectSchemas().find(schema => schema.properties.kind.enum?.includes(kind) || schema.properties.kind.const === kind);

test("apply offers band on time and damage and on no other effect, and the old shapes stay valid", () => {
    const apply = tool("apply").parameters;
    for (const kind of ["time", "damage"]) {
        assert.ok(schemaOf(kind).properties.band, `${kind} offers band`);
        assert.match(schemaOf(kind).properties.band.description, /basis banded/);
        assert.match(schemaOf(kind).properties.band.description, /details\.options/);
    }
    for (const schema of effectSchemas())
        if (!["time", "damage"].some(kind => schema.properties.kind.enum?.includes(kind) || schema.properties.kind.const === kind))
            assert.equal(schema.properties.band, undefined, JSON.stringify(schema.properties.kind));
    for (const effect of [{kind: "time", band: "single_room_search"}, {kind: "damage", band: "moderate", subject: "Steven Knott"},
        {kind: "time", band: "sleep_night", why: "a night at the boarding house"}])
        assert.ok(Check(apply, {effects: [effect]}), JSON.stringify(effect));
    // The Keeper's own amounts and the book's are exactly what they were.
    for (const effect of [{kind: "damage", dice: "1D6"}, {kind: "time", minutes: 30}, {kind: "time", stated: "long-search"},
        {kind: "damage", stated: "chapel-floor"}, {kind: "threat", name: "corbitt-haunting"}, {kind: "cash", delta: -5, source: "found"}])
        assert.ok(Check(apply, {effects: [effect]}), JSON.stringify(effect));
    assert.equal(Check(apply, {effects: [{kind: "time", band: 20}]}), false);
});

test("the tool carries band to the kernel untouched, and the kernel's refusals reach the Keeper", async (t) => {
    const table = await openTable({responses: [
        fauxAssistantMessage([fauxToolCall("apply", {effects: [{kind: "time", band: "single_room_search", why: "the drawers"}]})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("apply", {effects: [{kind: "time", band: "single_room_search", minutes: 5}]})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("apply", {effects: [{kind: "cash", band: "single_room_search", delta: 5, source: "found"}]})], {stopReason: "toolUse"}),
        fauxAssistantMessage([fauxToolCall("narrate", {text: "The drawers yield nothing."})], {stopReason: "toolUse"}),
        fauxAssistantMessage("done"),
    ]});
    t.after(() => table.dispose());
    await waitForIdle(table.session);
    await table.session.prompt("I go through the desk.");
    const sent = table.kernelRequests().filter(request => request.method === "table.apply");
    assert.equal(sent.length, 3);
    assert.deepEqual(sent[0].params.effects, [{kind: "time", band: "single_room_search", why: "the drawers"}]);
    assert.deepEqual(sent[1].params.effects, [{kind: "time", band: "single_room_search", minutes: 5}]);
    assert.deepEqual(sent[2].params.effects, [{kind: "cash", band: "single_room_search", delta: 5, source: "found"}]);
    const texts = toolResultTexts(table.session).join("\n");
    assert.match(texts, /band rolls the time amount inside single_room_search; give one/);
    assert.match(texts, /a cash effect takes no band/);
});
