/** Read-only host view of kernel-owned source state. No database or metadata writes. */
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, join, relative, resolve, sep} from 'node:path';
export async function sourceMetadata(directory: string): Promise<Record<string, any>> {
    directory = resolve(directory);
    let root = directory;
    while (dirname(root)!==root && !root.endsWith(sep+'.coc')) root=dirname(root);
    const database = join(root,'source-reading.sqlite');
    if (existsSync(database)) {
        const db = new DatabaseSync(database,{readOnly:true});
        try {
            db.exec('PRAGMA busy_timeout=25000;');
            const version=Number(db.prepare('PRAGMA user_version').get()!.user_version);
            if(version!==1)throw Error('Unsupported source database schema version');
            const key=relative(root,directory),value=db.prepare('SELECT payload FROM source_modules WHERE scope=?').get(key);
            if(value)return JSON.parse(String(value.payload));
            if(db.prepare('SELECT 1 FROM source_revisions WHERE scope=? LIMIT 1').get(key)
                || db.prepare('SELECT 1 FROM source_imports WHERE scope=?').get(key))
                throw Error('Registered SQLite source metadata is missing');
        } finally {db.close();}
    } else if(existsSync(join(root,'.source-reading-owner')))
        throw Error('The authoritative source database is missing');
    // Only an as-yet-unimported source uses its original JSON. Once imported, SQL errors never fall back here.
    return JSON.parse(await readFile(join(directory,'module.json'),'utf8'));
}
