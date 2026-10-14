/** Native driver transport probes; all event fixtures remain unit evidence only. */
import * as native from '../play/driver.ts';
import { pyMethod as baseMethod } from './npc-support.ts';
export async function replay_turn(events: any[], timeout = 10, setup_transport = false) { const old = native.time.monotonic, clock = { value: 0 }, pending = [...events]; native.time.monotonic = () => clock.value; try {
    const daemon = Object.create(native.Daemon.prototype);
    daemon.turn_count = 0;
    daemon.setup_transport = setup_transport;
    daemon.pi = { begin_turn: () => ({ get(seconds: number) { if (!pending.length || pending[0][0] > clock.value + seconds) {
                clock.value += seconds;
                throw new native.QueueEmpty();
            } const [at, event] = pending.shift()!; clock.value = at; return { ...event, _recv_mono: at }; } }), end_turn() { }, alive: () => true, call: () => ({ success: true }) };
    daemon._await_quiet = () => true;
    daemon._finalize_turn = (n: any, text: any, start: any, mono: any, tools: any, final: any, settled: any, reason: any, options: any = {}) => ({ final_text: final, settle_class: settled, stop_reason: reason, wall_seconds: clock.value, tools, ...options });
    return await daemon._run_turn('Continue investigating.', timeout);
}
finally {
    native.time.monotonic = old;
} }
export const SimpleNamespace = (v: any) => v;
export const importlib = { util: { spec_from_file_location: () => ({ loader: { exec_module() { } } }), module_from_spec: () => new Proxy({ ...native, Daemon: { __new__: () => Object.create(native.Daemon.prototype) } }, { set(target: any, key, value) { if (key === 'rpc_call')
                native.runtime.rpcCall = value;
            else if (key === 'PiProcess')
                native.runtime.processFactory = value;
            else if (key === 'time')
                native.time.monotonic = value.monotonic;
            else
                target[key] = value; return true; } }) } };
export function resetDriver(t: any) { const clock = native.time.monotonic, factory = native.runtime.processFactory, rpc = native.runtime.rpcCall; t.after(() => { native.time.monotonic = clock; native.runtime.processFactory = factory; native.runtime.rpcCall = rpc; }); }
export async function pyMethod(obj: any, name: string, args: any[] = [], kwargs: any = {}) { if (typeof obj === 'string' && name === 'count')
    return obj.split(args[0]).length - 1; if (typeof obj === 'string' && name === 'index')
    return obj.indexOf(args[0]); return baseMethod(obj, name, args, kwargs); }
export async function continuous_readiness_probe(_monkeypatch: any, states: any[], deadline = 10, opening_backlog = false) { const old = native.time.monotonic, clock = { value: 0 }, calls: any[] = [], polls: number[] = [], supplied = [...states], last = states.at(-1); let accepted = false; const prior = opening_backlog ? [{ type: 'agent_start', _recv_mono: 2 }, { type: 'message_update', _recv_mono: 2.1, assistantMessageEvent: { type: 'text_delta', delta: 'Old opening' } }, { type: 'agent_settled', _recv_mono: 2.2 }] : [], work = [...prior, { type: 'agent_start' }, { type: 'message_end', message: { role: 'custom', customType: 'coc-delivery', display: true, content: 'Fixture delivery', details: { coc_delivery: true } } }, { type: 'agent_settled' }]; native.time.monotonic = () => clock.value; try {
    const daemon = Object.create(native.Daemon.prototype);
    daemon.turn_count = 0;
    daemon.pi = { begin_turn: () => ({ get(timeout: number) { if (accepted) {
                clock.value += Math.min(.1, timeout);
                if (work.length)
                    return work.shift();
                clock.value += Math.max(0, timeout - .1);
                throw new native.QueueEmpty();
            } clock.value += Math.min(.333, timeout); return { type: 'entry_appended', entry: { customType: 'coc-telemetry', data: { kind: 'background-poll' } } }; } }), end_turn: () => calls.push(['end_turn', clock.value]), alive: () => true, call(req: any) { calls.push([req.type, clock.value]); if (req.type === 'get_state') {
            polls.push(clock.value);
            return supplied.length ? supplied.shift() : last;
        } if (req.type === 'prompt') {
            accepted = true;
            clock.value += .2;
        } return { success: true }; } };
    daemon._finalize_turn = (n: any, text: any, start: any, mono: any, tools: any, final: any, settled: any, reason: any, kw: any = {}) => ({ settle_class: settled, stop_reason: reason, wall_seconds: clock.value, final_text: final, ...kw });
    const result = await daemon._run_turn('Fixture input', deadline);
    return [native, clock, calls, polls, result];
}
finally {
    native.time.monotonic = old;
} }
