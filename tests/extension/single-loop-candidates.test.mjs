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
import { buildCandidates, keeperCall, obligationCandidates } from "../../runtime/jev/candidates.ts";
import { bindBatch, bindingOf, CLERK_AUTHORITY, initialView, interpretBind, next, routeBatch, settleRead } from "../../runtime/jev/step-policy.ts";

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
	// The person present and not yet introduced, with no label of the table's own: the name is open, the LLM's to fill.
	const person = candidates.find((candidate) => candidate.key === "apply:person:Steven Knott");
	assert.equal(person?.clerk, "declared_bookkeeping");
	assert.equal(bindingOf(person), "open");
	// Outside a session only the ordinary check is offered of the rule decisions; no sanity, development or combat family.
	assert.deepEqual(candidates.filter((candidate) => candidate.verb === "resolve" && candidate.family !== "mod_check").map((candidate) => candidate.key), ["resolve:core-check:ordinary-check"]);
	// The active natural-npc Mod declares a first-impression check for meeting him: the clerk's by authority (b).
	const contact = candidates.find((candidate) => candidate.family === "mod_check");
	assert.equal(contact?.clerk, "mod_contact");
	assert.equal(contact?.bound.target, "Steven Knott");
	assert.equal(contact?.basis.path, "mods.pending_contacts[0]");
	// What Jev reads: no internal kernel tag, no host basis, no clerk label.
	const { batch } = routeBatch({ ...initialView({ runId: "r", rawInput: "x", context, candidates, readFirst: false }) }, scope, []);
	const shown = allText(batch.state) + allText(batch.questions);
	for (const hidden of ["available_route_not_player_choice", '"authority"', '"basis"', '"clerk"', "declared_bookkeeping"]) assert.ok(!shown.includes(hidden), `Jev never sees ${hidden}`);
	assert.deepEqual(obligationCandidates(state), [], "the SO-04 seam issues nothing in SL-02");
});

test("boss only: nobody off the roster, no rule family without its session, no effect kind the kernel does not issue as a candidate", () => {
	const candidates = buildCandidates({
		capsule: { where: { assets: [{ kind: "map", name: "floor plan" }] }, present: [{ name: "A", called: { name: "甲" } }] },
		applyOptions: { candidates: [{ effect: { kind: "cash", delta: -5 } }, { effect: { kind: "damage", target: "A" } }, { effect: { kind: "move", to: "b" }, description: { unlock_when: { met: false } } }] },
		resolveOptions: { profiles: [{ actor: "Tom" }], decisions: [{ name: "sanity:check", family: "sanity" }, { name: "combat:attack", family: "combat" }, { name: "healing:first-aid", family: "healing" }],
			context: { session: { kind: "sanity_bout", status: "active", turn_of: "tom", actions: [{ decision: "sanity:bout-tick", actor: "tom" }] } } },
	}, "anything");
	assert.deepEqual(candidates, [], "an introduced person, a map, a cash debit, damage, a gated move, and every non-ordinary rule family: none of them is the clerk's");
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

test("an NPC's pending defence without a standing keeps the closed choice: several options are a Jev bind, one runs directly, Jev's unknown goes to the LLM", async (t) => {
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
	assert.deepEqual(interpretBind(defend, batch, answer("unknown"), 0.6).pending.map((item) => [item.kind, item.purpose]), [["infer", "bind"], ["direct", "llm_proposal"]]);
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

test("an NPC's own turn is a closed bind over the actions the kernel issues it; the chosen action keeps its own parameters", async (t) => {
	const { call } = kernel(t);
	const turn = await fight(call);
	await call("table.resolve", { call_id: `t${turn}-c3`, action: { intent: "combat", decision: "combat:defend", goal: "combat:defend", method: "combat:defend", actor: "steven-knott", defense: "dodge" } });
	const state = await reads(call);
	assert.equal(state.resolveOptions.context.session.turn_of, "steven-knott");
	const candidates = buildCandidates(state, "我揍他");
	const turnCandidate = candidates.find((candidate) => candidate.forced);
	assert.equal(turnCandidate.key, `resolve:combat:turn:steven-knott:r${state.resolveOptions.context.session.round}`);
	assert.deepEqual(turnCandidate.unbound[0].options, ["combat:attack", "combat:maneuver", "combat:end"]);
	assert.equal(candidates.filter((candidate) => candidate.family === "combat").length, 1, "the NPC's actions are not route questions about the player's words");
	const batch = bindBatch(initialView({ runId: "r", rawInput: "我揍他", context, candidates, readFirst: false }), turnCandidate, scope, []);
	const answer = (choice) => ({ batchId: batch.id, status: "complete", issues: [], coverage: { required: ["decision"], answered: ["decision"], unknown: [] },
		answers: { decision: { status: "answered", type: "choice", choice, confidence: 0.85 } } });
	// Attack: its one target and one weapon are the kernel's, so it runs directly.
	const attack = interpretBind(turnCandidate, batch, answer("combat:attack"), 0.6).pending;
	assert.deepEqual(attack.map((item) => [item.kind, item.purpose]), [["direct", "execute"]]);
	assert.deepEqual([attack[0].candidate.bound.target, attack[0].candidate.bound.weapon, attack[0].candidate.key], ["thomas-hayes", "unarmed", turnCandidate.key]);
	// A manoeuvre's kind is not in the session view: the LLM fills it.
	assert.deepEqual(interpretBind(turnCandidate, batch, answer("combat:maneuver"), 0.6).pending.map((item) => [item.kind, item.purpose]), [["infer", "bind"], ["direct", "llm_proposal"]]);
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

test("SL-08: an NPC's standing attack with one target and one weapon is its forced, fully bound turn -- direct, no Jev, no LLM", async (t) => {
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
	const [attack] = forced;
	assert.equal(attack.key, `resolve:combat:attack:steven-knott:r${session.round}`);
	assert.deepEqual([attack.bound.decision, attack.bound.actor, attack.bound.target, attack.bound.weapon], ["combat:attack", "steven-knott", "thomas-hayes", "unarmed"]);
	assert.equal(bindingOf(attack), "none");
	assert.equal(attack.clerk, "session_step");
	// The clerk basis names the kernel row and the standing, with its basis and disposition.
	assert.equal(attack.basis.path, "context.session.actions[0]");
	assert.deepEqual(attack.basis.standing, { action: "attack", basis: "rule-default", disposition: { disposition: "fights_to_the_end", basis: "keeper" } });
	assert.equal(candidates.filter((candidate) => candidate.family === "combat").length, 1, "no closed bind over his actions: the standing decided");
	const view = initialView({ runId: "r", rawInput: "我揍他", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates }, 0);
	assert.deepEqual([view.pending[0].kind, view.pending[0].purpose, view.pending[0].candidate.key], ["direct", "execute", attack.key]);
	assert.equal(next(view).kind, "direct");
	const { tool, args } = keeperCall(attack);
	assert.equal(tool, "resolve");
	assert.deepEqual([args.action.intent, args.action.decision, args.action.actor, args.action.target, args.action.weapon], ["combat", "combat:attack", "steven-knott", "thomas-hayes", "unarmed"]);
});

test("SL-08: several weapons or targets under a standing attack are a Jev bind over the kernel's own lists, and the attack is still decided", async (t) => {
	const { call } = kernel(t);
	await knottsTurn(call, "fights_to_the_end");
	const live = await reads(call);
	const state = withSession(live, (session) => { session.actions[0].weapons = ["unarmed", "knife_medium"]; session.actions[0].targets = ["thomas-hayes", "ruth"]; return session; });
	const [attack] = buildCandidates(state, "我揍他").filter((candidate) => candidate.forced);
	assert.equal(attack.bound.decision, "combat:attack");
	assert.deepEqual(attack.unbound.map((value) => [value.name, value.vocabulary, value.options]),
		[["target", "closed", ["thomas-hayes", "ruth"]], ["weapon", "closed", ["unarmed", "knife_medium"]]]);
	const view = initialView({ runId: "r", rawInput: "我揍他", context, candidates: [], readFirst: false });
	settleRead(view, 1, { materials: [], summary: {} }, { context, candidates: [attack] }, 0);
	assert.deepEqual([view.pending[0].kind, view.pending[0].purpose], ["decide", "bind"]);
	const batch = bindBatch(view, attack, scope, []);
	assert.deepEqual(batch.questions.map((question) => question.key), ["target", "weapon"], "Jev binds the parameters, not the action");
	const answer = { batchId: batch.id, status: "complete", issues: [], coverage: { required: ["target", "weapon"], answered: ["target", "weapon"], unknown: [] },
		answers: { target: { status: "answered", type: "choice", choice: "ruth", confidence: 0.8 }, weapon: { status: "answered", type: "choice", choice: "knife_medium", confidence: 0.8 } } };
	assert.deepEqual(interpretBind(attack, batch, answer, 0.6).pending.map((item) => [item.kind, item.purpose, item.extra?.target, item.extra?.weapon]),
		[["direct", "execute", "ruth", "knife_medium"]]);
});

test("SL-08: hold and flee issue no attack and no other step for the NPC: the turn is the Keeper's; no standing keeps the previous route", async (t) => {
	const { call } = kernel(t);
	const { turn, n } = await knottsTurn(call, "fights_to_the_end");
	await call("table.apply", { call_id: `t${turn}-c${n}`, effects: [{ kind: "npc", name: "Steven Knott", action: "hold", why: "He hesitates." }] });
	const held = await reads(call);
	assert.deepEqual(held.resolveOptions.context.session.standing_action, { action: "hold", basis: "keeper", disposition: { disposition: "fights_to_the_end", basis: "keeper" } });
	const none = (state) => buildCandidates(state, "我揍他").filter((candidate) => candidate.family === "combat");
	assert.deepEqual(none(held), [], "a hold: no attack candidate, and no closed bind over his other actions");
	const fled = withSession(held, (session) => ({ ...session, standing_action: { action: "flee", basis: "rule-default", disposition: { disposition: "fights_then_flees", basis: "authored" } } }));
	assert.deepEqual(none(fled), [], "a flight: the same");
	// No standing (a kernel that predates §11.5.3, or an NPC with no disposition): Jev's closed bind over the issued actions.
	const unstanding = withSession(held, ({ standing_action: _standing, ...session }) => session);
	const [turnCandidate] = buildCandidates(unstanding, "我揍他").filter((candidate) => candidate.forced);
	assert.equal(turnCandidate.key, `resolve:combat:turn:steven-knott:r${held.resolveOptions.context.session.round}`);
	assert.deepEqual(turnCandidate.unbound[0].options, ["combat:attack", "combat:maneuver", "combat:end"]);
	// A standing the builder cannot trust (a basis outside the contract's) keeps the previous route too.
	const odd = withSession(held, (session) => ({ ...session, standing_action: { action: "attack", basis: "guess" } }));
	assert.equal(buildCandidates(odd, "我揍他").find((candidate) => candidate.forced).key, turnCandidate.key);
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
	// The material is his own parameters as the card issued them, and the basis names which were read.
	assert.deepEqual(inference.detail.person, fighter.combat_disposition.material);
	assert.deepEqual(inference.basis.row.read, Object.keys(fighter.combat_disposition.material));
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
	assert.deepEqual(interpretBind(inference, batch, answer("fights_then_flees", 0.4), 0.6).pending.map((item) => [item.kind, item.purpose]), [["infer", "bind"], ["direct", "llm_proposal"]]);
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
