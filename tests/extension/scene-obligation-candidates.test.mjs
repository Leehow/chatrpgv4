/**
 * SO-04 (spec scene-obligations-as-candidates D6, owner rulings Q1/Q2/Q5; contract §135.26): the scene obligations the
 * kernel issues become the clerk's candidates.
 *
 * The kernel is the subject of every state read at the morgue, so those reads come from the emitted kernel on a real
 * haunting campaign (seeded), driven through its own RPC. The variants the haunting does not state (one approach, a
 * stated minimum, a Mod-served recipe, an unstated difficulty, a hazard) are the kernel's own morgue rows with one
 * field changed, never a hand-built shape. The policy half is pure (`step-policy.ts`). The clerk's note and the refusal
 * budget are asserted at the extension seam: the hybrid engine on a real Pi session over the emitted kernel.
 */
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createRealCampaign, openTable } from "./harness.mjs";
import { buildCandidates, keeperCall, obligationCandidates } from "../../runtime/jev/candidates.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import { BIND_FAMILY, CLERK_AUTHORITY, ROUTE_FAMILY, bindBatch, bindingOf, initialView, interpretBind, interpretRoute, next, routeBatch, settleExecute, settleRead } from "../../runtime/jev/step-policy.ts";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { issuedSection, readCandidateBodies } from "../../runtime/jev/candidate-bodies.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "camp";
const MORGUE = "newspaper-morgue";
const ACCESS = "globe-clippings-access", ARCHIVIST = "globe-archivist";
const GUARDED = ["apply:clue:globe-unpublished-story", "apply:clue:macario-tragedy"];
const APPROACHES = ["Persuade", "Intimidate", "Charm", "Fast Talk"];
/** The kernel's seed under which the first roll of the process, a regular Persuade, passes (tests/kernel/test_scene_obligations.py PASS). */
const PASS = "4";
const INPUT = "I ask the city editor to let me into the clippings room";
const scope = { owner: `campaign:${CAMPAIGN}`, campaign: CAMPAIGN, worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: MORGUE, clock: null, present: [], receipts: [] };
const allText = (value) => JSON.stringify(value);

/** The emitted kernel over its JSONL RPC, seeded, on a fresh workspace with one real campaign of The Haunting. */
function kernel(t, seed = PASS) {
	const workspace = mkdtempSync(join(tmpdir(), "so04-candidates-"));
	createRealCampaign(workspace, CAMPAIGN);
	const child = spawn(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, COC_KERNEL_SEED: seed } });
	const waiting = new Map();
	let id = 0;
	createInterface({ input: child.stdout }).on("line", (line) => {
		if (!line.trim()) return;
		const frame = JSON.parse(line);
		if (frame.progress) return;
		waiting.get(frame.id)?.(frame);
		waiting.delete(frame.id);
	});
	const call = (method, params = {}) => new Promise((resolve, reject) => {
		const key = String(++id);
		waiting.set(key, (frame) => (frame.ok ? resolve(frame.result) : reject(new Error(`${method}: ${frame.error?.code} ${frame.error?.message}`))));
		child.stdin.write(`${JSON.stringify({ id: key, method, params: { campaign: CAMPAIGN, ...params } })}\n`);
	});
	t.after(async () => {
		child.stdin.end();
		await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
		rmSync(workspace, { recursive: true, force: true });
	});
	return { call };
}
async function reads(call) {
	const [capsule, applyOptions, resolveOptions] = await Promise.all([call("table.capsule"), call("table.apply.options"), call("table.resolve.options")]);
	return { capsule, applyOptions, resolveOptions };
}
/** Turn 1 at the morgue: the party has just walked in. */
async function atMorgue(call) {
	await call("table.open");
	const opened = await call("table.player_input", { text: INPUT });
	await call("table.apply", { call_id: `t${opened.turn}-c1`, effects: [{ kind: "move", to: MORGUE }] });
	return opened.turn;
}
const keys = (candidates) => candidates.map((candidate) => candidate.key);
const ofObligation = (candidates, handle) => candidates.filter((candidate) => candidate.basis?.obligation === handle);
/** The kernel's morgue reads with the gate's `next` (or the whole row) changed: a variant the haunting does not state. */
function variant(state, change) {
	const applyOptions = structuredClone(state.applyOptions);
	const row = applyOptions.obligations.find((value) => value.handle === ACCESS);
	change(row, applyOptions);
	return { ...state, applyOptions };
}

test("at the morgue the gate's check carries its meeting in place of the roster candidate, the archivist issues nothing, the guarded clues and Arty's Mod check are withheld", async (t) => {
	const { call } = kernel(t);
	await atMorgue(call);
	const state = await reads(call);
	assert.deepEqual(state.applyOptions.obligations.map((row) => [row.handle, row.state]), [[ACCESS, "open"], [ARCHIVIST, "blocked"]]);
	const gate = state.applyOptions.obligations[0];
	assert.deepEqual(gate.next, { kind: "meet", person: "Arty Wilmot" });
	assert.deepEqual([gate.then.kind, gate.then.target, gate.then.approaches.map((value) => value.skill)], ["check", "Arty Wilmot", APPROACHES],
		"the kernel names the check the meeting leads to");
	const candidates = buildCandidates(state, INPUT);

	// No routed candidate for Arty: the check carries his meeting (owner ruling 2026-09-23), so neither the roster
	// candidate nor a separate stated meeting is offered.
	assert.deepEqual(candidates.filter((candidate) => candidate.family === "person" && candidate.bound.who === "Arty Wilmot"), [],
		"the meeting is carried by the check, never a second candidate and never the roster one");
	const [check, ...others] = candidates.filter((candidate) => candidate.family === "obligation_check");
	assert.equal(others.length, 0);
	assert.equal(check.key, `resolve:obligation:${ACCESS}`);
	assert.match(check.label, /^The book's price of "Access to the Globe clippings": meet Arty Wilmot first, then a regular Persuade, Intimidate, Charm or Fast Talk check against Arty Wilmot before anyone gets clue globe-unpublished-story or clue macario-tragedy$/);
	const arty = check.before;
	assert.equal(arty.key, "apply:person:Arty Wilmot");
	assert.equal(arty.clerk, "stated_obligation");
	assert.ok(CLERK_AUTHORITY.includes("stated_obligation"));
	assert.deepEqual([arty.basis.read, arty.basis.path, arty.basis.obligation, arty.basis.step], ["table.apply.options", "obligations[0]", ACCESS, "meet"]);
	assert.match(arty.label, /^The book puts Arty Wilmot \(gatekeeper\) here in the way of "Access to the Globe clippings": whoever is after clue globe-unpublished-story or clue macario-tragedy meets Arty Wilmot first; /);
	// A stated meeting is data: without the table's own label it is staged under the book's name, with no LLM step.
	assert.equal(arty.bound.name, "Arty Wilmot");
	assert.equal(bindingOf(arty), "none");
	assert.deepEqual(arty.detail.guards.map((guard) => guard.clue), ["globe-unpublished-story", "macario-tragedy"]);
	assert.ok(arty.detail.guards.every((guard) => guard.summary), "Jev reads what the gate guards");
	// The table's own label, when the kernel issued one, is the name instead.
	const labelled = buildCandidates({ ...state, capsule: { ...state.capsule, present: state.capsule.present.map((person) =>
		person.name === "Arty Wilmot" ? { ...person, untold: { ...person.untold, label: "城市版编辑" } } : person) } }, INPUT);
	assert.equal(labelled.find((candidate) => candidate.family === "obligation_check").before.bound.name, "城市版编辑");
	assert.deepEqual(ofObligation(candidates, ARCHIVIST), [], "a blocked obligation issues nothing");
	// Ruth is on the roster without the table's own label and her obligation is blocked: no data source names her here, so
	// staging her is the Keeper's to propose, not the clerk's to issue (§135.28).
	assert.equal(candidates.find((candidate) => candidate.key === "apply:person:Ruth Blake"), undefined);

	// The guarded clues keep their rows in the options (with guarded_by) and are withheld from the clerk, however offered.
	for (const key of GUARDED) {
		const clue = key.slice("apply:clue:".length);
		assert.equal(state.applyOptions.candidates.find((row) => row.effect.clue === clue)?.guarded_by, ACCESS);
		assert.ok(!keys(candidates).includes(key), `${key} is withheld while the gate is open`);
	}
	const located = buildCandidates({ ...state, located: [{ handle: "globe-unpublished-story", label: "the 1918 story", kind: "clue" }] }, INPUT);
	assert.ok(!keys(located).includes(GUARDED[0]), "a located clue behind an open guard is withheld too");
	assert.ok(keys(candidates).includes("apply:clue:globe-fire-cutoff"), "an unguarded clue of the same scene is still offered");

	// Q2: the book preordains Arty's reaction, so the Mod's first impression for him is not the clerk's; Ruth's still is.
	const contacts = candidates.filter((candidate) => candidate.family === "mod_check");
	assert.deepEqual(contacts.map((candidate) => candidate.bound.target), ["Ruth Blake"]);
	assert.ok(state.capsule.mods.pending_contacts.some((contact) => contact.target === "Arty Wilmot"), "the Mod's own declaration is unchanged");

	// Nothing the kernel keeps for audit reaches Jev: no page, no guard tag, no Mod bookkeeping, no authority string.
	const { batch } = routeBatch(initialView({ runId: "r", rawInput: INPUT, context, candidates, readFirst: false }), scope, []);
	const shown = allText(batch.state) + allText(batch.questions);
	for (const hidden of ["pdf", "448", "guarded_by", "mod_contact", "preordained", "authority", '"basis"', "stated_obligation", '"source"', '"before"'])
		assert.ok(!shown.includes(hidden), `Jev never sees ${hidden}`);
});

test("seeks on the gate's check carries its meeting directly first, under the book's name and with no LLM step, then binds and rolls the check", async (t) => {
	const { call } = kernel(t);
	const turn = await atMorgue(call);
	const state = await reads(call);
	const candidates = buildCandidates(state, INPUT);
	const check = candidates.find((candidate) => candidate.family === "obligation_check");
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	const offered = view.candidates, index = offered.findIndex((candidate) => candidate.key === check.key);
	const now = { status: "answered", type: "choice", choice: "now", confidence: 0.8 }, later = { ...now, choice: "later" }, seeks = { ...now, choice: "seeks" };
	const result = { batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
		answers: { ...Object.fromEntries(offered.map((_, i) => [`need_${i + 1}`, i === index ? seeks : later])), exit: { ...now, choice: "continue" } } };
	const routed = interpretRoute(view, offered, result, 0.6);
	assert.deepEqual(routed.selected, [check.key], "one Jev question answered seeks: the check");
	// "now" is not an answer to a fact question: it selects nothing.
	const nowAnswer = { ...result, answers: { ...result.answers, [`need_${index + 1}`]: now } };
	assert.deepEqual(interpretRoute(view, offered, nowAnswer, 0.6).selected, []);
	// The meeting runs first, directly: no Jev question for it and no LLM step for its name.
	assert.deepEqual(routed.pending.map((item) => [item.kind, item.purpose, item.candidate.key]), [["direct", "execute", "apply:person:Arty Wilmot"]]);
	const meeting = routed.pending[0].candidate;
	assert.equal(meeting.then, check.key);
	const { tool, args } = keeperCall(meeting);
	assert.equal(tool, "apply");
	assert.deepEqual(args.effects, [{ kind: "person", who: "Arty Wilmot", name: "Arty Wilmot",
		why: `The book puts Arty Wilmot here for "Access to the Globe clippings", under the book's name; player: "${INPUT}"` }],
	"the book's name, and a why composed from the demand and the player's words (§135.28): no open parameter");
	assert.deepEqual(meeting.composed, ["why"]);
	view.pending.push(...routed.pending);
	assert.equal(next(view).kind, "direct");
	// Past the run's time budget (§135.25) the carried meeting still runs: structure, no model, like a forced step.
	const spent = structuredClone(view);
	spent.budget.runMs = spent.budget.maxRunMs;
	assert.deepEqual([next(spent).kind, next(spent).item?.candidate?.key], ["direct", "apply:person:Arty Wilmot"]);
	const staged = await call("table.apply", { call_id: `t${turn}-c2`, effects: args.effects });
	assert.ok(staged.receipts.length);
	// The fresh read issues the check without its meeting; the policy binds it next (the several approaches: Jev).
	const after = buildCandidates(await reads(call), INPUT);
	const item = view.pending.shift();
	settleExecute(view, 2, item, { ok: true, summary: {} }, { context, candidates: after }, 0);
	assert.deepEqual(view.pending.map((value) => [value.kind, value.purpose, value.candidate?.key]), [["decide", "bind", check.key]]);
	assert.equal(view.pending[0].candidate.before, undefined, "the fresh check carries nothing: the meeting is met");
	assert.ok(view.consumed.includes("apply:person:Arty Wilmot"));
	assert.ok(!view.observations.some((value) => value.kind === "infer"), "no LLM step on the way");
});

test("after the meeting the gatekeeper's check is an obligation_check with the closed approach binder; a pass releases the clues and issues the archivist", async (t) => {
	const { call } = kernel(t);
	const turn = await atMorgue(call);
	await call("table.apply", { call_id: `t${turn}-c2`, effects: [{ kind: "person", who: "Arty Wilmot", name: "Arty" }] });
	const state = await reads(call);
	const candidates = buildCandidates(state, INPUT);
	assert.ok(!candidates.some((candidate) => candidate.family === "person" && candidate.bound.who === "Arty Wilmot"), "a meeting met is not offered again");
	const [check, ...more] = candidates.filter((candidate) => candidate.family === "obligation_check");
	assert.equal(more.length, 0);
	assert.equal(check.key, `resolve:obligation:${ACCESS}`);
	assert.equal(check.verb, "resolve");
	assert.equal(check.clerk, "stated_obligation");
	assert.deepEqual([check.basis.obligation, check.basis.step], [ACCESS, "check"]);
	assert.deepEqual([check.bound.obligation, check.bound.target], [ACCESS, "Arty Wilmot"]);
	assert.equal(check.bound.skill, undefined, "four approaches: the clerk never picks one");
	assert.match(check.label, /^The book's price of "Access to the Globe clippings": a regular Persuade, Intimidate, Charm or Fast Talk check against Arty Wilmot before anyone gets clue globe-unpublished-story or clue macario-tragedy$/);
	// Several approaches: one closed Jev bind over the approaches, the ordinary binder's dice words and the intent.
	assert.equal(bindingOf(check), "closed");
	assert.deepEqual(check.unbound.map((value) => [value.name, value.options]),
		[["skill", APPROACHES], ["bonus", ["none", "one", "two"]], ["penalty", ["none", "one", "two"]], ["intent", ["investigate", "social", "move"]]]);
	for (const key of GUARDED) assert.ok(!keys(candidates).includes(key), "still withheld: the gate is open until its check settles");
	// §135.20: the read hands the Keeper the check's body -- the demand and what it guards, never the page.
	const bodies = await readCandidateBodies({ candidates, capsule: state.capsule, call });
	const body = bodies.bodies.find((entry) => entry.family === "obligation_check");
	assert.equal(body?.name, ACCESS);
	assert.equal(body.body.demand, "Access to the Globe clippings");
	assert.deepEqual(body.body.next.approaches.map((value) => value.skill), APPROACHES);
	assert.deepEqual(body.body.guards.map((guard) => guard.clue), ["globe-unpublished-story", "macario-tragedy"]);
	const section = allText(issuedSection(bodies));
	for (const hidden of ["pdf", "448", '"source"', "mod_contact", "Arty refuses"]) assert.ok(!section.includes(hidden), `the body carries no ${hidden}`);

	// The policy: several approaches go to decide(bind); a confident answer runs the clerk's resolve with the claim.
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	const routed = interpretRoute(view, [check], { batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
		answers: { need_1: { status: "answered", type: "choice", choice: "seeks", confidence: 0.9 }, exit: { status: "answered", type: "choice", choice: "continue", confidence: 0.9 } } }, 0.6);
	assert.deepEqual(routed.pending.map((item) => [item.kind, item.purpose]), [["decide", "bind"]]);
	const batch = bindBatch(view, check, scope, []);
	assert.deepEqual(batch.questions.map((question) => question.key), ["skill", "bonus", "penalty", "intent"]);
	assert.match(batch.questions[0].instructions, /never the skill values/);
	const answer = (choices, confidence = 0.85) => ({ batchId: batch.id, status: "complete", issues: [], coverage: { required: Object.keys(choices), answered: Object.keys(choices), unknown: [] },
		answers: Object.fromEntries(Object.entries(choices).map(([key, choice]) => [key, { status: "answered", type: "choice", choice, confidence }])) });
	const bound = interpretBind(check, batch, answer({ skill: "Persuade", bonus: "one", penalty: "none", intent: "social" }), 0.6);
	assert.deepEqual(bound.pending.map((item) => [item.kind, item.purpose]), [["direct", "execute"]]);
	// §135.28: an approach the words do not settle takes the rules default -- the investigator's highest current value
	// among the offered approaches, read from the kernel's own profiles; Intimidate and Fast Talk tie at 45, and the tie
	// goes to the first in the book's stated order -- stamped on the operation's basis; no LLM step.
	const profile = (skill) => state.resolveOptions.profiles.find((row) => row.actor === check.bound.actor && row.skill === skill)?.value;
	assert.deepEqual(APPROACHES.map(profile), [40, 45, 35, 45], "the kernel's issued values the default is read from");
	assert.deepEqual(check.unbound.find((value) => value.name === "skill").ruleDefault, { rule: "highest_offered_skill", value: "Intimidate" });
	const defaulted = interpretBind(check, batch, answer({ skill: "unknown", bonus: "none", penalty: "none", intent: "social" }), 0.6);
	assert.deepEqual(defaulted.pending.map((item) => [item.kind, item.purpose, item.extra?.skill]), [["direct", "execute", "Intimidate"]]);
	assert.deepEqual([defaulted.pending[0].candidate.basis.binding, defaulted.pending[0].candidate.basis.rule_default],
		["rule-default", { skill: { value: "Intimidate", rule: "highest_offered_skill" } }]);
	assert.deepEqual(defaulted.bindings.map((entry) => [entry.name, entry.path, entry.value]),
		[["skill", "rule-default", "Intimidate"], ["bonus", "jev", "none"], ["penalty", "jev", "none"], ["intent", "jev", "social"]]);
	// Below the gate everywhere: the approach and the dice take their defaults, but the intent has none (the obligation
	// states no intent), so the check is the Keeper's turn -- never an LLM bind.
	const low = interpretBind(check, batch, answer({ skill: "Persuade", bonus: "none", penalty: "none", intent: "social" }, 0.4), 0.6);
	assert.deepEqual(low.pending.map((item) => [item.kind, item.purpose, item.reason, item.extra?.unresolved]), [["infer", "adjudicate", "clerk_unbound", ["intent"]]]);

	// The clerk's call is the Keeper's resolve with the claim; the dice word becomes a modifier with its reason.
	const { tool, args } = keeperCall(check, bound.pending[0].extra);
	assert.equal(tool, "resolve");
	const { actor: _actor, ...sent } = JSON.parse(JSON.stringify(args.action));
	assert.deepEqual(sent, { obligation: ACCESS, target: "Arty Wilmot", skill: "Persuade", intent: "social",
		modifiers: { bonus_dice: 1, penalty_dice: 0, reason: INPUT }, goal: INPUT, method: INPUT });
	const settled = await call("table.resolve", { call_id: `t${turn}-c3`, action: keeperCall(check, { skill: "Persuade", intent: "social", bonus: "none", penalty: "none" }).args.action });
	assert.deepEqual(settled.obligation, { handle: ACCESS, settled: true }, "seeded pass: the claim settles the gate");

	const after = buildCandidates(await reads(call), INPUT);
	for (const key of GUARDED) assert.ok(keys(after).includes(key), `${key} returns once the gate settles`);
	assert.equal(after.filter((candidate) => candidate.family === "obligation_check").length, 0, "a settled obligation issues nothing");
	const ruth = after.filter((candidate) => candidate.family === "person" && candidate.bound.who === "Ruth Blake");
	assert.equal(ruth.length, 1);
	assert.deepEqual([ruth[0].clerk, ruth[0].basis.obligation, ruth[0].basis.step], ["stated_obligation", ARCHIVIST, "meet"], "the archivist, open now, states her meeting");
	assert.deepEqual([ruth[0].bound.name, bindingOf(ruth[0])], ["Ruth Blake", "none"], "a meeting-only obligation is routed, under the book's name");
	// The archivist guards nothing of her own: her route question names what the gate she follows guards.
	assert.match(ruth[0].routeFact.target, /is the player's declared action after any of: clue globe-unpublished-story .*clue macario-tragedy/);
	assert.deepEqual(Object.keys(ruth[0].routeFact.criteria), ["seeks", "not", "unknown"]);
	assert.match(ruth[0].label, /^The book puts Ruth Blake \(helpful_staff\) here for "The Globe archivist" once "Access to the Globe clippings" is settled: Ruth Blake is met next; /);
});

test("the approach binder: one available approach is bound, a stated minimum the actor misses rules one out, maximum leaves the skill to the kernel", async (t) => {
	const { call } = kernel(t);
	const turn = await atMorgue(call);
	await call("table.apply", { call_id: `t${turn}-c2`, effects: [{ kind: "person", who: "Arty Wilmot", name: "Arty" }] });
	const state = await reads(call);
	const checkOf = (reads) => obligationCandidates(reads, INPUT).find((candidate) => candidate.family === "obligation_check");
	const one = checkOf(variant(state, (row) => { row.next.approaches = [{ skill: "Persuade" }]; }));
	assert.equal(one.bound.skill, "Persuade", "one approach: bound");
	assert.deepEqual(one.unbound.map((value) => value.name), ["intent"], "no approach or dice question; the intent the kernel does not issue stays a closed bind");
	const persuade = state.resolveOptions.profiles.find((profile) => profile.skill === "Persuade").value;
	const minimum = checkOf(variant(state, (row) => { row.next.approaches = [{ skill: "Persuade", minimum: persuade + 1 }, { skill: "Charm" }]; }));
	assert.equal(minimum.bound.skill, "Charm", "an approach whose stated minimum the actor misses is not available");
	assert.equal(checkOf(variant(state, (row) => { row.next.approaches = [{ skill: "Persuade", minimum: persuade + 1 }]; })), undefined, "no available approach, no candidate");
	const highest = checkOf(variant(state, (row) => { row.next.selection = "maximum"; }));
	assert.equal(highest.bound.skill, undefined);
	assert.deepEqual(highest.unbound.map((value) => value.name), ["intent"]);
	assert.match(highest.label, /the higher of Persuade, Intimidate, Charm and Fast Talk/);
});

test("no candidate for a step the Mod serves, a step the page leaves unstated, or a target not here; hazards and non-open states issue nothing", async (t) => {
	const { call } = kernel(t);
	const turn = await atMorgue(call);
	await call("table.apply", { call_id: `t${turn}-c2`, effects: [{ kind: "person", who: "Arty Wilmot", name: "Arty" }] });
	const state = await reads(call);
	const obligationSteps = (reads) => buildCandidates(reads, INPUT).filter((candidate) => candidate.clerk === "stated_obligation");
	assert.equal(obligationSteps(state).length, 1, "control: the morgue's check");
	// The Mod-recipe identity (§134.13): the Mod contact check is the step's candidate, and there is no second one.
	const served = variant(state, (row) => { row.next.served_by = { mod: "natural-npc", check: "natural-npc:first-impression" }; delete row.reaction; delete row.mod_contact; });
	assert.deepEqual(obligationSteps(served), []);
	assert.ok(buildCandidates(served, INPUT).some((candidate) => candidate.family === "mod_check" && candidate.bound.target === "Arty Wilmot"),
		"the serving Mod check is offered for Arty once no preordained reaction withholds it");
	assert.deepEqual(obligationSteps(variant(state, (row) => { delete row.next.difficulty; row.next.difficulty_unstated = true; })), [], "difficulty unstated: the Keeper's");
	assert.deepEqual(obligationSteps(variant(state, (row) => { delete row.next.approaches; delete row.next.selection; row.next.approaches_unstated = true; })), [], "approaches unstated: the Keeper's");
	assert.deepEqual(obligationSteps(variant(state, (_row, options) => { options.context.present = options.context.present.filter((name) => name !== "Arty Wilmot"); })), [], "no target here");
	for (const blocked of ["blocked", "settled", "waived"])
		assert.deepEqual(obligationSteps(variant(state, (row) => { row.state = blocked; })), [], `${blocked} issues nothing`);
	// A blocked obligation's guards hold; a settled one's do not.
	assert.ok(!keys(buildCandidates(variant(state, (row) => { row.state = "blocked"; }), INPUT)).includes(GUARDED[0]));
	assert.ok(!keys(buildCandidates(variant(state, (row) => { row.state = "settled"; }), INPUT)).includes(GUARDED[0]),
		"while the options' own row still carries guarded_by the clue stays withheld: the kernel, not the builder, lifts a guard");
	// A person an unsettled obligation guards is withheld: neither staged nor met by a Mod check, until the guard lifts.
	const person = buildCandidates(variant(state, (row) => { row.trigger.guards.people = ["Ruth Blake"]; }), INPUT);
	assert.ok(!person.some((candidate) => candidate.bound.who === "Ruth Blake" || candidate.bound.target === "Ruth Blake"), "Ruth is behind the guard");
	assert.ok(buildCandidates(state, INPUT).some((candidate) => candidate.family === "mod_check" && candidate.bound.target === "Ruth Blake"), "control: unguarded, her Mod check is offered");
	// Q1: hazards are the Keeper's. The scene's `on_enter` data and a module's mechanics never become candidates.
	const hazard = { ...state, capsule: { ...state.capsule, where: { ...state.capsule.where,
		on_enter: { san_triggers: [{ trigger: "sees the bed fly", loss: "0/1d3" }], danger_attacks: [{ attacker: "bed", skill: "Dodge" }] },
		mech: ["hazard: Luck then Jump, or fall 1d6"] } } };
	assert.deepEqual(keys(buildCandidates(hazard, INPUT)), keys(buildCandidates(state, INPUT)), "hazard data adds no candidate");
});

test("an obligation's route question is a fact about the input -- is the declaration after what it guards -- naming the guarded things", async (t) => {
	const { call } = kernel(t);
	await atMorgue(call);
	const candidates = buildCandidates(await reads(call), INPUT);
	const view = initialView({ runId: "r", rawInput: INPUT, context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	const { batch, offered } = routeBatch(view, scope, []);
	const index = offered.findIndex((candidate) => candidate.family === "obligation_check");
	const question = batch.questions[index];
	assert.deepEqual(Object.keys(question.criteria), ["seeks", "not", "unknown"], "not now/later: the order of steps is craft");
	assert.match(question.target, /is the player's declared action after any of: clue globe-unpublished-story \(An unpublished 1918 feature/);
	assert.match(question.target, /clue macario-tragedy \(The Macario family/);
	assert.match(question.instructions, /not an order of steps/);
	for (const hidden of ["pdf", "448", "preordained", "guarded_by"]) assert.ok(!allText(question).includes(hidden));
	// Every other candidate keeps the now/later question.
	assert.ok(batch.questions.filter((_, i) => i !== index && i < offered.length).every((value) => Object.keys(value.criteria)[0] === "now"));
});

test("precedence: person -> mod_check -> obligation_check -> core-check -> clue/handout -> move", () => {
	const candidate = (family, key) => ({ key, verb: family === "move" || family === "clue" || family === "person" || family === "handout" ? "apply" : "resolve", family, label: key, source: "t", bound: {}, unbound: [] });
	const offered = [candidate("move", "m"), candidate("clue", "c"), candidate("core-check", "k"), candidate("obligation_check", "o"), candidate("mod_check", "d"), candidate("person", "p"), candidate("handout", "h")];
	const view = initialView({ runId: "r", rawInput: "x", context, candidates: offered, readFirst: false });
	const now = { status: "answered", type: "choice", choice: "now", confidence: 0.9 };
	const result = { batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
		answers: { ...Object.fromEntries(offered.map((_, index) => [`need_${index + 1}`, now])), exit: { ...now, choice: "continue" } } };
	assert.deepEqual(interpretRoute(view, offered, result, 0.6).selected, ["p", "d", "o", "k", "c", "h", "m"]);
});

test("a refused clerk step is dropped for the run and hands the turn to the Keeper; a Keeper's claimed resolve consumes the obligation check", () => {
	const check = { key: `resolve:obligation:${ACCESS}`, verb: "resolve", family: "obligation_check", label: "the gate", source: "table.apply.options", bound: { obligation: ACCESS }, unbound: [], clerk: "stated_obligation" };
	const view = initialView({ runId: "r", rawInput: "x", context, candidates: [check], readFirst: false });
	settleExecute(view, 1, { kind: "direct", purpose: "execute", candidate: check }, { ok: false, summary: { refused: "needs" } }, { context, candidates: [check] }, 0);
	assert.ok(view.consumed.includes(check.key));
	assert.deepEqual(view.candidates, [], "not offered again this run");
	assert.deepEqual(next(view), { kind: "infer", purpose: "adjudicate", reason: "clerk_refused", item: view.pending[0] }, "the Keeper decides, not another route");
	// The Keeper's own resolve that claims the obligation consumes the clerk's candidate for it.
	const keeper = initialView({ runId: "r", rawInput: "x", context, candidates: [check], readFirst: false });
	settleExecute(keeper, 1, { kind: "direct", purpose: "execute", call: { method: "resolve", params: { action: { obligation: ACCESS, skill: "Charm" } }, label: "resolve" } },
		{ ok: true, summary: {} }, { context, candidates: [check] }, 0);
	assert.deepEqual(keeper.candidates, []);
});

// ---- the extension seam ----------------------------------------------------------------------------

/** Kernel requests run once on the prepared workspace, through the emitted kernel's own RPC. */
function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: "test-camp", ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")], { cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
/** Turn 1 walked into the morgue and met Arty, and closed; the player now asks him for the clippings. */
const metArty = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: MORGUE }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "person", who: "Arty Wilmot", name: "城市版编辑" }] }],
	["table.narrate", { call_id: "t1-c3", text: "城市版编辑挡在剪报室门口。" }],
]);
function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = pick(question) ?? (question.key === "exit" ? "continue" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown");
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
/** Jev: the player seeks what the gate guards, then the route finishes; the bind takes Persuade, no dice, social. */
const decideGate = (batch) => batch.family === BIND_FAMILY
	? answered(batch, (question) => ({ skill: "Persuade", bonus: "none", penalty: "none", intent: "social" })[question.key])
	: answered(batch, (question) => question.key === "exit" ? "finish" : question.criteria.seeks ? "seeks" : undefined);
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});
async function hybrid({ responses, admission, seed = PASS }) {
	const requests = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch) => decideGate(batch) } });
	const table = await openTable({
		realKernel: true, prepareWorkspace: metArty, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: seed },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		...(admission ? { laneResponses: { admission } } : {}),
		responses: responses.map((response) => (context) => { requests.push(context); return response; }),
	});
	return { table, requests };
}

test("the clerk rolls the gatekeeper's check with its claim through the gateway; the Keeper's note names the obligation step, receipt and page", async (t) => {
	const { table, requests } = await hybrid({ responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑松了口，放你下楼。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("我请编辑看在老同行的面子上放我进剪报室");
	const telemetry = table.telemetry("test-camp");
	const row = telemetry.find((entry) => entry.tool === "resolve" && entry.origin === "policy");
	assert.ok(row?.ok, "the clerk's resolve landed");
	assert.equal(row.clerk, "stated_obligation");
	assert.equal(row.basis.obligation, ACCESS, "the operation carries basis: obligation <handle>");
	const admission = telemetry.find((entry) => entry.lane === "admission" && entry.origin === "policy");
	assert.equal(admission?.basis?.obligation, ACCESS, "so the §32 research reads obligation checks as their own row");
	const note = clerkNotes(requests.at(-1)).find((entry) => entry.clerk_did);
	const did = note.clerk_did.find((entry) => entry.operation === "resolve");
	assert.match(did.obligation, new RegExp(`^obligation ${ACCESS}: Persuade \\(regular\\) passed, settled; receipt \\S+; pdf p\\.448$`));
	assert.deepEqual(did.result.obligation, { handle: ACCESS, settled: true });
	assert.equal(note.obligation_open, undefined, "nothing crossed");
});

test("a clerk refusal stays off the Keeper's refusal budget: recorded on the clerk's side, never struck against the class", async (t) => {
	const refuse = () => fauxAssistantMessage(JSON.stringify({ verdict: "not_authorized", grounds: "test: the player did not choose it" }));
	const attempt = (goal) => fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target: "Arty Wilmot", goal, method: goal } })], { stopReason: "toolUse" });
	const { table } = await hybrid({
		// Three refusals of one class (resolve, needs, action_not_authorized): the clerk's check, then two Keeper attempts.
		admission: [refuse, refuse, refuse],
		responses: [attempt("请他通融一下"), attempt("换个说法再请他通融"), fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑摇头。" })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我请编辑看在老同行的面子上放我进剪报室");
	const telemetry = table.telemetry("test-camp");
	const clerk = telemetry.find((entry) => entry.lane === "refusals" && entry.origin === "policy");
	assert.ok(clerk, "the clerk's refusal is recorded on its side");
	assert.deepEqual([clerk.reason, clerk.counted, clerk.clerk, clerk.refusal], ["clerk_refusal", false, "stated_obligation", "action_not_authorized"]);
	const keeperRefused = telemetry.filter((entry) => entry.tool === "resolve" && entry.ok === false && entry.origin !== "policy");
	assert.equal(keeperRefused.length, 2, "the Keeper's two attempts reached the review and were refused");
	assert.deepEqual(telemetry.filter((entry) => entry.lane === "refusals" && entry.reason === "class_limit"), [],
		"two Keeper strikes of the class: the clerk's refusal is not the third");
	assert.ok(!telemetry.some((entry) => entry.code === "blocked" && entry.reason === "refusal_budget"));
	const narrate = telemetry.find((entry) => entry.tool === "narrate");
	assert.equal(narrate?.ok, true);
});

test("a clerk step that crossed an open obligation is one obligation_open line beside clerk did; an obligation step names step, receipt and page (stub ports)", async () => {
	const handlers = new Map();
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => handlers.get(name)?.(value) };
	const engine = createHybridEngine({ env: {}, decision: null, record: () => {} });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	const source = "a".repeat(64);
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method) => method === "table.capsule"
		? { where: { scene: MORGUE }, present: [], _context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 3, source_revision: source } }
		: method === "table.status" ? { turn: 3, state: "open", receipts: [] } : {} });
	// The gateway answers as the kernel does: a clue that crossed the gate, then the gate's own settled check.
	const answers = [
		{ status: "succeeded", receipts: ["clue-1"], result: { receipts: ["clue-1"], obligation_open: ACCESS } },
		{ status: "succeeded", receipts: ["roll-1"], result: { receipt: "roll-1", outcome: { skill: "Charm", passed: false, level: "failure" },
			obligation: { handle: ACCESS, settled: false, book: "Arty refuses." } } },
	];
	bus.emit("coc:operation-dispatcher", { dispatch: async () => answers.shift() });
	const plan = engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "go", session: {} });
	const invocation = (step) => ({ runId: "run-1", stepId: step, operationId: `${step}/op1`, origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true }, invocation("s1"));
	const clue = { key: "apply:clue:x", verb: "apply", family: "clue", label: "Reveal clue x", source: "t", bound: { kind: "clue", clue: "x" }, unbound: [], clerk: "declared_bookkeeping" };
	const row = { handle: ACCESS, state: "open", next: { kind: "check", difficulty: "regular" }, source: [{ page: 448 }] };
	const gate = { key: `resolve:obligation:${ACCESS}`, verb: "resolve", family: "obligation_check", label: "the gate", source: "table.apply.options",
		bound: { obligation: ACCESS, skill: "Charm", intent: "social" }, unbound: [], clerk: "stated_obligation",
		basis: { read: "table.apply.options", path: "obligations[0]", row, obligation: ACCESS, step: "check" } };
	await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: clue } }, invocation("s2"));
	await plan.ports.operations.execute({ origin: "policy", operation: "execute", params: { candidate: gate } }, invocation("s3"));
	const [message] = await plan.ports.projection.project({ view: { policyState: { view: {} } }, stepId: "s4", step: { kind: "infer", purpose: "compose", reason: "finish" } });
	const note = JSON.parse(message.content);
	assert.equal(note.clerk_did.length, 2);
	assert.equal(note.obligation_open.length, 1, "one line for the crossing");
	assert.match(note.obligation_open[0], new RegExp(`^obligation ${ACCESS} is open and the clerk's step "Reveal clue x" crossed what it guards \\(receipt clue-1\\)`));
	assert.equal(note.clerk_did[0].obligation, undefined, "a clue step is no obligation step");
	assert.equal(note.clerk_did[1].obligation, `obligation ${ACCESS}: Charm (regular) failed, still open (book: Arty refuses.); receipt roll-1; pdf p.448`);
});

/** The run on a real Pi session over the emitted kernel, arriving at the morgue with Arty not yet met; Jev is a stub. */
async function arrival({ fact, responses, firstExit = "finish", bind = { skill: "Persuade", bonus: "none", penalty: "none", intent: "social" } }) {
	const decisions = [], requests = [], calls = [];
	let routes = 0;
	const probe = { name: "so04-call-probe", factory(pi) { pi.on("tool_call", (event) => { calls.push({ id: event.toolCallId, tool: event.toolName, input: structuredClone(event.input) }); }); } };
	// The §135.30 compile answers `unknown` (the default), so nothing clears and the obligation reaches the fact question.
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch) => { decisions.push(batch); return batch.family === BIND_FAMILY
		? answered(batch, (question) => bind[question.key])
		: batch.family === COMPILE_FAMILY ? answered(batch)
		: (routes++, answered(batch, (question) => question.key === "exit" ? (routes === 1 ? firstExit : "finish") : question.criteria.seeks ? fact : undefined)); } } });
	const table = await openTable({
		realKernel: true, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: PASS },
		prepareWorkspace: (workspace) => kernelSteps(workspace, [["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
			["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: MORGUE }] }], ["table.narrate", { call_id: "t1-c2", text: "你到了报馆。" }]]),
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, probe],
		responses: responses.map((response) => (context) => { requests.push(context); return response; }),
	});
	return { table, decisions, requests, calls };
}
const factQuestions = (decisions) => decisions.filter((batch) => batch.family === ROUTE_FAMILY).flatMap((batch) => batch.questions.filter((question) => question.criteria.seeks));

test("seeks at arrival: the meeting is carried directly under the book's name, the check is bound and rolled with its claim, and no LLM step is spent on them", async (t) => {
	const { table, decisions, calls } = await arrival({ fact: "seeks", responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑松口了。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("我想请人帮我翻出科比特宅的旧剪报");
	const clerk = calls.filter((value) => value.id.startsWith("clerk:"));
	assert.deepEqual(clerk.slice(0, 2).map((value) => value.tool === "apply" ? value.input.effects : value.input.action.obligation),
		[[{ kind: "person", who: "Arty Wilmot", name: "Arty Wilmot",
			why: 'The book puts Arty Wilmot here for "Access to the Globe clippings", under the book\'s name; player: "我想请人帮我翻出科比特宅的旧剪报"' }], ACCESS],
		"the meeting (its why composed), then the claimed check");
	const telemetry = table.telemetry("test-camp");
	assert.ok(telemetry.some((row) => row.tool === "resolve" && row.origin === "policy" && row.ok && row.basis?.obligation === ACCESS));
	const infers = telemetry.filter((row) => row.lane === "run" && row.event === "llm_bound");
	assert.deepEqual(infers, [], "no LLM bind for the meeting or the check");
	assert.equal(factQuestions(decisions).filter((question) => /globe-unpublished-story/.test(question.target)).length >= 1, true);
	assert.ok(decisions.some((batch) => batch.family === BIND_FAMILY && batch.questions.some((question) => question.key === "skill")), "the check's approach was a Jev bind");
});

test("SL-12 (§135.28): Jev cannot tell the approach -- the clerk rolls the rules default, the first of the investigator's highest, with no LLM step", async (t) => {
	const { table, calls, requests } = await arrival({ fact: "seeks", bind: { skill: "unknown", bonus: "none", penalty: "none", intent: "social" },
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑松口了。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("我想请人帮我翻出科比特宅的旧剪报");
	const roll = calls.find((value) => value.id.startsWith("clerk:") && value.input.action?.obligation === ACCESS);
	// Thomas Hayes: Intimidate 45 and Fast Talk 45 are his highest of the four; Intimidate is stated first.
	assert.deepEqual([roll?.input.action.skill, roll?.input.action.intent], ["Intimidate", "social"]);
	const telemetry = table.telemetry("test-camp");
	const row = telemetry.find((entry) => entry.tool === "resolve" && entry.origin === "policy" && entry.ok);
	assert.deepEqual([row?.basis?.obligation, row?.basis?.binding, row?.basis?.rule_default], [ACCESS, "rule-default", { skill: { value: "Intimidate", rule: "highest_offered_skill" } }],
		"the default is on the operation's basis, which every row of the call carries");
	const bind = telemetry.find((entry) => entry.lane === "run" && entry.event === "bind" && entry.candidate === `resolve:obligation:${ACCESS}`);
	assert.deepEqual(bind.bindings.filter((entry) => ["skill", "intent", "goal"].includes(entry.name)).map((entry) => [entry.name, entry.path]),
		[["goal", "composed"], ["skill", "rule-default"], ["intent", "jev"]]);
	assert.equal(requests.length, 1, "one model request, the compose: none for the approach");
	assert.ok(!telemetry.some((entry) => entry.event === "llm_bound"), "no LLM bind");
});

test("not at arrival: the obligation issues nothing and is not asked again this run", async (t) => {
	// The first route asks for more material, so a second route follows on the same run.
	const { table, decisions, calls } = await arrival({ fact: "not", firstExit: "read_more", responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你在报馆里转了一圈。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("我在报馆里随便看看");
	assert.ok(!calls.some((value) => value.id.startsWith("clerk:") && (value.input.action?.obligation || value.input.effects?.some((effect) => effect.who === "Arty Wilmot"))),
		"no meeting and no claimed check by the clerk");
	const asked = factQuestions(decisions).filter((question) => /globe-unpublished-story/.test(question.target));
	const routes = decisions.filter((batch) => batch.family === ROUTE_FAMILY);
	assert.equal(routes.length, 2, "a second route followed");
	assert.equal(asked.length, 1, "asked once; not again on the next route");
	assert.ok(!allText(routes[1]).includes(`resolve:obligation`) && !routes[1].questions.some((question) => question.criteria.seeks), "the second route does not carry it");
});
