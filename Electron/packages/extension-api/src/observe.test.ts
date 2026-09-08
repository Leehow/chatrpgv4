import {expect,it,vi} from 'vitest';
import {createExtensionHostAPI} from './index.js';

it('shares one polling query per host, extension and session and stops without subscribers',async()=>{
  vi.useFakeTimers();
  try {
    const invokeExtension=vi.fn(async()=>({ok:true as const,data:{state:'reading'}}));
    const host={invokeExtension};
    const options={host,extensionId:'source-reader',sessionId:'one',capabilities:['invoke.agent']};
    const first=createExtensionHostAPI(options).observe!('status',{});
    const second=createExtensionHostAPI(options).observe!('status',{});
    expect(first).toBe(second);
    const a=vi.fn(),b=vi.fn(),unsubA=first.subscribe(a),unsubB=second.subscribe(b);
    await first.refresh();expect(invokeExtension).toHaveBeenCalledTimes(1);
    const snapshot=first.snapshot();
    await vi.advanceTimersByTimeAsync(1500);
    expect(invokeExtension).toHaveBeenCalledTimes(2);expect(first.snapshot()).toBe(snapshot);
    expect(a).toHaveBeenCalledTimes(1);expect(b).toHaveBeenCalledTimes(1);
    unsubA();unsubB();await vi.advanceTimersByTimeAsync(5000);
    expect(invokeExtension).toHaveBeenCalledTimes(2);
    expect(createExtensionHostAPI({...options,sessionId:'two'}).observe!('status',{})).not.toBe(first);
    expect(createExtensionHostAPI({...options,capabilities:[]}).observe).toBeUndefined();
  }finally{vi.useRealTimers();}
});
