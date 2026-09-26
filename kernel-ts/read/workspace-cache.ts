/** One lock and byte governor for rebuildable workspace files, never campaign directories. */
import {readdir, readFile, stat, rm, mkdir, open} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';

export const CAMPAIGN_CACHE_BYTES = 128 * 1024 * 1024;
export const TOTAL_CACHE_BYTES = 512 * 1024 * 1024;

export function workspaceCacheRoot(storeRoot: string): string {
    const root = resolve(storeRoot);
    return ['evidence', 'workpad'].includes(basename(root)) && basename(dirname(root)) === 'workspace-cache' ? dirname(root) : root;
}

/** `now` (SL-87): the clock the 500 ms wait for the lock is measured on. Defaults to `Date.now`; a test whose subject is not
 * that wait passes one that moves per poll, so a loaded machine's slow holder does not time it out. */
export async function withWorkspaceCacheLock<T>(storeRoot: string, action: () => Promise<T>, now: () => number = Date.now): Promise<T> {
    // The same fs-ext descriptor backend as the kernel. Keep this shared source adapter free
    // of kernel .js imports: the host also loads it directly through Node's TypeScript loader.
    const native = createRequire(import.meta.url)('fs-ext') as {flockSync(fd: number, operation: string): void};
    const root = workspaceCacheRoot(storeRoot);
    await mkdir(root, {recursive: true, mode: 0o700});
    const handle = await open(join(root, '.write.lock'), 'a+', 0o600);
    let held = false;
    try {
        const deadline = now() + 500;
        for (;;) {
            try {native.flockSync(handle.fd, 'exnb'); held = true; break;}
            catch (error) {
                if (!['EAGAIN', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '') || now() >= deadline) throw error;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
        return await action();
    } finally {try {if (held) native.flockSync(handle.fd, 'un');} finally {await handle.close();}}
}

/** Called under the common lock. Reserve the peak atomic-write bytes before writing anything. */
export async function reserveWorkspaceBytes(storeRoot: string, campaign: string, additional: number, protectedPaths: string[] = [],
    limits = {campaign: CAMPAIGN_CACHE_BYTES, total: TOTAL_CACHE_BYTES}): Promise<void> {
    const root = workspaceCacheRoot(storeRoot);
    // Standalone adapters enforce their explicit local quota; the host's combined governor is
    // enabled only for its canonical cache root, never by walking a caller's parent directory.
    if (basename(root) !== 'workspace-cache') return;
    const files: Array<{path: string; bytes: number; modified: number}> = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
        if (depth > 3) throw new Error('workspace cache index depth exceeded');
        for (const entry of await readdir(directory, {withFileTypes: true}).catch(() => [])) {
            if (entry.isSymbolicLink() || entry.name === '.write.lock') continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await walk(path, depth + 1);
            else if (entry.isFile()) {
                if (files.length >= 8192) throw new Error('workspace cache file quota exceeded');
                const info = await stat(path); files.push({path, bytes: info.size, modified: info.mtimeMs});
            }
        }
    };
    await walk(root, 0);
    const ownership = new Map<string, string>();
    for (const file of files) {
        if (!file.path.endsWith('.json')) continue;
        try {
            const data = JSON.parse(await readFile(file.path, 'utf8'));
            if (typeof data.scope?.campaign !== 'string') continue;
            ownership.set(file.path, data.scope.campaign);
            if (dirname(file.path) === join(root, 'evidence', 'refs') && /^[a-f0-9]{64}$/.test(data.id))
                ownership.set(join(root, 'evidence', 'bodies', data.id), data.scope.campaign);
        } catch { /* Corruption remains quota-visible and evictable cache data. */ }
    }
    let total = files.reduce((sum, file) => sum + file.bytes, 0);
    let owned = files.reduce((sum, file) => sum + (ownership.get(file.path) === campaign ? file.bytes : 0), 0);
    const protectedSet = new Set(protectedPaths.map(path => resolve(path)));
    for (const file of files.sort((a, b) => a.modified - b.modified)) {
        if (total + additional <= limits.total && owned + additional <= limits.campaign) break;
        if (protectedSet.has(file.path)) continue;
        if (owned + additional > limits.campaign && ownership.get(file.path) !== campaign) continue;
        await rm(file.path, {force: true}); total -= file.bytes;
        if (ownership.get(file.path) === campaign) owned -= file.bytes;
    }
    if (total + additional > limits.total || owned + additional > limits.campaign) throw new Error('workspace cache quota exceeded');
}
