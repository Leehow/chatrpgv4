/** Contract §29.2: `table.branch`, the host-level action that opens a new worldline from an
 * arbitrary committed node reachable from any wl/* ref. Unlike the Keeper-facing fork (§15.3)
 * no turn is opened and no dice roll happens; the old line keeps every commit. Replays of the
 * same (campaign, commit, name) do not re-create the line, they only ensure it is active.
 *
 * The one-time `branched` capsule section is stored on campaign.json as `pending_branch` and
 * cleared by the player_input that carries it (see write/index.ts).
 */
import type { HandlerGroup } from "../handlers.js";
import type { KernelContext } from "../context.js";
import { RpcError, internalError } from "../errors.js";
import { isJsonObject } from "../json.js";
import { clone, number, string, type Row } from "../read/values.js";
import { activeName, registry, newLine, validateName, lineSeed } from "./identity.js";
import { currentLine, head, lineCommit, run, checkout, createBranch, deleteBranch, commitIfDirty, type WorldlineContext } from "./history.js";
import { checkpointFromRecord, writeCheckpoint, readableTurn } from "../write/continuation.js";
import type { createWriteRuntime } from "../write/index.js";

type WriteRuntime = ReturnType<typeof createWriteRuntime>;

async function refLines(context: WorldlineContext): Promise<string[]> {
  const result = await run(context, ["for-each-ref", "--format=%(refname)", "refs/heads/wl/"]);
  if (result.code !== 0) return [];
  return result.stdout.split("\n").map(line => line.trim()).filter(line => line.startsWith("refs/heads/wl/")).map(line => line.slice("refs/heads/wl/".length)).sort();
}

/** The last closed turn at a commit, read from the turn records the commit carries (0 before turn 1). */
async function turnAtCommit(context: WorldlineContext, sha: string): Promise<number> {
  const result = await run(context, ["ls-tree", "--name-only", sha, "turns/"]);
  if (result.code !== 0) return 0;
  let last = 0;
  for (const entry of result.stdout.split("\n")) {
    const match = /(\d+)\.json$/.exec(entry.trim());
    if (match) last = Math.max(last, Number(match[1]));
  }
  return last;
}

/** The line a commit was written on: a line that reaches it without inheriting it through its
 * own fork point. Lines that only contain the commit because they forked at or after it are not
 * its owner. Deterministic tiebreak: sorted order, so `main` wins a genuine ambiguity. */
async function ownerLine(context: WorldlineContext, sha: string, containing: string[], lines: Row): Promise<string> {
  const owners: string[] = [];
  for (const name of containing) {
    const forked = isJsonObject(lines[name]) ? lines[name].forked_from : null;
    const forkCommit = isJsonObject(forked) && typeof forked.commit === "string" ? forked.commit : null;
    if (forkCommit && (await run(context, ["merge-base", "--is-ancestor", sha, forkCommit])).code === 0) continue;
    owners.push(name);
  }
  return (owners.length ? owners : containing).sort()[0];
}

export function createBranchHandlers(context: KernelContext, writer: WriteRuntime): HandlerGroup {
  async function branch(params: Row): Promise<Row> {
    const campaign = await writer.campaign(params, { requireTurn: false, requireWorld: false });
    const wl: WorldlineContext = { kernel: context, campaign };
    const rawCommit = params.commit;
    const badCommit = () => new RpcError("invalid_params", "params.commit must name a commit a worldline of this campaign reaches", {
      fix: "pick a node from table.graph; its sha is the commit",
      details: { commit: rawCommit ?? null },
    });
    if (typeof rawCommit !== "string" || !/^[0-9a-fA-F]{4,40}$/.test(rawCommit)) throw badCommit();
    const shortResult = await run(wl, ["rev-parse", "--short", "--verify", `${rawCommit}^{commit}`]);
    if (shortResult.code !== 0) throw badCommit();
    const short = shortResult.stdout.trim();
    const names = await refLines(wl);
    const containing: string[] = [];
    for (const name of names)
      if ((await run(wl, ["merge-base", "--is-ancestor", short, `wl/${name}`])).code === 0) containing.push(name);
    if (!containing.length) throw badCommit();

    const meta = await campaign.readCampaign(), lines = clone(registry(meta)), source = activeName(meta);
    const forkTurn = await turnAtCommit(wl, short);
    const fromLine = await ownerLine(wl, short, containing, lines);
    const forkedFrom = { line: fromLine, turn: forkTurn, commit: short };

    const taken = async (name: string): Promise<boolean> => Object.hasOwn(lines, name) || await lineCommit(wl, name) != null;
    let name: string;
    if (params.name != null) {
      name = validateName(params.name, "name");
      const existing = lines[name];
      if (isJsonObject(existing) && isJsonObject(existing.forked_from) && existing.forked_from.commit === short) {
        // Idempotent replay: the line exists from this very commit; only ensure it is active.
        if (source !== name) {
          if (await lineCommit(wl, name) == null) throw new RpcError("invalid_params", `worldline ${JSON.stringify(name)} has no branch ref`, { details: { line: name } });
          await commitIfDirty(wl, `worldline ${source}: sealed before resuming ${name}`);
          await checkout(wl, name);
          if (isJsonObject(lines[source])) lines[source].status = "dormant";
          lines[name].status = "active";
          meta.worldlines = lines;
          meta.active_worldline = name;
          await campaign.writeCampaign(meta);
          if (!context.seedLocked) context.rng.seed(`${string(existing.seed || lineSeed(campaign.id, name, short))}:${number(existing.last_turn ?? forkTurn) + 1}`);
        }
        return { ok: true, line: { name, kind: "if", loop: 0, forked_from: clone(existing.forked_from) }, active: name, branched_from: clone(existing.forked_from) };
      }
      if (await taken(name)) throw new RpcError("invalid_params", `worldline ${JSON.stringify(name)} already exists`, {
        fix: "pick a name no line has, or replay with the same commit to enter it",
        details: { name, lines: Object.keys(lines).sort() },
      });
    } else {
      let k = 1;
      while (await taken(name = `if-${forkTurn}-${k}`)) k++;
    }

    // A turn that is still open owns the table; branching underneath it would strand its receipts.
    const turn = await readableTurn(campaign);
    if (turn && turn.state !== "awaiting_player") throw new RpcError("operation_in_progress", `turn ${number(turn.turn)} is ${string(turn.state)}; finish it with narrate or ask before branching`, {
      fix: "close the open turn first, then branch",
      details: { turn: number(turn.turn), state: string(turn.state) },
    });

    const before = clone(meta);
    const seal = await commitIfDirty(wl, `worldline ${source}: sealed before branching`);
    const base = seal || await head(wl);
    let created = false;
    try {
      await createBranch(wl, name, short);
      created = true;
      await checkout(wl, name);
      if (isJsonObject(lines[source])) {
        lines[source].status = "dormant";
        lines[source].last_turn = turn ? Math.max(0, number(turn.turn) - 1) : null;
        lines[source].last_commit = base;
      }
      lines[name] = newLine(campaign.id, name, "if", 0, clone(forkedFrom));
      meta.worldlines = lines;
      meta.active_worldline = name;
      meta.pending_branch = { name, from_line: fromLine, from_turn: forkTurn };
      await campaign.writeCampaign(meta);
      const landed = await commitIfDirty(wl, `worldline ${name}: branched from ${fromLine} at turn ${forkTurn}`) || await head(wl);
      lines[name].last_commit = landed;
      lines[name].last_turn = forkTurn;
      await campaign.writeCampaign(meta);
      // §15.1: the new line's rolls re-seed from its own seed and its next turn number.
      if (!context.seedLocked) context.rng.seed(`${lineSeed(campaign.id, name, short)}:${forkTurn + 1}`);
      // The checkpoint follows the fork point's turn record, so a reopened table resumes there.
      const record = forkTurn > 0 ? await campaign.readTurnRecord(forkTurn) : null;
      if (record) await writeCheckpoint(campaign, checkpointFromRecord(campaign.id, record, {}, name));
      const label = typeof params.label === "string" && params.label.trim() ? params.label.trim() : null;
      await campaign.appendEvent(forkTurn + 1, { type: "worldline-forked", data: { name, mode: "if", loop: 0, from: clone(forkedFrom), ...(label ? { label } : {}) } });
      await campaign.telemetry({ lane: "worldline", op: "branch", ok: true, line: name, from: fromLine, turn: forkTurn });
    } catch (error) {
      try {
        await checkout(wl, source, true);
        if (created) await deleteBranch(wl, name);
        await campaign.writeCampaign(before);
      } catch { /* the rollback itself is best-effort; the original error carries the news */ }
      await campaign.telemetry({ lane: "worldline", op: "branch", ok: false, line: name, error: internalError(error).message });
      throw error;
    }
    return { ok: true, line: { name, kind: "if", loop: 0, forked_from: clone(forkedFrom) }, active: name, branched_from: clone(forkedFrom) };
  }
  return Object.freeze({ "table.branch": branch });
}
