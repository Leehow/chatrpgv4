// @vitest-environment jsdom
import React from 'react';
import {render,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {applyStreamEvent} from './transcript-model';
import {CocStreamingProse} from './CocStreamingProse';

afterEach(cleanup);
const base={version:1 as const,campaign:'c',turn:1,worldline:'main',loop:0,run:'r',input_revision:'input',delivery_id:'delivery',attempt_id:'attempt',timestamp:1};
it('shows streamed speech without a raw partial marker and reconciles the canonical card once',()=>{
  let rows=applyStreamEvent([],{type:'final_delivery',sessionId:'s',frame:{...base,sequence:1,event:'start',speakers:[{name:'Clerk',who:{npc:'clerk',name:'Clerk'}}]}});
  const delta={type:'final_delivery' as const,sessionId:'s',frame:{...base,sequence:2,event:'delta' as const,delta:'The door opens. {{say:Cl'}};
  rows=applyStreamEvent(rows,delta);
  rows=applyStreamEvent(rows,delta);
  const mounted=render(<CocStreamingProse details={rows[0].presentation!.details as any}/>);
  expect(mounted.container.textContent).toBe('The door opens. ');
  rows=applyStreamEvent(rows,{type:'final_delivery',sessionId:'s',frame:{...base,sequence:3,event:'delta',delta:'erk}}Come in.{{/say}}'}});
  mounted.rerender(<CocStreamingProse details={rows[0].presentation!.details as any}/>);
  expect(mounted.container.textContent).toBe('The door opens. Come in.');
  expect(mounted.container.querySelector('[data-who="npc"]')?.textContent).toBe('Come in.');
  rows=applyStreamEvent(rows,{type:'presentation',sessionId:'s',entry:{id:'canonical',role:'assistant',content:'',timestamp:2,presentation:{renderer:'coc-mechanics',details:{final_stream_id:'delivery',marked_text:'The door opens. {{say:Clerk}}Come in.{{/say}}',mechanics:[]}}}});
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe('canonical');
  expect(rows[0].typewriter).toBeUndefined();
});

it('ignores replayed stream frames after the canonical card has replaced that delivery',()=>{
  const canonical={id:'canonical',role:'assistant' as const,content:'',timestamp:2,presentation:{renderer:'coc-mechanics',details:{final_stream_id:'delivery',marked_text:'Complete.'}}};
  const rows=applyStreamEvent([canonical],{type:'final_delivery',sessionId:'s',frame:{...base,sequence:1,event:'start'}});
  expect(rows).toEqual([canonical]);
});

it('requests history replay when reconnect first receives a later sequence',()=>{
  const rows=applyStreamEvent([],{type:'final_delivery',sessionId:'s',frame:{...base,sequence:4,event:'delta',delta:'tail'}});
  expect(rows).toHaveLength(1);
  expect(rows[0].presentation?.details).toMatchObject({needsReplay:true,chunks:[]});
});

it('keeps one speech wrapper while several provider chunks extend the same spoken line',()=>{
  const speakers=[{name:'Clerk',who:{npc:'clerk',name:'Clerk'}}];
  const mounted=render(<CocStreamingProse details={{chunks:['{{say:Clerk}}Hello'],speakers}}/>);
  mounted.rerender(<CocStreamingProse details={{chunks:['{{say:Clerk}}Hello',' there',', friend.'],speakers}}/>);
  expect(mounted.container.querySelectorAll('.coc-say')).toHaveLength(1);
  expect(mounted.container.querySelector('.coc-say')?.textContent).toBe('Hello there, friend.');
});

it('attributes streaming speech by the authorized public name returned by the kernel',()=>{
  const speakers=[{name:'Steven Knott',who:{npc:'steven-knott',name:'Public Knott'}}];
  const mounted=render(<CocStreamingProse details={{chunks:['{{say:Public Knott}}Tomorrow at ten.{{/say}}'],speakers}}/>);
  expect(mounted.container.querySelector('[data-who="npc"]')?.textContent).toBe('Tomorrow at ten.');
  expect(mounted.container.querySelector('.coc-say')?.getAttribute('title')).toBe('Public Knott');
});

it('ends the prior live inference card when the final prose phase starts',()=>{
  const prior={id:'keeper',role:'assistant' as const,content:'',thinking:'Private thought',streaming:true,tools:[{id:'handoff',name:'narrate',input:'{}',startedAt:1,finished:true}]};
  const rows=applyStreamEvent([prior],{type:'final_delivery',sessionId:'s',frame:{...base,sequence:1,event:'start',status:'streaming'}});
  expect(rows[0].streaming).toBe(false);
  expect(rows[0].thinking).toBe('Private thought');
  expect(rows[0].tools).toEqual(prior.tools);
  expect(rows[1].presentation?.renderer).toBe('coc-stream');
});

it('holds an entire nested name marker until its outer speech delimiter arrives',()=>{
  const speakers=[{name:'Reception nurse',who:{npc:'nurse',name:'Reception nurse'}}];
  const chunks=['{{say:{{name:Reception nurse}}'];
  const mounted=render(<CocStreamingProse details={{chunks:[...chunks],speakers}}/>);
  expect(mounted.container.textContent).toBe('');
  chunks.push('}}Please sign here.{{/say}}');
  mounted.rerender(<CocStreamingProse details={{chunks:[...chunks],speakers}}/>);
  expect(mounted.container.textContent).toBe('Please sign here.');
  expect(mounted.container.querySelector('[data-who="npc"]')?.textContent).toBe('Please sign here.');
});
