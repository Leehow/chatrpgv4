// @vitest-environment jsdom
import React from 'react'
import {render,screen,waitFor,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {CocCharacterDraft} from './CocCharacterDraft'
afterEach(cleanup)
it('shows the actual numerical card and ordinary gear before acknowledging its revision',async()=>{
 const onRendered=vi.fn(async()=>{})
 const data={revision:2,sheet:{name:'Helen',occupation:'Journalist',age:29,era:'1920s',characteristics:{STR:65},derived:{HP:12},skills:{'Art and Craft (Photography)':60},finance:{assets:{amount:90},spending_level:{amount:2}},cash:'9 USD',credit_rating:9,backstory:{traits:'Evidence first'},own_language:'English',key_connection:{summary:'Editor friend'},equipment:['Camera'],creation:{skills:{occupation:{unspent:0},interest:{unspent:0}}}}}
 render(<CocCharacterDraft data={data} onRendered={onRendered}/>)
 expect(screen.getByRole('region',{name:'Character draft'}).getAttribute('data-draft-revision')).toBe('2')
 expect(screen.getByText('65')).toBeTruthy();expect(screen.getByText('32')).toBeTruthy();expect(screen.getByText('13')).toBeTruthy()
 expect(screen.getByText('Camera')).toBeTruthy();expect(screen.getByText('Art and Craft (Photography)')).toBeTruthy()
 await waitFor(()=>expect(onRendered).toHaveBeenCalledOnce())
})
