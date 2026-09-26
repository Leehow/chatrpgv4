/**
 * Contract §138.9 (BR-05): fill the travel minutes of a shipped starter's roads, once, as a reviewed data change.
 *
 *   node scripts/fill-starter-travel.ts [--dry-run] STARTER_ID...
 *
 * Every `route-to` relation of `content/starters/<id>/module-graph.json` that carries no `travel_minutes` is asked
 * through the host's build step (`extensions/module/travel-fill.ts`, one Jev Choice per road over the travel rows of
 * `time-costs` and the exit `adjacent`) and written by the kernel's one writer (`kernel-ts/modules/route-travel.ts`):
 * the row's `default`, or 0 for `adjacent`, with `travel: {basis: "banded", band, confidence}`. A road below the gate
 * or without an answer keeps no minutes. A relation that already carries minutes is never touched, so a second run
 * asks only what the first left open.
 *
 * The file is edited in place, relation by relation, so the reviewed diff is the roads and nothing else; the script
 * refuses to write when any other byte of the parsed graph would change. What moves with the graph's bytes moves
 * with it: the manifest's `graph_content_digest` beside a projected starter, and the `graph_sha256` and `fingerprint`
 * of a bundled character guidance accepted for the old bytes (its text is untouched: it reads nothing of a road),
 * after the old fingerprint is first reproduced by the function the App computes it with. The Jev key comes from the
 * environment (`EXT_JEV_APIKEY`); nothing prints it.
 */
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson, jsonDigest, parsePythonJson, pythonJsonDumps, type JsonValue} from '../kernel-ts/json.ts';
import {applyTravelFill, unfilledRoad} from '../kernel-ts/modules/route-travel.ts';
import {askTravel, readTravelRows, unfilledRoads} from '../extensions/module/travel-fill.ts';
import {guidanceFingerprint} from '../extensions/module/character-guidance.ts';
import {composeRuntimeContext, createRuntime} from '../runtime/host.ts';

type Row = Record<string, any>;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const content = join(root, 'content');
const sha = (bytes: string) => createHash('sha256').update(bytes, 'utf8').digest('hex');

/** The span of every `relations[i].properties` value in the file's own text, so an edit leaves every other byte alone. */
function propertySpans(text: string): Map<number, {start: number; end: number}> {
  const spans = new Map<number, {start: number; end: number}>();
  let at = 0;
  const space = () => { while (at < text.length && ' \t\r\n'.includes(text[at])) at++; };
  const quoted = (): string => { const start = at++; while (text[at] !== '"') { if (text[at] === '\\') at++; at++; } at++; return JSON.parse(text.slice(start, at)); };
  const value = (path: Array<string | number>): void => {
    space();
    const start = at, head = text[at];
    if (head === '{') {
      at++; space();
      if (text[at] === '}') at++;
      else for (;;) { space(); const key = quoted(); space(); at++; value([...path, key]); space(); if (text[at++] === '}') break; }
    } else if (head === '[') {
      at++; space();
      if (text[at] === ']') at++;
      else for (let index = 0; ; index++) { value([...path, index]); space(); if (text[at++] === ']') break; }
    } else if (head === '"') quoted();
    else while (at < text.length && !',]} \t\r\n'.includes(text[at])) at++;
    if (path.length === 3 && path[0] === 'relations' && path[2] === 'properties' && typeof path[1] === 'number') spans.set(path[1], {start, end: at});
  };
  value([]);
  return spans;
}

/** The file's indent unit, read from its first indented line (the shipped graphs use 2 or 1 spaces). */
function indentUnit(text: string): number {
  const line = /\n( +)\S/.exec(text);
  if (!line) throw new Error('the graph is not indented JSON');
  return line[1].length;
}

/** Re-render the filled relations' `properties` in place, each at its own line's indentation. */
function spliced(text: string, graph: Row, changed: Set<number>): string {
  const spans = propertySpans(text), unit = indentUnit(text);
  let out = text;
  for (const index of [...changed].sort((a, b) => b - a)) {
    const span = spans.get(index);
    if (!span) throw new Error(`relation ${index} has no properties in the file`);
    const lineStart = out.lastIndexOf('\n', span.start) + 1, indent = /^ */.exec(out.slice(lineStart))![0];
    const rendered = pythonJsonDumps(graph.relations[index].properties, {indent: unit}).split('\n').join('\n' + indent);
    out = out.slice(0, span.start) + rendered + out.slice(span.end);
  }
  return out;
}

/** Every difference between two parsed graphs must be a travel property added to a road that had none. */
function onlyRoads(before: Row, after: Row): string[] {
  const problems: string[] = [];
  const {relations: a, ...restBefore} = before, {relations: b, ...restAfter} = after;
  if (canonicalJson(restBefore as JsonValue) !== canonicalJson(restAfter as JsonValue)) problems.push('something outside relations changed');
  if (a.length !== b.length) problems.push('the relation count changed');
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (canonicalJson(a[index]) === canonicalJson(b[index])) continue;
    const {properties: pa = {}, ...ra} = a[index], {properties: pb = {}, ...rb} = b[index];
    const {travel_minutes: _m, travel: _t, ...kept} = pb;
    if (a[index].relation_kind !== 'route-to' || !unfilledRoad(a[index]) || canonicalJson(ra) !== canonicalJson(rb)
      || canonicalJson(pa) !== canonicalJson(kept))
      problems.push(`relation ${a[index].relation_id} changed beyond its travel`);
  }
  return problems;
}

/** Register a starter from a content root in a throwaway home and compute each bundle's fingerprint the App's way. */
async function fingerprints(contentRoot: string, moduleId: string, languages: string[]): Promise<Record<string, string>> {
  const home = await mkdtemp(join(tmpdir(), 'fill-starter-travel-'));
  const host = {resourceRoot: root, contentRoot, agentHome: join(root, '.pi/coc-agent')};
  const binding = {owner: 'preparation' as const, home};
  const context = composeRuntimeContext(binding, host);
  const runtime = createRuntime(binding, {...host, ...context});
  try {
    const kernel = runtime.openKernel();
    await kernel.call('module.register', {module_id: moduleId});
    const {occupations} = await kernel.call<any>('setup.occupations');
    const result: Record<string, string> = {};
    for (const language of languages)
      result[language] = await guidanceFingerprint({home: runtime.home, contentRoot, module_id: moduleId, play_language: language, occupations});
    return result;
  } finally {
    await runtime.close();
    await rm(home, {recursive: true, force: true});
  }
}

async function bundles(moduleId: string): Promise<Array<{path: string; language: string; saved: Row}>> {
  const folder = join(content, 'starters', moduleId, 'character-guidance');
  let names: string[] = [];
  try { names = (await readdir(folder)).filter(name => name.endsWith('.json')).sort(); } catch { return []; }
  return Promise.all(names.map(async name => ({path: join(folder, name), language: name.slice(0, -5),
    saved: JSON.parse(await readFile(join(folder, name), 'utf8'))})));
}

async function fill(moduleId: string, dryRun: boolean): Promise<Row> {
  const path = join(content, 'starters', moduleId, 'module-graph.json');
  const text = await readFile(path, 'utf8'), before = parsePythonJson(text) as Row, graph = parsePythonJson(text) as Row;
  const rows = await readTravelRows(content), roads = unfilledRoads(graph);
  const asked = await askTravel({env: process.env, module: moduleId, roads, rows, timeoutMs: 120_000});
  const {filled, skipped} = applyTravelFill(graph, asked.entries, rows);
  const report: Row = {module: moduleId, roads: roads.length, road_relations: graph.relations.filter((r: Row) => r.relation_kind === 'route-to').length,
    ...asked.row, relations_filled: filled.length, relations_adjacent: filled.filter(item => item.travel_minutes === 0).length,
    relations_unfilled: graph.relations.filter(unfilledRoad).length, skipped};
  if (dryRun || !filled.length) return report;
  const changed = new Set(filled.map(item => graph.relations.findIndex((relation: Row) => relation.relation_id === item.relation_id)));
  const out = spliced(text, graph, changed), reparsed = parsePythonJson(out) as Row;
  if (canonicalJson(reparsed as JsonValue) !== canonicalJson(graph as JsonValue)) throw new Error(`${moduleId}: the edited text does not parse to the filled graph`);
  const problems = onlyRoads(before, reparsed);
  if (problems.length) throw new Error(`${moduleId}: ${problems.join('; ')}`);
  const shipped = await bundles(moduleId), live = shipped.filter(bundle => bundle.saved.graph_sha256 === sha(text));
  // The old fingerprint must reproduce before a new one is written: otherwise the bundle is already stale for
  // another reason, and re-keying it would hide that.
  const oldPrints = live.length ? await fingerprints(content, moduleId, live.map(bundle => bundle.language)) : {};
  for (const bundle of live)
    if (oldPrints[bundle.language] !== bundle.saved.fingerprint) throw new Error(`${moduleId}: the ${bundle.language} bundle's fingerprint does not reproduce; not re-keying it`);
  const manifestPath = join(content, 'starters', moduleId, 'module-graph-manifest.json');
  let manifestText: string | undefined;
  try { manifestText = await readFile(manifestPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const manifestDigest = manifestText === undefined ? undefined : String(JSON.parse(manifestText).graph_content_digest);
  if (manifestDigest !== undefined && manifestDigest !== jsonDigest(before as JsonValue))
    throw new Error(`${moduleId}: the manifest's digest does not match the graph before the fill; not touching either`);
  await writeFile(path, out, 'utf8');
  if (manifestText !== undefined && manifestDigest !== undefined) {
    await writeFile(manifestPath, manifestText.replace(manifestDigest, jsonDigest(reparsed as JsonValue)), 'utf8');
    report.manifest = 'graph_content_digest updated';
  }
  if (live.length) {
    const newPrints = await fingerprints(content, moduleId, live.map(bundle => bundle.language));
    for (const bundle of live) {
      const saved = {...bundle.saved, graph_sha256: sha(out), fingerprint: newPrints[bundle.language]};
      await writeFile(bundle.path, JSON.stringify(saved, null, 2) + '\n', 'utf8');
    }
    report.bundles_rekeyed = live.map(bundle => bundle.language);
  }
  return report;
}

const args = process.argv.slice(2), dryRun = args.includes('--dry-run'), ids = args.filter(arg => !arg.startsWith('--'));
if (!ids.length) throw new Error('Usage: node scripts/fill-starter-travel.ts [--dry-run] STARTER_ID...');
for (const id of ids) process.stdout.write(JSON.stringify(await fill(id, dryRun)) + '\n');
