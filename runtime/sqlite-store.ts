/** Short, operation-owned SQLite connections. Callbacks never await while a transaction is held. */
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const sqliteBusy = (error: unknown): boolean =>
  typeof (error as {errcode?: unknown})?.errcode === 'number' && ((error as {errcode: number}).errcode & 255) === 5;
export interface SqliteOwner {
  root: string;
  name: string;
  tables: readonly string[];
  schema: string;
  prepare(): Promise<{hasLegacy: boolean; publish(db: DatabaseSync): void}>;
}

export async function sqliteOperation<T>(owner: SqliteOwner, write: boolean, action: (db: DatabaseSync) => T,
  retryUntil?: number): Promise<T | undefined> {
  const path = join(owner.root, owner.name), marker = path + '.owner';
  for (;;) {
    let db: DatabaseSync | undefined;
    try {
      const exists = existsSync(path);
      if (!exists && existsSync(marker)) throw Error('The authoritative SQLite database is missing');
      let prepared: Awaited<ReturnType<SqliteOwner['prepare']>> | undefined;
      if (!exists) {
        prepared = await owner.prepare();
        if (!write && !prepared.hasLegacy) return undefined;
        await mkdir(owner.root, {recursive: true, mode: 0o700});
      }
      db = new DatabaseSync(path, {readOnly: exists && !write});
      if (!exists) await chmod(path, 0o600);
      db.exec('PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON;');
      let version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
      if (version === 0 && existsSync(marker)) version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
      if (version === 0) {
        if (existsSync(marker)) throw Error('The authoritative SQLite schema is missing');
        if (exists && !write) {db.close(); db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON;');}
        prepared ??= await owner.prepare();
        db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
        try {
          version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
          if (version === 0) {db.exec(owner.schema); prepared.publish(db); db.exec('PRAGMA user_version=1;');}
          else if (version !== 1) throw Error('Unsupported SQLite storage schema version');
          db.exec('COMMIT'); version = 1;
        } catch (error) {db.exec('ROLLBACK'); throw error;}
      }
      if (version !== 1) throw Error('Unsupported SQLite storage schema version');
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
      if (owner.tables.some(table => !tables.has(table))) throw Error('The authoritative SQLite schema is incomplete');
      if (!existsSync(marker)) {
        try {await writeFile(marker, 'SQLite storage authority version 1\n', {flag: 'wx', mode: 0o600});}
        catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
      }
      if (write) db.exec('PRAGMA synchronous=FULL;');
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const value = action(db);
        if (value instanceof Promise) throw Error('SQLite transaction callback must be synchronous');
        db.exec('COMMIT'); return value;
      } catch (error) {db.exec('ROLLBACK'); throw error;}
    } catch (error) {
      if (!sqliteBusy(error) || retryUntil === undefined || Date.now() >= retryUntil) throw error;
    } finally {db?.close();}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
