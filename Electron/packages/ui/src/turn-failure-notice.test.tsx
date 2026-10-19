// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type {HistoryEntry,StreamEvent} from '@pipi/host-api'
import {MessageView} from './Transcript'
import {applyStreamEvent,historyMessages,transcriptFingerprint,type ChatMessage} from './transcript-model'
vi.mock('streamdown',async original=>({...await original<typeof import('streamdown')>(),Streamdown:({children}:{children:unknown})=><>{children}</>}))
vi.mock('@streamdown/code',()=>({code:{}}))
afterEach(cleanup)
const summary='The final response could not be written because its output path is not a directory (ENOTDIR).'
const details=JSON.stringify({failures:[{operation:'output',code:'ENOTDIR',message:'mkdir failed'}],settled_receipts:2},null,2)
const row:HistoryEntry={id:'failure',role:'assistant',placedByHost:true,content:summary,timestamp:1,
 failureNotice:{label:'Technical details',details}}
const draw=(message:ChatMessage)=><MessageView message={message} onCopy={async()=>{}} onResend={()=>{}} resendDisabled={false}/>
it('keeps a concrete error visible while raw diagnostics stay closed live and after reload',()=>{
 const live=applyStreamEvent([],{type:'presentation',sessionId:'s',entry:row} as Extract<StreamEvent,{type:'presentation'}>)[0]
 const saved=historyMessages([row])[0]
 for(const message of [live,saved]){
  expect(message.failureNotice).toEqual(row.failureNotice)
  const view=render(draw(message))
  expect(screen.getByText(summary)).toBeTruthy()
  const toggle=screen.getByRole('button',{name:'Technical details'})
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(view.container.querySelector('pre')).toBeNull()
  fireEvent.click(toggle)
  expect(view.container.querySelector('pre')?.textContent).toBe(details)
  view.rerender(draw({...message,timestamp:2}))
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(toggle)
  expect(view.container.querySelector('pre')).toBeNull()
  expect(screen.getByText(summary)).toBeTruthy()
  cleanup()
 }
 expect(transcriptFingerprint([saved])).not.toBe(transcriptFingerprint([{...saved,failureNotice:{...row.failureNotice!,details:'different'}}]))
})
