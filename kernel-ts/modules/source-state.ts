/** Authoritative source metadata/jobs; JSON filenames are one-way inspection projections. */
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync, mkdirSync, writeFileSync, renameSync, rmSync} from 'node:fs';
import {join, resolve, relative, dirname, sep} from 'node:path';
import {parsePythonJson, storedJson} from '../json.js';
import {withOptionalExclusiveLock, type AdvisoryLocks} from '../locks.js';
import {RpcError} from '../errors.js';
import {array, clone, row, type Row} from '../read/values.js';
import {inside, resolvedPath} from './paths.js';

type Snapshot = {metadata: Row | null; jobs: Row[]; revision: number};
type Frame = Snapshot & {directory: string; dirty: boolean; active: boolean; parent?: Frame};
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const databases = new Map<string, SourceState>();

export function sourceState(stateRoot: string): SourceState {
    const root = resolve(stateRoot);
    let state = databases.get(root);
    if (!state) {state = new SourceState(root); databases.set(root, state);}
    return state;
}
export function closeSourceState(stateRoot: string): void {
    const root=resolve(stateRoot);databases.get(root)?.close();databases.delete(root);
}
export function sourceStateRoot(directory: string): string | undefined {
    let at = resolve(directory);
    while (dirname(at) !== at) {if (at.endsWith(sep + '.coc')) return at; at = dirname(at);}
    return undefined;
}
/** Host-side consumers use the same source authority; ordinary non-source fixture files remain readable. */
export async function readSourceMetadata(directory: string, stateRoot = sourceStateRoot(directory), locks?: AdvisoryLocks): Promise<Row | null> {
    if (stateRoot) return (await sourceState(stateRoot).snapshot(directory, locks)).metadata;
    try {return row(parsePythonJson(new TextDecoder('utf-8', {fatal: true}).decode(await readFile(join(directory, 'module.json')))));}
    catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;}
}

export class SourceState {
    readonly root: string;
    private connection?: DatabaseSync;
    private frames = new AsyncLocalStorage<Frame>();
    private imports = new Map<string, Promise<void>>();
    constructor(root: string) {this.root = resolve(root);}
    private db(): DatabaseSync {
        if (this.connection) return this.connection;
        mkdirSync(this.root, {recursive: true});
        if (!existsSync(join(this.root,'source-reading.sqlite')) && existsSync(join(this.root,'.source-reading-owner')))
            throw Error('The authoritative source database is missing; legacy JSON cannot restore it');
        const db = new DatabaseSync(join(this.root, 'source-reading.sqlite'));
        try {
            db.exec('PRAGMA busy_timeout=25000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
            const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
            if (version !== 0 && version !== 1) throw Error('Unsupported source database schema version');
            if (version===0 && existsSync(join(this.root,'.source-reading-owner')))
                throw Error('The authoritative source database schema is missing');
            if (version === 1) {
                const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(value=>String(value.name));
                if (!['source_modules','source_jobs','source_revisions','source_imports','source_exports'].every(name=>tables.includes(name)))
                    throw Error('The authoritative source database schema is incomplete');
            }
            if (version===0) db.exec(`BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS source_modules(scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS source_jobs(scope TEXT NOT NULL REFERENCES source_modules(scope), job_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL, state TEXT, purpose TEXT, focus TEXT, request_key TEXT, owner TEXT, lease TEXT,
                    payload TEXT NOT NULL, PRIMARY KEY(scope,job_id), UNIQUE(scope,ordinal));
                CREATE INDEX IF NOT EXISTS source_jobs_state ON source_jobs(scope,state,ordinal);
                CREATE INDEX IF NOT EXISTS source_jobs_key ON source_jobs(scope,request_key);
                CREATE TABLE IF NOT EXISTS source_revisions(scope TEXT NOT NULL, revision INTEGER NOT NULL,
                    metadata TEXT NOT NULL, jobs TEXT NOT NULL, PRIMARY KEY(scope,revision));
                CREATE TABLE IF NOT EXISTS source_imports(scope TEXT PRIMARY KEY, metadata_sha TEXT NOT NULL, queue_sha TEXT NOT NULL,
                    archive TEXT NOT NULL, metadata_bytes BLOB NOT NULL, queue_bytes BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS source_exports(scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, error TEXT);
                PRAGMA user_version=1; COMMIT;`);
            if (!existsSync(join(this.root,'.source-reading-owner'))) {
                try {writeFileSync(join(this.root,'.source-reading-owner'),'SQLite source authority version 1\n',{flag:'wx'});}
                catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
            }
            this.connection = db;
            return db;
        } catch (error) {try {db.exec('ROLLBACK');} catch {} db.close(); throw error;}
    }
    private scope(directory: string): string {
        const path = resolve(directory), key = relative(this.root, path);
        if (!key || key === '..' || key.startsWith('..' + sep) || resolve(this.root, key) !== path)
            throw new RpcError('invalid_params', 'Source directory escapes its database owner');
        return key;
    }
    private frame(directory: string): Frame | undefined {
        for (let value = this.frames.getStore(); value; value = value.parent) if (value.active && value.directory === resolve(directory)) return value;
        return undefined;
    }
    async ensure(directory: string, locks?: AdvisoryLocks): Promise<void> {
        const canonicalRoot=await resolvedPath(this.root),canonicalDirectory=await resolvedPath(directory);
        if (!inside(canonicalRoot,canonicalDirectory) || canonicalDirectory!==resolve(canonicalRoot,this.scope(directory)))
            throw new RpcError('invalid_params','Source directory escapes its database owner');
        directory = resolve(directory); const scope = this.scope(directory), db = this.db();
        if (db.prepare('SELECT 1 FROM source_modules WHERE scope=?').get(scope)) return;
        if (db.prepare('SELECT 1 FROM source_revisions WHERE scope=? LIMIT 1').get(scope)
            || db.prepare('SELECT 1 FROM source_imports WHERE scope=?').get(scope))
            throw Error('Registered SQLite source state is missing; legacy JSON cannot restore it');
        if (!existsSync(join(directory, 'module.json'))) return;
        let pending = this.imports.get(scope);
        if (!pending) {
            const migrate = async () => {
                if (db.prepare('SELECT 1 FROM source_modules WHERE scope=?').get(scope)) return;
                const metadata = await readFile(join(directory, 'module.json'));
                let queue: Buffer;
                try {queue = await readFile(join(directory, 'deepen-queue.json'));}
                catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; queue = Buffer.from('[]\n');}
                const meta = row(parsePythonJson(new TextDecoder('utf-8', {fatal:true}).decode(metadata)));
                const jobs = array(parsePythonJson(new TextDecoder('utf-8', {fatal:true}).decode(queue)));
                if (!meta.id || !Array.isArray(parsePythonJson(queue.toString()))) throw Error('Invalid legacy source state');
                const archive = join(directory, 'source-state-imports', digest(Buffer.concat([metadata, queue])));
                await mkdir(archive, {recursive:true});
                for (const [name, bytes] of [['module.json', metadata], ['deepen-queue.json', queue]] as const) {
                    try {await writeFile(join(archive, name), bytes, {flag:'wx'});}
                    catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                        if (digest(await readFile(join(archive, name))) !== digest(bytes)) throw Error('Source migration archive changed');}
                }
                db.exec('BEGIN IMMEDIATE');
                try {
                    if (!db.prepare('SELECT 1 FROM source_modules WHERE scope=?').get(scope)) {
                        this.persist(scope, {metadata:meta,jobs,revision:0}, 1);
                        db.prepare('INSERT INTO source_imports VALUES(?,?,?,?,?,?)').run(scope,digest(metadata),digest(queue),relative(this.root,archive),metadata,queue);
                    }
                    db.exec('COMMIT');
                } catch (error) {db.exec('ROLLBACK'); throw error;}
            };
            pending = (locks ? withOptionalExclusiveLock(locks, join(directory, '.metadata.lock'), migrate) : migrate())
                .finally(() => this.imports.delete(scope));
            this.imports.set(scope, pending);
        }
        await pending;
    }
    private current(directory: string): Snapshot {
        const scope = this.scope(directory), db = this.db();
        const saved = db.prepare('SELECT revision,payload FROM source_modules WHERE scope=?').get(scope);
        if (!saved) return {metadata:null,jobs:[],revision:0};
        const jobs = db.prepare('SELECT payload FROM source_jobs WHERE scope=? ORDER BY ordinal').all(scope)
            .map(item => row(parsePythonJson(String(item.payload))));
        return {metadata:row(parsePythonJson(String(saved.payload))),jobs,revision:Number(saved.revision)};
    }
    async registered(directory: string, locks?: AdvisoryLocks): Promise<boolean> {
        const frame=this.frame(directory);
        if(frame)return frame.metadata!==null;
        await this.ensure(directory,locks);
        return Boolean(this.db().prepare('SELECT 1 FROM source_modules WHERE scope=?').get(this.scope(directory)));
    }
    async snapshot(directory: string, locks?: AdvisoryLocks): Promise<Snapshot> {
        const frame = this.frame(directory);
        if (frame) return {metadata:frame.metadata ? clone(frame.metadata) : null,jobs:clone(frame.jobs),revision:frame.revision};
        await this.ensure(directory, locks);
        // Both statements see one snapshot, including while another process commits a publication.
        const db = this.db(); db.exec('BEGIN');
        try {const value = this.current(directory); db.exec('COMMIT'); return value;}
        catch (error) {db.exec('ROLLBACK'); throw error;}
    }
    private persist(scope: string, value: Snapshot, revision: number): void {
        if (!value.metadata) throw Error('Source state needs registered metadata');
        const db = this.db(), metadata = storedJson(value.metadata), jobs = storedJson(value.jobs);
        db.prepare('INSERT INTO source_modules VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,payload=excluded.payload')
            .run(scope,revision,metadata);
        // Historical payloads retain replaced/removed jobs, including deliberate source-window resets.
        db.prepare('INSERT INTO source_revisions VALUES(?,?,?,?)').run(scope,revision,metadata,jobs);
        db.prepare('DELETE FROM source_jobs WHERE scope=?').run(scope);
        const insert = db.prepare('INSERT INTO source_jobs VALUES(?,?,?,?,?,?,?,?,?,?)');
        value.jobs.forEach((job, ordinal) => {
            if (typeof job.job_id !== 'string' || !job.job_id) throw Error('Source queue job needs its persisted id');
            insert.run(scope,job.job_id,ordinal,String(job.state??''),String(job.purpose??''),String(job.focus??''),String(job.key??''),
                typeof job.owner==='string'?job.owner:null,typeof job.lease==='string'?job.lease:null,storedJson(job));
        });
        db.prepare('INSERT INTO source_exports VALUES(?,?,NULL) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,error=NULL').run(scope,revision);
    }
    private commit(frame: Frame): void {
        if (!frame.dirty) return;
        const scope = this.scope(frame.directory), db = this.db(); db.exec('BEGIN IMMEDIATE');
        try {
            const current = Number(db.prepare('SELECT revision FROM source_modules WHERE scope=?').get(scope)?.revision ?? 0);
            if (current !== frame.revision) throw new RpcError('needs','Source state changed before commit',{details:{reason:'source_state_conflict'}});
            this.persist(scope,frame,frame.revision+1); db.exec('COMMIT'); frame.revision++; frame.dirty=false;
        } catch (error) {db.exec('ROLLBACK'); throw error;}
    }
    private async project(frame: Frame): Promise<void> {
        // Never recover authoritative state from an export, and never fail a committed publication because its export failed.
        const db=this.db(),scope=this.scope(frame.directory);
        try {
            db.exec('BEGIN IMMEDIATE');
            // Export the latest committed snapshot under a short synchronous lock. A delayed
            // exporter can never overwrite a newer revision, and no await holds a SQL write lock.
            const current=this.current(frame.directory);
            mkdirSync(frame.directory,{recursive:true});
            for(const [name,value] of [['module.json',current.metadata],['deepen-queue.json',current.jobs]] as const){
                const target=join(frame.directory,name),temporary=target+'.sqlite-export-'+process.pid;
                try {writeFileSync(temporary,storedJson(value));renameSync(temporary,target);}
                finally {rmSync(temporary,{force:true});}
            }
            db.prepare('UPDATE source_exports SET error=NULL WHERE scope=?').run(scope);
            db.exec('COMMIT');
        } catch (error) {
            try {db.exec('ROLLBACK');}catch{}
            try {db.prepare('UPDATE source_exports SET error=? WHERE scope=?').run(String(error),scope);}catch{}
        }
    }
    async transaction<T>(directory: string, action: () => Promise<T>, locks?: AdvisoryLocks): Promise<T> {
        if (this.frame(directory)) return action();
        const snapshot = await this.snapshot(directory, locks);
        const frame: Frame = {...snapshot,directory:resolve(directory),dirty:false,active:true,parent:this.frames.getStore()};
        return this.frames.run(frame,async()=>{try {const value=await action(); if(frame.dirty){this.commit(frame);await this.project(frame);}return value;}
            finally {frame.active=false;}});
    }
    async flush(directory: string): Promise<void> {
        const frame = this.frame(directory);
        if (frame?.dirty) {this.commit(frame); await this.project(frame);}
    }
    async update(directory: string, values: {metadata?:Row;jobs?:Row[]}, locks?: AdvisoryLocks): Promise<void> {
        const frame = this.frame(directory);
        if (!frame) return this.transaction(directory,()=>this.update(directory,values),locks);
        if (values.metadata && storedJson(values.metadata)!==storedJson(frame.metadata)) {frame.metadata=clone(values.metadata);frame.dirty=true;}
        if (values.jobs && storedJson(values.jobs)!==storedJson(frame.jobs)) {frame.jobs=clone(values.jobs);frame.dirty=true;}
    }
    close(): void {this.connection?.close();this.connection=undefined;}
}
