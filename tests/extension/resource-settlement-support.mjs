import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// The suite loads these through the bundled TS entry. Explicit repository paths
// let scripts/select-tests.mjs see the direct resource-test dependencies:
// kernel-ts/apply/resources.ts, kernel-ts/apply/clock.ts,
// kernel-ts/healing/resources.ts, kernel-ts/healing/session.ts,
// kernel-ts/healing/mp.ts, kernel-ts/healing/day.ts,
// kernel-ts/resolve/context.ts, kernel-ts/resolve/arithmetic.ts,
// kernel-ts/rules/tables.ts, kernel-ts/random.ts, kernel-ts/read/values.ts.

export const ROOT = resolve(import.meta.dirname, '../..');
export const INVESTIGATOR = 'thomas-hayes';
export const DAY = 1440;
export const WEEK = 7 * DAY;

/** Build once per suite, outside the cases; benchmark wall time includes this work. */
export async function resourceSuite({ entryPoint = 'kernel-ts/testing/resource-settlement.ts' } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'coc-resource-pilot-'));
  let base;
  try {
    await symlink(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
    const entry = process.env.COC_RESOURCE_PILOT_API;
    if (!entry) await build({
      entryPoints: [join(ROOT, entryPoint)],
      outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external',
      format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
    });
    const api = await import(pathToFileURL(entry ? resolve(entry) : join(temporary, 'api.mjs')).href);
    const { clone } = api;
    base = await api.createKernelContext({ workspace: join(temporary, 'unused-workspace'), content: join(ROOT, 'content'), seed: '4' });
    const ruleRoot = join(ROOT, 'content/rulesets/coc7/rules-json');
    const documents = new Map(await Promise.all((await readdir(ruleRoot)).filter(name => name.endsWith('.json')).map(async name =>
      [join(ruleRoot, name), api.parsePythonJson(await readFile(join(ruleRoot, name), 'utf8'))])));
    // Real authored bytes, loaded once. No rule table is synthesized by the adapter.
    const snapshots = { ...base.snapshots,
      readJson: async path => { assert.ok(documents.has(path), `Unexpected rule read: ${path}`); return clone(documents.get(path)); },
      pathExists: async path => documents.has(path),
    };
    const tables = new api.RuleTables({ ...base, snapshots });
    const arithmetic = await api.CheckArithmetic.create(tables);
    const pregen = api.parsePythonJson(await readFile(join(ROOT, 'content/starters/the-haunting/pregens/thomas-hayes/character.json'), 'utf8'));
    const authored = api.parsePythonJson(await readFile(join(ROOT, 'content/starters/the-haunting/module-graph.json'), 'utf8'));

    function create(seed = '4') {
      let storedSheet = clone(pregen);
      // Explicit post-creation fixture: resources start at the authored maxima.
      // Campaign creation itself remains covered by the retained RPC cases.
      storedSheet.current_hp = storedSheet.derived.HP;
      storedSheet.current_mp = storedSheet.derived.MP;
      storedSheet.current_san = storedSheet.derived.SAN;
      storedSheet.conditions = [];
      const saves = new Map();
      const world = { clock: { minutes: 0 }, active_scene: 'commission-briefing' };
      const turn = { turn: 1, receipts: [] };
      const kernel = { ...base, snapshots, rng: new api.PythonRandom(seed), seedLocked: true };
      const graph = new api.ModuleGraph('the-haunting', clone(authored), 'resource-pilot', {});
      const module = { graph, meta: {} };
      // Storage only: receipt minting, RNG, conditions and resource rules stay in production code.
      const campaign = {
        id: 'c1', directory: join(temporary, 'unused-workspace/.coc/campaigns/c1'),
        party: async () => [clone(storedSheet)],
        readSave: async name => clone(saves.get(name) ?? null),
        saveExists: async name => saves.has(name),
        writeSave: async (name, value) => { saves.set(name, clone(value)); },
        writeSheet: async value => { storedSheet = clone(value); },
        writeWorld: async value => { Object.assign(world, clone(value)); },
      };
      function context(callId) {
        const transaction = { campaign, world, turn };
        return { kernel, transaction, campaign, world, turn, graph, module, callId,
          ordinal: Number(callId.split('-c')[1]),
          async settlement(subject) {
            assert.ok(subject === undefined || subject === INVESTIGATOR, 'The pilot fixture has one investigator');
            const snapshot = new api.CampaignSnapshot(kernel, campaign.id);
            snapshot.meta = { id: 'c1', module_id: 'the-haunting' };
            snapshot.world = world;
            snapshot.turn = turn;
            snapshot.party = await campaign.party();
            for (const [name, value] of saves) snapshot.jsonFiles.set(join('save', name), clone(value));
            return new api.SettleContext(kernel, transaction, snapshot, module, tables, arithmetic,
              undefined, callId, this.ordinal, snapshot.party[0], snapshot.party[0], {});
          },
        };
      }
      const record = result => { turn.receipts.push(...clone(result.receipts)); return result; };
      return {
        sheet: () => clone(storedSheet),
        save: name => clone(saves.get(name) ?? null),
        setMp(value) { storedSheet.current_mp = value; },
        clock: () => api.clockSection(graph, world),
        async loseSan(callId, points) {
          const settled = await context(callId).settlement();
          const result = await api.executeSanity(settled, { command: { kind: 'sanity_check', payload: {
            source: 'an unnatural sight', san_loss_success: String(points), san_loss_fail_expr: String(points), involuntary_kind: 'freeze',
          } } }, { capability: { resolver_capability: 'sanity.execute' } });
          turn.receipts.push(...clone(settled.receipts));
          return { ...result.data, san_loss: result.data.check.san_loss };
        },
        async hurt(callId, points) {
          return record(await api.applyResources.damage(context(callId), { kind: 'damage', dice: `1D1+${points - 1}`, why: 'fall' }));
        },
        async rest(callId, minutes) {
          const current = context(callId);
          const [before] = api.advanceClock(world, minutes);
          const result = await api.applyResources.recovery(current, minutes);
          const dayEnded = await api.applyResources.dayBoundary(current, before);
          return record({ ...result, ...(dayEnded ? { day_ended: dayEnded } : {}) });
        },
        async travel(callId, minutes) {
          const current = context(callId), [before] = api.advanceClock(world, minutes);
          const dayEnded = await api.applyResources.dayBoundary(current, before);
          return dayEnded ? { day_ended: dayEnded } : {};
        },
      };
    }
    return { create, api, tables, kernel: { ...base, snapshots }, async close() { try { await base.git.close(); } finally { await rm(temporary, { recursive: true, force: true }); } } };
  } catch (error) {
    try { await base?.git.close(); } finally { await rm(temporary, { recursive: true, force: true }); }
    throw error;
  }
}
