// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {MessageView} from './Transcript'
import {nestSidebarSessions, type SidebarSession} from './Sidebar'
afterEach(cleanup)
it('keeps copy and branch after a marked delivery and copies its prose',()=>{
  const onCopy=vi.fn(async(_message:any)=>{}),onBranch=vi.fn()
  const message={id:'delivery',role:'assistant' as const,content:'',presentation:{renderer:'coc-mechanics',details:{marked_text:'The door opens. {{m:1}}'}}}
  render(<MessageView message={message} onCopy={onCopy} onResend={()=>{}} resendDisabled={false} onBranch={onBranch} branchMessageIds={new Set(['delivery'])} actionWords={{copy:'Copy',branch:'Create branch'}}/>)
  fireEvent.click(screen.getByRole('button',{name:'Copy'}))
  expect(onCopy.mock.calls[0][0].content).toBe('The door opens.')
  fireEvent.click(screen.getByRole('button',{name:'Create branch'}))
  expect(onBranch).toHaveBeenCalledWith(message)
})
it('nests a newer child under its parent without hiding orphaned or cyclic rows',()=>{
  const row=(id:string,parentSessionId?:string)=>({id,parentSessionId} as SidebarSession)
  expect(nestSidebarSessions([row('child','root'),row('root'),row('orphan','missing')]).map(s=>[s.id,s.branchDepth])).toEqual([['root',0],['child',1],['orphan',0]])
  expect(nestSidebarSessions([row('a','b'),row('b','a')])).toHaveLength(2)
})
