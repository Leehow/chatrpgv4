#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectMapSupplyPages } from "../../plugins/coc-keeper/pi/lib/map-supply.ts";

const root = path.resolve(process.argv[2] || process.cwd());
const workspace = await mkdtemp(path.join(os.tmpdir(), "coc-map-supply-"));
const pages = path.join(workspace, ".coc", "module-assets", "cold-harvest", "pages");
await mkdir(pages, { recursive: true });
await writeFile(path.join(pages, "0016.md"), "## 地图 1\n", "utf8");
await writeFile(path.join(pages, "0022.md"), "![只剩图片引用](lost.png)\n", "utf8");
await writeFile(path.join(pages, "0023.md"), "# 正文\n这是一段足够长的正文，不应被当作图像页。".repeat(8), "utf8");

const direct = detectMapSupplyPages([
  { pdf_index: 16, markdown: "## 地图 1\n" },
  { pdf_index: 22, markdown: "![only image](lost.png)\n" },
  { pdf_index: 23, markdown: "# 正文\n" + "文字".repeat(100) },
], [1, 16]);
assert.deepEqual(direct.needs_image, [16, 22]);
assert.deepEqual(direct.needs_ocr_or_image, [1, 16, 22]);
assert.deepEqual(direct.reasons[16], ["illustration_heading", "low_text_density"]);

const renderer = path.join(workspace, "renderer.mjs");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J3S8AAAAASUVORK5CYII=";
await writeFile(renderer, `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
await mkdir(request.output_dir, { recursive: true });
const images = [];
for (const pdf_index of request.pdf_indices) {
  const target = path.join(request.output_dir, \`page-\${String(pdf_index).padStart(4, "0")}.png\`);
  await writeFile(target, Buffer.from("${png}", "base64"));
  images.push({ pdf_index, path: target });
}
process.stdout.write(JSON.stringify({ schema_version: 1, status: "ok", images }));
`, "utf8");
await chmod(renderer, 0o755);
await writeFile(path.join(workspace, "source.pdf"), "external renderer fixture", "utf8");
process.env.COC_MAP_RENDER_COMMAND = renderer;

const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const tools = new Map();
const hidden = [];
const fakePi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  registerCommand() {}, registerShortcut() {}, on() {}, appendEntry() {},
  sendMessage: (message) => hidden.push(message), setActiveTools() {}, getThinkingLevel: () => "off",
};
extension.default(fakePi, { coordinatorEnabled: () => false });
const mapSupply = tools.get("coc_map_supply");
assert.ok(mapSupply, "Pi registers coc_map_supply");
const ctx = { cwd: workspace, mode: "rpc", sessionManager: { getSessionId: () => "map-probe" } };

const detected = await mapSupply.execute("detect", { operation: "detect", pages_dir: pages, needs_ocr: [1, 16] }, undefined, undefined, ctx);
assert.deepEqual(detected.details.needs_image, [16, 22]);
assert.deepEqual(detected.details.needs_ocr_or_image, [1, 16, 22]);

const rendered = await mapSupply.execute("render", {
  operation: "render", pages_dir: pages, needs_ocr: [1], asset_root_id: "cold-harvest",
  source_pdf_path: path.join(workspace, "source.pdf"),
}, undefined, undefined, ctx);
assert.equal(rendered.details.status, "rendered");
assert.equal(rendered.details.assets.length, 2);
assert.match(rendered.details.assets[0].image_ref, /^\.coc\/module-assets\/cold-harvest\/images\/map-supply\//);
assert.match(rendered.details.assets[0].sha256, /^sha256:[0-9a-f]{64}$/);

const presented = await mapSupply.execute("present", {
  operation: "present", image_ref: rendered.details.assets[0].image_ref, caption: "地图 1；守秘人专用",
}, undefined, undefined, ctx);
assert.equal(presented.details.status, "delivered");
assert.equal(hidden.length, 1);
assert.equal(hidden[0].display, false);
assert.equal(hidden[0].customType, "coc-map-supply-visual");
assert.deepEqual(hidden[0].content.map((part) => part.type), ["text", "image"]);
assert.equal(hidden[0].content[1].source.type, "base64");
process.stdout.write(JSON.stringify({ ok: true, checks: 3 }));
