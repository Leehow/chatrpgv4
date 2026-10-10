// @vitest-environment jsdom
import React from 'react';
import {render, screen, cleanup} from '@testing-library/react';
import {afterEach, test, expect, vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/mods-panel.js';
import {ui} from './fixtures/coc-ui-words';
const Panel = createComponent(React);
afterEach(cleanup);
test('native Historical Reference exposes its switch without external search credentials',async()=>{
 const settings={get:vi.fn(),update:vi.fn()};
 const row={id:'historical-reference',version:'1.3.0',name:'Historical Reference',author:'PipiCOC',compatible:true,description:'Native historical references',settings:{},default_enabled:true,active:{enabled:true,version:'1.3.0'},host_settings:[]};
 render(<Panel api={{invoke:vi.fn(async()=>({ok:true,data:{ui:ui('en'),mods:[row]}})),settings}}/>);
 await screen.findByText('Historical Reference');
 expect(screen.queryByLabelText('Exa API key')).toBeNull();
 expect(settings.get).not.toHaveBeenCalled();
 expect(settings.update).not.toHaveBeenCalled();
});
