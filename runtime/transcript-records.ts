/** Read-only access to host-published transcript data; this module never opens a PDF. */
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export const TRANSCRIPT_SQLITE_NAME = 'transcripts.sqlite';
export const TRANSCRIPT_SQLITE_TABLES = ['transcript_records', 'transcript_claims', 'transcript_imports'] as const;
/** Undefined means not migrated; an imported store never falls back to legacy files. */
export function homePageRecords(root: string, fileSha: string, page: number): unknown[] | undefined {
  const path = join(root, TRANSCRIPT_SQLITE_NAME);
  if (!existsSync(path)) {
    if (existsSync(path + '.owner')) throw Error('The authoritative SQLite database is missing');
    return undefined;
  }
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    db.exec('PRAGMA busy_timeout=0;');
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 1) throw Error('Unsupported transcript database schema version');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
    if (TRANSCRIPT_SQLITE_TABLES.some(table => !tables.has(table))) throw Error('The transcript database schema is incomplete');
    const rows = db.prepare('SELECT payload,digest FROM transcript_records WHERE file_sha=? AND page=? ORDER BY rowid DESC').all(fileSha, page);
    const records: unknown[] = [];
    for (const row of rows) {
      const payload = String(row.payload);
      if (createHash('sha256').update(payload).digest('hex') !== row.digest) continue;
      try {records.push(JSON.parse(payload));} catch {}
    }
    return records;
  } finally {db.close();}
}
