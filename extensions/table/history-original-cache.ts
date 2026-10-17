/** Session-owned immutable originals only; current transcript listings always go to the kernel. */
type Row=Record<string,any>;
export function createSnapshotReadCache(){
 const values=new Map<string,{value:Row;bytes:number}>(),pending=new Map<string,Promise<Row>>();
 let bytes=0,generation=0;
 const clear=()=>{generation++;values.clear();pending.clear();bytes=0;};
 return{clear,async read(scope:string,params:Row,load:()=>Promise<Row>):Promise<{value:Row;reused:boolean}>{
  if(typeof params._snapshot!=='string'||!params._snapshot||!params.read)return{value:await load(),reused:false};
  const key=JSON.stringify([scope,params]),old=values.get(key);
  if(old)return{value:structuredClone(old.value),reused:true};
  const flight=pending.get(key);if(flight){
   const value=await flight;
   if(value.verified===true&&value._snapshot===params._snapshot)return{value:structuredClone(value),reused:true};
   return{value:await load(),reused:false};
  }
  const ticket=generation,work=load();pending.set(key,work);
  try{
   const value=await work;
   if(ticket===generation&&value.verified===true&&value._snapshot===params._snapshot){
    const size=Buffer.byteLength(JSON.stringify(value),'utf8');
    if(size<=256*1024){
     while(values.size>=32||bytes+size>256*1024){const first=values.keys().next().value;if(first===undefined)break;bytes-=values.get(first)!.bytes;values.delete(first);}
     values.set(key,{value:structuredClone(value),bytes:size});bytes+=size;
    }
   }
   return{value,reused:false};
  }finally{if(pending.get(key)===work)pending.delete(key);}
 }};
}
