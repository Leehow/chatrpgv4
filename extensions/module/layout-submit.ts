/**
 * Contract §191.2: the page-transcript layout child's one tool.
 *
 * The child never names a path (owner, 2026-10-07: the system decides where the layout goes). It hands its whole layout
 * to `submit_layout`; the host assembles it at once with §191.3's own `assembleLayout`, keeps the submission with the
 * fewest unplaced lines as `layout.md` in the child's work directory, and answers with the lines it left out, so the
 * child can correct them in the same session. The findings help the model; the service assembles `layout.md` again and
 * the store's permutation check decides what is kept.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { assembleLayout, layoutFindings } from "./page-transcript.ts";

export default function layoutSubmit(pi: any, options: { env?: NodeJS.ProcessEnv } = {}) {
	const env = options.env ?? process.env;
	const dir = env.PI_COC_LAYOUT_SUBMIT_DIR, limit = Number(env.PI_COC_LAYOUT_SUBMISSIONS);
	if (!dir || !Number.isSafeInteger(limit) || limit < 1) throw new Error("Layout submission needs its work directory and a submission count");
	const lines: unknown = JSON.parse(readFileSync(join(dir, "lines.json"), "utf8"));
	if (!Array.isArray(lines) || lines.some(line => typeof line !== "string")) throw new Error("lines.json is not a list of lines");
	let submitted = 0, best: number | undefined, reminded = false;
	const log = (row: Record<string, unknown>) => appendFileSync(join(dir, "submissions.jsonl"), JSON.stringify(row) + "\n");

	pi.on("tool_result", (event: any) => {
		if (event.toolName === "submit_layout" && event.details?.kind === "layout_submission_error") return { isError: true };
	});
	// Once per child: a run that ends without a layout, or with lines left out and a submission to spare, is asked again.
	pi.on("agent_end", () => {
		if (reminded || submitted >= limit || best === 0) return;
		reminded = true;
		pi.sendMessage({ customType: "layout-submit-required", display: false, content: submitted
			? "The last submit_layout result lists lines that are neither placed nor dropped. Call submit_layout once more with the whole corrected layout."
			: "Call submit_layout now with the whole layout of this page. Do not answer in ordinary text." },
			{ triggerTurn: true, deliverAs: "followUp" });
	});
	pi.registerTool({ name: "submit_layout", label: "Submit page layout", executionMode: "sequential",
		description: "Hand the host your whole layout of this page. The host stores it -- you never choose a file or a path -- and "
			+ "answers with any line you neither placed nor dropped. Submit the whole layout each time, never a fragment.",
		parameters: Type.Object({ layout: Type.String({ description: "The page's whole layout: Markdown with line placeholders, the drop list, image text and figure notes." }) }),
		async execute(_id: string, params: any) {
			if (submitted >= limit) return { content: [{ type: "text", text: "No submission is left; the host keeps your best layout. You are done." }],
				details: { kind: "layout_submission", submission: submitted, left: 0 }, terminate: true };
			const layout = params?.layout;
			if (typeof layout !== "string" || !layout.trim()) {
				log({ invalid: true });
				return { content: [{ type: "text", text: "submit_layout needs the page's whole layout as one non-empty string." }],
					isError: true, details: { kind: "layout_submission_error" } };
			}
			submitted++;
			const assembly = assembleLayout(layout, lines as string[]);
			const kept = best === undefined || assembly.unplaced.length <= best;
			if (kept) {
				const path = join(dir, "layout.md"), temp = `${path}.tmp`;
				writeFileSync(temp, layout);
				renameSync(temp, path);
				best = assembly.unplaced.length;
			}
			log({ submission: submitted, unplaced: assembly.unplaced, ignored: assembly.ignored, free_removed: assembly.free_removed, kept });
			const left = limit - submitted;
			return { content: [{ type: "text", text: layoutFindings(assembly, lines as string[], left, kept) }],
				details: { kind: "layout_submission", submission: submitted, unplaced: assembly.unplaced.length, left },
				terminate: !assembly.unplaced.length || left <= 0 };
		} });
}
