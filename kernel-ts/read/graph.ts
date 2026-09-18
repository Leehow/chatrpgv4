/** Host-facing full-graph read (contract §29.1): every commit reachable from any wl/* ref,
 *  classified and projected for the memory-line panel. Read-only: no table, no dice, no writes;
 *  a cold process (no open table) and a live one answer the same. */
import { RpcError } from "../errors.js";
import type { KernelContext } from "../context.js";
import type { HandlerGroup } from "../handlers.js";
import { CampaignSnapshot, loadCampaignModule } from "./campaign.js";
import { clockSection, parseClockLocal } from "./capsule.js";
import type { ModuleGraph } from "./module-graph.js";
import { integer, number, string, truth, row, type Row } from "./values.js";

const DEFAULT_MAX_NODES = 500;
const MAX_NODES_LIMIT = 1000;
const TURN_SUBJECT = /^turn (\d+):/;

interface RawCommit {
    readonly sha: string;
    readonly parents: string[];
    /** Committer timestamp (ISO 8601); the sort key the contract calls `at`. */
    readonly at: string;
    readonly subject: string;
}

/** One for-each-ref for the wl/* tips plus one log for everything they reach. */
async function commitWalk(context: KernelContext, campaign: string): Promise<{ tips: Map<string, string[]>; commits: RawCommit[] }> {
    const refs = await context.git.run(campaign, ["for-each-ref", "--format=%(objectname:short)%00%(refname:strip=3)", "refs/heads/wl/"]);
    const tips = new Map<string, string[]>();
    if (refs.code !== 0)
        return { tips, commits: [] };
    const heads: string[] = [];
    for (const line of refs.stdout.split("\n")) {
        if (!line.trim())
            continue;
        const [sha, name] = line.split("\0");
        if (!sha || !name)
            continue;
        heads.push(`refs/heads/wl/${name}`);
        tips.set(sha, [...tips.get(sha) ?? [], name]);
    }
    if (!heads.length)
        return { tips, commits: [] };
    const log = await context.git.run(campaign, ["log", "--format=%x1e%h%x1f%p%x1f%cI%x1f%s", ...heads]);
    if (log.code !== 0)
        throw new RpcError("internal", `git log failed (${log.code}): ${(log.stderr || log.stdout || "").trim()}`);
    const seen = new Set<string>(), commits: RawCommit[] = [];
    for (const record of log.stdout.split("\x1e")) {
        const text = record.replace(/^\n+|\n+$/g, "");
        if (!text)
            continue;
        const [sha, parents, at, ...rest] = text.split("\x1f");
        if (!sha || seen.has(sha))
            continue;
        seen.add(sha);
        commits.push({ sha, parents: (parents ?? "").split(" ").filter(Boolean), at: at ?? "", subject: rest.join("\x1f") });
    }
    return { tips, commits };
}

type WorldClock = Row & { minutes: number };

/** One cat-file --batch for every kept commit's world.json; one git show per node would not scale. */
async function batchWorldClocks(context: KernelContext, campaign: string, shas: readonly string[]): Promise<Map<string, WorldClock | null>> {
    const result = new Map<string, WorldClock | null>();
    if (!shas.length)
        return result;
    const batch = await context.git.runInput(campaign, ["cat-file", "--batch"], shas.map(sha => `${sha}:world.json\n`).join(""));
    if (batch.code !== 0)
        throw new RpcError("internal", `git cat-file --batch failed (${batch.code}): ${(batch.stderr || batch.stdout || "").trim()}`);
    // The decoded text is valid UTF-8 by the runtime's fatal decoder, so re-encoding restores the
    // exact byte stream the batch headers measure.
    const bytes = Buffer.from(batch.stdout, "utf8");
    let offset = 0;
    for (const sha of shas) {
        let clock: WorldClock | null = null;
        const headerEnd = bytes.indexOf(0x0a, offset);
        if (headerEnd >= 0) {
            const header = bytes.subarray(offset, headerEnd).toString("ascii");
            const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
            if (match) {
                const size = Number(match[1]), start = headerEnd + 1;
                try {
                    const world = JSON.parse(bytes.subarray(start, start + size).toString("utf8"));
                    const saved = row(world.clock), minutes = saved.minutes;
                    if (typeof minutes === "number" && Number.isFinite(minutes))
                        clock = { ...saved, minutes: Math.trunc(minutes) };
                }
                catch { /* An unreadable snapshot falls back to the parent clock below. */ }
                offset = start + size + 1;
            }
            else {
                // "missing" answers echo the request token; advance past the header line only.
                offset = headerEnd + 1;
            }
        }
        result.set(sha, clock);
    }
    return result;
}

/** Mechanical kind per contract: `turn <n>:` subject is a turn; more than one parent is a merge;
 *  before the first turn commit is setup; seal/landing/reset commits are worldline. */
function classify(commits: readonly RawCommit[]): Map<string, { kind: string; turn: number | null }> {
    const bySha = new Map(commits.map(commit => [commit.sha, commit]));
    const turns = new Map<string, number | null>();
    for (const commit of commits) {
        const match = TURN_SUBJECT.exec(commit.subject);
        turns.set(commit.sha, match ? Number(match[1]) : null);
    }
    const reachesTurn = new Map<string, boolean>();
    const reach = (sha: string): boolean => {
        const cached = reachesTurn.get(sha);
        if (cached !== undefined)
            return cached;
        reachesTurn.set(sha, false); // commits form a DAG; the placeholder only guards pathological cycles
        const commit = bySha.get(sha);
        const result = turns.get(sha) != null || (commit?.parents.some(reach) ?? false);
        reachesTurn.set(sha, result);
        return result;
    };
    const result = new Map<string, { kind: string; turn: number | null }>();
    for (const commit of commits) {
        const turn = turns.get(commit.sha) ?? null;
        const kind = turn != null ? "turn" : commit.parents.length > 1 ? "merge" : !reach(commit.sha) ? "setup" : "worldline";
        result.set(commit.sha, { kind, turn });
    }
    return result;
}

/** The same projection the capsule and table.view use (clockSection); no panel-side clock math. */
function whenOf(graph: ModuleGraph | null, clock: WorldClock): Row | null {
    if (!graph)
        return null;
    const reading = clockSection(graph, { clock }), at = reading.at;
    const match = typeof at === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(at) : null;
    if (match)
        return { y: Number(match[1]), mo: Number(match[2]), d: Number(match[3]), hh: Number(match[4]), mm: Number(match[5]) };
    return reading.day != null && reading.hh != null && reading.mm != null
        ? { day: Number(reading.day), hh: Number(reading.hh), mm: Number(reading.mm) } : null;
}

function graphLines(meta: Row): { active: string; lines: Row[] } {
    const worldlines = row(meta.worldlines),
        active = typeof meta.active_worldline === "string" && meta.active_worldline ? meta.active_worldline : "main";
    return {
        active,
        lines: Object.keys(worldlines).sort().map(name => {
            const value = row(worldlines[name]), forked = row(value.forked_from);
            return {
                name, kind: value.kind ?? null, loop: number(value.loop), status: value.status ?? null,
                last_turn: value.last_turn ?? null, last_commit: value.last_commit ?? null,
                forked_from: truth(forked) ? { line: forked.line ?? null, turn: forked.turn ?? null, commit: forked.commit ?? null } : null,
                parents: Array.isArray(value.parents) ? value.parents : []
            };
        })
    };
}

export async function tableGraph(context: KernelContext, params: Row): Promise<Row> {
    const campaign = await CampaignSnapshot.open(context, params.campaign, false, false);
    let maxNodes = DEFAULT_MAX_NODES;
    if (params.max_nodes != null) {
        if (!integer(params.max_nodes) || number(params.max_nodes) < 1)
            throw new RpcError("invalid_params", "max_nodes must be a positive integer", { details: { max_nodes: params.max_nodes } });
        maxNodes = Math.min(number(params.max_nodes), MAX_NODES_LIMIT);
    }
    const { tips, commits } = await commitWalk(context, campaign.id),
        bySha = new Map(commits.map(commit => [commit.sha, commit])),
        kinds = classify(commits);
    // Newest commit first; ties keep the log's own order, which never lists a parent before its child.
    const ordered = [...commits].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)),
        truncated = commits.length > maxNodes,
        kept = ordered.slice(0, maxNodes),
        keptSet = new Set(kept.map(commit => commit.sha));
    for (const sha of tips.keys())
        if (!keptSet.has(sha)) {
            const tip = bySha.get(sha);
            if (tip) {
                kept.push(tip);
                keptSet.add(sha);
            }
        }
    const clocks = await batchWorldClocks(context, campaign.id, kept.map(commit => commit.sha)),
        resolved = new Map<string, WorldClock>();
    const clockOf = (commit: RawCommit): WorldClock => {
        const cached = resolved.get(commit.sha);
        if (cached !== undefined)
            return cached;
        const own = clocks.get(commit.sha);
        let value: WorldClock;
        if (own != null)
            value = own;
        else {
            // A commit without a readable world snapshot inherits the newest clock its parents knew.
            resolved.set(commit.sha, { minutes: 0 }); // commits form a DAG; the placeholder only guards pathological cycles
            const inherited = commit.parents.map(sha => bySha.get(sha)).filter((parent): parent is RawCommit => Boolean(parent)).map(clockOf);
            value = inherited.length ? inherited.reduce((latest, next) => next.minutes > latest.minutes ? next : latest) : { minutes: 0 };
        }
        resolved.set(commit.sha, value);
        return value;
    };
    const moduleId = string(campaign.meta.module_id),
        graph = moduleId ? (await loadCampaignModule(context, moduleId, campaign.world, campaign.id)).graph : null,
        pinned = row(campaign.world.clock).start_local,
        currentAnchor = parseClockLocal(pinned) ? pinned : undefined;
    const nodes = kept.map(commit => {
        const { kind, turn } = kinds.get(commit.sha)!, clock = clockOf(commit);
        return {
            // Pre-pin history shares the current calendar; a node's own anchor always wins.
            sha: commit.sha, turn, clock: clock.minutes,
            when: whenOf(graph, { ...clock, start_local: clock.start_local ?? currentAnchor }), kind,
            title: turn != null ? commit.subject.replace(TURN_SUBJECT, "").trim() : commit.subject,
            at: commit.at, parents: [...commit.parents], tip_of: tips.get(commit.sha) ?? []
        };
    });
    return { campaign: campaign.id, ...graphLines(campaign.meta), nodes, truncated };
}

export function graphHandlers(context: KernelContext): HandlerGroup {
    return Object.freeze({
        "table.graph": async (params) => tableGraph(context, params)
    });
}
