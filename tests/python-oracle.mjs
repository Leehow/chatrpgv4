/** Materialize a read-only historical reference for developer tests, never for product launch. */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const spec = JSON.parse(fs.readFileSync(join(here, 'python-oracle.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(spec.revision)) throw new Error('The Python oracle requires a full pinned Git revision');
let retainedRoot;

function permissions(root, writable) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected link in frozen oracle: ${root}`);
  if (stat.isDirectory()) {
    if (writable) fs.chmodSync(root, 0o755);
    for (const name of fs.readdirSync(root)) permissions(join(root, name), writable);
    if (!writable) fs.chmodSync(root, 0o555);
  } else fs.chmodSync(root, writable ? 0o644 : 0o444);
}

export function pythonOracleRoot() {
  if (retainedRoot) return retainedRoot;
  const cache = join(repo, '.cache', 'python-oracle');
  const target = join(cache, spec.revision);
  const marker = join(target, 'oracle-revision');
  if (fs.existsSync(marker)) {
    if (fs.lstatSync(target).isSymbolicLink() || fs.readFileSync(marker, 'utf8').trim() !== spec.revision)
      throw new Error('The frozen oracle cache does not match its revision');
    return retainedRoot = target;
  }
  if (fs.existsSync(target)) throw new Error(`Incomplete test oracle cache: ${target}`);
  fs.mkdirSync(cache, {recursive:true});
  const stage = fs.mkdtempSync(join(cache, '.export-'));
  try {
    const archive = execFileSync('git', ['archive', '--format=tar', spec.revision, ...spec.paths],
      {cwd:repo, env:Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), maxBuffer:128 * 1024 * 1024, stdio:['ignore','pipe','pipe']});
    execFileSync('tar', ['-xf', '-', '-C', stage], {input:archive});
    fs.writeFileSync(join(stage, 'oracle-revision'), spec.revision + '\n');
    permissions(stage, false);
    try { fs.renameSync(stage, target); }
    catch (error) {
      if (!['EEXIST','ENOTEMPTY'].includes(error.code) || !fs.existsSync(marker)
          || fs.readFileSync(marker,'utf8').trim() !== spec.revision) throw error;
      permissions(stage, true);
      fs.rmSync(stage, {recursive:true});
    }
    return retainedRoot = target;
  } catch (error) {
    if (fs.existsSync(stage)) { permissions(stage, true); fs.rmSync(stage, {recursive:true}); }
    throw new Error(`Cannot prepare the frozen Python test oracle at ${spec.revision}; the checkout must include this Git history. ${error.message}`);
  }
}

export function pythonOracleEnvironment(env = process.env) {
  return {...env, PYTHONPATH:join(pythonOracleRoot(), 'kernel'), PYTHONDONTWRITEBYTECODE:'1'};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write(pythonOracleRoot() + '\n');
