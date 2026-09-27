/**
 * A controlled typed admission endpoint for the extension seam (contract §32.10's family interface, §32.12.3.2's design).
 *
 * `fetch` answers the pinned Jev endpoint the way the typed API does, for whichever design the review sends:
 *
 * - the role-first design (`role_i`, `choice_i`, `result_i`, `span_i`, `target_i`, `gate_i`, `order_i`, `missing_i`,
 *   `basis_i`): each line's distributions are built so that the host's own arithmetic
 *   (`runtime/jev/admission-roles-domain.ts`) reads back exactly the line's scripted lane-shaped `verdict` and binary
 *   `confidence`;
 * - §32.10's v1 (`verdict_i`, `missing_i`, `basis_i`): the verdict is chosen at the scripted confidence.
 *
 * `lines[i]` is line i's `{verdict, confidence, missing?}` (line 0's when the request has more lines than the script). The
 * semantic judgement belongs to the model; what is under test is what the host does with an answer.
 */

const ADMITTING = new Set(["authorized", "entailed", "not_player_action"]);

/** An exact distribution over a question's issued options: `given` where named, 0 elsewhere. */
function over(keys, given) {
	return Object.fromEntries(keys.map((key) => [key, given[key] ?? 0]));
}
const argmax = (probabilities) => Object.entries(probabilities).reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];

/**
 * The role-first design's answer to one question for a line scripted `{verdict, confidence}`: the admit probability is
 * p = (1 + c) / 2 for an admitting verdict and (1 - c) / 2 for a refusing one, carried by the question the verdict's
 * dominant role reads (`choice` for an investigator's act, `result` for the world's response); every other question
 * admits fully, so min(...) and the role mixture give back exactly p, and |2p - 1| = c.
 */
function rolesDistribution(family, keys, line) {
	const c = line.confidence, verdict = line.verdict;
	const p = ADMITTING.has(verdict) ? (1 + c) / 2 : (1 - c) / 2;
	const world = verdict === "not_player_action";
	switch (family) {
		case "role": return over(keys, world ? { world_response: 1 } : { investigator_act: 1 });
		case "choice":
			if (world) return over(keys, { chosen: 1 });
			if (verdict === "entailed") return over(keys, { routine_step: p, keeper_choice: 1 - p });
			if (verdict === "uncertain") return over(keys, { chosen: p, unclear: 1 - p });
			return over(keys, { chosen: p, keeper_choice: 1 - p });
		case "result": return over(keys, world ? { answers_player: p, needs_unchosen_act: 1 - p } : { answers_player: 1 });
		case "span": return over(keys, { activity_time: 1 });
		case "target": return over(keys, { addressed: 1 });
		case "gate": return over(keys, { no_obstacle: 1 });
		case "order": return over(keys, { in_step: 1 });
		default: return undefined;
	}
}

/** The answers to one request body, for either design. */
export function typedAnswers(body, lines) {
	return Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
		const keys = Object.keys(question.criteria);
		const family = key.slice(0, key.lastIndexOf("_")), index = Number(key.slice(key.lastIndexOf("_") + 1));
		const line = lines[index] ?? lines[0];
		let probabilities;
		if (family === "verdict") {
			const rest = keys.length > 1 ? (1 - line.confidence) / (keys.length - 1) : 0;
			probabilities = Object.fromEntries(keys.map((option) => [option, option === line.verdict ? line.confidence : rest]));
		} else if (family === "missing") probabilities = over(keys, { [line.missing ?? "none"]: 1 });
		else if (family === "basis") probabilities = over(keys, { [body.state.playerWords?.[0]?.alias ?? "none"]: 1 });
		else probabilities = rolesDistribution(family, keys, line);
		const choice = family === "verdict" ? line.verdict : argmax(probabilities);
		return [key, { type: "choice", choice, confidence: probabilities[choice], probabilities }];
	}));
}

/**
 * Install the endpoint for one test. `lines` scripts each line; `delayMs` delays the answer (on `clock` when given, the
 * admission clock of SL-87); `status` answers every request with that HTTP failure instead. Returns the request bodies.
 */
export function installTypedEndpoint(t, lines, { delayMs = 0, clock, status } = {}) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		if (delayMs) await (clock ? clock.sleep(delayMs) : new Promise((resolve) => setTimeout(resolve, delayMs)));
		if (status) return new Response("unavailable", { status });
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers: typedAnswers(body, lines), usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

/** The question keys of one line family across the requests (`role`, `verdict`, ...), sorted. */
export function questionKeys(requests, family) {
	return requests.flatMap((body) => Object.keys(body.questions).filter((key) => key.startsWith(`${family}_`))).sort();
}
