/** Native adapters for legacy fixture spelling; benchmark and report logic stays in play modules. */
import * as nativeBench from '../play/bench.ts';
import * as nativePlayer from '../play/player.ts';
import * as nativeDriver from '../play/driver.ts';
import * as nativeMetrics from '../play/persona-metrics.ts';
import * as nativeReport from '../play/persona-report.ts';
import { pyMethod as baseMethod, Path, TestPath } from './npc-support.ts';
import { randomUUID } from 'node:crypto';
import { relative, isAbsolute } from 'node:path';
import { lstatSync, rmSync, readdirSync } from 'node:fs';
export const bench = new Proxy({ ...nativeBench }, { get(target: any, key) { if (key === 'campaign_dir')
        return (id: string) => Path(nativeBench.campaign_dir(id)); return key in nativeBench.runtime ? nativeBench.runtime[String(key)] : target[key]; }, set(target: any, key, value) { if (key in nativeBench.runtime)
        nativeBench.runtime[String(key)] = value;
    else
        target[key] = value; return true; } });
export const player_mod: any = { ...nativePlayer }, driver: any = { ...nativeDriver, run_dir: (id: string) => Path(nativeDriver.run_dir(id)) }, persona_metrics = nativeMetrics, persona_report = { ...nativeReport };
export const os = { environ: process.env }, uuid = { uuid4: () => ({ hex: randomUUID().replaceAll('-', '') }) };
export const iter = (values: any[]) => values[Symbol.iterator]();
export function next(it: Iterator<any>, fallback?: any) { const v = it.next(); if (v.done && arguments.length < 2)
    throw Error('Iterator exhausted'); return v.done ? fallback : v.value; }
export function _ScriptedPlayer(answers: any[]) { return { answers: [...answers], views: [] as any[], act(view: string) { this.views.push(view); return this.answers.length ? { ok: true, player_message: this.answers.shift(), private_eval: {} } : { ok: false, error: 'out of answers', player_message: null, private_eval: {} }; } }; }
export function pyMonkeypatch(t: any) { return { setattr(obj: any, key: string, value: any) { if (obj === nativePlayer.PersonaPlayer && key === '_prompt') {
        const old = obj.prototype[key];
        obj.prototype[key] = function (...args: any[]) { return value(this, ...args); };
        t.after(() => obj.prototype[key] = old);
        return;
    } const old = obj[key]; obj[key] = value; t.after(() => obj[key] = old); } }; }
export function resetPersona(t: any) { const saved = { ...nativeBench.runtime }, oldSleep = nativePlayer.time.sleep, oldPointer = driver.CURRENT_RUN_FILE; t.after(() => { Object.assign(nativeBench.runtime, saved); nativePlayer.time.sleep = oldSleep; driver.CURRENT_RUN_FILE = oldPointer; nativeBench._exhausted.clear(); }); }
export async function pyMethod(obj:any,name:string,args:any[]=[],kwargs:any={}){
 if(obj===bench&&name==='start_table'&&Object.hasOwn(kwargs,'launcher'))return obj[name](...args,kwargs.launcher);
 if(obj===player_mod&&name==='PersonaPlayer')return new nativePlayer.PersonaPlayer(args[0],args[1],kwargs);
 if(obj===persona_metrics&&name==='rate')return nativeMetrics.rate(args[0],kwargs.ok??args[1],kwargs.violation??args[2]);
 if(obj instanceof TestPath&&name==='glob'){const pattern=String(args[0]),parts=pattern.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),rx=new RegExp('^'+parts.join('.*')+'$');return readdirSync(String(obj)).sort().filter(x=>rx.test(x)).map(x=>Path(String(obj)+'/'+x));}
 if(obj instanceof TestPath&&name==='is_relative_to'){const rel=relative(String(args[0]),String(obj));return !rel.startsWith('..')&&!isAbsolute(rel);}
 if(obj instanceof TestPath&&name==='is_symlink')return lstatSync(String(obj)).isSymbolicLink();
 if(name==='rmtree'){rmSync(String(args[0]),{recursive:true,force:true});return;}
 if(typeof obj==='string'&&name==='rsplit'){const index=obj.lastIndexOf(args[0]);return index<0?[obj]:[obj.slice(0,index),obj.slice(index+args[0].length)];}
 return baseMethod(obj,name,args,kwargs);
}
