/** Atomic revision-checked task records, outside the campaign's canonical world Git tree. */
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ContractError } from './contracts.ts';
import { assertTaskRecord } from './task-record.ts';
import type { TaskRecord, TaskStore } from './task-runtime.ts';

export function createTaskStore(directory: string): TaskStore & { list(): Promise<TaskRecord[]> } {
  const path = (id: string) => join(directory, `${createHash('sha256').update(id).digest('hex')}.json`);
  const parse = (text: string): TaskRecord => {
    let record: unknown;
    try { record = JSON.parse(text); } catch { throw new ContractError('invalid_task_record'); }
    assertTaskRecord(record); return record;
  };
  const load = async (id: string): Promise<TaskRecord | undefined> => {
    let text: string;
    try { text = await readFile(path(id), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const record = parse(text);
    if (record.checkpoint.context.id !== id) throw new ContractError('invalid_task_record');
    return record;
  };
  return {
    load,
    async list() {
      const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const records: TaskRecord[] = [];
      for (const file of files.filter(file => /^[a-f0-9]{64}\.json$/.test(file))) records.push(parse(await readFile(join(directory, file), 'utf8')));
      return records;
    },
    async save(record) {
      assertTaskRecord(record);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = path(record.checkpoint.context.id), temporary = `${target}.${randomUUID()}.tmp`;
      const lock = await open(`${target}.lock`, 'a+', 0o600);
      // Reuse the product's descriptor-owned native lock; a process crash releases it.
      const native = createRequire(import.meta.url)('fs-ext') as { flockSync(fd: number, operation: string): void };
      let held = false;
      try {
        const deadline = Date.now() + 500;
        for (;;) {
          try { native.flockSync(lock.fd, 'exnb'); held = true; break; }
          catch (error) {
            if (!['EAGAIN', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '') || Date.now() >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        const previous = await load(record.checkpoint.context.id);
        if (record.revision !== (previous?.revision ?? 0) + 1 || previous?.status === 'closed' && record.status !== 'closed')
          throw new ContractError('stale_task_record');
        if (previous && (!isDeepStrictEqual(previous.intent, record.intent) || !isDeepStrictEqual(previous.domain, record.domain)
          || ['id', 'rootId', 'parentId', 'owner', 'kind', 'goal', 'scope', 'capabilities', 'origin'].some(key =>
            !isDeepStrictEqual(previous.checkpoint.context[key as keyof typeof record.checkpoint.context], record.checkpoint.context[key as keyof typeof record.checkpoint.context]))))
          throw new ContractError('task_record_conflict');
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, target);
        const folder = await open(directory, 'r');
        try { await folder.sync(); } finally { await folder.close(); }
      } finally {
        try { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        finally { try { if (held) native.flockSync(lock.fd, 'un'); } finally { await lock.close(); } }
      }
    },
  };
}
