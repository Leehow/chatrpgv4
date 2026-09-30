// @vitest-environment jsdom
import React from 'react';
import {render, screen, fireEvent, cleanup, waitFor} from '@testing-library/react';
import {afterEach, test, expect, vi} from 'vitest';
import {createComponent} from '../../../../pipicoc/mods-panel.js';
import {ui} from './fixtures/coc-ui-words';
const Panel = createComponent(React);
afterEach(cleanup);
const key = 'ext.coc-keeper.exaApiKey';
const row = {id:'historical-reference', version:'1.0.0', name:'Historical Reference', author:'PipiCOC', compatible:true,
  description:'Historical references', settings:{}, default_enabled:true, active:{enabled:false,version:'1.0.0'},
  host_settings:[{slot:'exa_api_key',key,format:'secret',caption:'exaKey'}]};
test('right-panel secret saves to app settings, never campaign configuration, even without a campaign',async()=>{
  const invoke=vi.fn(async()=>({ok:true,data:{ui:ui('en'),mods:[row]}}));
  const update=vi.fn(async()=>({ok:true,data:{}})), get=vi.fn(async()=>({[key]:true}));
  render(<Panel api={{invoke,settings:{get,update}}}/>);
  const input=await screen.findByLabelText('Exa API key') as HTMLInputElement;
  await screen.findByText('Credential saved'); expect(input.type).toBe('password');expect(input.value).toBe('');
  fireEvent.change(input,{target:{value:'new-test-credential'}});fireEvent.click(screen.getByText('Save key'));
  await waitFor(()=>expect(update).toHaveBeenCalledWith({[key]:'new-test-credential'}));
  await waitFor(()=>expect(input.value).toBe(''));
  expect(invoke).not.toHaveBeenCalledWith('mods.configure',expect.anything());
  fireEvent.click(screen.getByText('Clear key'));
  await waitFor(()=>expect(update).toHaveBeenCalledWith({[key]:null}));
});
test('provider errors cannot echo submitted credentials in the panel',async()=>{
  const invoke=vi.fn(async()=>({ok:true,data:{ui:ui('en'),mods:[row]}}));
  const update=vi.fn(async()=>{throw new Error('leaked-test-credential');});
  render(<Panel api={{invoke,settings:{get:async()=>({}),update}}}/>);
  const input=await screen.findByLabelText('Exa API key');await screen.findByText('Credential not configured');
  fireEvent.change(input,{target:{value:'leaked-test-credential'}});fireEvent.click(screen.getByText('Save key'));
  await screen.findByText('Unable to save the credential. Please retry.');
  expect(screen.queryByText('leaked-test-credential')).toBeNull();
});
