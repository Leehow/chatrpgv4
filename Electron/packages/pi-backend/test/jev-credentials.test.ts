import {cp, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, expect, it} from 'vitest';
import {createPiHostBackend} from '../src/index.js';
import {assemblePiSpawn, mergedSpawnEnvironment} from '../src/spawn-assembly.js';
import {resetInMemoryVault} from '../src/secret-vault.js';
import {readJevApiKey} from '../../../../extensions/jev/agent/config.js';

let root = '';
let backend: ReturnType<typeof createPiHostBackend> | undefined;
afterEach(async () => {
  await backend?.close(); backend = undefined;
  resetInMemoryVault();
  if (root) await rm(root, {recursive: true, force: true});
  root = '';
});

it('the real Jev settings API and cold preparation share the encrypted vault through save, rotation, clear and disable', async () => {
  root = await mkdtemp(join(tmpdir(), 'jev-vault-'));
  const profile = join(root, 'profile'), project = join(root, 'project');
  await mkdir(project, {recursive: true});
  await cp(resolve(import.meta.dirname, '../../../../extensions/jev'), join(profile, 'extensions/jev'), {recursive: true});
  backend = createPiHostBackend({agentDir: profile, vaultDir: profile, sessionsRoot: join(root, 'sessions'),
    runtimeRoot: join(root, 'runtime'), profileMode: 'isolated', resourceMode: 'explicit',
    env: {PATH: process.env.PATH, TYPESAFE_API_KEY: 'stale-cli-credential', EXT_JEV_APIKEY: 'stale-vault-credential'}});
  const owner = backend as any;
  const preparationEnv = () => owner.cocRuntime.preparationEnv(project);
  const write = (value: string | null) => backend!.handle('updateExtensionSettings', ['jev', {'ext.jev.apiKey': value}]);

  expect(readJevApiKey(await preparationEnv())).toBeUndefined();
  expect(await write('first-jev-secret')).toMatchObject({ok: true});
  expect(await backend.handle('getExtensionSettings', ['jev'])).toEqual({'ext.jev.apiKey': true});
  expect(readJevApiKey(await preparationEnv())).toBe('first-jev-secret');
  expect(await readFile(join(profile, 'secret-vault.json'), 'utf8')).not.toContain('first-jev-secret');
  expect(await readFile(join(profile, 'pipiui-settings.json'), 'utf8')).not.toContain('first-jev-secret');

  const registeredExtensions = await owner.registeredExtensionsForSpawn(project);
  const spawn = assemblePiSpawn({cwd: project, registeredExtensions});
  const env = mergedSpawnEnvironment({EXT_JEV_APIKEY: 'stale-vault-credential'}, {}, spawn.env);
  expect(readJevApiKey(env)).toBe('first-jev-secret');
  expect(JSON.stringify(spawn.args)).not.toContain('first-jev-secret');
  expect(env.PIPIUI_EXT_SETTINGS_JEV).not.toContain('first-jev-secret');

  expect(await write('rotated-jev-secret')).toMatchObject({ok: true});
  expect(readJevApiKey(await preparationEnv())).toBe('rotated-jev-secret');
  expect(await write(null)).toMatchObject({ok: true});
  expect(readJevApiKey(await preparationEnv())).toBeUndefined();
  expect(await write('restored-jev-secret')).toMatchObject({ok: true});
  await backend.handle('setExtensionEnabled', ['jev', false, 'app']);
  expect(readJevApiKey(await preparationEnv())).toBeUndefined();
});

it('a cleared mounted extension cannot inherit a stale secret from the host or dotenv', () => {
  const spawn = assemblePiSpawn({cwd: '/tmp/jev-test', registeredExtensions: [{id: 'jev', enabled: true,
    extensionPath: '/tmp/jev-test/agent/index.js', settings: {}}]});
  const env = mergedSpawnEnvironment({EXT_JEV_APIKEY: 'host-old', TYPESAFE_API_KEY: 'legacy-old'},
    {EXT_JEV_APIKEY: 'dotenv-old'}, spawn.env);
  expect(readJevApiKey(env)).toBeUndefined();
});
