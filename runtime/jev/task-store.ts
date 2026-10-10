/** Atomic revision-checked task records, outside the campaign's canonical world Git tree. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFile, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {sqliteOperation, type SqliteOwner} from '../sqlite-store.ts';
import {ContractError} from './contracts.ts';
import {assertTaskRecord} from './task-record.ts';
import type {TaskRecord, TaskStore} from './task-runtime.ts';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function createTaskStore(directory: string): TaskStore & {list(): Promise<TaskRecord[]>} {
  const parse = (text: string): TaskRecord => {
    let record: unknown;
    try {record = JSON.parse(text);} catch {throw new ContractError('invalid_task_record');}
    assertTaskRecord(record); return record;
  };
  const decode = (row: Record<string, unknown> | undefined): TaskRecord | undefined => {
    if (!row) return undefined;
    const record = parse(String(row.payload));
    if (record.checkpoint.context.id !== row.id || record.revision !== row.revision || record.status !== row.status)
      throw new ContractError('invalid_task_record');
    return record;
  };
  const owner: SqliteOwner = {
    root: resolve(directory), name: 'tasks.sqlite', tables: ['tasks', 'task_imports'],
    schema: 'CREATE TABLE tasks(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);'
      + 'CREATE TABLE task_imports(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes BLOB NOT NULL);',
    async prepare() {
      const names = await readdir(directory).catch(error => {if (error.code === 'ENOENT') return []; throw error;});
      const originals = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
        const bytes = await readFile(join(directory, name)), record = parse(bytes.toString('utf8'));
        if (name !== hash(record.checkpoint.context.id) + '.json') throw new ContractError('invalid_task_record');
        return {name, bytes, record};
      }));
      return {hasLegacy: originals.length > 0, publish(db) {
        for (const {name, bytes, record} of originals) {
          db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(record.checkpoint.context.id, record.revision, record.status, bytes.toString('utf8'));
          db.prepare('INSERT INTO task_imports VALUES(?,?,?)').run(name, hash(bytes), bytes);
        }
      }};
    },
  };
  const loadRow = (db: DatabaseSync, id: string) => decode(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  return {
    load: id => sqliteOperation(owner, false, db => loadRow(db, id), Date.now() + 500),
    async list() {return await sqliteOperation(owner, false, db => db.prepare('SELECT * FROM tasks ORDER BY id').all().map(row => decode(row)!), Date.now() + 500) ?? [];},
    async save(record) {
      assertTaskRecord(record);
      await sqliteOperation(owner, true, db => {
        const previous = loadRow(db, record.checkpoint.context.id);
        if (record.revision !== (previous?.revision ?? 0) + 1 || previous?.status === 'closed' && record.status !== 'closed')
          throw new ContractError('stale_task_record');
        if (previous && (!isDeepStrictEqual(previous.intent, record.intent) || !isDeepStrictEqual(previous.domain, record.domain)
          || ['id', 'rootId', 'parentId', 'owner', 'kind', 'goal', 'scope', 'capabilities', 'origin'].some(key =>
            !isDeepStrictEqual(previous.checkpoint.context[key as keyof typeof record.checkpoint.context], record.checkpoint.context[key as keyof typeof record.checkpoint.context]))))
          throw new ContractError('task_record_conflict');
        db.prepare('INSERT INTO tasks VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET '
          + 'revision=excluded.revision,status=excluded.status,payload=excluded.payload WHERE tasks.revision=excluded.revision-1')
          .run(record.checkpoint.context.id, record.revision, record.status, JSON.stringify(record));
      }, Date.now() + 500);
    },
  };
}
