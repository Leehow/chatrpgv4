/** Public words already attributed by the delivery owner, never extracted from prose. */
export interface PublicDialogueLine {speaker:string;text:string}
export function publicDialogue(value:unknown):PublicDialogueLine[]{
 if(!Array.isArray(value))return [];
 return value.flatMap(line=>{
  if(!line||typeof line!=='object'||Array.isArray(line))return [];
  const who=line.who&&typeof line.who==='object'?line.who:{};
  const speaker=typeof line.speaker==='string'?line.speaker:Object.hasOwn(who,'shown')?who.shown:who.name??who.label;
  return typeof speaker==='string'&&speaker.trim()&&speaker.length<=120&&typeof line.text==='string'&&line.text.trim()
   ?[{speaker,text:Array.from(line.text).slice(0,200).join('')}]:[];
 }).slice(-6);
}
