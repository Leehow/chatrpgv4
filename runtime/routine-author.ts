/** Contract §247.4: the Mod-owned routine summary instruction rides the author system prompt, not its packet. */
type Row=Record<string,any>;
export function routineAuthorPrompt(packet:Row):string {
 const instruction=packet.decision_context?.routine?.instruction;
 return typeof instruction==='string'&&instruction.trim()?'\n\n'+instruction:'';
}
export function routineAuthorPacket(packet:Row):Row {
 const routine=packet.decision_context?.routine;
 if(!routine)return packet;
 const {instruction,mod,version,key,...summary}=routine;
 return {...packet,decision_context:{...packet.decision_context,routine:summary}};
}
