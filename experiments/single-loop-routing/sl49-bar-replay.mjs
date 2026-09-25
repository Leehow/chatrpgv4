/**
 * SL-48 / SL-49: replay the bar reading of a live table's turn through this worktree's emitted kernel, with the
 * reviews the live table recorded (batch 5 of SL-29A: campaign `sl29ab5-xuese-5001`, the bar `last-stop`, job `read-6`).
 *
 *   node experiments/single-loop-routing/sl49-bar-replay.mjs --home <dir holding .coc> --campaign <id> --focus <scene>
 *     --job <read-N> --turn <n> [--out <dir>] [--keep]
 *
 * What it does, on a disposable copy of the table's `.coc` (the campaign, its sidecar repository, its module fork, the
 * library module and the Mod packages; the live table's files are only read):
 * 1. Positions the world before the turn's move: the scene leaves `index_scenes` (the move landed there on that turn).
 * 2. For each recorded round of the job (round 1: the candidate copy and the unit reviews under `verify-1/`; round 2:
 *    the attempt's `draft.json` and merged `review.json`), queues a fresh `detail` reading of the focus, puts the
 *    recorded observations, draft and review in its attempt, and finishes it `completed`: the publication gate of this
 *    branch judges the recorded review. A refusal is finished `failed` with the refusal the host would record (§22.3.1).
 * 3. Opens the turn with its recorded player input, sends the move, and reports the pages the refusal names
 *    (`details.index`, §22.4.8), then lands it (`_land_on_index`) as the host would.
 * 4. Builds the Keeper's note as the hybrid engine would on the next model step (`readCarriedViews` + `carriedSection`):
 *    the scene's text over those pages (their native text, `runtime.sourceText`), and the scene's record -- the scene
 *    view when the reading published (with `where.contested`), else `{status: "unavailable", reason}`.
 *
 * The summary (stdout, and `summary.json` in `--out`) says whether the record published, the contested fields, the
 * refusal, the scene's index row and the note's views with their sizes; the note itself (book text) is written only to
 * `--out`. No model is called. Nothing under the live table's home is written.
 */
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {REPO, startKernel} from './kernel.mjs';
import {createRuntime} from '../../runtime/host.ts';
import {carriedSection, readCarriedViews} from '../../runtime/jev/carried-views.ts';

const argv = process.argv.slice(2), arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const home = arg('--home'), campaign = arg('--campaign'), focus = arg('--focus'), jobId = arg('--job'), turn = Number(arg('--turn'));
if (!home || !campaign || !focus || !jobId || !Number.isInteger(turn)) throw new Error('--home, --campaign, --focus, --job and --turn are required');
const out = arg('--out');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value));

const live = join(home, '.coc'), ws = mkdtempSync(join(tmpdir(), 'sl49-bar-replay-'));
const fork = join(ws, '.coc/module-campaigns', campaign, 'modules');
try {
  // The table's own files, copied (APFS clones where it can); never written in place.
  for (const part of [join('campaigns', campaign), join('module-campaigns', campaign), join('repos', `${campaign}.git`), join('mods', 'packages')])
    if (existsSync(join(live, part))) cpSync(join(live, part), join(ws, '.coc', part), {recursive: true});
  const meta0 = json(join(live, 'campaigns', campaign, 'campaign.json')), mid = meta0.module_id;
  if (existsSync(join(live, 'modules', mid))) cpSync(join(live, 'modules', mid), join(ws, '.coc/modules', mid), {recursive: true});
  const moduleDir = join(fork, mid), attempt = join(moduleDir, 'work', jobId, 'attempt-1');
  const worldPath = join(ws, '.coc/campaigns', campaign, 'world.json'), world = json(worldPath);
  const record = json(join(ws, '.coc/campaigns', campaign, 'turns', `${String(turn).padStart(4, '0')}.json`));
  const move = (record.receipts ?? []).find(row => row.kind === 'move' && row.to === focus);
  if (!move) throw new Error(`turn ${turn} has no move into ${focus}`);
  world.index_scenes = (world.index_scenes ?? []).filter(scene => scene !== focus);
  save(worldPath, world);

  // The recorded rounds.
  const unitReviews = round => readdirSync(join(attempt, `verify-${round}`)).filter(name => name.startsWith('unit-')).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map(unit => { const dir = join(attempt, `verify-${round}`, unit), tries = readdirSync(dir).filter(name => name.startsWith('attempt-')).sort();
      return join(dir, tries.at(-1)); });
  const rounds = [];
  if (existsSync(join(attempt, 'verify-1'))) {
    const units = unitReviews(1);
    rounds.push({round: 1, draft: json(join(units[0], 'draft.json')), review: {checked: units.flatMap(dir => json(join(dir, 'review.json')).checked),
      missing: units.flatMap(dir => json(join(dir, 'review.json')).missing)}});
  }
  if (existsSync(join(attempt, 'verify-2'))) rounds.push({round: 2, draft: json(join(attempt, 'draft.json')), review: json(join(attempt, 'review.json'))});
  const observations = json(join(attempt, 'observations.json'));

  const kernel = startKernel({workspace: ws});
  const summary = {campaign, focus, job: jobId, turn, rounds: []};
  let published = null;
  for (const {round, draft, review} of rounds) {
    await kernel.call('module.read.request', {module_id: mid, campaign, purpose: 'detail', focus, retry: true});
    const job = await kernel.call('module.read.claim', {module_id: mid, owner: 'sl49-replay', campaign});
    if (!job.job_id) throw new Error(`no reading of ${focus} to claim`);
    save(join(job.work_dir, 'observations.json'), {...observations, review_pages: observations.review_pages?.length ? observations.review_pages : observations.read_pages});
    save(join(job.work_dir, 'draft.json'), draft);
    save(join(job.work_dir, 'review.json'), review);
    const disputes = review.checked.filter(entry => entry.verdict !== 'supported').map(entry => ({paths: entry.paths ?? [entry.path], verdict: entry.verdict}));
    const frame = await kernel.frame('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed', campaign,
      draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
    if (frame.ok) {
      published = {round, job: job.job_id};
      summary.rounds.push({round, job: job.job_id, disputes, published: true});
      break;
    }
    const details = frame.error.details ?? {};
    const refusal = {message: frame.error.message, ...Object.fromEntries(['path', 'rule', 'reason'].filter(key => typeof details[key] === 'string').map(key => [key, details[key]]))};
    await kernel.call('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'failed', campaign, detail: frame.error.message, refusal});
    summary.rounds.push({round, job: job.job_id, disputes, published: false, refusal: {code: frame.error.code, path: details.path ?? null, rule: details.rule ?? null,
      verdict: details.verdict ?? null, message_head: String(frame.error.message).split(': ')[0]}});
  }
  const forkMeta = json(join(moduleDir, 'module.json')), graph = json(join(moduleDir, forkMeta.graph_file));
  summary.published = published;
  summary.contested = Object.keys(graph.contested ?? {});
  summary.scene_index = (forkMeta.reading?.scene_index ?? []).map(row => ({name: row.name, scene: row.scene ?? null, pages: row.pages, job_id: row.job_id}));

  // The turn: its recorded input, the move, where it lands.
  await kernel.call('table.open', {campaign});
  const turnState = json(join(ws, '.coc/campaigns', campaign, 'turn.json'));
  if (turnState.state !== 'acting') await kernel.call('table.player_input', {campaign, text: record.player_text});
  // The recorded move: its destination and, for an improvised route, the way the Keeper said they went.
  const effect = {kind: 'move', to: focus, ...(typeof move.via === 'string' ? {via: move.via} : {})}, callId = `t${json(join(ws, '.coc/campaigns', campaign, 'turn.json')).turn}-c90`;
  const refused = await kernel.frame('table.apply', {campaign, call_id: callId, effects: [effect]});
  let landed = null, pages = [];
  if (!refused.ok && refused.error.details?.index) {
    pages = refused.error.details.index.pages;
    landed = await kernel.call('table.apply', {campaign, call_id: callId, effects: [{...effect, _land_on_index: true}]});
  }
  summary.move = refused.ok ? {landed: 'ready'} : {refused: refused.error.details?.reason ?? refused.error.code, ...(refused.error.details?.reason ? {} : {error: refused.error}), index_pages: pages,
    landed: landed ? {active_scene: landed.world?.active_scene, scene_text: landed.scene_text} : null};

  // The Keeper's note on the next model step, as the hybrid engine builds it.
  const runtime = createRuntime({owner: 'preparation', home: ws}, {resourceRoot: REPO, nodeExecutable: process.execPath});
  let texts = [];
  if (pages.length) {
    const bundle = await runtime.sourceText({pdf: join(moduleDir, forkMeta.source_document.path), pages, expected_file_sha256: forkMeta.source_document.file_sha256});
    texts = (bundle.snapshots ?? []).map(row => ({page: row.page, ...(row.pdf_label ? {pdf_label: row.pdf_label} : {}), text: row.text ?? ''}));
  }
  const call = (method, params) => kernel.call(method, {campaign, ...params});
  const refusedRound = summary.rounds.at(-1);
  const carried = await readCarriedViews({call, people: [], ...(published && !pages.length ? {scene: focus} : {}),
    ...(texts.length ? {sceneTexts: [{scene: focus, pages: texts}]} : {}),
    ...(!published ? {sceneRecords: [{scene: focus, view: {status: 'unavailable', reason: refusedRound?.refusal?.rule ?? 'reading_failed'}}]} : {})});
  const note = carriedSection(carried, {record: !!published});
  summary.note = {views: carried.views.map(entry => ({focus: entry.focus, name: entry.name ?? null, bytes: Buffer.byteLength(JSON.stringify(entry.view)),
    keys: Object.keys(entry.view ?? {}), ...(entry.focus === 'scene' ? {contested: (entry.view.where?.contested ?? []).map(row => `${row.record} ${row.field}`)} : {}),
    ...(entry.truncated ? {truncated: true, omitted_fields: entry.omitted_fields ?? []} : {})})), head_bytes: Buffer.byteLength(String(note?.head ?? ''))};
  await runtime.close?.();
  await kernel.close();
  if (out) { mkdirSync(out, {recursive: true}); save(join(out, 'summary.json'), summary); save(join(out, 'note.json'), note ?? null); }
  console.log(JSON.stringify(summary, null, 1));
} finally {
  if (!argv.includes('--keep')) rmSync(ws, {recursive: true, force: true});
  else console.error(`workspace kept: ${ws}`);
}
