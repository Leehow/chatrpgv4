import React,{memo,useEffect,useRef} from 'react';
// @ts-expect-error -- shared packaged renderer owns speaker colors.
import {speakerInk,SPEAKER_CSS} from '../../../../pipicoc/mechanics.js';

type Speaker={name:string;who:Record<string,unknown>};
export type StreamingProseDetails={chunks:string[];speakers?:Speaker[];status?:string;delivery_id?:string};
type Piece={text:string;who?:Record<string,unknown>};
const PieceView=memo(({piece}:{piece:Piece})=>{
  const who=piece.who;
  if(!who)return <>{piece.text}</>;
  const kind=who.npc?'npc':who.investigator?'investigator':'label';
  const anchor=String(who.npc??who.investigator??who.label??'');
  const name=String(who.shown??who.name??who.label??'');
  return <span className="coc-say" data-who={kind} title={name}
    style={{'--coc-say-ink':speakerInk(anchor,kind)} as React.CSSProperties}>{piece.text}</span>;
});

/** Append-only markup decoding; unfinished marker syntax is never rendered. */
export function CocStreamingProse({details}:{details:StreamingProseDetails}) {
  const state=useRef({count:0,tail:'',pieces:[] as Piece[],who:undefined as Record<string,unknown>|undefined});
  const firstPaint=useRef(false);
  const prose=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{
    if(document.getElementById('coc-stream-speaker-style'))return;
    const style=document.createElement('style');style.id='coc-stream-speaker-style';
    style.textContent=SPEAKER_CSS;document.head.appendChild(style);
  },[]);
  useEffect(()=>{
    if(firstPaint.current||!details.chunks.length||!details.delivery_id)return;
    const node=prose.current;
    if(!node||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting&&entry.intersectionRect.width>0&&entry.intersectionRect.height>0))return;
      if(!node.textContent?.trim()||firstPaint.current)return;
      requestAnimationFrame(()=>{
        const rect=node.getBoundingClientRect(),root=node.closest('[data-virtuoso-scroller]')?.getBoundingClientRect();
        const top=Math.max(0,root?.top??0),bottom=Math.min(innerHeight,root?.bottom??innerHeight);
        if(rect.bottom<=top||rect.top>=bottom||rect.width<=0||rect.height<=0||firstPaint.current)return;
        performance.mark(`coc-final-first-paint:${details.delivery_id}`);firstPaint.current=true;
      });
    },{root:node.closest('[data-virtuoso-scroller]')});
    observer.observe(node);
    return()=>observer.disconnect();
  },[details.chunks.length,details.delivery_id]);
  if(details.chunks.length<state.current.count)state.current={count:0,tail:'',pieces:[],who:undefined};
  const current=state.current;
  const append=(text:string)=>{
    if(!text)return;
    const last=current.pieces.at(-1);
    if(last&&last.who===current.who)current.pieces[current.pieces.length-1]={...last,text:last.text+text};
    else current.pieces.push({text,...(current.who?{who:current.who}:{})});
  };
  for(;current.count<details.chunks.length;current.count++){
    current.tail+=details.chunks[current.count];
    while(current.tail){
      const open=current.tail.indexOf('{{');
      if(open<0){
        const held=current.tail.endsWith('{')?'{':'';
        append(held?current.tail.slice(0,-1):current.tail);current.tail=held;break;
      }
      if(open>0){append(current.tail.slice(0,open));current.tail=current.tail.slice(open);}
      let end=current.tail.indexOf('}}');
      const nested=current.tail.startsWith('{{say:{{name:');
      if(nested&&end>=0){
        if(current.tail.length<end+4)break;
        if(current.tail.slice(end+2,end+4)==='}}')end+=2;
      }
      if(end<0){if(current.tail.length>256)current.tail='';break;}
      const token=current.tail.slice(2,end);
      if(token==='/say')current.who=undefined;
      else if(token.startsWith('say:')){
        const raw=token.slice(4).trim();
        const name=raw.startsWith('{{name:')&&raw.endsWith('}}')?raw.slice(7,-2):raw;
        current.who=details.speakers?.find(speaker=>speaker.name===name||speaker.who.name===name||speaker.who.shown===name)?.who;
      }
      current.tail=current.tail.slice(end+2);
    }
  }
  return <div className="coc-streaming-prose" data-delivery-status={details.status}>
    <p ref={prose} style={{whiteSpace:'pre-wrap'}}>{current.pieces.map((piece,index)=><PieceView key={index} piece={piece}/>)}</p>
    {details.status==='interrupted'?<span role="status">⏸</span>:details.status==='publication_pending'?<span role="status">…</span>:null}
  </div>;
}
