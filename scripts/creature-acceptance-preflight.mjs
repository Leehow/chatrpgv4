/** Read-only prerequisites for creature acceptance; expectations come from the reviewed package, never this runtime. */
import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const REQUIRED_FILES = ['bin/pi-coc', 'build/kernel/rpc.mjs', 'build/runtime/launch.mjs', 'build/runtime/pi-hybrid.mjs'];
const REQUIRED_MODS = ['hostile-creatures', 'natural-npc', 'narration-craft'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function validateExpected(expected) {
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!object(expected) || !/^[a-f0-9]{40}$/.test(expected.commit ?? '') || !digest(expected.receipt_sha256)
    || !REQUIRED_FILES.every(file => digest(expected.files?.[file]))
    || !REQUIRED_MODS.every(id => {
      const lock = expected.mod_locks?.[id];
      return object(lock) && typeof lock.version === 'string' && digest(lock.digest)
        && Number.isInteger(lock.state_version) && lock.enabled === true && object(lock.settings);
    }) || typeof expected.requirements?.creature !== 'string' || !expected.requirements.creature.trim()
    || typeof expected.requirements.habits !== 'string' || !expected.requirements.habits.trim()
    || typeof expected.requirements.weakness_actor !== 'string' || !expected.requirements.weakness_actor.trim()
    || !Array.isArray(expected.requirements.weakness_books) || !expected.requirements.weakness_books.length
    || expected.requirements.weakness_books.some(book => typeof book !== 'string' || !book.trim())) {
    throw new Error('A reviewed commit, receipt, compiled-file hashes, exact Mod locks and authored binding facts are required.');
  }
}

function kernelReader(root, home) {
  const child = spawn(join(root, 'node/bin/node'), [join(root, 'build/kernel/rpc.mjs'), '--workspace', home,
    '--content', join(root, 'content')], {cwd: root, env: {...process.env, PI_COC_RESOURCE_ROOT: root,
    PI_COC_HOME: home, PI_COC_LAYOUT: 'compiled', PI_OFFLINE: '1'}, stdio: ['pipe', 'pipe', 'pipe']});
  const pending = new Map(); let sequence = 0, stderr = '';
  const fail = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
  child.once('error', fail);
  child.stdin.on('error', fail);
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  const lines = createInterface({input: child.stdout});
  lines.on('line', line => {
    try {
      const message = JSON.parse(line), waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result); else waiter.reject(new Error(JSON.stringify(message.error)));
    } catch (error) { fail(error); }
  });
  const closed = new Promise(accept => child.once('close', code => {
    fail(new Error(`Kernel closed (${code}): ${stderr}`)); accept();
  }));
  return {
    read: (method, params) => new Promise((accept, reject) => {
      const id = `preflight-${++sequence}`, timer = setTimeout(() => {
        pending.delete(id); reject(new Error(`Read timed out: ${method}`));
      }, 15000);
      pending.set(id, {resolve: value => {clearTimeout(timer); accept(value);},
        reject: error => {clearTimeout(timer); reject(error);}});
      child.stdin.write(JSON.stringify({id, method, params}) + '\n');
    }),
    close: async () => {
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGTERM'), 5000);
      try { await closed; } finally {clearTimeout(timer); lines.close();}
    },
  };
}

export async function checkCreaturePrerequisites({root, home, campaign, receipt, expected, read}) {
  const checks = [], add = (gate, field, actual, wanted) => checks.push({gate, field,
    pass: canonical(actual) === canonical(wanted), actual, expected: wanted});
  const result = () => ({ok: checks.length > 0 && checks.every(check => check.pass),
    scope: 'prerequisites_only', no_model_calls: true, checks});
  let reader;
  try {
    validateExpected(expected);
    if (typeof campaign !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(campaign)) throw new Error('An existing campaign id is required.');
    root = await realpath(root);
    const receiptBytes = await readFile(receipt), packaged = JSON.parse(receiptBytes);
    add('artifact', 'receipt_sha256', sha(receiptBytes), expected.receipt_sha256);
    add('artifact', 'commit', packaged.commit, expected.commit);
    add('artifact', 'resource_root', root, await realpath(join(packaged.app, 'Contents/Resources/pi-coc')));
    for (const file of REQUIRED_FILES) add('artifact', file, sha(await readFile(join(root, file))), expected.files[file]);
    if (checks.some(check => !check.pass)) return result();
    const world = JSON.parse(await readFile(join(home, '.coc/campaigns', campaign, 'world.json')));
    reader = read ? {read, close: async () => {}} : kernelReader(root, home);
    const params = {campaign}, catalog = await reader.read('mods.list', params);
    for (const id of REQUIRED_MODS) {
      const wanted = expected.mod_locks[id], active = world.mods?.active?.[id];
      add('locks', id, active, wanted);
      add('locks', `${id}.loadable`, catalog.mods?.some(mod => mod.id === id && mod.version === wanted.version
        && mod.compatible === true && canonical(mod.active) === canonical(wanted)), true);
    }
    add('locks', 'pending', world.mods?.pending, {});
    add('locks', 'pending_order', Object.hasOwn(world.mods ?? {}, 'pending_order'), false);
    if (checks.some(check => !check.pass)) return result();
    const capsule = await reader.read('table.capsule', params), wanted = expected.requirements;
    const word = capsule.mods?.vocabulary?.words?.find(word => word.key === 'habits');
    add('bindings', 'capsule.habits.bound', word?.bound, true);
    const creature = await reader.read('table.look', {...params, focus: 'npc', name: wanted.creature});
    add('bindings', 'creature.kind', creature.kind, 'creature');
    add('bindings', 'creature.habits', creature[word?.label ?? 'habits'], wanted.habits);
    const actor = await reader.read('table.look', {...params, focus: 'npc', name: wanted.weakness_actor});
    add('bindings', 'actor.weaknesses', actor.weaknesses?.map(entry => entry.book), wanted.weakness_books);
  } catch (error) {checks.push({gate: 'unavailable', field: 'preflight', pass: false, error: String(error.message)});}
  finally {await reader?.close();}
  return result();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const flags = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const flag = process.argv[i];
      if (!['--root', '--home', '--campaign', '--receipt', '--expected'].includes(flag) || !process.argv[i + 1]) {
        throw new Error('Use --root --home --campaign --receipt --expected; the expectation must come from the reviewed package.');
      }
      flags[flag.slice(2)] = process.argv[i + 1];
    }
    const expected = JSON.parse(await readFile(flags.expected, 'utf8'));
    const report = await checkCreaturePrerequisites({...flags, expected});
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ok: false, scope: 'prerequisites_only', error: String(error.message)}) + '\n');
    process.exitCode = 1;
  }
}
