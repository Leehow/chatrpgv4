/**
 * Contract §177.2 (amended 2026-10-07): the cast reader's one tool.
 *
 * The child never names a path (owner, 2026-10-07: the system decides where an agent's output is written). It hands its
 * whole draft to `submit_cast`; the host writes `draft.json` into the range directory and runs the reader's own check
 * there (`coc-read-check --kind module-cast`, the host-owned wrapper), and the same call answers with what the check
 * refused, so the child repairs in the same session. A draft the check passes ends the child. The kernel's `cast.submit`
 * still checks `draft.json` against its own copy of the text: the findings here help the model and decide nothing.
 */
import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";

export default function castSubmit(pi: any, options: { env?: NodeJS.ProcessEnv } = {}) {
	const env = options.env ?? process.env;
	const dir = env.PI_COC_CAST_SUBMIT_DIR, checker = env.PI_COC_READER_CHECK;
	if (!dir || !checker) throw new Error("Cast submission needs its range directory and the host's checker");
	let submitted = 0, passed = false, reminded = false;
	const log = (row: Record<string, unknown>) => appendFileSync(join(dir, "submissions.jsonl"), JSON.stringify(row) + "\n");

	pi.on("tool_result", (event: any) => {
		if (event.toolName === "submit_cast" && event.details?.kind === "cast_submission_error") return { isError: true };
	});
	// Once per child, and only on a run whose model answered: Pi ends a run on a provider error before its auto-retry and
	// tells extensions nothing of the retry (§191.2's TR-D rule).
	pi.on("agent_end", (event: any) => {
		const answer = Array.isArray(event?.messages) ? event.messages.findLast((message: any) => message?.role === "assistant") : undefined;
		if (["error", "aborted"].includes(answer?.stopReason)) return;
		if (reminded || passed) return;
		reminded = true;
		pi.sendMessage({ customType: "cast-submit-required", display: false, content: submitted
			? "The last submit_cast result lists what the check refused. Repair those rows and call submit_cast once more with the whole draft."
			: "Call submit_cast now with your whole draft. Do not answer in ordinary text." },
			{ triggerTurn: true, deliverAs: "followUp" });
	});
	pi.registerTool({ name: "submit_cast", label: "Submit the cast draft", executionMode: "sequential",
		description: "Hand the host your whole cast draft for this range. The host stores it -- you never choose a file or a path -- and runs "
			+ "the cast check at once: a draft it passes ends your work; otherwise the answer lists each refused row with its fix. Submit the whole draft each time.",
		parameters: Type.Object({ draft: Type.Object({ people: Type.Array(Type.Any()) }, { additionalProperties: true,
			description: "The whole draft: {people: [{book, play, notes, pages}]}, as your instructions say." }) }),
		async execute(_id: string, params: any, signal?: AbortSignal) {
			const draft = params?.draft;
			if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
				log({ invalid: true });
				return { content: [{ type: "text", text: "submit_cast needs the whole draft as one object: {people: [...]}." }],
					isError: true, details: { kind: "cast_submission_error" } };
			}
			submitted++;
			const path = join(dir, "draft.json"), temp = `${path}.tmp`;
			writeFileSync(temp, JSON.stringify(draft) + "\n");
			renameSync(temp, path);
			const result = await pi.exec(checker, ["--kind", "module-cast", "--draft", path], { signal });
			let check: any;
			try { check = JSON.parse(result.stdout); } catch { /* reported below as the checker's own output */ }
			const ok = check?.ok === true;
			log({ submission: submitted, ok, ...(typeof check?.people === "number" ? { people: check.people } : {}),
				refused: Array.isArray(check?.refused) ? check.refused.length : 0, ...(check?.error ? { error: String(check.error).slice(0, 400) } : {}) });
			if (ok) {
				passed = true;
				return { content: [{ type: "text", text: `Draft stored and checked: ${check.people} people. You are done.` }],
					details: { kind: "cast_submission", submission: submitted, ok: true }, terminate: true };
			}
			const output = (result.stdout || result.stderr || "the cast check gave no answer").trim();
			return { content: [{ type: "text", text: `Draft stored, but the check refused it:\n${output}\nRepair what it names, keep every other row `
				+ "as it is, and call submit_cast again with the whole draft. Remove a row only if you cannot repair it." }],
				details: { kind: "cast_submission", submission: submitted, ok: false } };
		} });
}
