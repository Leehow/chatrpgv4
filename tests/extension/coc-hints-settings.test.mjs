/** The beginner-hints settings section: registered where the settings UI looks, words from the surface, value in the host's document. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createComponent, hintsEnabledFrom, SETTINGS_KEY } from "../../pipicoc/settings-hints.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the section is registered where the settings UI and the package both look", async () => {
	const manifest = JSON.parse(await readFile(join(ROOT, "pipiui-extension.json"), "utf8"));
	const section = manifest.app.ui.settingsSections.find(entry => entry.id === "coc-hints");
	assert.ok(section, "the settings UI has no section to render");
	assert.equal(section.entry, "pipicoc/settings-hints.js");
	assert.ok(manifest.app.settings.schema.properties[SETTINGS_KEY], "the setting is not declared in the pack's schema");
	for (const tag of ["en", "zh-Hans"]) {
		const words = JSON.parse(await readFile(join(ROOT, "content/ui", tag, "hints.json"), "utf8"));
		for (const key of ["title", "lead", "enabled", "failed"]) assert.equal(typeof words[key], "string", `${tag} lacks ${key}`);
	}
});

test("the stored value is read as on unless it says enabled: false", () => {
	assert.equal(hintsEnabledFrom(undefined), true);
	assert.equal(hintsEnabledFrom({}), true);
	assert.equal(hintsEnabledFrom({ enabled: true }), true);
	assert.equal(hintsEnabledFrom({ enabled: false }), false);
});

test("the section draws a checkbox from the host's document and writes the choice back through the host", async () => {
	const written = [];
	const host = {
		getExtensionSettings: async () => ({ [SETTINGS_KEY]: { enabled: false } }),
		updateExtensionSettings: async (id, value) => { written.push([id, value]); return { ok: true }; },
	};
	// A minimal React: state and effects run synchronously enough for this section's one effect.
	const state = [];
	let cursor = 0, effects = [];
	const React = {
		createElement: (type, props, ...children) => typeof type === "function" ? type({ ...(props || {}), children }) : { type, props: props || {}, children },
		useState: (initial) => { const i = cursor++; if (state[i] === undefined) state[i] = [initial]; return [state[i][0], (next) => { state[i][0] = next; }]; },
		useEffect: (fn) => { effects.push(fn); },
		useRef: (value) => ({ current: value }),
	};
	const Section = createComponent(React);
	const draw = () => { cursor = 0; effects = []; const tree = Section({ api: {}, ctx: { host } }); return tree; };
	draw();
	for (const effect of effects) await effect();
	await new Promise(resolve => setTimeout(resolve, 5));
	const tree = draw();
	const find = (node, pred) => node && typeof node === "object" ? (pred(node) ? node : [...(node.children || [])].map(child => find(child, pred)).find(Boolean)) : undefined;
	const checkbox = find(tree, node => node.props && node.props["data-testid"] === "coc-hints-enabled");
	assert.ok(checkbox, "no checkbox drawn");
	assert.equal(checkbox.props.checked, false);
	checkbox.props.onChange({ target: { checked: true } });
	await new Promise(resolve => setTimeout(resolve, 5));
	assert.deepEqual(written, [["coc-keeper", { [SETTINGS_KEY]: { enabled: true } }]]);
});
