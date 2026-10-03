/** Immutable advisory expression references; no NPC state or generated speech ownership. */
import {RpcError} from '../errors.js';
import {jsonDigest,parsePythonJson} from '../json.js';
import {array,row,string,number,integer,type Row} from './values.js';
export const EXPRESSION_REFERENCE_CAPABILITY='npc.expression.references.v1';
export const EXPRESSION_CATALOG_BYTES=24000;
export function expressionCatalogRevision(active:readonly Row[],language:string|null):string {
 return jsonDigest({language,packages:active.filter(mod=>!!row(mod.contributes).expression_cards).map(mod=>({id:mod.id,version:mod.version,digest:mod.digest}))});
}
export function expressionCards(manifest:Row,files:ReadonlyMap<string,Uint8Array>):Row[] {
 const path=row(manifest.contributes).expression_cards;if(path==null)return[];
 const fail=(reason:string):never=>{throw new RpcError('invalid_params',`${manifest.id} ${manifest.version}: invalid expression card catalog`,{fix:'declare the reference capability and a bounded version-1 JSON catalog of unique cards',details:{field:'contributes.expression_cards',reason}});};
 if(typeof path!=='string'||!path.endsWith('.json')||!files.has(path)||!array(manifest.package_files).includes(path))fail('expression_catalog_path');
 if(!array(manifest.requires).includes(EXPRESSION_REFERENCE_CAPABILITY))fail('expression_catalog_capability');
 const bytes=files.get(path)!;if(bytes.length>EXPRESSION_CATALOG_BYTES)fail('expression_catalog_budget');
 let data:Row;try{data=row(parsePythonJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{fail('expression_catalog_json');}
 if(!integer(data!.version)||number(data!.version)!==1||!Array.isArray(data!.cards)||data!.cards.length<1||data!.cards.length>24)fail('expression_catalog_shape');
 const names=new Set<string>();
 for(const value of data!.cards){const c=row(value);if(Object.keys(c).some(k=>!['name','kind','applies','activation_question','pattern','examples'].includes(k)))fail('expression_card_shape');
  for(const [field,max] of [['name',80],['applies',360],['activation_question',160],['pattern',500]]as const)
   if(typeof c[field]!=='string'||!c[field].trim()||[...c[field]].length>max)fail('expression_card_text');
  if(names.has(c.name)||!['habit','interaction'].includes(c.kind))fail('expression_card_identity');names.add(c.name);
  if(!Array.isArray(c.examples)||c.examples.length<1||c.examples.length>2)fail('expression_examples');
  for(const example of c.examples){const e=row(example);if(Object.keys(e).length!==2||!['context','reply'].every(k=>typeof e[k]==='string'&&e[k].trim()&&[...e[k]].length<=300))fail('expression_example_shape');}
 }
 return data!.cards;
}
export function expressionCatalog(active:readonly Row[],language:string):Row {
 const packages=active.flatMap(mod=>{if(!row(mod.contributes).expression_cards)return[];
  const cards=expressionCards(mod,mod.files);return[{id:mod.id,version:mod.version,digest:mod.digest,cards}];});
 const revision=expressionCatalogRevision(active,language);
 return{enabled:packages.length>0,revision,play_language:language,packages,budget:{allowance_ms:1200,selected_bytes:2200,people:8,habit:1,interaction:1}};
}
