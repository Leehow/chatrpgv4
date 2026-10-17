/** Read-only protocol counters. Never records credentials, request contents or reasoning text. */
export default function wireObserver(pi){
    let sequence=0,pending;
    const record=row=>{try{pi.appendEntry('coc-telemetry',{lane:'stage3-wire',...row});}catch{}};
    pi.on('before_provider_request',(event,ctx)=>{
        const body=event.payload;
        pending={request:++sequence,blocks:[],text_bytes:0,thinking_bytes:0,tool_bytes:0};
        record({event:'request',request:sequence,model:ctx.model?.provider+'/'+ctx.model?.id,
            effort:body.output_config?.effort??null,thinking_type:body.thinking?.type??null,max_tokens:body.max_tokens??null,
            assistant_replay:(body.messages??[]).filter(message=>message.role==='assistant').map(message=>
                Array.isArray(message.content)?message.content.map(block=>({type:block.type,
                    ...(block.type==='thinking'?{signed:!!block.signature}:{})})):['text'])});
    });
    pi.on('provider_stream_event',event=>{
        if(!pending||event.api!=='anthropic-messages')return;
        const data=event.data;
        if(data?.type==='content_block_start')pending.blocks.push({index:data.index,type:data.content_block?.type});
        if(data?.type==='content_block_delta'){
            if(data.delta?.type==='text_delta')pending.text_bytes+=Buffer.byteLength(data.delta.text??'');
            if(data.delta?.type==='thinking_delta')pending.thinking_bytes+=Buffer.byteLength(data.delta.thinking??'');
            if(data.delta?.type==='input_json_delta')pending.tool_bytes+=Buffer.byteLength(data.delta.partial_json??'');
        }
        if(data?.type==='message_delta')pending.stop_reason=data.delta?.stop_reason;
        if(data?.type==='message_stop'){record({event:'response',...pending});pending=undefined;}
    });
}
