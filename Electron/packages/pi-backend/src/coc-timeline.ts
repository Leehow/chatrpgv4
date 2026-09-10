/** Durable transcript anchors. No message ordinals or semantic text matching. */
export type TimelineAnchor = {commit:string; turn:number; messageId:string; endId:string; sessionId:string};
export function timelineAnchors(rows:any[], sessionId:string):TimelineAnchor[] {
  const anchors:TimelineAnchor[]=[];
  let pending:TimelineAnchor|undefined;
  const markedByTurn=new Map<number,string>();
  for(const row of rows) {
    const message=row.message;
    if(row.customType==='coc-mechanics'&&row.data?.marked_text)markedByTurn.set(row.data.turn,row.id);
    if(message?.role==='user') {pending=undefined;markedByTurn.clear();}
    let data=row.type==='custom'&&row.customType==='coc-turn-anchor'?row.data:undefined;
    if(message?.role==='toolResult' && ['narrate','ask'].includes(message.toolName) && !message.isError) {
      data=message.details;
      if(!data?.commit)for(const part of message.content??[]) {
        if(part.type!=='text')continue;
        try {const parsed=JSON.parse(part.text); if(parsed.commit)data=parsed;} catch {}
      }
    }
    if(typeof data?.commit==='string' && Number.isInteger(data.turn)) {
      pending={commit:data.commit,turn:data.turn,messageId:markedByTurn.get(data.turn)??'',endId:row.id,sessionId};
      const existing=anchors.find(a=>a.commit===data.commit);
      if(existing)pending=existing;else anchors.push(pending);
    }
    if(pending && row.id) {
      pending.endId=row.id;
      if(message?.role==='assistant' && (message.content??[]).some((p:any)=>p.type==='text'&&p.text?.trim()))pending.messageId=markedByTurn.get(pending.turn)??row.id;
      if(row.customType==='coc-mechanics'&&row.data?.marked_text)pending.messageId=row.id;
    }
  }
  return anchors.filter(a=>a.messageId);
}

export function transcriptPrefix(rows:any[], anchor:TimelineAnchor):any[] {
  const end=rows.findIndex(row=>row.id===anchor.endId);
  if(end<0)throw new Error('The selected delivery is no longer available');
  return rows.slice(1,end+1);
}
