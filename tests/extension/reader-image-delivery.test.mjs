import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {successfulImageDeliveries} from '../../extensions/module/reader-image-delivery.ts';

test('only a successful bound host-image receipt can serve as original-page evidence',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'reader-delivery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const cache=join(dir,'cache');await mkdir(cache);const path=join(cache,'page-8.jpg'),bytes=Buffer.from('original image');await writeFile(path,bytes);
 const sha=value=>createHash('sha256').update(value).digest('hex'),sourceSha='a'.repeat(64),log=join(dir,'images.jsonl');
 const host={page:8,path,image_sha256:sha(bytes),box:[0,0,1,1],source_sha256:sourceSha};
 await writeFile(log,JSON.stringify({delivery:'attempted',candidates:['page-call'],host_pages:[host]})+'\n');
 assert.deepEqual((await successfulImageDeliveries(log,{file_sha256:sourceSha,cache})).hostPages,[]);
 await writeFile(log,JSON.stringify({delivery:'succeeded',included:['page-call'],host_pages:[host]})+'\n');
 const accepted=await successfulImageDeliveries(log,{file_sha256:sourceSha,cache});
 assert.deepEqual([...accepted.toolCallIds],['page-call']);
 assert.deepEqual(accepted.hostPages.map(row=>row.page),[8]);
 await writeFile(path,'tampered');
 assert.deepEqual((await successfulImageDeliveries(log,{file_sha256:sourceSha,cache})).hostPages,[]);
});
