/** Private writing-cache persistence. These helpers never lock or mutate canonical world state. */
import {open,rename,unlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';

export async function acquireWritingCache(path:string):Promise<{release:()=>Promise<void>}|null> {
  const backend=createRequire(import.meta.url)('fs-ext') as {flockSync:(fd:number,operation:string)=>void};
  const handle=await open(path,'a+',0o600);
  try{backend.flockSync(handle.fd,'exnb');}
  catch(error){await handle.close();if(['EAGAIN','EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code??''))return null;throw error;}
  let released=false;
  return{async release(){if(released)return;released=true;try{backend.flockSync(handle.fd,'un');}finally{await handle.close();}}};
}

export async function writeWritingCache(path:string,text:string):Promise<void> {
  const temporary=path+'.'+randomUUID()+'.tmp';
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(text,'utf8');await handle.sync();await handle.close();await rename(temporary,path);}
  finally{await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
