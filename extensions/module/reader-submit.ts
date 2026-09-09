/** Private checked submission for the small source-guidance task; never graph publication. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resourceRootFrom } from "../../runtime/deployment.mjs";
import { Type } from "typebox";
import { validateGuidance } from "./character-guidance.ts";
import { checkReviewEvidence } from "./reader-review.ts";

export default async function readerSubmit(pi: any) {
	const cwd = process.cwd();
	const checker = process.env.PI_COC_READER_CHECK ?? join(resourceRootFrom(import.meta.url), "bin/coc-read-check");
	const task = JSON.parse(await readFile(join(cwd, "task.json"), "utf8"));
	if (task.purpose !== "guidance") throw new Error("Checked submission is only available for source guidance");
	const reviewing = Array.isArray(task.required_review);
	const originals = reviewing ? await Promise.all(["draft.json", "guidance.json"].map(name => readFile(join(cwd, name)))) : [];
	const seen = new Set<number>();
	pi.on("context", (event: any) => {
		for (const message of event.messages) {
			if (message.role !== "toolResult" || message.details?.kind !== "source_pages" ||
				!message.content?.some((block: any) => block.type === "image")) continue;
			for (const row of message.details.observations ?? []) seen.add(row.page);
		}
	});
	pi.registerTool({
		name: "submit_reading", label: "Submit checked source artifacts",
		executionMode: "sequential",
		description: reviewing
			? "Save and check review.json, then finish without another model reply. Supply review or omit it if already written. Never modify the candidate pair. Call alone after viewing the original cited pages."
			: "Save and check draft.json and guidance.json, then finish without another model reply. Supply both small objects, or omit them if already written with write/edit/bash. Failure returns findings for repair. Call alone after viewing the required original pages.",
		parameters: reviewing ? Type.Object({review:Type.Optional(Type.Any())})
			: Type.Object({draft:Type.Optional(Type.Any()),guidance:Type.Optional(Type.Any())}),
		async execute(_id: string, params: any, signal?: AbortSignal) {
			if (signal?.aborted) throw new Error("Source submission cancelled");
			const names = reviewing ? ["review"] : ["draft", "guidance"];
			for (const name of names) if (params[name] !== undefined) {
				if (!params[name] || typeof params[name] !== "object" || Array.isArray(params[name])) throw new Error(`${name} must be an object`);
				await writeFile(join(cwd, `${name}.json`), JSON.stringify(params[name]) + "\n");
			}
			if (reviewing) {
				for (const [i, name] of ["draft.json", "guidance.json"].entries())
					if (!(await readFile(join(cwd, name))).equals(originals[i])) throw new Error("reviewer modified its candidate pair");
				const review = JSON.parse(await readFile(join(cwd, "review.json"), "utf8"));
				checkReviewEvidence(review, task.required_review, seen);
				if (typeof review.guidance?.approved !== "boolean" || !Array.isArray(review.guidance?.issues)) throw new Error("review needs guidance approved and issues");
			} else {
				const guidance = JSON.parse(await readFile(join(cwd, "guidance.json"), "utf8"));
				if (!(guidance.needs_choice === true && Object.keys(guidance).length === 1)) {
					validateGuidance(guidance);
					if (Object.keys(guidance).length !== 5) throw new Error("guidance needs exactly five bounded strings");
				}
				const result = await pi.exec(checker, ["--packet",join(cwd,"task.json"),"--draft",join(cwd,"draft.json")], {signal});
				if (result.code !== 0) throw new Error(result.stdout || result.stderr || "source draft check failed");
				const check = JSON.parse(result.stdout);
				if (check.ok !== true || !Array.isArray(check.required_view_pages)) throw new Error("source draft check did not complete");
				const missing = check.required_view_pages.filter((page: number) => !seen.has(page));
				if (missing.length) throw new Error(`View original physical pages before submitting: ${missing.join(", ")}`);
			}
			if (signal?.aborted) throw new Error("Source submission cancelled");
			return {content:[{type:"text",text:"Artifacts checked. The host will apply the existing independent review and publication gates."}],
				details:{kind:"source_submission",phase:reviewing?"review":"guidance"},terminate:true};
		},
	});
}
