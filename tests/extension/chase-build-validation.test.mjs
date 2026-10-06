/** Signed body Build and structural vehicle Build through the production TS save/load boundary. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {root, temporary, table} from './object-usages-fixture.mjs';

const modulePath = join(temporary, 'chase-build-validation.mjs');
await build({stdin: {contents: "export * from './kernel-ts/chase/index.ts'; export * from './kernel-ts/chase/validation.ts'; export * from './kernel-ts/rules/tables.ts'; export * from './kernel-ts/random.ts';", resolveDir: root},
  outfile: modulePath, bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent'});
const {ChaseSession, RuleTables, PythonRandom, validateSnapshot} = await import(pathToFileURL(modulePath).href);

test('signed human Build survives chase persistence while invalid numbers and negative vehicle capacity refuse', async t => {
  const game = await table(t), tables = new RuleTables(game.context);
  for (const bodyBuild of [-2, -1, 0, 2]) {
    const chase = await ChaseSession.create('signed-body', new PythonRandom(3), tables);
    chase.addParticipant('person', 'quarry', 8, 60, {con: 60, build: bodyBuild});
    chase.addParticipant('car', 'pursuer', 14, 50, {isVehicle: true, build: 5, driveAuto: 60});
    chase.addParticipant('rider', 'passenger', 0, 50, {role: 'passenger', vehicleActorId: 'car', build: bodyBuild});
    let saved;
    const port = {writeSave: async (_name, value) => {saved = structuredClone(value);}, readSave: async () => saved};
    await chase.save(port);
    const restored = await ChaseSession.load(port, new PythonRandom(3), tables, undefined, {trustedStandalone: true});
    assert.equal(restored.participants.person.build, bodyBuild);
    assert.equal(restored.participants.rider.build, bodyBuild);
    for (const actor of ['person', 'rider', 'car']) for (const field of ['build', 'build_max']) {
      for (const invalid of [-0.5, '1', null, true, NaN, Infinity, -Infinity]) {
        const tampered = structuredClone(saved);
        tampered.participants.find(p => p.actor_id === actor)[field] = invalid;
        assert.throws(() => validateSnapshot(tampered), /chase snapshot participant build/);
      }
    }
    for (const field of ['build', 'build_max']) {
      const tampered = structuredClone(saved);
      tampered.participants.find(p => p.actor_id === 'car')[field] = -1;
      assert.throws(() => validateSnapshot(tampered), /chase snapshot participant build/);
    }
    const overMaximum = structuredClone(saved);
    overMaximum.participants.find(p => p.actor_id === 'person').build = bodyBuild + 1;
    assert.throws(() => validateSnapshot(overMaximum), /health\/build/);
    const wrecked = structuredClone(saved);
    Object.assign(wrecked.participants.find(p => p.actor_id === 'car'), {build: 0, wrecked: true});
    assert.doesNotThrow(() => validateSnapshot(wrecked), 'a vehicle reduced to zero structural Build remains valid');
  }
});
