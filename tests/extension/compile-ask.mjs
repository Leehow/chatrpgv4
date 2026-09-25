/**
 * Test helpers for the compile's `ask` family after §135.30.9 (SL-52): the family is asked as one yes/no question per row
 * (key `ask_<n>`, the row's alias; the target carries the row's words after `ask_<n>: `), not as one choice.
 *
 * Many tests author the declaration's ask the old way -- one row (by alias), `none` or `unclear`, meaning "the declaration seeks
 * this row and no other" -- and `fanAsk` turns that into the per-row answers the compile reads: the named row `yes`, every
 * other row `no`, `unclear` everywhere for `unclear`, each at the authored confidence, with the authored distribution folded
 * onto yes/no/unclear. Answers for aliases past the batch's rows are never read.
 */
const ASK_ROWS = 32;

/** `answers` (key -> answer) with a single-choice `ask` answer fanned out to `ask_1`…`ask_32`. */
export function fanAsk(answers) {
	const single = answers?.ask;
	if (!single || single.status !== "answered" || single.type !== "choice") return answers;
	const { ask: _ask, ...out } = answers;
	for (let index = 1; index <= ASK_ROWS; index++) {
		const alias = `ask_${index}`;
		if (Object.hasOwn(out, alias)) continue;
		const verdict = (key) => key === alias ? "yes" : key === "unclear" || key === "unknown" ? key : "no";
		const probabilities = single.probabilities && Object.entries(single.probabilities).reduce((sum, [key, value]) => {
			const into = verdict(key);
			sum[into] = Math.round(((sum[into] ?? 0) + value) * 100) / 100;
			return sum;
		}, {});
		out[alias] = { status: "answered", type: "choice", choice: verdict(single.choice), confidence: single.confidence, ...(probabilities ? { probabilities } : {}) };
	}
	return out;
}
/** A complete `DecisionResult` whose single-choice `ask` answer (if any) is fanned out. */
export const fanResult = (result) => result?.answers ? { ...result, answers: fanAsk(result.answers) } : result;
/** Whether a compile question is one `ask` row's own question. */
export const isAskRow = (question) => /^ask_\d+$/.test(question?.key ?? "");
/** The row's own words an `ask` row question carries (its `describe`), parsed back. */
export function askWords(question) {
	const target = String(question?.target ?? ""), words = target.slice(target.indexOf(": ") + 2);
	try { return JSON.parse(words); } catch { return words; }
}
