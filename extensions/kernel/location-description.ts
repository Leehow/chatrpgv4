/** Resolve one declared section from the active, version-locked location provider. */
type Row=Record<string,any>;
export const LOCATION_DESCRIPTION_HEADING='Place description for the author';
export async function locationDescription(capsule:Row,read:(keys:string[])=>Promise<Row>):Promise<Row|undefined> {
 const provider=capsule.mods?.location_context;
 if(!provider)return;
 const owner=capsule.mods.instructions?.find((row:Row)=>row.mod===provider.mod&&row.version===provider.version);
 const section=owner?.sections?.find((row:Row)=>row.heading===LOCATION_DESCRIPTION_HEADING);
 if(typeof section?.key!=='string')return;
 const result=await read([section.key]);
 const selected=result.sections?.find((row:Row)=>row.key===section.key&&row.mod===provider.mod&&row.version===provider.version&&row.heading===LOCATION_DESCRIPTION_HEADING);
 if(typeof selected?.text!=='string'||!selected.text.trim())throw Error('The locked location description section is unavailable');
 return {mod:provider.mod,version:provider.version,key:section.key,instruction:selected.text};
}
