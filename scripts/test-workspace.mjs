/** Private CoW test views of a retained campaign seed; never fall back to full copies. */
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync, utimesSync, statfsSync, openSync, readSync, closeSync, renameSync, rmSync,readlinkSync,symlinkSync,lutimesSync,linkSync } from 'node:fs';
import { resolve, join, dirname, basename, extname, relative, sep, isAbsolute } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const WORKSPACE_RECORD = 'test-workspace.json';
export const ARCHIVE_RECORD = '.test-data-archive.json';
export const TEST_OBJECTS = resolve(import.meta.dirname,'../.coc/test-data/objects');
export const DEFAULT_LIMITS = Object.freeze({ seedBytes: 4 * 1024 ** 3, growthBytes: 512 * 1024 ** 2, minFreeBytes: 10 * 1024 ** 3, files: 100000 });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== '..';
const inside = (root, path) => { const r = relative(root, path); return r === '' || !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };

function realAncestors(path) {
  for (let p = resolve(path);; p = dirname(p)) {
    const st = lstatSync(p, { throwIfNoEntry: false });
    if (st && (st.isSymbolicLink() || !st.isDirectory())) throw Error('Workspace ancestor must be a real directory: ' + p);
    if (dirname(p) === p) break;
  }
}
function assertWritableDestination(path) {
  for (let directory = resolve(path);; directory = dirname(directory)) {
    if (existsSync(join(directory, ARCHIVE_RECORD))) throw Error('Read-only test archive: use --seed-home to create a private writable workspace');
    if (dirname(directory) === directory) break;
  }
}
function filesUnder(root, selected, skip = [], directories) {
  const rows = [];
  function walk(path) {
    if (skip.includes(path)) return;
    if (basename(path) === ARCHIVE_RECORD) return;
    const st = lstatSync(path, { bigint: true });
    if (st.isSymbolicLink()) {
      const target=resolve(dirname(path),readlinkSync(path)),match=basename(target).match(/^([a-f0-9]{64})-([0-7]{4})(?:\.[A-Za-z0-9]+)?$/);
      if(!match||!inside(TEST_OBJECTS,target)||dirname(target)!==join(TEST_OBJECTS,match[1].slice(0,2)))throw Error('Writable fixture references are not supported: '+path);
      realAncestors(dirname(target));const object=lstatSync(target,{bigint:true});
      if(!object.isFile()||(object.mode&0o222n)!==0n)throw Error('Test object must be a read-only regular file');
      rows.push({path:relative(root,path),size:Number(object.size),signature:signature(object),referenceSignature:signature(st),cloneSource:target,expectedHash:match[1],originalMode:parseInt(match[2],8),mtimeMs:Number(st.mtimeNs)/1e6,atimeMs:Number(st.mtimeNs)/1e6});return;
    }
    if (st.isDirectory()) { directories?.push(relative(root, path)); for (const entry of readdirSync(path).sort()) walk(join(path, entry)); }
    else if (st.isFile()) rows.push({ path: relative(root, path), size: Number(st.size), signature: signature(st) });
    else throw Error('Unsupported workspace entry: ' + path);
  }
  for (const path of selected) if (existsSync(join(root, path))) walk(join(root, path));
  return rows;
}
function signature(st) { return [st.dev, st.ino, st.size, st.mtimeNs, st.ctimeNs].map(String).join(':'); }
function sha(path) {
  const hash = createHash('sha256'), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW), buffer = Buffer.allocUnsafe(256 * 1024);
  try { let n; while ((n = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}
function limitsFor(limits = {}) {
  const result = { ...DEFAULT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(result)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, name) || !Number.isSafeInteger(value) || value < 0) throw Error('Invalid workspace limit: ' + name);
    if (name === 'minFreeBytes' ? value < DEFAULT_LIMITS[name] : value > DEFAULT_LIMITS[name]) throw Error('Workspace limits require a reviewed contract change to expand');
  }
  return result;
}
function available(path) { const st = statfsSync(path); return st.bavail * st.bsize; }
function requireFree(path, limits) { const free = available(path); if (free < limits.minFreeBytes) throw Error('Test storage admission refused: free bytes ' + free + ' below ' + limits.minFreeBytes); return free; }
function assertClosed(paths) {
  const result = spawnSync(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof', ['-b', '-w', '-nP', '-u', String(process.getuid()), '-Fpn'], { encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 ** 2 });
  if (result.error || ![0, 1].includes(result.status)) throw Error('Cannot establish that the selected seed is quiescent');
  let pid = 0;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n') && pid !== process.pid && paths.some(path => inside(path, line.slice(1)))) throw Error('Selected seed is open by process ' + pid + ': ' + line.slice(1));
  }
}

export function cloneTestFiles(pairs) {
  if (process.platform !== 'darwin') {
    for (const [source, target] of pairs) copyFileSync(source, target, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL);
    return;
  }
  // libuv returns ENOSYS for forced reflinks on this Mac. cp -c can silently copy.
  const source = fileURLToPath(new URL('./test-clone.c', import.meta.url));
  const digest = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 20);
  const cache = resolve(dirname(source), '../.tmp/test-storage-tools'); realAncestors(cache); mkdirSync(cache, { recursive: true });
  const executable = join(cache, 'clone-' + digest);
  if (!existsSync(executable)) {
    const temporary = executable + '.' + process.pid;
    try {
      const build = spawnSync('/usr/bin/cc', ['-O2', source, '-o', temporary], { encoding: 'utf8' });
      if (build.error || build.status !== 0) throw Error('Cannot build forced CoW helper: ' + (build.error || build.stderr));
      renameSync(temporary, executable);
    } finally { rmSync(temporary, { force: true }); }
  }
  const input = pairs.map(pair => pair.map(path => { if (path.includes('\0')) throw Error('Invalid clone path'); return path; }).join('\0') + '\0').join('');
  const result = spawnSync(executable, [], { input, encoding: 'utf8', maxBuffer: 1024 ** 2 });
  if (result.error || result.status !== 0) throw Error('Forced CoW is unavailable; full-copy fallback refused: ' + (result.error || result.stderr));
}

/** Share every payload type through private CoW file references. No extension exemptions. */
export function shareTestTree(source, destination, { limits,readOnly=false } = {}) {
  source = resolve(source); destination = resolve(destination); limits = limitsFor(limits);
  realAncestors(dirname(source)); realAncestors(dirname(destination));
  assertWritableDestination(destination);
  const info = lstatSync(source);
  if (!info.isSymbolicLink() && !info.isDirectory() && !info.isFile()) throw Error('Test source must be a real file or directory');
  if (inside(source, destination) || inside(destination, source)) throw Error('Test view overlaps its source');
  if (lstatSync(destination, { throwIfNoEntry: false })) throw Error('Preserve existing test view: ' + destination);
  assertClosed([source]);
  const root = info.isDirectory() ? source : dirname(source);
  const selected = info.isDirectory() ? readdirSync(source).sort() : [basename(source)];
  const directories = [], rows = filesUnder(root, selected, [], directories), bytes = rows.reduce((sum, row) => sum + row.size, 0);
  if (rows.length > limits.files || bytes > limits.seedBytes) throw Error('Test tree exceeds its file/byte budget');
  let parent = dirname(destination); while (!existsSync(parent)) parent = dirname(parent);
  requireFree(parent, limits);
  if (info.isDirectory()) mkdirSync(destination, { recursive: true }); else mkdirSync(dirname(destination), { recursive: true });
  if (info.isDirectory()) for (const directory of directories) mkdirSync(join(destination, directory), { recursive: true });
  const prepared = rows.map(row => {
    const path = row.cloneSource??join(root, row.path), st = lstatSync(path);
    if (signature(lstatSync(path, { bigint: true })) !== row.signature) throw Error('Test source changed: ' + row.path);
    const target = info.isDirectory() ? join(destination, row.path) : destination;
    mkdirSync(dirname(target), { recursive: true });
    const hash=sha(path);if(row.expectedHash&&hash!==row.expectedHash)throw Error('Shared test object digest mismatch');
    return { row, path, target, st, hash };
  });
  if(readOnly){
    for(const row of prepared){
      const mode=row.row.originalMode??(row.st.mode&0o777),extension=extname(row.target),suffix=/^\.[A-Za-z0-9]+$/.test(extension)?extension:'';
      const directory=join(TEST_OBJECTS,row.hash.slice(0,2)),object=join(directory,row.hash+'-'+mode.toString(8).padStart(4,'0')+suffix);mkdirSync(directory,{recursive:true});
      if(!existsSync(object)){
        const existing=readdirSync(directory).find(name=>name.startsWith(row.hash+'-')&&!name.includes('.partial-'));
        const canonical=existing?join(directory,existing):row.path;
        if(sha(canonical)!==row.hash)throw Error('Shared object source digest mismatch');
        const temporary=object+'.partial-'+randomUUID();
        try{cloneTestFiles([[canonical,temporary]]);chmodSync(temporary,mode&0o555);if(sha(temporary)!==row.hash)throw Error('Shared object verification failed');try{linkSync(temporary,object);}catch(error){if(error.code!=='EEXIST')throw error;}}finally{rmSync(temporary,{force:true});}
      }
      if((lstatSync(object).mode&0o222)!==0||sha(object)!==row.hash)throw Error('Shared object is writable or corrupt');
      symlinkSync(object,row.target);lutimesSync(row.target,row.st.atime,row.row.mtimeMs===undefined?row.st.mtime:row.row.mtimeMs/1000);
    }
  }else cloneTestFiles(prepared.map(row => [row.path, row.target]));
  for (const row of prepared) {
    if(!readOnly){chmodSync(row.target, row.row.originalMode??(row.st.mode & 0o777)); utimesSync(row.target,row.row.atimeMs===undefined?row.st.atime:row.row.atimeMs/1000,row.row.mtimeMs===undefined?row.st.mtime:row.row.mtimeMs/1000);}
    if ((!readOnly&&sha(row.target)!==row.hash) || signature(lstatSync(row.path, { bigint: true })) !== row.row.signature) throw Error('Test tree verification failed: ' + row.row.path);
  }
  const afterDirectories = [];
  if (JSON.stringify(filesUnder(root, selected, [], afterDirectories)) !== JSON.stringify(rows) || JSON.stringify(afterDirectories) !== JSON.stringify(directories)) throw Error('Test source inventory changed');
  requireFree(destination, limits);
  if(readOnly&&info.isDirectory())writeFileSync(join(destination,ARCHIVE_RECORD),JSON.stringify({kind:'test-data-archive',objects:TEST_OBJECTS,policy:'Materialize a private writable view before running tests'})+'\n',{flag:'wx'});
  const digest = createHash('sha256').update(JSON.stringify(prepared.map(row => [row.row.path, row.hash]))).digest('hex');
  return { files: rows.length, bytes, tree_sha256: digest, method: 'forced-copy-on-write', source, destination };
}

export function createTestWorkspace({ seed, destination, campaign, limits }) {
  seed = resolve(seed); destination = resolve(destination); limits = limitsFor(limits);
  if (!validId(campaign)) throw Error('Invalid campaign id');
  realAncestors(seed); realAncestors(dirname(destination));
  assertWritableDestination(destination);
  if (inside(destination, seed)) throw Error('Destination must not contain the seed');
  if (lstatSync(destination, { throwIfNoEntry: false })) throw Error('Preserve existing test workspace: ' + destination);
  const campaignPath = join(seed, '.coc/campaigns', campaign, 'campaign.json');
  realAncestors(dirname(campaignPath));
  const config = JSON.parse(readFileSync(campaignPath, 'utf8'));
  if (config.id !== campaign || !validId(config.module_id)) throw Error('Seed campaign binding is invalid');
  const selected = ['campaigns/' + campaign, 'repos/' + campaign + '.git', 'modules/' + config.module_id, 'module-campaigns/' + campaign,
    'mods/packages', 'npc', 'npc-voice', 'map-words', 'ui-words', 'memory-decisions/' + campaign, 'memory-drafts/' + campaign].map(path => '.coc/' + path);
  if (selected.some(path => inside(join(seed, path), destination))) throw Error('Destination overlaps selected seed data');
  if (!existsSync(join(seed, '.coc/repos', campaign + '.git')) || !existsSync(join(seed, '.coc/modules', config.module_id))) throw Error('Seed is missing campaign history or its bound module');
  for (const path of selected) realAncestors(dirname(join(seed, path)));
  assertClosed(selected.map(path => join(seed, path)));
  const rows = filesUnder(seed, selected), bytes = rows.reduce((n, row) => n + row.size, 0);
  if (rows.length > limits.files || bytes > limits.seedBytes) throw Error('Selected test seed exceeds its file/byte budget');
  let existingParent = dirname(destination);
  while (!existsSync(existingParent)) existingParent = dirname(existingParent);
  const freeBefore = requireFree(existingParent, limits);
  mkdirSync(destination, { recursive: true });
  const record = { version: 1, kind: 'cow-test-workspace', status: 'creating', seed, destination, campaign, module: config.module_id, created_at: new Date().toISOString(), limits, seedBytes: bytes, freeBefore, files: [] };
  const save = () => writeFileSync(join(destination, WORKSPACE_RECORD), JSON.stringify(record) + '\n');
  save();
  try {
    const prepared = [];
    for (const row of rows) {
      const source = row.cloneSource??join(seed, row.path), target = join(destination, row.path);
      if (signature(lstatSync(source, { bigint: true })) !== row.signature) throw Error('Seed changed during creation: ' + row.path);
      const hash = sha(source), st = lstatSync(source);
      if(row.expectedHash&&hash!==row.expectedHash)throw Error('Shared test object digest mismatch');
      mkdirSync(dirname(target), { recursive: true });
      prepared.push({ row, source, target, hash, st });
    }
    cloneTestFiles(prepared.map(({ source, target }) => [source, target]));
    for (const { row, source, target, hash, st } of prepared) {
      chmodSync(target,row.originalMode??(st.mode & 0o777)); utimesSync(target,row.atimeMs===undefined?st.atime:row.atimeMs/1000,row.mtimeMs===undefined?st.mtime:row.mtimeMs/1000);
      if (sha(target) !== hash || signature(lstatSync(source, { bigint: true })) !== row.signature) throw Error('Seed changed or clone verification failed: ' + row.path);
      record.files.push({ path: row.path, size: row.size, sha256: hash, signature: signature(lstatSync(target, { bigint: true })) });
    }
    const after = filesUnder(seed, selected);
    if (JSON.stringify(after) !== JSON.stringify(rows)) throw Error('Seed inventory changed during creation');
    record.status = 'ready'; record.freeAfter = requireFree(destination, limits); save();
    return record;
  } catch (error) {
    record.status = 'failed'; record.error = String(error); save();
    throw error;
  }
}

export function checkTestWorkspaceBudget(home, evidenceRoot) {
  home = resolve(home); const path = join(home, WORKSPACE_RECORD);
  assertWritableDestination(home);
  if (!existsSync(path)) return null;
  realAncestors(home);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.kind !== 'cow-test-workspace' || record.status !== 'ready' || record.destination !== home) throw Error('Managed test workspace is not ready');
  const limits = limitsFor(record.limits), before = new Map(record.files.map(row => [row.path, row]));
  let growth = 0; const current = filesUnder(home, ['.coc']);
  for (const row of current) if (before.get(row.path)?.signature !== row.signature) growth += row.size;
  let count = current.length;
  if (evidenceRoot && resolve(evidenceRoot) !== home) {
    evidenceRoot = resolve(evidenceRoot); realAncestors(evidenceRoot);
    const evidence = filesUnder(evidenceRoot, readdirSync(evidenceRoot).sort(), [home]);
    growth += evidence.reduce((bytes, row) => bytes + row.size, 0); count += evidence.length;
    requireFree(evidenceRoot, limits);
  }
  const result = { growthBytes: growth, files: count, freeBytes: requireFree(home, limits) };
  if (growth > limits.growthBytes || count > limits.files) throw Error('Test storage admission refused: new/changed bytes ' + growth + ', files ' + count + '; preserve evidence and review the test budget');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--tree') {
    if (process.argv.length !== 5) throw Error('Usage: node scripts/test-workspace.mjs --tree SOURCE NEW_DESTINATION');
    console.log(JSON.stringify(shareTestTree(process.argv[3], process.argv[4])));
    process.exit(0);
  }
  const [seed, destination, campaign] = process.argv.slice(2);
  if (!seed || !destination || !campaign) throw Error('Usage: node scripts/test-workspace.mjs SEED_HOME NEW_HOME CAMPAIGN');
  const record = createTestWorkspace({ seed, destination, campaign });
  console.log(JSON.stringify({ destination: record.destination, files: record.files.length, seedBytes: record.seedBytes, status: record.status }));
}
