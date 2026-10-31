/**
 * A campaign id reused after an aborted setup (live 1031b): the earlier attempt forked a private source workspace and its
 * directory was renamed away, but the authoritative source database still registered that workspace. The registration alone
 * is no workspace: the new campaign must read the shared library until it forks again, and create must get a usable answer.
 */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {mkdir, readdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {CONTENT_DIR, importSource, kernel, MODULE, PREGEN, ROOT} from './support.ts';

const {createKernelContext} = await importSource('kernel-ts/context.ts');
const {ensureCampaignModule} = await importSource('kernel-ts/modules/campaign-scope.ts');
const {closeSourceState} = await importSource('kernel-ts/modules/source-state.ts');
const {createAdvisoryLocks} = await importSource('kernel-ts/locks.ts');
const flock = promisify(createRequire(join(ROOT, 'package.json'))('fs-ext').flock);

/** A campaign's first private write, through the production fork (§22.6); the RPC kernel shares the same home. */
async function forkFor(k: any, campaign: string): Promise<void> {
 const context = await createKernelContext({workspace: k.workspace, content: CONTENT_DIR, locks: createAdvisoryLocks(flock)});
 try { await ensureCampaignModule(context, campaign, MODULE); }
 finally { closeSourceState(context.stateRoot); await context.git.close?.(); }
 // The campaign's first read registers the published workspace in the authoritative source database.
 await k.ok('module.status', {module_id: MODULE, campaign});
}

const ID = 'c-reused';

async function abortedFork(k: any): Promise<string> {
 const refused = await k.err('campaign.create', {id: ID, module: MODULE, pregen: PREGEN, play_language: 'zh-Hans', start_scene: 'no-such-opening'});
 const scene = refused.details.candidates[0].scene;
 // The aborted attempt forked the workspace before its campaign.json existed (setup scopes precede it, §22.6).
 await forkFor(k, ID);
 const scope = join(k.workspace, '.coc/module-campaigns', ID);
 assert.ok(existsSync(join(scope, 'modules', MODULE, 'module.json')), 'the aborted attempt forked a private workspace');
 // The driver renamed the aborted attempt's directories away; the source database was not told.
 await rename(scope, scope + '-aborted-books-changed');
 return scene;
}

test('a registration whose private workspace is gone reads the library, and campaign.create succeeds', async t => {
 const k = await kernel(t);
 const scene = await abortedFork(k);
 const status = await k.ok('module.status', {module_id: MODULE, campaign: ID});
 assert.ok(status, 'the campaign scope answers from the library');
 const created = await k.ok('campaign.create', {id: ID, module: MODULE, pregen: PREGEN, play_language: 'zh-Hans', start_scene: scene});
 assert.ok(created, 'the campaign is created on the authored opening');
});

test('navigation residue written into the vanished workspace is no fork either', async t => {
 const k = await kernel(t);
 const scene = await abortedFork(k);
 // What 1031b left: a source-navigation write recreated the directory with sections.json and its lock, no module.json.
 const residue = join(k.workspace, '.coc/module-campaigns', ID, 'modules', MODULE);
 await mkdir(residue, {recursive: true});
 await writeFile(join(residue, 'sections.json'), '[]');
 await writeFile(join(residue, '.metadata.lock'), '');
 const created = await k.ok('campaign.create', {id: ID, module: MODULE, pregen: PREGEN, play_language: 'zh-Hans', start_scene: scene});
 assert.ok(created, 'the campaign is created on the authored opening');
 // A later private write forks a fresh workspace; the residue is kept beside it as evidence, never deleted.
 await forkFor(k, ID);
 assert.ok(existsSync(join(residue, 'module.json')), 'the campaign forked again');
 assert.equal(JSON.parse(readFileSync(join(residue, 'module.json'), 'utf8')).retired, undefined, 'the registration is the new seed, not the retired residue');
 const kept = (await readdir(join(k.workspace, '.coc/module-campaigns', ID, 'modules'))).filter(name => name.startsWith(`.residue-${MODULE}-`));
 assert.equal(kept.length, 1, 'the residue was moved aside, not removed');
});

test('a created campaign whose private workspace lost its graph is refused as not prepared, never read from the library', async t => {
 const k = await kernel(t);
 const created = await k.ok('campaign.create', {id: ID, module: MODULE, pregen: PREGEN, play_language: 'zh-Hans'});
 assert.ok(created);
 await forkFor(k, ID);
 const modules = join(k.workspace, '.coc/module-campaigns', ID, 'modules');
 await rename(join(modules, MODULE), join(modules, MODULE + '-moved'));
 const status = await k.err('module.status', {module_id: MODULE, campaign: ID});
 assert.equal(status.code, 'campaign_not_ready');
 assert.equal(status.details?.reason, 'module_not_prepared');
 assert.ok(typeof status.fix === 'string' && status.fix.length > 0, 'the refusal says what to do');
});
