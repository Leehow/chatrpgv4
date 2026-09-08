import assert from "node:assert/strict";
import { test } from "node:test";
import { boundImages } from "../../extensions/module/reader-context.ts";

test("all new images reach the model before historical eviction", () => {
	const image = { type: "image", mimeType: "image/png", data: Buffer.alloc(100).toString("base64") };
	const original = Array.from({ length: 6 }, (_, i) => ({ role: "toolResult", toolCallId: `read-${i}`, content: [{ type: "text", text: `page ${i}` }, image] }));
	const result = boundImages(original, new Set(["read-0"]), 250, 4);
	assert.deepEqual(result.included, ["read-5", "read-4", "read-3", "read-2", "read-1"]);
	assert.equal(result.bytes, 500);
	assert.match(result.messages[0].content[1].text, /Earlier page/);
	assert.equal(result.messages[1].content[1].type, "image");
	const later = boundImages(original, new Set(original.map(m => m.toolCallId)), 250, 4);
	assert.deepEqual(later.included, ["read-5", "read-4"]);
	assert.ok(original.every(m => m.content[1].type === "image"));
	assert.deepEqual(result.messages.map(m => m.toolCallId), original.map(m => m.toolCallId));
});

test("the newest image remains available even if it alone exceeds the soft budget", () => {
	const result = boundImages([{ role: "toolResult", toolCallId: "new", content: [{ type: "image", data: Buffer.alloc(300).toString("base64") }] }], new Set(), 100);
	assert.deepEqual(result.included, ["new"]);
});
