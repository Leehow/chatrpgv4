/**
 * SL-02 (spec pi-native-single-loop, contract §135.2/§135.3): host-issued candidates from real state, the clerk's
 * closed authority, and the combat session split (direct / Jev bind / LLM) of the "parameters-only steps never go
 * to the LLM" ruling.
 *
 * The kernel is the subject of every state read here, so the reads come from the emitted kernel on a real
 * campaign of the shipped starter, driven through its own RPC; the policy half is pure (`step-policy.ts`).
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRealCampaign } from "./harness.mjs";
import { pinContactImpression } from "./natural-npc-contact.mjs";
import { buildCandidates, keeperCall, obligationCandidates } from "../../runtime/jev/candidates.ts";
import { compileRows } from "../../runtime/jev/compile-rows.ts";
import { actGated, compileBatch, compileReaches, fightStep } from "../../runtime/jev/route-compile.ts";
import { bindBatch, bindingOf, CLERK_AUTHORITY, initialView, interpretBind, next, routeBatch, settleCheckSelection, settleCompile, settleRead, settleRoute, startStep } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "camp";
const scope = { owner: `campaign:${CAMPAIGN}`, campaign: CAMPAIGN, worldline: "main", loop: 0, audience: "keeper" };
const context = { scene: "commission-briefing", clock: null, present: [], receipts: [] };

/** The emitted kernel over its JSONL RPC on a fresh workspace with one real campaign of The Haunting. */
function kernel(t) {
	const workspace = mkdtempSync(join(tmpdir(), "sl02-candidates-"));
	createRealCampaign(workspace, CAMPAIGN);
	const child = spawn(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
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
/** Open turn 1 and start a fight the way the live table did: pin the landlord a stat block, then attack him. */
async function fight(call) {
	await call("table.open");
	const opened = await call("table.player_input", { text: "我揍他" });
	const turn = opened.turn;
	await call("table.apply", { call_id: `t${turn}-c1`, effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] });
	await call("table.resolve", { call_id: `t${turn}-c2`, action: { intent: "combat", goal: "hit him", method: "fists", target: "Steven Knott", weapon: "unarmed" } });
	return turn;
}
const allText = (value) => JSON.stringify(value);

test("candidates come from the kernel's own reads: each carries its clerk authority and kernel row, and nothing internal reaches Jev", async (t) => {
	const { call } = kernel(t);
	// The table is locked to natural-npc 1.4.4 (§178.5), so meeting Knott is still a pending `contact` check for the clerk.
	for (const [method, params] of pinContactImpression()) await call(method, params);
	await call("table.open");
	await call("table.player_input", { text: "我先看看这间办公室" });
	const state = await reads(call);
	const candidates = buildCandidates(state, "我先看看这间办公室");
	assert.ok(candidates.length > 0);
	for (const candidate of candidates) {
		assert.ok(CLERK_AUTHORITY.includes(candidate.clerk), `${candidate.key} names a clerk authority`);
		assert.ok(candidate.basis && typeof candidate.basis === "object" && typeof candidate.basis.read === "string", `${candidate.key} carries its kernel row`);
	}
	// Moves are exactly the kernel's available ones: a gate the kernel reports unmet is not a candidate at all.
	const available = state.applyOptions.candidates.filter((row) => row.effect.kind === "move" && row.description?.unlock_when?.met !== false).map((row) => `apply:move:${row.effect.to}`);
	assert.deepEqual(candidates.filter((candidate) => candidate.family === "move").map((candidate) => candidate.key), available);
	assert.ok(state.applyOptions.candidates.some((row) => row.description?.unlock_when?.met === false), "the fresh campaign does have gated moves");
	// The person present and not yet introduced, with no label of the table's own: no data source gives the name (an
	// improvised name), so staging him is the Keeper's to propose and is not issued to the clerk (§135.28).
	assert.equal(candidates.find((candidate) => candidate.key === "apply:person:Steven Knott"), undefined);
	// With the table's own label he is the clerk's, bound whole: the name is the label, the why is composed.
	const labelled = buildCandidates({ ...state, capsule: { ...state.capsule, present: state.capsule.present.map((row) =>
		row.name === "Steven Knott" ? { ...row, untold: { ...row.untold, label: "房东" } } : row) } }, "我先看看这间办公室");
	const person = labelled.find((candidate) => candidate.key === "apply:person:Steven Knott");
	assert.equal(person?.clerk, "declared_bookkeeping");
	assert.equal(bindingOf(person), "none");
	assert.deepEqual([person.bound.name, person.composed], ["房东", ["why"]]);
	assert.equal(person.bound.why, 'The table\'s own label for Steven Knott in this scene, staged for the player\'s declared action; player: "我先看看这间办公室"');
	// The check groups are ordinary agent candidates, each backed by an issued decision.
	const checkGroups = candidates.filter(candidate => candidate.unbound.some(parameter => parameter.binder === 'resolve-selection'));
	assert.deepEqual(new Set(checkGroups.map(candidate => candidate.bound.decision)),
		new Set(state.resolveOptions.selection.options.filter(option => !['combat', 'chase'].includes(option.family) || option.action.decision === 'chase:start').map(option => option.action.decision)));
	assert.ok(checkGroups.every(candidate => candidate.checkOwner === 'jev'));
	assert.equal(candidates.some(candidate => candidate.family === 'check_selection'), false, 'no second global selector before compose');
	// natural-npc 1.4.4 declares a first-impression `contact` check for meeting him: the clerk's by authority (b).
	const contact = candidates.find((candidate) => candidate.family === "mod_check");
	assert.equal(contact?.clerk, "mod_contact");
	assert.equal(contact?.bound.target, "Steven Knott");
	assert.equal(contact?.basis.path, "mods.pending_contacts[0]");
	assert.deepEqual(contact?.basis.row.rule, {trigger: "contact", scope: "actor-target", reusable: true},
		"the emitted kernel's contact declaration travels through the candidate to admission");
	// What Jev reads: no internal kernel tag, no host basis, no clerk label.
	const { batch } = routeBatch({ ...initialView({ runId: "r", rawInput: "x", context, candidates, readFirst: false }) }, scope, []);
	const shown = allText(batch.state) + allText(batch.questions);
	for (const hidden of ["available_route_not_player_choice", '"authority"', '"basis"', '"clerk"', "declared_bookkeeping"]) assert.ok(!shown.includes(hidden), `Jev never sees ${hidden}`);
	// §134.18: the opening scene states the commission, an accept whose candidate is the kernel's settlement apply.
	assert.deepEqual(obligationCandidates(state).map((candidate) => [candidate.key, candidate.verb, candidate.family]),
		[["apply:obligation:knott-accept-commission", "apply", "obligation_check"]]);
});

test("boss only: nobody off the roster, no rule family without its session, no effect kind the kernel does not issue as a candidate", () => {
	const candidates = buildCandidates({
		capsule: { where: { assets: [{ kind: "map", name: "floor plan" }] }, present: [{ name: "A", called: { name: "甲" } }] },
		applyOptions: { candidates: [{ effect: { kind: "cash", delta: -5 } }, { effect: { kind: "damage", target: "A" } }, { effect: { kind: "move", to: "b" }, description: { unlock_when: { met: false } } }] },
		resolveOptions: { profiles: [{ actor: "Tom" }], decisions: [{ name: "sanity:check", family: "sanity" }, { name: "combat:attack", family: "combat" }, { name: "healing:first-aid", family: "healing" }],
			context: { session: { kind: "sanity_bout", status: "active", turn_of: "tom", actions: [{ decision: "sanity:bout-tick", actor: "tom" }] } } },
	}, "anything");
	assert.deepEqual(candidates.map(candidate => candidate.family), ['sanity'], 'only the already-active sanity bout is issued; unrelated actions remain absent');
	assert.deepEqual(candidates[0].unbound[0].options, ['sanity:bout-tick']);
});

test("SL-07: an NPC's pending defence carries the kernel's standing, so it is bound and runs directly -- never a decide, never an infer", async (t) => {
	const { call } = kernel(t);
	await fight(call);
	const state = await reads(call);
	const pending = state.resolveOptions.context.session.pending_defense;
	assert.equal(pending.for, "npc");
	assert.deepEqual(pending.options, ["dodge", "fight_back", "none"], "the options stay as issued");
	assert.equal(pending.standing.basis, "rule-default");
	assert.ok(pending.options.includes(pending.standing.defense));
	const candidates = buildCandidates(state, "我揍他");
	const defend = candidates.find((candidate) => candidate.forced);
	assert.equal(defend.bound.decision, "combat:defend");
	assert.equal(defend.bound.actor, "steven-knott");
	assert.equal(defend.bound.defense, pending.standing.defense);
	assert.deepEqual(defend.unbound, []);
	assert.equal(bindingOf(defend), "none");
	assert.equal(defend.clerk, "session_step");
	// The clerk basis names the standing and its basis; the kernel row is the one it came from.
	assert.equal(defend.basis.path, "context.session.pending_defense");
	assert.deepEqual(defend.basis.standing, pending.standing);
	assert.equal(candidates.filter((candidate) => candidate.family === "move").length, 0, "no scene move while the fight runs");
	// Folded into a run, structure puts it first and it is direct: no route question, no bind question, no LLM.
	const view = initialView({ runId: "r", rawInput: "我揍他", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	assert.deepEqual([view.pending[0].kind, view.pending[0].purpose, view.pending[0].candidate.key], ["direct", "execute", defend.key]);
	assert.equal(next(view).kind, "direct");
	const { tool, args } = keeperCall(defend);
	assert.equal(tool, "resolve");
	assert.deepEqual({ ...args.action, goal: undefined, method: undefined },
		{ intent: "combat", decision: "combat:defend", actor: "steven-knott", defense: pending.standing.defense, goal: undefined, method: undefined });
	// A standing whose word the kernel did not issue is not trusted: the closed choice stays.
	const odd = buildCandidates({ ...state, resolveOptions: { ...state.resolveOptions, context: { ...state.resolveOptions.context,
		session: { ...state.resolveOptions.context.session, pending_defense: { ...pending, standing: { defense: "parry", basis: "keeper" } } } } } }, "我揍他");
	assert.equal(bindingOf(odd.find((candidate) => candidate.forced)), "closed");
});

test("an NPC's pending defence without a standing keeps the closed choice: several options are a Jev bind, one runs directly, Jev's unknown goes to the Keeper", async (t) => {
	const { call } = kernel(t);
	await fight(call);
	const live = await reads(call);
	// A kernel that predates §11.5.2 issues no standing.
	const { standing: _standing, ...unstanding } = live.resolveOptions.context.session.pending_defense;
	const state = { ...live, resolveOptions: { ...live.resolveOptions, context: { ...live.resolveOptions.context,
		session: { ...live.resolveOptions.context.session, pending_defense: unstanding } } } };
	const candidates = buildCandidates(state, "我揍他");
	const defend = candidates.find((candidate) => candidate.forced);
	assert.equal(defend.bound.decision, "combat:defend");
	assert.deepEqual(defend.unbound.map((value) => [value.name, value.vocabulary, value.options]), [["defense", "closed", ["dodge", "fight_back", "none"]]]);
	assert.equal(defend.basis.standing, undefined);
	const view = initialView({ runId: "r", rawInput: "我揍他", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	assert.deepEqual([view.pending[0].kind, view.pending[0].purpose, view.pending[0].candidate.key], ["decide", "bind", defend.key]);
	// The bind question carries each option's rule meaning and the fight as the kernel shows it.
	const batch = bindBatch(view, defend, scope, []);
	assert.match(batch.questions[0].criteria.fight_back, /Fighting/);
	assert.ok(allText(batch.state).includes("hp_max"));
	const answer = (choice, confidence = 0.9) => ({ batchId: batch.id, status: "complete", issues: [], coverage: { required: ["defense"], answered: ["defense"], unknown: [] },
		answers: { defense: { status: "answered", type: "choice", choice, confidence } } });
	assert.deepEqual(interpretBind(defend, batch, answer("fight_back"), 0.6).pending.map((item) => [item.kind, item.purpose, item.extra?.defense]), [["direct", "execute", "fight_back"]]);
	// §135.28: a defence among several has no rules default, so Jev's unknown hands the turn to the Keeper -- never an LLM bind.
	assert.deepEqual(interpretBind(defend, batch, answer("unknown"), 0.6).pending.map((item) => [item.kind, item.purpose, item.reason, item.extra?.unresolved]),
		[["infer", "compose", "check_unresolved", ["defense"]]]);
	// One legal option: bound at build time, run directly.
	const single = buildCandidates({ ...state, resolveOptions: { ...state.resolveOptions, context: { ...state.resolveOptions.context,
		session: { ...state.resolveOptions.context.session, pending_defense: { ...unstanding, options: ["dodge"] } } } } }, "我揍他");
	const one = single.find((candidate) => candidate.forced);
	assert.equal(one.bound.defense, "dodge");
	assert.equal(bindingOf(one), "none");
});

test("SL-07: a handout already handed over is never a candidate again -- by the world's handouts_shown, not by its words", async (t) => {
	const { call } = kernel(t);
	await call("table.open");
	const opened = await call("table.player_input", { text: "我看看那封信" });
	const before = await reads(call);
	const handout = buildCandidates(before, "我看看那封信").find((candidate) => candidate.family === "handout");
	assert.ok(handout, "the opening scene's handout is offered before it is shown");
	const asset = before.capsule.where.assets.find((row) => row.kind === "handout" && row.name === handout.bound.name);
	await call("table.apply", { call_id: `t${opened.turn}-c1`, effects: [{ kind: "handout", name: asset.name }] });
	const after = await reads(call);
	const [shown] = after.applyOptions.context.handouts_shown;
	assert.ok(shown, "the kernel issues the handed-over handout as world state");
	const again = buildCandidates(after, "我看看那封信");
	assert.equal(again.filter((candidate) => candidate.family === "handout").length, 0, "the scene asset is not offered again");
	// Located by the read under its handle, it is not offered either.
	const located = buildCandidates({ ...after, located: [{ handle: shown, label: asset.name, kind: "handout" }] }, "我看看那封信");
	assert.equal(located.filter((candidate) => candidate.family === "handout").length, 0, "nor as a located entity");
	// The same row with its world state withheld would be offered: the state is what consumes it, not the name.
	const unmarked = { ...after, capsule: { ...after.capsule, where: { ...after.capsule.where, assets: after.capsule.where.assets.map(({ shown: _s, ...row }) => row) } } };
	assert.equal(buildCandidates(unmarked, "我看看那封信").filter((candidate) => candidate.family === "handout").length, 1);
});

test("an NPC's own turn of a fight is the forced npc_act step (§143.4) -- no closed bind over the actions the kernel issues him", async (t) => {
	const { call } = kernel(t);
	const turn = await fight(call);
	await call("table.resolve", { call_id: `t${turn}-c3`, action: { intent: "combat", decision: "combat:defend", goal: "combat:defend", method: "combat:defend", actor: "steven-knott", defense: "dodge" } });
	const state = await reads(call);
	const session = state.resolveOptions.context.session;
	assert.equal(session.turn_of, "steven-knott");
	assert.deepEqual(session.actions.map((action) => action.decision), ["combat:attack", "combat:maneuver", "combat:flee", "combat:end"], "the kernel still issues his actions");
	const candidates = buildCandidates(state, "我揍他");
	const turnCandidate = candidates.find((candidate) => candidate.forced);
	assert.deepEqual([turnCandidate.key, turnCandidate.clerk, turnCandidate.family, turnCandidate.bound], [`npc_act:steven-knott:r${session.round}`, "npc_act", "npc_act",
		{ npc: "steven-knott", trigger: "turn" }]);
	assert.deepEqual(turnCandidate.unbound, [], "nothing is bound before his act is written: the act's own step binds it");
	assert.equal(candidates.filter((candidate) => candidate.family === "combat").length, 0, "the NPC's actions are not route questions about the player's words");
	const view = initialView({ runId: "r", rawInput: "我揍他", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	assert.deepEqual([view.pending[0].kind, view.pending[0].purpose, view.pending[0].candidate.key], ["direct", "execute", turnCandidate.key], "forced: it runs first");
	// What his act can be bound to is the kernel's own read (§143.3): the fight's opponent and the weapon in his hands.
	const options = await call("npc.act.options", { name: "Steven Knott" });
	const attack = options.ways.find((way) => way.way === "attack");
	assert.deepEqual([attack.params.target.map((option) => option.value), attack.params.weapon.map((option) => option.value)], [["thomas-hayes"], ["unarmed"]]);
});

test("the player's declared attack: one target and weapon are bound, several targets are a Jev bind, and it runs once per turn", () => {
	const session = (targets) => ({ kind: "combat", status: "active", round: 3, turn_of: "tom", pending_defense: null,
		actions: [{ decision: "combat:attack", actor: "tom", targets, weapons: ["unarmed"] }, { decision: "combat:flee", actor: "tom" }],
		participants: [{ name: "tom", label: "Tom", side: "investigator", hp: 10, hp_max: 10 }, ...targets.map((name) => ({ name, label: name, side: "npc", hp: 5, hp_max: 5 }))] });
	const build = (targets) => buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: session(targets) } } }, "继续揍他");
	const one = build(["knott"]).find((candidate) => candidate.bound.decision === "combat:attack");
	assert.equal(one.key, "resolve:combat:attack:tom", "the player's action is keyed without the round: once per turn");
	assert.deepEqual([one.bound.target, one.bound.weapon, one.bound.goal, "actor" in one.bound], ["knott", "unarmed", "继续揍他", false]);
	assert.equal(bindingOf(one), "none");
	assert.equal(one.forced, undefined, "the player's own action waits for the route question: it is his declaration, not structure");
	const two = build(["knott", "ruth"]).find((candidate) => candidate.bound.decision === "combat:attack");
	assert.equal(bindingOf(two), "closed");
	assert.deepEqual(two.unbound.map((value) => [value.name, value.options]), [["target", ["knott", "ruth"]]]);
	// A consumed key is not offered again in the same run.
	assert.equal(buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: session(["knott"]) } } }, "x", new Set([one.key]))
		.some((candidate) => candidate.key === one.key), false);
});

test("the player's answer to a choice that was already open settles that choice; one opened during the run is left to the Keeper", () => {
	const session = { kind: "combat", status: "active", round: 4, turn_of: "knott",
		pending_defense: { for: "player", actor: "tom", attacker: "knott", options: ["dodge", "fight_back"] }, actions: [],
		participants: [{ name: "tom", label: "Tom", side: "investigator" }, { name: "knott", label: "Knott", side: "npc" }] };
	const resolveOptions = { context: { session, pending_choice: { name: "defense:knott-r4" } } };
	assert.deepEqual(buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions }, "躲开", new Set()), [], "not answering anything: the Keeper hands it back with ask");
	const [answer] = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions, answering: ["defense:knott-r4"] }, "躲开");
	assert.equal(answer.forced, true);
	const { args } = keeperCall(answer, { defense: "dodge" });
	assert.deepEqual(args.action.choice, { pending: "defense:knott-r4", option: "dodge" });
});

test("a selected flight answers the existing mechanics choice and lands its choice and combat-end receipts", async (t) => {
	const { call } = kernel(t);
	const { turn, n } = await knottsTurn(call, "fights_to_the_end");
	await call("table.apply", { call_id: `t${turn}-c${n}`, effects: [{ kind: "npc", name: "Steven Knott", action: "hold", why: "He hesitates." }] });
	const before = await reads(call);
	assert.equal(before.resolveOptions.context.session.turn_of, "thomas-hayes");
	const asked = await call("table.ask", { call_id: `t${turn}-c${n + 1}`, kind: "mechanics", options: ["accept", "flee"], binds: "combat:investigator-turn", text: "The doorway is open while he hesitates." });
	const input = "I choose to flee the fight through the open doorway.";
	const opened = await call("table.player_input", { text: input });
	const state = await reads(call);
	const pending = asked.pending_choice.name;
	const candidates = buildCandidates({ ...state, answering: [pending] }, input);
	const flight = candidates.find(candidate => candidate.bound.decision === "combat:flee");
	assert.ok(flight);
	assert.equal(flight.forced, undefined, "the issued choice alone does not select an escape");
	const { args } = keeperCall(flight);
	const settled = await call("table.resolve", { call_id: `t${opened.turn}-c1`, ...args });
	const status = await call("table.status");
	assert.ok(status.receipts.some(receipt => receipt.kind === "session" && receipt.family === "combat" && receipt.transition === "end" && receipt.outcome === "fled"), JSON.stringify(settled));
	assert.ok(status.receipts.some(receipt => receipt.kind === "choice" && receipt.pending === pending && receipt.option === "flee"), "the flight must consume the choice through the kernel's existing binding");
	const after = await reads(call);
	assert.equal(after.resolveOptions.context.session, null);
	assert.equal(after.resolveOptions.context.pending_choice, null, "the answered choice must not survive the ended fight");
	assert.deepEqual(args.action.choice, { pending, option: "flee" });
});

test("flight choice binding ignores stale, fresh, story and unissued choices without forcing the flight", () => {
	const session = { kind: "combat", status: "active", round: 4, turn_of: "tom", pending_defense: null,
		actions: [{ decision: "combat:flee", actor: "tom" }], participants: [{ name: "tom", label: "Tom", side: "investigator" }] };
	const choice = { name: "escape-r4", kind: "mechanics", options: ["accept", "flee"] };
	const build = (pending_choice, answering) => buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session, pending_choice } }, answering }, "I leave the fight.").find(candidate => candidate.bound.decision === "combat:flee");
	for (const [pending, answering] of [[choice, []], [choice, ["old-escape"]], [{ ...choice, name: "new-escape" }, [choice.name]],
		[{ ...choice, kind: "story" }, [choice.name]], [{ ...choice, options: ["accept"] }, [choice.name]]]) {
		const flight = build(pending, answering);
		assert.equal(keeperCall(flight).args.action.choice, undefined);
		assert.equal(flight.forced, undefined);
	}
	const answered = build(choice, [choice.name]);
	assert.deepEqual(keeperCall(answered).args.action.choice, { pending: choice.name, option: "flee" });
	assert.equal(answered.forced, undefined);
	assert.equal(actGated(answered, []), true, "an unselected offered escape remains gated");
	const view = initialView({ runId: "flight-choice", rawInput: "I leave the fight.", context, candidates: [answered], readFirst: false });
	const modelState = JSON.stringify([routeBatch(view, scope, []).batch.state, bindBatch(view, answered, scope, []).state]);
	assert.ok(!modelState.includes(choice.name), "runtime choice identity stays outside Jev's semantic questions");
	assert.ok(!modelState.includes('"choice"'), "receipt attachment does not prime a semantic selection");
});

/** Knott's own turn after his dodge, with a Keeper-written disposition (or none): the state SL-08 reads. */
async function knottsTurn(call, disposition) {
	const turn = await fight(call);
	let n = 3;
	if (disposition) await call("table.apply", { call_id: `t${turn}-c${n++}`, effects: [{ kind: "npc", name: "Steven Knott", disposition, why: "test fixture" }] });
	await call("table.resolve", { call_id: `t${turn}-c${n++}`, action: { intent: "combat", decision: "combat:defend", goal: "combat:defend", method: "combat:defend", actor: "steven-knott", defense: "dodge" } });
	return { turn, n };
}
const withSession = (state, change) => ({ ...state, resolveOptions: { ...state.resolveOptions, context: { ...state.resolveOptions.context,
	session: change(structuredClone(state.resolveOptions.context.session)) } } });

test("§143.4 (replaces SL-08's forced attack): the kernel still issues his standing attack; the builder binds nothing from it -- his turn is his own act", async (t) => {
	const { call } = kernel(t);
	await knottsTurn(call, "fights_to_the_end");
	const state = await reads(call);
	const session = state.resolveOptions.context.session;
	assert.equal(session.turn_of, "steven-knott");
	assert.deepEqual(session.standing_action, { action: "attack", basis: "rule-default", disposition: { disposition: "fights_to_the_end", basis: "keeper" },
		read: { hp_fraction: session.standing_action.read.hp_fraction, outnumbered: false, stance: "hostile" } });
	const candidates = buildCandidates(state, "我揍他");
	const forced = candidates.filter((candidate) => candidate.forced);
	assert.equal(forced.length, 1);
	const [act] = forced;
	assert.deepEqual([act.key, act.clerk, act.bound.npc], [`npc_act:steven-knott:r${session.round}`, "npc_act", "steven-knott"]);
	assert.equal(bindingOf(act), "none");
	// The basis carries the standing as a fact about him (the stakes and the Keeper's note read it); it decides nothing.
	assert.deepEqual(act.basis.row.standing_action, session.standing_action);
	assert.equal(candidates.filter((candidate) => candidate.family === "combat").length, 0, "no attack of the clerk's own");
	const view = initialView({ runId: "r", rawInput: "我揍他", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	assert.deepEqual([view.pending[0].kind, view.pending[0].purpose, view.pending[0].candidate.key], ["direct", "execute", act.key]);
	assert.equal(next(view).kind, "direct");
});

test("§143.4 (retires §142.14's release): with an intention under way on his card his turn is still his own act -- no forced blow to release", async (t) => {
	const { call } = kernel(t);
	const { turn, n } = await knottsTurn(call, "fights_to_the_end");
	await call("table.apply", { call_id: `t${turn}-c${n}`, effects: [{ kind: "npc", name: "Steven Knott", intends: "Get to the telephone and ring the police.", outcome: "attempted" }] });
	await call("table.narrate", { call_id: `t${turn}-c${n + 1}`, text: "诺特一边挡着，一边往电话那边挪。" });
	await call("table.player_input", { text: "我揍他" });
	const state = await reads(call);
	assert.equal(state.resolveOptions.context.session.turn_of, "steven-knott");
	assert.equal(state.resolveOptions.context.session.standing_action.action, "attack", "the standing attack still stands");
	const card = state.capsule.present.find((person) => person.name === "Steven Knott");
	assert.equal(card.history.intents[0].status, "attempted");
	const [act] = buildCandidates(state, "我揍他").filter((candidate) => candidate.forced);
	assert.equal(act.clerk, "npc_act", "the intention under way reaches his act through the situation packet, not through a release");
	const situation = await call("npc.situation", { name: "Steven Knott" });
	assert.deepEqual(situation.done.map((row) => [row.intent, row.status]), [["Get to the telephone and ring the police.", "attempted"]]);
});

test("§143.4: several weapons or targets are the act's parameters in the kernel's own read, never a bind the builder makes over the session view", async (t) => {
	const { call } = kernel(t);
	await knottsTurn(call, "fights_to_the_end");
	const live = await reads(call);
	const state = withSession(live, (session) => { session.actions[0].weapons = ["unarmed", "knife_medium"]; session.actions[0].targets = ["thomas-hayes", "ruth"]; return session; });
	const forced = buildCandidates(state, "我揍他").filter((candidate) => candidate.forced);
	assert.deepEqual(forced.map((candidate) => [candidate.clerk, candidate.unbound.length]), [["npc_act", 0]]);
	const options = await call("npc.act.options", { name: "Steven Knott" });
	assert.deepEqual(options.ways.map((way) => way.way).slice(0, 2), ["attack", "flee"], "on his turn of the fight: the fight's own actions first");
	assert.ok(!options.ways.some((way) => way.way === "first_blow" || way.way === "leave"), "in a fight there is no first blow and no walking out");
});

test("§143.4: hold, flee, no standing or an untrusted one -- his turn of a fight is his own act; a Keeper's hold on his turn still passes it (§142.5)", async (t) => {
	const { call } = kernel(t);
	const { turn, n } = await knottsTurn(call, "fights_to_the_end");
	const live = await reads(call);
	// §142.5: a hold written on his own turn is how he spends it -- the kernel passes the turn on, so the fight no longer
	// waits on him (the Keeper's veto of the table's act, spec D7).
	const applied = await call("table.apply", { call_id: `t${turn}-c${n}`, effects: [{ kind: "npc", name: "Steven Knott", action: "hold", why: "He hesitates." }] });
	assert.equal(applied.turn_passed[0].passed, "steven-knott");
	assert.notEqual((await reads(call)).resolveOptions.context.session.turn_of, "steven-knott");
	const standings = [{ action: "hold", basis: "keeper" }, { action: "flee", basis: "rule-default", disposition: { disposition: "fights_then_flees", basis: "authored" } },
		undefined, { action: "attack", basis: "guess" }];
	for (const standing of standings) {
		const state = withSession(live, ({ standing_action: _standing, ...session }) => (standing ? { ...session, standing_action: standing } : session));
		const forced = buildCandidates(state, "我揍他").filter((candidate) => candidate.forced);
		assert.deepEqual(forced.map((candidate) => candidate.clerk), ["npc_act"], `${standing?.action ?? "no"} standing`);
		assert.equal(buildCandidates(state, "我揍他").filter((candidate) => candidate.family === "combat").length, 0);
	}
});

test("SL-08: an NPC's turn without a disposition is a forced closed bind that infers one from his own parameters, once, as the clerk's write", async (t) => {
	const { call } = kernel(t);
	const { turn, n } = await knottsTurn(call, null);
	const state = await reads(call);
	const session = state.resolveOptions.context.session;
	assert.equal(session.standing_action, undefined, "no disposition, no standing");
	const fighter = await call("table.look", { focus: "npc", name: session.turn_of });
	assert.equal(fighter.combat_disposition.disposition, null);
	const candidates = buildCandidates({ ...state, fighter }, "我揍他");
	const forced = candidates.filter((candidate) => candidate.forced);
	assert.equal(forced.length, 1, "the inference comes before any bind over his actions");
	const [inference] = forced;
	assert.equal(inference.key, "apply:npc-disposition:steven-knott");
	assert.equal(inference.clerk, "disposition_inference");
	assert.equal(bindingOf(inference), "closed");
	assert.deepEqual(inference.unbound[0].options, ["fights_to_the_end", "fights_then_flees", "avoids_fighting", "surrenders"]);
	assert.deepEqual(inference.unbound[0].descriptions, fighter.combat_disposition.options, "the criteria are the kernel's table descriptions");
	// The material is his own parameters as the card issued them, plus the first impression natural-npc settled when the
	// party met him (§178.3: rolled at the turn's start), and the basis names which were read.
	const settled = state.capsule.mods.relationships.find((row) => row.target === fighter.name)?.impression;
	assert.ok(settled, "he was met, so his first impression is settled");
	const material = { ...fighter.combat_disposition.material, first_impression: settled };
	assert.deepEqual(inference.detail.person, material);
	assert.deepEqual(inference.basis.row.read, Object.keys(material));
	const view = initialView({ runId: "r", rawInput: "我揍他", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	assert.deepEqual([view.pending[0].kind, view.pending[0].purpose, view.pending[0].candidate.key], ["decide", "bind", inference.key]);
	const batch = bindBatch(view, inference, scope, []);
	assert.deepEqual(batch.questions.map((question) => question.key), ["disposition"]);
	assert.match(batch.questions[0].instructions, /own parameters/);
	assert.ok(allText(batch.state).includes(Object.values(fighter.combat_disposition.material)[0].slice(0, 20)), "Jev reads the material");
	const answer = (choice, confidence) => ({ batchId: batch.id, status: "complete", issues: [], coverage: { required: ["disposition"], answered: ["disposition"], unknown: [] },
		answers: { disposition: { status: "answered", type: "choice", choice, confidence } } });
	const confident = interpretBind(inference, batch, answer("fights_then_flees", 0.8), 0.6).pending;
	assert.deepEqual(confident.map((item) => [item.kind, item.purpose, item.extra?.disposition]), [["direct", "execute", "fights_then_flees"]]);
	const { tool, args } = keeperCall(inference, confident[0].extra);
	assert.equal(tool, "apply");
	assert.deepEqual(Object.keys(args.effects[0]).sort(), ["disposition", "kind", "name", "why"], "the model-visible shape: the host-only marker is added by the kernel extension, not here");
	// Below the gate the Keeper completes the same write (the operation-completion path).
	// Below the gate the disposition has no rules default: the Keeper is asked once and writes it (§135.28, never an LLM bind).
	assert.deepEqual(interpretBind(inference, batch, answer("fights_then_flees", 0.4), 0.6).pending.map((item) => [item.kind, item.purpose, item.reason]),
		[["infer", "adjudicate", "clerk_unbound"]]);
	// Once written, the card has it and nothing is inferred again: the next read issues the standing instead.
	await call("table.apply", { call_id: `t${turn}-c${n}`, effects: [{ ...args.effects[0], _inferred: { read: inference.basis.row.read } }] });
	const after = await reads(call);
	const card = await call("table.look", { focus: "npc", name: "steven-knott" });
	assert.deepEqual(card.combat_disposition, { disposition: "fights_then_flees", basis: "inferred" });
	assert.equal(after.resolveOptions.context.session.standing_action.basis, "rule-default");
	assert.ok(!buildCandidates({ ...after, fighter: card }, "我揍他").some((candidate) => candidate.clerk === "disposition_inference"));
	// A first impression an active Mod settled for him is material too, matched by the table's name for him.
	const impression = { reaction: "wary", disposition: "unfriendly" };
	const withImpression = buildCandidates({ ...state, fighter, capsule: { ...state.capsule, mods: { ...state.capsule.mods,
		relationships: [{ actor: "Thomas Hayes", target: fighter.name, decision: "npc-first-impression", impression }] } } }, "我揍他");
	const inferred = withImpression.find((candidate) => candidate.clerk === "disposition_inference");
	assert.deepEqual(inferred.detail.person.first_impression, impression);
	assert.ok(inferred.basis.row.read.includes("first_impression"));
});

/** A complete Jev answer: `pick(question)` returns `[choice, confidence, probabilities?]`. */
const jevAnswer = (batch, pick) => {
	const answers = Object.fromEntries(batch.questions.map((question) => {
		const [choice, confidence, probabilities] = pick(question);
		return [question.key, { status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } }];
	}));
	return { batchId: batch.id, status: "complete", issues: [], coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, answers };
};
/** The alias the compile question gives a row, read from the question itself. */
const rowAlias = (question, row) => Object.entries(question.criteria).find(([, value]) => value === row)?.[0];

test("§143.16 (NAF-17): on the investigator's own turn the clerk takes a fight step only when the compile read the declaration as it; his own turn is untouched (§143.4)", async (t) => {
	const { call } = kernel(t);
	const turn = await fight(call);
	await call("table.resolve", { call_id: `t${turn}-c3`, action: { intent: "combat", decision: "combat:defend", goal: "combat:defend", method: "combat:defend", actor: "steven-knott", defense: "dodge" } });
	// His turn (§143.4): the forced act of his own is no investigator's fight step and is never gated, whatever the compile read.
	const his = buildCandidates(await reads(call), "钱呢？你说的二十块，现在就给我。");
	assert.deepEqual(his.filter((candidate) => candidate.forced).map((candidate) => candidate.clerk), ["npc_act"]);
	assert.deepEqual(his.filter((candidate) => fightStep(candidate) || actGated(candidate, [])), [], "nothing of his is gated");
	// The Keeper's hold passes his turn (§142.5): the investigator's own turn, the session issuing the attack and the flight.
	await call("table.apply", { call_id: `t${turn}-c4`, effects: [{ kind: "npc", name: "Steven Knott", action: "hold", why: "He backs to the window, hands up." }] });
	const state = await reads(call);
	assert.equal(state.resolveOptions.context.session.turn_of, "thomas-hayes");
	const DEMAND = "钱呢？你说的二十块，现在就给我。";
	const candidates = buildCandidates(state, DEMAND);
	assert.deepEqual(candidates.filter(fightStep).map((candidate) => candidate.key), ["resolve:combat:attack:thomas-hayes", "resolve:combat:flee:thomas-hayes", "resolve:combat:end:thomas-hayes"],
		"the investigator's fight steps include the engine-bound ending; a manoeuvre still needs its goal");
	const rows = compileRows(state);

	/** One run: the compile answers `act`, the route answers `now` on the listed steps, then `ask_llm`. */
	const run = (act, now) => {
		const view = initialView({ runId: "r", rawInput: DEMAND, context, candidates, rows, readFirst: false });
		const compile = next(view);
		assert.deepEqual([compile.kind, compile.purpose], ["decide", "compile"], "the fight steps owe a compile");
		startStep(view, compile);
		const batch = compileBatch(view, scope, [], []);
		settleCompile(view, 1, batch, jevAnswer(batch, (question) => question.key === "act" ? [rowAlias(question, act[0]) ?? act[0], act[1], act[2]] : ["unclear", 0.9]), 5, 0.6);
		const route = next(view);
		assert.deepEqual([route.kind, route.purpose], ["decide", "route"]);
		startStep(view, route);
		const { batch: asked, offered } = routeBatch(view, scope, []);
		const row = settleRoute(view, 2, asked, offered, jevAnswer(asked, (question) => {
			if (question.key === "exit") return ["ask_llm", 0.76];
			if (!("now" in question.criteria)) return ["not", 0.9];
			return now.includes(offered[Number(question.key.split("_")[1]) - 1].key) ? ["now", 0.92] : ["later", 0.9];
		}), 5, 0.6);
		return { view, row };
	};
	const ATTACK = "resolve:combat:attack:thomas-hayes", FLEE = "resolve:combat:flee:thomas-hayes", END = "resolve:combat:end:thomas-hayes";

	// The demand, its act below the gate and the margin: the route says now on the attack and on the flight, and selects neither.
	const demand = run(["none", 0.5, { none: 0.5, act_1: 0.3, unclear: 0.2 }], [ATTACK, FLEE]);
	assert.equal(demand.view.declaredActs, undefined, "no act cleared");
	assert.deepEqual([demand.row.detail.selected, demand.row.detail.act_gated], [[], [ATTACK, FLEE, END]]);
	assert.ok([ATTACK, FLEE].every((key) => demand.view.consumed.includes(key)), "the Keeper's for the run");
	assert.ok(!demand.view.pending.some((item) => item.candidate && fightStep(item.candidate)), "no clerk fight step pending");
	assert.deepEqual([next(demand.view).kind, next(demand.view).purpose, next(demand.view).reason], ["infer", "adjudicate", "ask_llm"], "the turn is the Keeper's");

	// "我又是一拳": the act cleared on the attack (the target left to the route and the attack's own bind): the route's now selects it;
	// the flight is not what was declared.
	const punch = run(["combat:attack", 1], [ATTACK, FLEE]);
	assert.deepEqual(punch.view.declaredActs, ["combat:attack"]);
	assert.deepEqual([punch.row.detail.selected, punch.row.detail.act_gated], [[ATTACK], [FLEE, END]]);
	assert.deepEqual([punch.view.pending[0].kind, punch.view.pending[0].purpose, punch.view.pending[0].candidate.key], ["direct", "execute", ATTACK],
		"one target and one weapon: the attack runs as it did");

	// The flight read as the act opens the flight; the attack was already the compile's to decide (another act: the Keeper's).
	const flight = run(["combat:flee", 0.9], [ATTACK, FLEE]);
	assert.deepEqual([flight.row.detail.selected, flight.row.detail.act_gated], [[FLEE], [END]]);
	assert.ok(flight.view.consumed.includes(ATTACK) && !flight.row.detail.offered_keys.includes(ATTACK), "decided by the compile, never offered to the route");
	const stopped = run(['combat:end', .95], [ATTACK, FLEE, END]);
	assert.deepEqual(stopped.row.detail.selected, [END]);
	assert.equal(stopped.view.pending[0].purpose, 'bind');
	assert.deepEqual(stopped.view.pending[0].candidate.unbound[0].options, state.resolveOptions.context.combat_outcomes);
});

test("§143.16: a flight the session issues alone still owes a compile -- the only read that can open it to the clerk", () => {
	// Nobody left to hit: the session issues the investigator no attack, only the flight.
	const session = { kind: "combat", status: "active", round: 3, turn_of: "tom", pending_defense: null,
		actions: [{ decision: "combat:flee", actor: "tom" }, { decision: "combat:end", actor: "tom" }],
		participants: [{ name: "tom", label: "Tom", side: "investigator" }, { name: "knott", label: "Knott", side: "npc", conditions: ["unconscious"] }] };
	const reads = { capsule: {}, applyOptions: {}, resolveOptions: { context: { session } } };
	const candidates = buildCandidates(reads, "我跑");
	assert.deepEqual(candidates.map((candidate) => candidate.key), ["resolve:combat:flee:tom"]);
	const rows = compileRows(reads);
	assert.deepEqual(rows.act.map((row) => row.id), ["combat:flee", "combat:end"]);
	assert.equal(compileReaches(candidates, rows), true, "the flight is read by the compile (fight_step)");
	assert.deepEqual([actGated(candidates[0], []), actGated(candidates[0], ["combat:flee"])], [true, false]);
	assert.equal(next(initialView({ runId: "r", rawInput: "我跑", context, candidates, rows, readFirst: false })).purpose, "compile");
});

test('an issued initial source-presence row becomes a conditional closed NPC operation',()=>{
 const row={effect:{kind:'npc',name:'mae',to:'dock'},description:{kind:'source_presence',name:'Mae',scene:'Dock',actor:{summary:'Present only during the day.'},scene_context:'Harbor'}};
 const reads={capsule:{},applyOptions:{candidates:[row]},resolveOptions:{}};
 const candidate=buildCandidates(reads,'I walk to the dock.').find(value=>value.family==='source_presence');
 assert.equal(candidate.bound.name,'mae');assert.equal(candidate.bound.to,'dock');assert.equal(candidate.routeFact.selects,'initialize');assert.equal(candidate.unbound.length,0);
 assert.equal(buildCandidates({...reads,applyOptions:{candidates:[{...row,guarded_by:'locked-meeting'}]}},'I walk to the dock.').some(value=>value.family==='source_presence'),false);
});

test('a minimal source destination still asks whether its access conditions allow movement',()=>{
 const row={effect:{kind:'move',to:'cemetery'},description:{kind:'move',display_name:'Church Cemetery',source_identity:true,source_context:'Its gate remains locked until dawn.'}};
 const candidate=buildCandidates({capsule:{},applyOptions:{candidates:[row]},resolveOptions:{}},'I go to the cemetery.').find(value=>value.family==='move');
 assert.equal(candidate.bound.to,'cemetery');assert.equal(candidate.routeFact.selects,'enter');
 assert.match(candidate.detail.source_context,/locked until dawn/);
 assert.equal(buildCandidates({capsule:{},applyOptions:{candidates:[{...row,guarded_by:'gate'}]},resolveOptions:{}},'I go to the cemetery.').some(value=>value.family==='move'),false);
});

test("§163.8 (owner ruling 2026-10-01: 「玩家的选择不替他定」): the builders mark the player's own choices from the side the kernel issued, and nobody else's", () => {
	const participants = [{ name: "tom", label: "Tom", side: "investigator" }, { name: "knott", label: "Knott", side: "npc" }, { name: "ruth", label: "Ruth", side: "npc" }];
	const owners = (candidate) => candidate.unbound.map((value) => [value.name, value.owner ?? null]);
	// The investigator's own turn: which target and which weapon are the player's.
	const attack = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: { kind: "combat", status: "active", round: 2, turn_of: "tom",
		pending_defense: null, participants, actions: [{ decision: "combat:attack", actor: "tom", targets: ["knott", "ruth"], weapons: ["unarmed", "knife"] }] } } } }, "我动手")
		.find((candidate) => candidate.bound.decision === "combat:attack");
	assert.deepEqual(owners(attack), [["target", "player"], ["weapon", "player"]]);
	// The defence the kernel hands to the player is the player's; an NPC's own defence is not.
	const defence = (side) => buildCandidates({ capsule: {}, applyOptions: {}, answering: ["defense:knott-r2"], resolveOptions: { context: {
		pending_choice: { name: "defense:knott-r2" }, session: { kind: "combat", status: "active", round: 2, turn_of: side === "player" ? "knott" : "tom", participants, actions: [],
			pending_defense: side === "player" ? { for: "player", actor: "tom", attacker: "knott", options: ["dodge", "fight_back"] }
				: { for: "npc", actor: "knott", attacker: "tom", options: ["dodge", "fight_back"] } } } } }, "我躲开").find((candidate) => candidate.forced);
	assert.deepEqual(owners(defence("player")), [["defense", "player"]]);
	assert.deepEqual(owners(defence("npc")), [["defense", null]]);
	// The investigator's opening blow outside a fight: its target and weapon are the player's.
	const blow = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { first_blow: { decision: "combat:attack", intent: "combat", actor: "Tom",
		targets: ["Knott", "Ruth"], weapons: ["unarmed", "knife"] } } } }, "我揍他").find((candidate) => candidate.clerk === "first_blow");
	assert.deepEqual(owners(blow), [["target", "player"], ["weapon", "player"]]);
	// Another person's turn of a chase is that person's own choice, never the player's.
	const chase = buildCandidates({ capsule: {}, applyOptions: {}, resolveOptions: { context: { session: { kind: "chase", status: "active", round: 1, turn_of: "knott",
		participants, actions: [{ decision: "chase:move", actor: "knott", targets: ["tom", "ruth"] }] } } } }, "我跑").flatMap((candidate) => [candidate, ...Object.values(candidate.variants ?? {})]);
	assert.ok(chase.some((candidate) => (candidate.unbound ?? []).some((value) => value.name === "target")), "the NPC's chase step has a target to choose");
	assert.ok(chase.every((candidate) => (candidate.unbound ?? []).every((value) => value.owner === undefined)), JSON.stringify(chase.map((candidate) => candidate.unbound)));
});
