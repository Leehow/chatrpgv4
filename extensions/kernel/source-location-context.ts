/** Registered identity remains distinct from asynchronous source enrichment. */
import {KernelError} from './client.ts';
type Row=Record<string,any>;
export async function sourceLocationContext(call:(method:string,args:Row)=>Promise<Row>,query:string,
 unavailable:(error:unknown)=>void):Promise<Row> {
 try{
  const {place}=await call('mods.locations.inspect',{name:query,need:'context'});
  if(typeof place?.name!=='string'||!place.name)return {};
  return {registered_location:{name:place.name,display_name:typeof place.display_name==='string'?place.display_name:place.name,
   authority:'identity-reference-only',
   guidance:'This registered identity is independent of the book consultation. Reuse its name for an already selected ordinary approach or view; movement, access and observation still require their normal validation and receipts. Compatible ordinary visible detail can be completed within known facts. A pending source-specific answer still awaits verified reading: do not claim it, reveal unseen interiors or poll/reword its cosmetic question to permit arrival. Registration grants no preparation, access or permission.'}};
 }catch(error){
  if(!(error instanceof KernelError&&error.code==='unknown_entity'))unavailable(error);
  return {};
 }
}
