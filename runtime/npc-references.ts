/** Input-scoped bindings to NPCs actually supplied by the kernel; aliases grant no access. */
type Row=Record<string,any>;
export const NPC_REFERENCE_PATTERN='^npc_[1-9][0-9]*$';
export const isNpcReference=(value:unknown):value is string=>typeof value==='string'&&/^npc_[1-9][0-9]*$/.test(value);
export class NpcReferences {
 private scope='';
 private readonly issued=new Set<string>();
 private readonly publicNames=new Map<string,Set<string>>();
 private readonly displays=new Map<string,string>();
 /** Other names the kernel shows for an issued person (the book's), read by lookup only, never shown. */
 private readonly names=new Map<string,Set<string>>();
 observe(scope:string,value:unknown):void {
  if(this.scope!==scope){this.scope=scope;this.issued.clear();this.publicNames.clear();this.displays.clear();this.names.clear();}
  if(!value||typeof value!=='object')return;
  const packet=value as Row;
  for(const person of [packet,...(Array.isArray(packet.present)?packet.present:[]),
   ...(Array.isArray(packet.npc_references?.people)?packet.npc_references.people:[])])
   if(person?.kind!=='creature'&&isNpcReference(person?.ref)){
    this.issued.add(person.ref);
    if(typeof person.display_name==='string'&&person.display_name.trim()){
     this.displays.set(person.ref,person.display_name.trim());
     const name=person.display_name.normalize('NFKC').trim().toLowerCase(),refs=this.publicNames.get(name)??new Set<string>();
     refs.add(person.ref);this.publicNames.set(name,refs);
    }
    // §270.20: the book's own name for them binds too, after the table has given them another word (live 1025i: once a
    // learned alias replaced the display name, the book's full name was "nobody at this table").
    if(typeof person.name==='string'&&person.name.trim()&&person.name.trim()!==person.display_name){
     const name=person.name.normalize('NFKC').trim().toLowerCase(),refs=this.names.get(name)??new Set<string>();
     refs.add(person.ref);this.names.set(name,refs);
    }
   }
 }
 /** The one public appellation an issued reference carries, when no other issued person shares it. */
 publicName(scope:string,ref:unknown):string|undefined{
  if(this.scope!==scope||!isNpcReference(ref)||!this.issued.has(ref))return undefined;
  const name=this.displays.get(ref);
  return name&&this.publicNames.get(name.normalize('NFKC').trim().toLowerCase())?.size===1?name:undefined;
 }
 /** Normalize only a unique, already-issued public identity. Canonical parsers stay strict. */
 bindActors(scope:string,input:unknown):{args:unknown;repairs:number}{
  if(this.scope!==scope||!input||typeof input!=='object'||Array.isArray(input))return{args:input,repairs:0};
  let repairs=0;
  const person=(name:unknown):string|undefined=>{
   if(typeof name!=='string'||isNpcReference(name))return undefined;
   const refs=this.publicNames.get(name.normalize('NFKC').trim().toLowerCase());
   if(refs?.size!==1)return undefined;
   const ref=[...refs][0];return this.issued.has(ref)?ref:undefined;
  };
  const bind=(value:unknown)=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return value;
   const row=value as Row,ref=person(row.actor);
   if(!ref)return row;
   repairs++;return {...row,actor:ref};
  };
  // A claim's person fields (who it is about, who provides it) name the same public people as the speaker does.
  const claims=(value:unknown)=>{
   const row=bind(value) as Row;
   if(!row||typeof row!=='object'||!Array.isArray(row.content))return row;
   return {...row,content:row.content.map((item:unknown)=>{
    const claim=item&&typeof item==='object'?(item as Row).new:undefined;
    if(!claim||typeof claim!=='object'||Array.isArray(claim))return item;
    let next=claim as Row;
    for(const key of ['actor','provider']){const ref=person(next[key]);if(ref){next={...next,[key]:ref};repairs++;}}
    return next===claim?item:{...(item as Row),new:next};
   })};
  };
  const value=input as Row;
  return{args:{...value,...(Array.isArray(value.interactions)?{interactions:value.interactions.map(claims)}:{}),
   ...(Array.isArray(value.commands)?{commands:value.commands.map(command=>command?.kind==='npc'?bind(command):command)}:{})},repairs};
 }
 /** §270: the issued people a public name names: one ref, several (ambiguous), or none. A name binds only when unique. */
 lookup(scope:string,name:string):string[] {
  if(this.scope!==scope)return [];
  const key=name.normalize('NFKC').trim().toLowerCase(),exact=[...(this.publicNames.get(key)??[])].filter(ref=>this.issued.has(ref));
  if(exact.length)return exact;
  const other=[...(this.names.get(key)??[])].filter(ref=>this.issued.has(ref));
  if(other.length)return other;
  // §270.18: a word that carries one issued person's whole public name is that person ("约翰·格林中士" for "约翰·格林"),
  // as §264.32 reads a full name inside a newcomer's word; two such people stay ambiguous.
  return [...new Set([...this.publicNames].filter(([public_])=>[...public_].length>=2&&key.includes(public_)).flatMap(([,refs])=>[...refs]))].filter(ref=>this.issued.has(ref));
 }
 require(scope:string,references:readonly string[]):void {
  if(references.some(ref=>!isNpcReference(ref)||this.scope!==scope||!this.issued.has(ref)))
   throw Error('Unknown or unissued NPC reference; use a ref from the supplied current NPC material');
 }
 current(scope:string):string[] {return this.scope===scope?[...this.issued]:[];}
}
