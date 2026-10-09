/** Real public SDK and Undici against local fixtures; no provider, credentials or Internet. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,readdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';
import {getGlobalDispatcher,setGlobalDispatcher,Agent} from 'undici';
import {getApiProvider} from '@earendil-works/pi-ai/compat';
import {createGrokBuildProvider} from '../../extensions/grok-build-oauth/agent/provider.js';
import {createObservedGrokStream,SseMetadataParser,transportInterceptor} from '../../extensions/grok-build-oauth/agent/transport-observation.js';
import {watchStreamProgress} from '../../vendor/pi/packages/coding-agent/src/core/stream-progress.ts';

const SECRET='PRIVATE_SENTINEL_47a9', encoder=new TextEncoder();
const context={systemPrompt:SECRET+'system',messages:[{role:'user',content:[{type:'text',text:SECRET+'prompt'}],timestamp:1}]};
const opts={apiKey:SECRET+'key',reasoning:'low',maxTokens:256,maxRetries:0,transport:'sse'};
function model(url,provider='grok-build'){return{id:'grok-4.7',name:'fixture',provider,api:'openai-responses',baseUrl:url+'/v1',reasoning:true,input:['text'],contextWindow:128000,maxTokens:16384,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};}
function frames(){const message={id:'m1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:SECRET+'📎',annotations:[]}]};return[
 {type:'response.created',response:{id:'r1',model:'grok-4.7',created_at:1,status:'in_progress'}},
 {type:'response.output_item.added',output_index:0,item:{...message,status:'in_progress',content:[]}},
 {type:'response.content_part.added',output_index:0,item_id:'m1',content_index:0,part:{type:'output_text',text:'',annotations:[]}},
 {type:'response.output_text.delta',item_id:'m1',output_index:0,content_index:0,delta:SECRET+'📎'},
 {type:'response.output_text.done',item_id:'m1',output_index:0,content_index:0,text:SECRET+'📎'},
 {type:'response.output_item.done',output_index:0,item:message},
 {type:'response.completed',response:{id:'r1',model:'grok-4.7',status:'completed',output:[message],usage:{input_tokens:10,output_tokens:4,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}},
];}
function body(){return Buffer.from(':'+SECRET+'heartbeat\r\n\r\n'+frames().map(f=>'event: '+f.type+'\r\ndata: '+JSON.stringify(f)+'\r\n\r\n').join(''));}
async function fixture(t,encoding='identity',action,extraHeaders={},status=200){const requests=[];const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;requests.push({body:JSON.parse(raw),headers:req.headers});res.writeHead(status,{'Content-Type':'text/event-stream','X-Request-ID':SECRET+'request','Content-Encoding':encoding,...extraHeaders});
 if(action)return action(req,res);
 const rawBody=body(),encoded=encoding==='gzip'?gzipSync(rawBody):encoding==='br'?brotliCompressSync(rawBody):encoding==='deflate'?deflateSync(rawBody):rawBody;
 for(let i=0;i<encoded.length;i+=7)res.write(encoded.subarray(i,i+7));res.end();});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});return{url:`http://127.0.0.1:${server.address().port}`,requests};}
async function consume(stream){const types=[];for await(const event of stream)types.push(event.type);return{types,result:await stream.result()};}
function capture(extra={}){const rows=[],traces=[];return{rows,traces,options:{enabled:true,sink:row=>{rows.push(row);},onTrace:trace=>traces.push(trace),...extra}};}
function privacy(rows){assert.ok(!JSON.stringify(rows).includes(SECRET),'trace must contain no privacy sentinel');}
function restore(t){const before=getGlobalDispatcher();t.after(()=>setGlobalDispatcher(before));return before;}

test('opt-in raw mode retains complete SSE and SDK payloads, immutable before hooks and without credentials',async t=>{
 restore(t);
 const originals=frames();originals[0].response.metadata={note:'echo '+opts.apiKey,authorization:opts.apiKey};
 const f=await fixture(t,'gzip',(_req,res)=>{
  const extra=' { "type": "response.future", "counter": 9007199254740993, "path": "/keep/this" } ';
  const encoded=gzipSync(Buffer.from(':'+SECRET+'heartbeat\r\n\r\n'+'data: '+extra+'\r\n\r\n'+originals.map(event=>'data: '+JSON.stringify(event)+'\r\n\r\n').join('')));
  for(let i=0;i<encoded.length;i+=7)res.write(encoded.subarray(i,i+7));res.end();
 },{'Set-Cookie':'session='+SECRET+'cookie; Path=/; SameSite=Lax'});
 const cap=capture({rawResponse:true}),config=createGrokBuildProvider({transportObservation:cap.options});
 const observed=await consume(config.streamSimple(model(f.url),context,{...opts,onProviderStreamEvent:event=>{event.after_hook=true;}}));
 await cap.traces[0].close();
 assert.equal(observed.result.stopReason,'stop');
 assert.equal(cap.rows[0].captureMode,'raw_response');
 const sse=cap.rows.filter(row=>row.event==='sse_event').map(row=>JSON.parse(row.payload_utf8));
 const sdk=cap.rows.filter(row=>row.event==='sdk_raw_event').map(row=>JSON.parse(row.payload_utf8));
 assert.equal(sse.length,originals.length+1);assert.deepEqual(sdk,sse);
 assert(sdk.every(event=>!event.after_hook),'receipt snapshots precede a mutating existing hook');
 assert.equal(sse[4].delta,originals[3].delta,'private response text is captured only in explicitly requested raw mode');
 assert.equal(sse[1].response.metadata.authorization,'[REDACTED_CREDENTIAL]');
 assert.equal(sse[1].response.metadata.note,'echo [REDACTED_CREDENTIAL]');
 assert.equal(cap.rows.find(row=>row.event==='sse_event'&&row.type==='response.future').payload_utf8,' { "type": "response.future", "counter": 9007199254740993, "path": "/keep/this" } ');
 assert.equal(cap.rows.find(row=>row.event==='sse_comment').payload_utf8,':'+SECRET+'heartbeat');
 const persisted=JSON.stringify(cap.rows);
 assert(!persisted.includes(opts.apiKey));assert(!persisted.includes(context.systemPrompt));assert(!persisted.includes(SECRET+'prompt'));
 assert.equal(cap.rows.at(-1).complete,true);
});

test('raw payload detail limits preserve the actual SDK result and explicitly mark lost evidence',async t=>{
 restore(t);const f=await fixture(t),cap=capture({rawResponse:true,limits:{records:8,logBytes:1024}});
 const config=createGrokBuildProvider({transportObservation:cap.options});
 const observed=await consume(config.streamSimple(model(f.url),context,opts));await cap.traces[0].close();
 assert.equal(observed.result.stopReason,'stop');
 assert.equal(cap.rows.at(-1).complete,false);assert(cap.rows.at(-1).incomplete.includes('metadata_limit'));
});

for(const encoding of ['identity','gzip','deflate','br'])test(`actual SDK preserves payload/output while observing ${encoding} entity and SSE`,async t=>{
 restore(t);const f=await fixture(t,encoding),cap=capture(),api=getApiProvider('openai-responses');
 const base=await consume(api.streamSimple(model(f.url),context,opts));
 const config=createGrokBuildProvider({transportObservation:cap.options});
 const observed=await consume(config.streamSimple(model(f.url),context,opts));await cap.traces[0].close();
 assert.equal(observed.result.stopReason,'stop');assert.deepEqual(observed.types,base.types);
 assert.deepEqual(observed.result.content,base.result.content);assert.deepEqual(f.requests[1].body,f.requests[0].body);
 assert.equal(f.requests[1].headers.authorization,f.requests[0].headers.authorization);
 assert.equal(getApiProvider('openai-responses'),api,'provider factory must not replace the global API');
 assert.equal(cap.rows.filter(r=>r.event==='sse_event').length,frames().length);
 assert.equal(cap.rows.filter(r=>r.event==='sdk_raw_event').length,frames().length);
 assert.ok(cap.rows.some(r=>r.event==='sse_comment'));
 assert.ok(cap.rows.some(r=>r.event==='normalized_consumed'&&r.type==='text_delta'));
 const transport=cap.rows.find(r=>r.event==='transport_summary'&&r.eofObserved);assert.ok(transport);
 const raw=body(),expectedEncoded=encoding==='gzip'?gzipSync(raw):encoding==='br'?brotliCompressSync(raw):encoding==='deflate'?deflateSync(raw):raw;
 assert.equal(transport.encodedBytes,expectedEncoded.length);assert.equal(transport.decodedBytes,raw.length);
 assert.ok(transport.terminalGapMs>=0);
 const response=cap.rows.find(r=>r.event==='sdk_response');assert.ok(response.wire&&response.requestIdHash);
 assert.equal(response.requestIdHash,cap.rows.find(r=>r.event==='response_headers').requestIdHash);
 assert.equal(cap.rows.at(-1).event,'attempt_summary');assert.equal(cap.rows.at(-1).complete,true);
 assert.ok(cap.rows.filter(r=>r.event==='response_chunk').every(r=>r.byteDomain==='http_entity_encoded_not_tcp_tls'&&r.receiptTime&&r.observerProcessingTime));
 privacy(cap.rows);
});

test('UTF-8 split at every byte, CR/LF boundaries, multiline data, and unknown type retain metadata only',()=>{
 const rows=[],errors=[],parser=new SseMetadataParser((event,fields)=>rows.push({event,...fields}),reason=>errors.push(reason));
 const bytes=encoder.encode(':'+SECRET+'\r\n\r\nevent: response.future\ndata: {"type":"response.future",\ndata: "value":"'+SECRET+'🌲"}\n\n');
 for(const byte of bytes)parser.feed(Uint8Array.of(byte),{});parser.end({});
 assert.deepEqual(errors,[]);assert.equal(rows.filter(r=>r.event==='sse_event')[0].type,'response.future');privacy(rows);
 const limited=new SseMetadataParser(()=>{},reason=>errors.push(reason),16);limited.feed(encoder.encode('data: '+SECRET+'\n\n'),{});assert.ok(errors.includes('sse_frame_limit'));
 const invalid=new SseMetadataParser(()=>{},reason=>errors.push(reason));invalid.feed(Uint8Array.of(0xff),{});assert.ok(errors.includes('invalid_utf8'));
});

test('concurrent attempts isolate IDs; duplicate install and non-Grok calls preserve global dispatch',async t=>{
 restore(t);const f=await fixture(t),a=capture(),b=capture(),api=getApiProvider('openai-responses');
 const one=createGrokBuildProvider({transportObservation:a.options}),two=createGrokBuildProvider({transportObservation:b.options});
 const first=one.streamSimple(model(f.url),context,opts),dispatcher=getGlobalDispatcher();
 await Promise.all([consume(first),consume(two.streamSimple(model(f.url),context,opts))]);
 await Promise.all([...a.traces,...b.traces].map(x=>x.close()));assert.equal(getGlobalDispatcher(),dispatcher);
 assert.notEqual(a.rows[0].attempt,b.rows[0].attempt);assert.equal(new Set(a.rows.map(r=>r.attempt)).size,1);assert.equal(new Set(b.rows.map(r=>r.attempt)).size,1);
 const count=a.rows.length;await consume(one.streamSimple(model(f.url,'other-provider'),context,opts));assert.equal(a.rows.length,count);assert.equal(getApiProvider('openai-responses'),api);
 privacy([...a.rows,...b.rows]);
});

test('result-only consumption explicitly leaves normalized observation incomplete',async t=>{
 restore(t);const f=await fixture(t),cap=capture(),config=createGrokBuildProvider({transportObservation:cap.options});
 const result=await config.streamSimple(model(f.url),context,opts).result();await cap.traces[0].close();assert.equal(result.stopReason,'stop');
 assert.equal(cap.rows.at(-1).complete,false);assert.ok(cap.rows.at(-1).incomplete.includes('normalized_not_fully_consumed'));privacy(cap.rows);
});

test('unsupported encoding, observation overflow, and sink failure cannot fail the request',async t=>{
 restore(t);for(const mode of ['unsupported','overflow','sink']){const f=await fixture(t,mode==='unsupported'?'x-unknown':'identity'),cap=capture(mode==='overflow'?{limits:{queuedBytes:1}}:mode==='sink'?{sink:()=>{throw Error(SECRET)}}:{});
 const config=createGrokBuildProvider({transportObservation:cap.options}),result=await consume(config.streamSimple(model(f.url),context,opts));await cap.traces[0].close();assert.equal(result.result.stopReason,'stop');
 assert.ok(cap.traces[0].reasons.has(mode==='unsupported'?'unsupported_content_encoding':mode==='overflow'?'observer_queue_limit':'sink_error'));privacy(cap.rows);}
});

test('dispatcher replacement is re-observed without changing provider options or API registry',async t=>{
 const before=restore(t),f=await fixture(t),cap=capture(),api=getApiProvider('openai-responses');
 const stream=createObservedGrokStream(api.streamSimple,cap.options);await consume(stream(model(f.url),context,opts));await cap.traces[0].close();
 const replacement=new Agent();t.after(()=>replacement.close());setGlobalDispatcher(replacement);
 await consume(stream(model(f.url),context,opts));await cap.traces[1].close();
 assert.notEqual(getGlobalDispatcher(),before);assert.equal(cap.rows.filter(r=>r.event==='transport_start').length,2);
 assert.equal(getApiProvider('openai-responses'),api);privacy(cap.rows);
});

test('legacy backpressure and handler exceptions are forwarded exactly',()=>{
 const record=[],store={getStore:()=>({origin:'http://fixture',path:'/v1/responses',trace:{wire:()=>({data:()=>record.push('observed'),record(){},end(){}}),incomplete(){}}})};
 let wrapped;const value=transportInterceptor(store)((opts,handler)=>{wrapped=handler;return 'dispatch-result';})({origin:'http://fixture',path:'/v1/responses',method:'POST'},{onData(){record.push('original');return false;}});
 assert.equal(value,'dispatch-result');assert.equal(wrapped.onData(Buffer.from('x')),false);assert.deepEqual(record,['original','observed']);
 const error=Error('original');transportInterceptor(store)((o,h)=>{wrapped=h;return true;})({origin:'http://fixture',path:'/v1/responses',method:'POST'},{onData(){throw error;}});
 assert.throws(()=>wrapped.onData(Buffer.from('x')),e=>e===error);
});

test('actual SDK cancellation and transport error preserve terminal outcome and incomplete trace',async t=>{
 restore(t);for(const fail of [false,true]){let response;const f=await fixture(t,'identity',(req,res)=>{response=res;res.write('data: '+JSON.stringify(frames()[0])+'\n\n');});
 const control=new AbortController(),cap=capture(),api=getApiProvider('openai-responses');let signalled=false;
 const stream=createObservedGrokStream(api.streamSimple,cap.options)(model(f.url),context,{...opts,signal:control.signal,onProviderStreamEvent(){if(signalled)return;signalled=true;if(fail)response.destroy();else control.abort();}});
 const result=await consume(stream);await cap.traces[0].close();assert.equal(result.result.stopReason,fail?'error':'aborted');
 assert.ok(cap.rows.at(-1).incomplete.includes('transport_error'));assert.equal(cap.rows.find(r=>r.event==='transport_summary').eofObserved,false);privacy(cap.rows);
 }});

test('opt-in raw capture retains SDK terminal errors even when HTTP failure has no SSE events',async t=>{
 restore(t);const f=await fixture(t,'identity',(_req,res)=>{
  res.end(JSON.stringify({error:{message:'UPSTREAM_FAILURE '+opts.apiKey,code:'overloaded'}}));
 },{'Content-Type':'application/json'},503);
 const cap=capture({rawResponse:true}),stream=createGrokBuildProvider({transportObservation:cap.options}).streamSimple(model(f.url),context,opts);
 const observed=await consume(stream);await cap.traces[0].close();
 assert.equal(observed.result.stopReason,'error');assert.equal(cap.rows.filter(row=>row.event==='sdk_raw_event').length,0);
 const row=cap.rows.find(row=>row.event==='normalized_consumed'&&row.type==='error');
 assert.equal(row.payloadFormat,'sdk_json');
 const terminal=JSON.parse(row.payload_utf8);assert.equal(terminal.type,'error');assert.equal(terminal.reason,'error');
 assert.match(terminal.error.errorMessage,/UPSTREAM_FAILURE/);assert(!row.payload_utf8.includes(opts.apiKey));
 assert.match(terminal.error.errorMessage,/REDACTED_CREDENTIAL/);
 assert.equal(f.requests.length,1,'observation must not retry the failed request');
});

test('result-only raw error retains its cause while keeping normalized coverage incomplete',async t=>{
 restore(t);const f=await fixture(t,'identity',(_req,res)=>{
  res.end(JSON.stringify({error:{message:'RESULT_FAILURE '+opts.apiKey,code:'overloaded'}}));
 },{'Content-Type':'application/json'},503);
 const cap=capture({rawResponse:true}),stream=createGrokBuildProvider({transportObservation:cap.options}).streamSimple(model(f.url),context,opts);
 const result=await stream.result();await cap.traces[0].close();assert.equal(result.stopReason,'error');
 const row=cap.rows.find(row=>row.event==='sdk_terminal_result');assert.equal(row.payloadFormat,'sdk_json');
 assert.match(JSON.parse(row.payload_utf8).errorMessage,/RESULT_FAILURE.*REDACTED_CREDENTIAL/);
 assert(!row.payload_utf8.includes(opts.apiKey));
 assert(cap.rows.at(-1).incomplete.includes('normalized_not_fully_consumed'));
 assert.equal(f.requests.length,1);
});

test('slow sink and delayed existing hooks do not prefetch or change request completion',async t=>{
 restore(t);const f=await fixture(t),rows=[],traces=[];let releaseSink,releaseHook,hookEntered;
 const sinkGate=new Promise(resolve=>{releaseSink=resolve;}),hookGate=new Promise(resolve=>{releaseHook=resolve;}),entered=new Promise(resolve=>{hookEntered=resolve;});
 const stream=createObservedGrokStream(getApiProvider('openai-responses').streamSimple,{enabled:true,sink:async row=>{await sinkGate;rows.push(row);},onTrace:trace=>traces.push(trace)})(model(f.url),context,{...opts,onProviderStreamEvent:async()=>{hookEntered();await hookGate;}});
 const waiting=consume(stream);await entered;releaseHook();
 const result=await waiting;assert.equal(result.result.stopReason,'stop','a blocked diagnostic sink cannot block provider completion');
 releaseSink();await traces[0].close();
 assert.ok(rows.some(row=>row.event==='sdk_hook_entry'));assert.ok(rows.some(row=>row.event==='sdk_hook_exit'));
 assert.ok(rows.filter(row=>row.event==='sdk_raw_event').every(row=>row.wire&&row.ordinal));
 assert.ok(rows.filter(row=>row.event==='normalized_consumed').every(row=>row.wire&&row.ordinal));privacy(rows);
});

test('observer failure and closed output budget leave result intact; summaries expose incompleteness',async t=>{
 restore(t);let trace;const f=await fixture(t),cap=capture({limits:{records:2},onTrace:value=>{trace=value;throw Error(SECRET);}});
 const observer=createObservedGrokStream(getApiProvider('openai-responses').streamSimple,cap.options);
 const result=await consume(observer(model(f.url),context,opts));assert.equal(result.result.stopReason,'stop');
 // Await only the observer's explicit completion, after the unchanged model result has returned.
 await trace.close();
 const summary=cap.rows.find(row=>row.event==='attempt_summary');assert.ok(summary);assert.equal(summary.complete,false);
 assert.ok(summary.incomplete.includes('metadata_limit'));assert.ok(summary.incomplete.includes('observer_callback_error'));privacy(cap.rows);
 assert.equal(summary.progress.sdkRaw.count,frames().length,'summary survives detailed-record limits');
 assert.ok(summary.progress.normalized.count>0);
 assert.ok(summary.progress.encoded.firstAt&&summary.progress.encoded.lastAt);
 assert.ok(cap.rows.some(row=>row.event==='transport_summary'&&row.encodedBytes>0));
});

test('SSE heartbeats remain visible when the real idle watchdog sees no model progress',async t=>{
 restore(t);
 const f=await fixture(t,'identity',(req,res)=>{
  res.write('data: '+JSON.stringify(frames()[0])+'\n\n:'+SECRET+'heartbeat\n\n');
  const pulse=setInterval(()=>res.write(':'+SECRET+'heartbeat\n\n'),10);
  res.on('close',()=>clearInterval(pulse));
 });
 const cap=capture(),observer=createObservedGrokStream(getApiProvider('openai-responses').streamSimple,cap.options);
 const stream=watchStreamProgress(signal=>observer(model(f.url),context,{...opts,signal}),undefined,120);
 const result=await consume(stream);await cap.traces[0].close();
 assert.equal(result.result.stopReason,'error');
 assert.match(result.result.errorMessage,/no response event for 120 ms/);
 assert.ok(cap.rows.some(row=>row.event==='sse_comment'),'bytes and heartbeat framing were observed');
 assert.ok(cap.rows.some(row=>row.event==='local_abort'),'local cancellation is distinct from EOF');
 assert.equal(cap.rows.filter(row=>row.event==='sdk_raw_event').length,1,'heartbeats are not normalized model events');
 assert.ok(cap.rows.some(row=>row.event==='transport_summary'&&row.encodedBytes>0&&!row.eofObserved));
 const summary=cap.rows.find(row=>row.event==='attempt_summary');
 assert.equal(summary.complete,false);assert.ok(summary.incomplete.includes('transport_error'));
 assert.equal(cap.rows[0].model,'grok-4.7');privacy(cap.rows);
});

test('synchronous dispatch failures close their wire and preserve the original error',()=>{
 const failure=Error('dispatch failed'),ends=[];
 const store={getStore:()=>({origin:'http://fixture',path:'/v1/responses',trace:{wire:()=>({end:(event,error)=>ends.push([event,error])})}})};
 const dispatch=transportInterceptor(store)(()=>{throw failure;});
 assert.throws(()=>dispatch({origin:'http://fixture',path:'/v1/responses',method:'POST'},{}),error=>error===failure);
 assert.deepEqual(ends,[['transport_error',failure]]);
});

 test('file sink writes only bounded metadata to the explicit diagnostic home',async t=>{
 restore(t);const f=await fixture(t),directory=await mkdtemp(resolve('.tmp/transport-trace-')),traces=[];
 const config=createGrokBuildProvider({transportObservation:{enabled:true,directory,onTrace:trace=>traces.push(trace)}});
 await consume(config.streamSimple(model(f.url),context,opts));await traces[0].close();
 const files=await readdir(join(directory,`process-${process.pid}`));assert.equal(files.length,1);
 const path=join(directory,`process-${process.pid}`,files[0]),text=await readFile(path,'utf8'),rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(rows.at(-1).event,'attempt_summary');assert.equal(rows.at(-1).complete,true);privacy(rows);
 assert.equal((await stat(path)).mode&0o777,0o600);
 });
