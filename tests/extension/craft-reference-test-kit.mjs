/** Shared fixtures for craft-reference contract tests. Not a play harness and not production code. */
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {after} from "node:test";
import {build} from "esbuild";

export const ROOT = resolve(import.meta.dirname, "../..");
const temporary = await mkdtemp(join(tmpdir(), "craft-reference-tests-"));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(ROOT, "node_modules"), join(temporary, "node_modules"), "dir");

await build({
	stdin: {contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: ROOT, sourcefile: "craft-reference-kernel.ts"},
	outfile: join(temporary, "kernel.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
await build({
	stdin: {
		contents: `export {prepareCraftReference, craftStillCurrent, CRAFT_REFERENCE_TYPE, CRAFT_INVALIDATION_TYPE} from './extensions/table/craft-reference.ts';
export {CraftReferenceRuntime} from './extensions/table/craft-runtime.ts';
export {requestSize} from './extensions/table/context-policy.ts';`,
		resolveDir: ROOT, sourcefile: "craft-reference-runtime.ts",
	},
	outfile: join(temporary, "runtime.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});

export const kernelApi = await import(pathToFileURL(join(temporary, "kernel.mjs")).href);
export const craftRuntime = await import(pathToFileURL(join(temporary, "runtime.mjs")).href);

export async function openKernel(t, id) {
	const home = await mkdtemp(join(temporary, "home-"));
	const context = await kernelApi.createKernelContext({
		workspace: home, content: join(ROOT, "content"), seed: id,
		locks: kernelApi.createAdvisoryLocks(async () => {}),
		env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"},
	});
	const runtime = kernelApi.createKernelRuntime(context);
	t.after(async () => {await runtime.close(); await rm(home, {recursive: true, force: true});});
	const call = (method, params = {}) => runtime.handlers[method]({campaign: id, ...params});
	await call("campaign.create", {id, module: "the-haunting", pregen: "thomas-hayes", play_language: "en"});
	return {home, call, id, campaign: join(home, ".coc", "campaigns", id)};
}

export async function writePackage(directory, manifest, files) {
	await mkdir(directory, {recursive: true});
	await writeFile(join(directory, "mod.json"), JSON.stringify(manifest));
	for (const [name, value] of Object.entries(files)) {
		const path = join(directory, name);
		await mkdir(dirname(path), {recursive: true});
		await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
	}
	return directory;
}

export function craftManifest(id, extra = {}) {
	return {
		id, version: "1.0.0", game_api: "pipicoc.game.v1", state_version: 1, author: "Test",
		name: {en: id}, description: {en: "Fixture craft provider"}, default_enabled: false,
		requires: ["mods.package-files.v1", "context.craft-reference.v1"],
		package_files: ["agent.md", "brief.md", "craft-reference.json", "cards.en.json", "starter-ids.json"],
		dependencies: {}, conflicts: [], settings: {reference_mode: "off"},
		settings_schema: {reference_mode: {enum: ["off", "jev"]}},
		contributes: {craft_reference: "craft-reference.json", instructions: "agent.md", brief: "brief.md"},
		...extra,
	};
}

export function oneCard(title) {
	return [{
		schemaVersion: "2.0", id: "CRAFT-EXC-01", family: "exchange", sourceStudyIds: ["LIT-01"], starter: true,
		examplesOrigin: "original_editorial_fixture", validationStatus: "not_human_calibrated",
		title, purpose: "Purpose text", useWhen: "Use when text", avoidWhen: "Avoid when text",
		context: "Context text", acceptable: "Acceptable text", stronger: "Stronger text", alternative: "Alternative text",
		nearMiss: "NEARMISS-SENTINEL", diagnosis: "DIAGNOSIS-SENTINEL", boundaryContext: "Boundary context",
		boundaryText: "Boundary text", why: "WHY-SENTINEL", elaboration: "Elaboration text",
	}];
}

export const CRAFT_DESCRIPTOR = {schema_version: 1, catalog: "cards.en.json", candidates: "starter-ids.json"};
