/** Shared transport-only helpers for migrated rule integration fixtures. */
import {createCampaign,kernel,type RpcClient} from './support.ts';
export * from './support.ts';
export {walkToConfrontation} from './mod-fixtures.ts';
export const seeded=(t:any,seed='7')=>kernel(t,{env:{COC_KERNEL_SEED:seed}});
export async function opening(k:RpcClient,text='我仔细观察诺特。'){
  await createCampaign(k);await k.table('open');await k.table('narrate',{call_id:'t0-c1',text:'开场。\n\n诺特把钥匙拍在桌上。'});return k.table('player_input',{text});
}
export const resolve=(k:RpcClient,call_id:string,action:any)=>k.table('resolve',{call_id,action});
export const resolveErr=(k:RpcClient,call_id:string,action:any)=>k.tableErr('resolve',{call_id,action});
export const receipts=async(k:RpcClient)=>(await k.table('status')).receipts;
