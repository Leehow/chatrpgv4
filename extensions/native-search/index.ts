/** Generic Pi request/stream seam for provider-hosted search (contract 124.12). */
import {streamSimple as anthropicStream} from '@earendil-works/pi-ai/api/anthropic-messages';
import {nativeSearchStream, nativeSearchState, clearNativeSearchState, setNativeSearchPolicy, nativeSearchPayload, nativeSearchEvent, NATIVE_SEARCH_ENTRY} from '../../runtime/native-search.js';
export default function (pi: any) {
  // A stream-only override keeps Pi's built-in model catalog and authentication.
  pi.registerProvider('anthropic', {api:'anthropic-messages', streamSimple:nativeSearchStream(anthropicStream,
    {api:'anthropic-messages',streamSimple:anthropicStream,resume:true})});
  let campaign: string | undefined;
  pi.events.on('coc:native-search-policy', (policy: any) => {
    if (policy?.campaign && policy.campaign === campaign) setNativeSearchPolicy(policy);
    else setNativeSearchPolicy(undefined);
  });
  pi.events.on('coc:table-open', (table: any) => {
    if (campaign !== table?.campaign) clearNativeSearchState();
    campaign = table?.campaign;
  });
  pi.on('session_start', (_event: any, ctx: any) => {
    clearNativeSearchState();
    const state = nativeSearchState();
    const entries = ctx.sessionManager?.getBranch?.() ?? [];
    state.records = entries.filter((row: any) => row.type === 'custom' && row.customType === NATIVE_SEARCH_ENTRY && row.data?.content)
      .map((row: any) => row.data).slice(-64);
    state.persist = (record: any) => pi.appendEntry(NATIVE_SEARCH_ENTRY, record);
    state.report = (row: any) => pi.events.emit('coc:native-search-event', {lane: 'native-search', ...row});
  });
  pi.on('before_provider_request', (event: any, ctx: any) => nativeSearchPayload(event.payload, ctx.model));
  pi.on('provider_stream_event', (event: any) => nativeSearchEvent(event));
  pi.on('agent_end', () => setNativeSearchPolicy(undefined));
  pi.on('session_shutdown', () => {clearNativeSearchState(); campaign = undefined;});
}
