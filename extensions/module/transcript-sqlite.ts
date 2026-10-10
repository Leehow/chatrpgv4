/** Home transcript records and token-owned claims; original legacy bytes remain untouched. */
import {createHash, randomUUID} from 'node:crypto';
import {readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {sqliteBusy, sqliteOperation, type SqliteOwner} from '../../runtime/sqlite-store.ts';
import {TRANSCRIPT_SQLITE_NAME, TRANSCRIPT_SQLITE_TABLES} from '../../runtime/transcript-records.ts';
import {TRANSCRIPT_VERSION} from './page-transcript.ts';
import type {TranscriptRecord, TranscriptClaim} from './transcript-store.ts';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function transcriptSqlite(root: string, extractionVersion: string,
  valid: (value: unknown, sha: string, page: number, version: string) => value is TranscriptRecord) {
  const owner: SqliteOwner = {
    root, name: TRANSCRIPT_SQLITE_NAME, tables: TRANSCRIPT_SQLITE_TABLES,
    schema: `CREATE TABLE transcript_records(file_sha TEXT NOT NULL,page INTEGER NOT NULL,extraction_version TEXT NOT NULL,
      transcript_version TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,
      PRIMARY KEY(file_sha,page,extraction_version,transcript_version));
      CREATE TABLE transcript_claims(file_sha TEXT NOT NULL,page INTEGER NOT NULL,extraction_version TEXT NOT NULL,
      transcript_version TEXT NOT NULL,token TEXT NOT NULL,pid INTEGER NOT NULL,claimed_at REAL NOT NULL,
      PRIMARY KEY(file_sha,page,extraction_version,transcript_version));
      CREATE TABLE transcript_imports(name TEXT PRIMARY KEY,digest TEXT NOT NULL,bytes BLOB NOT NULL);`,
    async prepare() {
      const originals: {name: string; bytes: Buffer; sha: string; page: number; claim: boolean; mtime: number}[] = [];
      const entries = await readdir(root, {withFileTypes: true}).catch(error => {if (error.code === 'ENOENT') return []; throw error;});
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
        for (const name of await readdir(join(root, entry.name))) {
          const match = /^page-(\d{4,})\.(json|claim)$/.exec(name), page = match ? Number(match[1]) : 0;
          if (!match || !Number.isSafeInteger(page) || page < 1) continue;
          const path = join(root, entry.name, name);
          originals.push({name: join(entry.name, name), bytes: await readFile(path), sha: entry.name, page,
            claim: match[2] === 'claim', mtime: (await stat(path)).mtimeMs});
        }
      }
      return {hasLegacy: originals.length > 0, publish(db) {
        for (const item of originals) {
          db.prepare('INSERT INTO transcript_imports VALUES(?,?,?)').run(item.name, digest(item.bytes), item.bytes);
          let value: any; try {value = JSON.parse(item.bytes.toString('utf8'));} catch {}
          if (item.claim) {
            const at = typeof value?.at === 'string' ? Date.parse(value.at) : NaN;
            db.prepare('INSERT INTO transcript_claims VALUES(?,?,?,?,?,?,?)').run(item.sha, item.page, '',
              TRANSCRIPT_VERSION, 'legacy:' + digest(item.bytes), Number.isSafeInteger(value?.pid) ? value.pid : 0,
              Number.isFinite(at) ? at : item.mtime);
          } else if (typeof value?.native?.extraction_version === 'string' && valid(value, item.sha, item.page, value.native.extraction_version)) {
            const payload = item.bytes.toString('utf8');
            db.prepare('INSERT INTO transcript_records VALUES(?,?,?,?,?,?)').run(item.sha, item.page, value.native.extraction_version,
              value.transcript_version, payload, digest(payload));
          }
        }
      }};
    },
  };
  return {
    async listing(sha: string): Promise<Array<[number,string,string,string]>> {
      return await sqliteOperation(owner,false,db=>db.prepare(`SELECT page,extraction_version,transcript_version,digest
        FROM transcript_records WHERE file_sha=? ORDER BY page,extraction_version,transcript_version`).all(sha)
        .map(row=>[Number(row.page),String(row.extraction_version),String(row.transcript_version),String(row.digest)] as [number,string,string,string])) ?? [];
    },
    async read(sha: string, pages: readonly number[]): Promise<Map<number, TranscriptRecord>> {
      return await sqliteOperation(owner, false, db => {
        const out = new Map<number, TranscriptRecord>();
        const rows = db.prepare(`SELECT page,payload,digest FROM transcript_records WHERE file_sha=? AND extraction_version=?
          AND transcript_version=? AND page IN (SELECT value FROM json_each(?))`).all(sha, extractionVersion, TRANSCRIPT_VERSION, JSON.stringify(pages));
        for (const row of rows) {
          const payload = String(row.payload); if (digest(payload) !== row.digest) continue;
          let value: unknown; try {value = JSON.parse(payload);} catch {continue;}
          if (valid(value, sha, Number(row.page), extractionVersion)) out.set(Number(row.page), value);
        }
        return out;
      }) ?? new Map();
    },
    async pages(sha: string): Promise<number[]> {
      return await sqliteOperation(owner, false, db => db.prepare('SELECT DISTINCT page FROM transcript_records WHERE file_sha=? ORDER BY page')
        .all(sha).map(row => Number(row.page))) ?? [];
    },
    async put(record: TranscriptRecord, retryUntil?: number): Promise<'stored' | 'exists'> {
      return (await sqliteOperation(owner, true, db => {
        const payload = JSON.stringify(record);
        return db.prepare('INSERT INTO transcript_records VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING')
          .run(record.file_sha256, record.page, record.native.extraction_version, record.transcript_version, payload, digest(payload)).changes ? 'stored' : 'exists';
      }, retryUntil))!;
    },
    async claimed(sha: string, page: number, staleMs: number, now: number): Promise<boolean> {
      try {
        return await sqliteOperation(owner, false, db => {
          const row = db.prepare("SELECT MAX(claimed_at) AS claimed_at FROM transcript_claims WHERE file_sha=? AND page=? AND extraction_version IN ('',?) AND transcript_version=?")
            .get(sha, page, extractionVersion, TRANSCRIPT_VERSION);
          return row?.claimed_at !== null && row?.claimed_at !== undefined && now - Number(row.claimed_at) <= staleMs;
        }) ?? false;
      } catch (error) {if (sqliteBusy(error)) return true; throw error;}
    },
    async claim(sha: string, page: number, staleMs: number, now: number): Promise<TranscriptClaim | null> {
      const token = randomUUID();
      try {
        const won = await sqliteOperation(owner, true, db => {
          const legacy=db.prepare("SELECT claimed_at FROM transcript_claims WHERE file_sha=? AND page=? AND extraction_version='' AND transcript_version=?")
            .get(sha,page,TRANSCRIPT_VERSION);
          if(legacy && now-Number(legacy.claimed_at)<=staleMs)return 0;
          return db.prepare(`INSERT INTO transcript_claims VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(file_sha,page,extraction_version,transcript_version) DO UPDATE SET
          token=excluded.token,pid=excluded.pid,claimed_at=excluded.claimed_at WHERE transcript_claims.claimed_at<?`)
          .run(sha, page, extractionVersion, TRANSCRIPT_VERSION, token, process.pid, now, now - staleMs).changes;
        });
        if (!won) return null;
      } catch (error) {if (sqliteBusy(error)) return null; throw error;}
      return {release: async () => {
        try {await sqliteOperation(owner, true, db => db.prepare(`DELETE FROM transcript_claims WHERE file_sha=? AND page=?
          AND extraction_version=? AND transcript_version=? AND token=?`).run(sha, page, extractionVersion, TRANSCRIPT_VERSION, token));}
        catch (error) {if (!sqliteBusy(error)) throw error;}
      }};
    },
  };
}
