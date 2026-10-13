import type {FinalDeliveryFrame,HistoryEntry} from '@pipi/host-api';
import {mechanicsEntry} from './coc-view.js';
import {withoutMechanicsMarkers} from '../../../../shared/delivery-markers.js';

/** Rebuild public interrupted/in-flight replies from the same frames used live. */
export class FinalDeliveryHistory {
  private streams=new Map<string,{frame:FinalDeliveryFrame;chunks:string[];speakers:FinalDeliveryFrame['speakers']}>();
  private completed=new Set<string>();
  accept(row:any):void {
    if(row?.customType==='coc-mechanics'&&typeof row.data?.final_stream_id==='string'){
      const body=mechanicsEntry(row)?.presentation?.details as {marked_text?:unknown;rendered_text?:unknown}|undefined;
      const text=typeof body?.marked_text==='string'&&body.marked_text?body.marked_text
        :typeof body?.rendered_text==='string'?body.rendered_text:'';
      if(withoutMechanicsMarkers(text))this.completed.add(row.data.final_stream_id);
    }
    if(row?.customType!=='coc-final-delivery'||row.data?.version!==1)return;
    const frame=row.data as FinalDeliveryFrame;
    if(typeof frame.delivery_id!=='string'||!Number.isSafeInteger(frame.sequence))return;
    const previous=this.streams.get(frame.delivery_id);
    if(previous&&(previous.frame.attempt_id!==frame.attempt_id||frame.sequence<=previous.frame.sequence))return;
    if(!previous&&frame.event!=='start')return;
    if(previous&&frame.sequence!==previous.frame.sequence+1)return;
    this.streams.set(frame.delivery_id,{frame,chunks:frame.event==='delta'?[...(previous?.chunks??[]),frame.delta??'']:previous?.chunks??[],
      speakers:frame.speakers??previous?.speakers??[]});
  }
  entry(id:string):HistoryEntry|undefined {
    const data=this.streams.get(id);
    if(!data||!data.chunks.length||this.completed.has(id))return;
    return {id:`coc-final:${id}`,role:'assistant',content:'',timestamp:data.frame.timestamp,
      presentation:{renderer:'coc-stream',details:{...data.frame,chunks:data.chunks,speakers:data.speakers}}};
  }
}
