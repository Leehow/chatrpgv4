/**
 * Contract §138.9 (BR-05 of docs/specs/band-then-roll.md): the host's build step "fill travel minutes".
 *
 * Only the host holds the Jev key, so the host names the band of every road the build adds without minutes, and the
 * kernel's one writer (`kernel-ts/modules/route-travel.ts`) lands it: inside the publication that adds the road for a
 * PDF book (`module.read.finish` with `travel`, wired by the reading service), and in the shipped starter graphs
 * through `scripts/fill-starter-travel.ts`. This file is the glue: which roads to ask, what each scene is as the
 * book describes it, the gate, the lease, the one Jev adapter of the step, the telemetry row. It never refuses and
 * never fails a publication: a road it cannot name keeps no minutes, and the row says why.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {JEV_INPUT_USD_PER_MILLION} from '../../runtime/jev/decision-adapter.ts';
import {TRAVEL_DEFAULT_MIN_CONFIDENCE, TRAVEL_FILL_FAMILY, runTravelBands, travelBatches, travelBindings,
  type SceneBrief, type TravelAnswer, type TravelBandInput, type TravelRoad} from '../../runtime/jev/travel-band-domain.ts';
import {ROUTE_TRAVEL_TABLE, TRAVEL_ADJACENT, travelRowsOf, unfilledRoad, type TravelEntry, type TravelRow} from '../../kernel-ts/modules/route-travel.ts';
import {readJevApiKey} from '../jev/agent/config.js';

type Row = Record<string, any>;
const plain = (value: unknown): value is Row => value != null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const folded = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/** Retries of one build request: a road asked once at build may take one retry on a transient failure. */
const TRAVEL_RETRY = {maxRetries: 1, backoffInitialMs: 200, backoffMaxMs: 1_000, retryNetwork: true, retryTimeout: false};
const DEFAULT_TRAVEL_JEV_TIMEOUT_MS = 8_000;

/** The band gate, the same `PI_COC_BAND_MIN_CONFIDENCE` in (0, 1] as the other band questions; a placeholder until calibrated. */
export function travelMinConfidence(env: NodeJS.ProcessEnv): number {
  const value = Number(env.PI_COC_BAND_MIN_CONFIDENCE?.trim() || NaN);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : TRAVEL_DEFAULT_MIN_CONFIDENCE;
}
/** Cap on one build's Jev time, `PI_COC_TRAVEL_JEV_TIMEOUT_MS`; its expiry leaves the unanswered roads without minutes. */
export function travelJevTimeoutMs(env: NodeJS.ProcessEnv): number {
  const value = Number(env.PI_COC_TRAVEL_JEV_TIMEOUT_MS?.trim() || NaN);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TRAVEL_JEV_TIMEOUT_MS;
}

/** A module graph seen as nodes and typed edges, whether the edges are published relations or a draft's claims. */
export interface GraphView {nodes: Map<string, Row>; edges: Array<{kind: string; from: string; to: string}>}
export function viewOfRelations(graph: Row): GraphView {
  const nodes = new Map((Array.isArray(graph.nodes) ? graph.nodes : []).filter((node: unknown) => plain(node) && typeof node.node_id === 'string').map((node: Row) => [node.node_id, node] as const));
  const edges = (Array.isArray(graph.relations) ? graph.relations : []).filter(plain)
    .filter((relation: Row) => typeof relation.from_node_id === 'string' && typeof relation.to_node_id === 'string')
    .map((relation: Row) => ({kind: String(relation.relation_kind), from: relation.from_node_id, to: relation.to_node_id}));
  return {nodes, edges};
}
export function viewOfClaims(nodes: unknown[], claims: unknown[]): GraphView {
  const byId = new Map<string, Row>();
  for (const node of nodes) if (plain(node) && typeof node.node_id === 'string') byId.set(node.node_id, {...byId.get(node.node_id), ...node});
  const edges = claims.filter(plain).filter(claim => typeof claim.subject_id === 'string' && typeof claim.object?.node_id === 'string')
    .map(claim => ({kind: String(claim.predicate), from: claim.subject_id as string, to: claim.object.node_id as string}));
  return {nodes: byId, edges};
}

const recordOf = (node: Row | undefined): Row => plain(node?.properties?.runtime_projection?.record) ? node!.properties.runtime_projection.record : {};
const isKind = (view: GraphView, id: string, kind: string): boolean => view.nodes.get(id)?.node_kind === kind;
/** The location nodes a node sits in: `located-in` / `occurs-at` out of it, `contains` into it. */
function locationsOf(view: GraphView, id: string): string[] {
  const out = view.edges.filter(edge => edge.from === id && ['located-in', 'occurs-at', 'part-of'].includes(edge.kind)).map(edge => edge.to);
  const into = view.edges.filter(edge => edge.to === id && edge.kind === 'contains').map(edge => edge.from);
  return [...new Set([...out, ...into])].filter(node => isKind(view, node, 'location'));
}

/**
 * A scene as the book describes it: its name (the record's display name before the node's), a summary that is more
 * than the name (the node's, else the record's dramatic question), the names of the locations it sits in and those
 * locations' own locations, and the record's place words. Nothing here judges; it only gathers what the book wrote.
 */
export function sceneBrief(view: GraphView, id: string): SceneBrief {
  const node = view.nodes.get(id) ?? {}, record = recordOf(node);
  const name = text(record.display_name) || text(node.name) || id;
  const summary = [node.summary, record.dramatic_question].map(text).find(value => value && folded(value) !== folded(name));
  const direct = locationsOf(view, id), places: string[] = [];
  for (const location of [...direct, ...direct.flatMap(place => locationsOf(view, place))]) {
    const label = text(view.nodes.get(location)?.name);
    if (label && !places.includes(label)) places.push(label);
  }
  const tags = Array.isArray(record.location_tags) ? [...new Set(record.location_tags.map(text).filter(Boolean))] as string[] : [];
  return {name, ...(summary ? {summary} : {}), ...(places.length ? {places} : {}), ...(tags.length ? {tags} : {})};
}

/** The roads to ask, one per unordered pair of distinct scenes, in the order the edges list them. */
export function roadsOf(view: GraphView, edges: Array<{from: string; to: string}>): TravelRoad[] {
  const seen = new Set<string>(), roads: TravelRoad[] = [];
  for (const {from, to} of edges) {
    if (from === to || !isKind(view, from, 'scene') || !isKind(view, to, 'scene')) continue;
    const [a, b] = from < to ? [from, to] : [to, from], key = JSON.stringify([a, b]);
    if (seen.has(key)) continue;
    seen.add(key);
    roads.push({a, b, briefs: [sceneBrief(view, a), sceneBrief(view, b)]});
  }
  return roads;
}

/**
 * A published or shipped graph's roads that carry no minutes in either direction: the whole of what a starter's fill
 * asks. A road timed one way is not asked; the writer times its other direction from it (`sameRoad`).
 */
export function unfilledRoads(graph: Row): TravelRoad[] {
  const view = viewOfRelations(graph), relations: Row[] = (Array.isArray(graph.relations) ? graph.relations : []).filter(plain);
  const pair = (relation: Row) => JSON.stringify([relation.from_node_id, relation.to_node_id].sort());
  const timed = new Set(relations.filter(relation => relation.relation_kind === 'route-to' && !unfilledRoad(relation)).map(pair));
  return roadsOf(view, relations.filter(relation => unfilledRoad(relation) && !timed.has(pair(relation)))
    .map(relation => ({from: relation.from_node_id, to: relation.to_node_id})));
}

/**
 * The roads a reading publication adds: the draft's `route-to` claims between two scenes that the graph did not
 * already state (a claim restated from `known_claims` was asked when it first landed). The scenes are read from the
 * draft over the job's `known_nodes`, and their places from both sets of claims.
 */
export function newRoads(job: Row, draft: Row): TravelRoad[] {
  const known = Array.isArray(job.known_claims) ? job.known_claims.filter(plain) : [];
  const drafted = Array.isArray(draft.claims) ? draft.claims.filter(plain) : [];
  const view = viewOfClaims([...(Array.isArray(job.known_nodes) ? job.known_nodes : []), ...(Array.isArray(draft.nodes) ? draft.nodes : [])], [...known, ...drafted]);
  const stated = new Set(known.filter((claim: Row) => claim.predicate === 'route-to').map((claim: Row) => JSON.stringify([claim.subject_id, claim.object?.node_id])));
  return roadsOf(view, drafted.filter((claim: Row) => claim.predicate === 'route-to' && typeof claim.subject_id === 'string' && typeof claim.object?.node_id === 'string'
    && !stated.has(JSON.stringify([claim.subject_id, claim.object.node_id]))).map((claim: Row) => ({from: claim.subject_id, to: claim.object.node_id})));
}

/** The travel rows as the content root ships them; the kernel re-reads the same table before it writes a number. */
export async function readTravelRows(contentRoot: string): Promise<TravelRow[]> {
  return travelRowsOf(JSON.parse(await readFile(join(contentRoot, 'rulesets', 'coc7', 'rules-json', `${ROUTE_TRAVEL_TABLE.table}.json`), 'utf8')));
}

export interface TravelFill {
  /** The bands to land, by the two scene node ids: what `module.read.finish` takes as `travel` and `applyTravelFill` writes. */
  entries: TravelEntry[];
  /** The one telemetry row of the step (`lane: "travel-fill"`, `event: "asked"`). */
  row: Row;
  answers: TravelAnswer[];
}
export interface TravelAsk {
  env: NodeJS.ProcessEnv;
  module: string;
  campaign?: string;
  roads: TravelRoad[];
  rows: TravelRow[];
  signal?: AbortSignal;
  /** Wall-clock cap on the whole step; `travelJevTimeoutMs(env)` when absent. */
  timeoutMs?: number;
}

const rounded = (value: number): number => Math.round(value * 1000) / 1000;
function tally(answers: TravelAnswer[]): Row {
  const unfilled: Record<string, number> = {};
  for (const answer of answers) if (answer.outcome !== 'banded') {
    const reason = answer.outcome === 'low_confidence' ? 'low_confidence' : answer.reason ?? 'no_answer';
    unfilled[reason] = (unfilled[reason] ?? 0) + 1;
  }
  const banded = answers.filter(answer => answer.outcome === 'banded');
  return {banded: banded.length, adjacent: banded.filter(answer => answer.band === TRAVEL_ADJACENT).length, unfilled};
}

/**
 * Ask the roads, under one lease sized to the build's requests, through the step's one Jev adapter. Without a key
 * nothing is asked and every road stays as it is (`unfilled.unconfigured`); the row is still written so an unfilled
 * build is never silent.
 */
export async function askTravel(ask: TravelAsk): Promise<TravelFill> {
  const began = Date.now(), base: Row = {lane: 'travel-fill', event: 'asked', module_id: ask.module, ...(ask.campaign ? {campaign: ask.campaign} : {}), roads: ask.roads.length};
  const none = (reason: string): TravelFill => {
    const answers = ask.roads.map((road): TravelAnswer => ({a: road.a, b: road.b, outcome: 'no_answer', reason}));
    return {entries: [], answers, row: {...base, ...tally(answers), calls: 0, ms: Date.now() - began}};
  };
  if (!ask.roads.length) return {entries: [], answers: [], row: {...base, banded: 0, adjacent: 0, unfilled: {}, calls: 0, ms: 0}};
  if (!readJevApiKey(ask.env)) return none('unconfigured');
  const input: TravelBandInput = {module: ask.module, ...(ask.campaign ? {campaign: ask.campaign} : {}), roads: ask.roads, rows: ask.rows};
  const bindings = travelBindings(input), {batches} = travelBatches(input);
  const deadlineAt = began + (ask.timeoutMs ?? travelJevTimeoutMs(ask.env));
  const signal = ask.signal ?? new AbortController().signal;
  // The lease covers every request of the build at its worst (each attempt of each batch at its packed upper bound).
  const attempts = TRAVEL_RETRY.maxRetries + 1;
  const bounds = batches.map(({batch}) => packDecisionBatch(batch).estimate);
  const inputTokens = bounds.reduce((sum, bound) => sum + bound.totalUpperBound, 0) * attempts;
  const outputTokens = bounds.reduce((sum, bound) => sum + bound.responseUpperBound, 0) * attempts;
  let lease: TaskLease | undefined;
  try {
    lease = new TaskLease({owner: TRAVEL_FILL_FAMILY, goal: 'Name the travel band of every road the build adds without minutes',
      scope: bindings.scope, capabilities: ['decision'], readSet: bindings.readSet, signal,
      budget: {deadlineAt, remainingInputTokens: Math.max(1, inputTokens), remainingOutputTokens: Math.max(1, outputTokens),
        remainingCostUsd: inputTokens * JEV_INPUT_USD_PER_MILLION / 1_000_000 + 0.001, remainingActions: Math.max(1, batches.length * attempts)}});
    const decision = createDecisionAdapter({env: ask.env, maxConcurrency: 4, retryPolicies: {[TRAVEL_FILL_FAMILY]: TRAVEL_RETRY}});
    const result = await runTravelBands(input, decision, lease, {minConfidence: travelMinConfidence(ask.env)});
    const entries: TravelEntry[] = result.answers.filter(answer => answer.outcome === 'banded')
      .map(answer => ({from: answer.a, to: answer.b, band: answer.band!, confidence: rounded(answer.confidence!)}));
    return {entries, answers: result.answers, row: {...base, ...tally(result.answers), calls: result.calls, ms: Date.now() - began,
      cost_usd: result.usage.costUsd, gate: travelMinConfidence(ask.env),
      answers: result.answers.map(answer => ({a: answer.a, b: answer.b, outcome: answer.outcome,
        ...(answer.band ? {band: answer.band} : {}), ...(answer.confidence !== undefined ? {confidence: rounded(answer.confidence)} : {}),
        ...(answer.distribution ? {distribution: answer.distribution} : {}), ...(answer.reason ? {reason: answer.reason} : {})}))}};
  } catch {
    return none('band_owner_error');
  } finally {
    lease?.close();
  }
}

export interface PublicationTravel {moduleId: string; campaign?: string; job: Row; draft: Row; signal?: AbortSignal}
/**
 * The reading service's step: the roads this publication adds, asked before `module.read.finish`, so their minutes
 * land in the same generation (a second generation would move the source revision under a turn's own preparation).
 * `undefined` when the publication adds no road.
 */
export function createTravelFill(deps: {env: NodeJS.ProcessEnv; contentRoot: string}): (input: PublicationTravel) => Promise<TravelFill | undefined> {
  return async input => {
    const roads = newRoads(input.job, input.draft);
    if (!roads.length) return undefined;
    let rows: TravelRow[];
    try { rows = await readTravelRows(deps.contentRoot); }
    catch { return {entries: [], answers: [], row: {lane: 'travel-fill', event: 'asked', module_id: input.moduleId, roads: roads.length,
      banded: 0, adjacent: 0, unfilled: {table_unavailable: roads.length}, calls: 0, ms: 0}}; }
    return askTravel({env: deps.env, module: input.moduleId, ...(input.campaign ? {campaign: input.campaign} : {}), roads, rows,
      ...(input.signal ? {signal: input.signal} : {})});
  };
}
