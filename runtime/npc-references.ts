/** Input-scoped bindings to NPCs actually supplied by the kernel; aliases grant no access. */
type Row=Record<string,any>;
export const NPC_REFERENCE_PATTERN='^npc_[1-9][0-9]*$';
export const isNpcReference=(value:unknown):value is string=>typeof value==='string'&&/^npc_[1-9][0-9]*$/.test(value);
export class NpcReferences {
 private scope='';
 private readonly issued=new Set<string>();
 private readonly publicNames=new Map<string,Set<string>>();
 observe(scope:string,value:unknown):void {
  if(this.scope!==scope){this.scope=scope;this.issued.clear();this.publicNames.clear();}
  if(!value||typeof value!=='object')return;
  const packet=value as Row;
  for(const person of [packet,...(Array.isArray(packet.present)?packet.present:[]),
   ...(Array.isArray(packet.npc_references?.people)?packet.npc_references.people:[])])
   if(person?.kind!=='creature'&&isNpcReference(person?.ref)){
    this.issued.add(person.ref);
    if(typeof person.display_name==='string'&&person.display_name.trim()){
     const name=person.display_name.normalize('NFKC').trim().toLowerCase(),refs=this.publicNames.get(name)??new Set<string>();
     refs.add(person.ref);this.publicNames.set(name,refs);
    }
   }
 }
 /** Normalize only a unique, already-issued public identity. Canonical parsers stay strict. */
 bindActors(scope:string,input:unknown):{args:unknown;repairs:number}{
  if(this.scope!==scope||!input||typeof input!=='object'||Array.isArray(input))return{args:input,repairs:0};
  let repairs=0;
  const bind=(value:unknown)=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return value;
   const row=value as Row;
   if(typeof row.actor!=='string'||isNpcReference(row.actor))return row;
   const refs=this.publicNames.get(row.actor.normalize('NFKC').trim().toLowerCase());
   if(refs?.size!==1)return row;
   const ref=[...refs][0];if(!this.issued.has(ref))return row;
   repairs++;return {...row,actor:ref};
  };
  const value=input as Row;
  return{args:{...value,...(Array.isArray(value.responses)?{responses:value.responses.map(bind)}:{}),
   ...(Array.isArray(value.commands)?{commands:value.commands.map(command=>command?.kind==='npc'?bind(command):command)}:{})},repairs};
 }
 require(scope:string,references:readonly string[]):void {
  if(references.some(ref=>!isNpcReference(ref)||this.scope!==scope||!this.issued.has(ref)))
   throw Error('Unknown or unissued NPC reference; use a ref from the supplied current NPC material');
 }
}
