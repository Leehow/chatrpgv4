/** Original-page identities that survived a completed provider request. */
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,sep} from 'node:path';

export type HostDeliveredPage={page:number;path:string;image_sha256:string;source_sha256:string;box:number[]};
const inside=(root:string,path:string)=>{const part=relative(root,path);return part===''||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)};

export async function successfulImageDeliveries(log:string,source:{file_sha256:string;cache:string}):Promise<{
 toolCallIds:Set<string>;hostPages:HostDeliveredPage[]}>{
 const rows=(await readFile(log,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const toolCallIds=new Set<string>(),hostPages:HostDeliveredPage[]=[],seen=new Set<string>();
 let cache:string|undefined;
 for(const row of rows){
   if(row.delivery!==undefined&&row.delivery!=='succeeded')continue;
   for(const id of Array.isArray(row.included)?row.included:[])if(typeof id==='string')toolCallIds.add(id);
   if(row.delivery!=='succeeded')continue;
   for(const page of Array.isArray(row.host_pages)?row.host_pages:[]){
     if(page?.source_sha256!==source.file_sha256||!Number.isSafeInteger(page.page)||page.page<1||typeof page.path!=='string'||
       !/^[a-f0-9]{64}$/.test(page.image_sha256)||JSON.stringify(page.box)!=='[0,0,1,1]')continue;
     try{
       cache??=await realpath(source.cache);
       const image=await realpath(page.path);if(!inside(cache,image))continue;
       if(createHash('sha256').update(await readFile(image)).digest('hex')!==page.image_sha256)continue;
       const key=page.page+':'+page.image_sha256;
       if(!seen.has(key)){seen.add(key);hostPages.push({page:page.page,path:image,image_sha256:page.image_sha256,
         source_sha256:page.source_sha256,box:page.box});}
     }catch{}
   }
 }
 return {toolCallIds,hostPages};
}
