// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import * as React from 'react'
import {createComponent} from '../../../../pipicoc/mechanics.js'

const Delivery=createComponent(React)
afterEach(cleanup)

it('opens an authorized map image and zooms locally',()=>{
  const {container}=render(<Delivery details={{mechanics:[{kind:'map',receipt:'map:house-t1',map:'house',name:'House',label:'宅邸地图',
    available:true,image:'data:image/png;base64,abc',regions:[{id:'entry',label:'门厅',level:'一层'},{id:'cellar',label:'地窖',level:'地下室'}],levels:['一层','地下室'],
    level_images:[{level:'一层',image:'data:image/png;base64,first'},{level:'地下室',image:'data:image/png;base64,cellar'}]}],
    ui:{words:{mechanics:{available:'可查看',pending:'尚未就绪'}}}}}/>)
  fireEvent.click(screen.getByText('宅邸地图'))
  const image=screen.getByRole('img',{name:'宅邸地图'}) as HTMLImageElement
  expect(image.src).toContain('data:image/png;base64,first')
  expect(container.textContent).toContain('门厅')
  fireEvent.click(screen.getByRole('button',{name:'地下室'}))
  expect(image.src).toContain('data:image/png;base64,cellar')
  const zoom=screen.getByRole('slider',{name:'宅邸地图'})
  fireEvent.change(zoom,{target:{value:'180'}})
  expect(image.style.width).toBe('180%')
})

it('never mounts an image for an unavailable map',()=>{
  render(<Delivery details={{mechanics:[{kind:'map',map:'house',name:'House',available:false,regions:[]}],
    ui:{words:{mechanics:{pending:'尚未就绪'}}}}}/>)
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText('尚未就绪')).toBeTruthy()
})
