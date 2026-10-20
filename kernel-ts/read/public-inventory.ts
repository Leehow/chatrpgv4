/** Positive committed custody; neither source promises nor absence inference. */
import {array,row,type Row} from './values.js';
export function publicInventory(party:Row[],world:Row):Row {
 const instances=row(row(world.objects).instances);
 return {authority:'Current committed investigator inventory. These positive holdings override older scene prose or unfulfilled source handover instructions. Omission never proves absence. This projection does not grant NPC knowledge.',
  holders:party.slice(0,16).map(sheet=>{
   const canonical=Object.values(instances).map(row).filter(item=>item.owner?.kind==='investigator'&&item.owner.id===sheet.id&&typeof item.name==='string'&&item.quantity>0);
   const legacy=array(sheet.equipment).flatMap(item=>{
    if(typeof item==='string')return [{name:item,quantity:1}];
    if(!item||typeof item!=='object'||item.object_id||typeof item.name!=='string')return [];
    return [{name:item.name,quantity:item.quantity??1}];
   });
   const items=[...canonical,...legacy].filter(item=>item.quantity>0).map(item=>({name:item.name,quantity:item.quantity}));
   return {name:sheet.name??sheet.id,items:items.slice(0,32),omitted:Math.max(0,items.length-32)};
  })};
}
