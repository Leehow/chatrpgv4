/** Place craft comes from a locked Mod; this adapter carries no authored style. */
type Row=Record<string,any>;
export function locationAuthorPrompt(packet:Row):string {
 const instruction=packet.decision_context?.location_description?.instruction;
 return typeof instruction==='string'&&instruction.trim()?'\n\n'+instruction:'';
}
export function locationAuthorPacket(packet:Row):Row {
 const description=packet.decision_context?.location_description;
 if(!description)return packet;
 const {instruction,...identity}=description;
 return {...packet,decision_context:{...packet.decision_context,location_description:identity}};
}
