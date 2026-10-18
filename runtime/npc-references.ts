/** Input-scoped bindings to NPCs actually supplied by the kernel; aliases grant no access. */
type Row=Record<string,any>;
export const NPC_REFERENCE_PATTERN='^npc_[1-9][0-9]*$';
export const isNpcReference=(value:unknown):value is string=>typeof value==='string'&&/^npc_[1-9][0-9]*$/.test(value);
export class NpcReferences {
 private scope='';
 private readonly issued=new Set<string>();
 observe(scope:string,value:unknown):void {
  if(this.scope!==scope){this.scope=scope;this.issued.clear();}
  if(!value||typeof value!=='object')return;
  const packet=value as Row;
  for(const person of [packet,...(Array.isArray(packet.present)?packet.present:[]),
   ...(Array.isArray(packet.npc_references?.people)?packet.npc_references.people:[])])
   if(person?.kind!=='creature'&&isNpcReference(person?.ref))this.issued.add(person.ref);
 }
 require(scope:string,references:readonly string[]):void {
  if(references.some(ref=>!isNpcReference(ref)||this.scope!==scope||!this.issued.has(ref)))
   throw Error('Unknown or unissued NPC reference; use a ref from the supplied current NPC material');
 }
}
