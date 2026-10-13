/** Native process and fixture utilities for migrated report/controller unit tests. */
import {round as numericRound} from '../play/numeric.ts';
import {pyEqual as exactEqual} from './npc-support.ts';
import { spawnSync } from 'node:child_process';
export const subprocess = { run: (args: string[], options: any = {}) => { const r = spawnSync(args[0], args.slice(1), { cwd: options.cwd, encoding: 'utf8', env: { ...process.env, ...options.env } }); if (r.error)
        throw r.error; if (options.check && r.status !== 0)
        throw Error(`Process failed ${r.status}: ${r.stderr}`); return { stdout: r.stdout, stderr: r.stderr, returncode: r.status }; } };
export const sys = { executable: process.execPath };
export const reversed = (v: any[]) => [...v].reverse();
export const nativeAssertions = {approx:(value:any,options:any={})=>({nativeApproximation:true,value,relative:options.rel??1e-6,absolute:options.abs??1e-12,nanOk:options.nan_ok??false})};
function approximationEqual(actual:any,expected:any,policy:any):boolean{
  if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((value,index)=>approximationEqual(actual[index],value,policy));
  if(expected&&typeof expected==='object')return actual&&typeof actual==='object'&&exactEqual(Object.keys(actual).sort(),Object.keys(expected).sort())&&Object.keys(expected).every(key=>approximationEqual(actual[key],expected[key],policy));
  if(typeof actual!=='number'||typeof expected!=='number')return exactEqual(actual,expected);
  if(Number.isNaN(expected))return policy.nanOk&&Number.isNaN(actual);
  if(!Number.isFinite(expected))return actual===expected;
  return actual===expected||Number.isFinite(actual)&&Math.abs(actual-expected)<=Math.max(policy.absolute,policy.relative*Math.abs(expected));
}
export function pyEqual(actual:any,expected:any):boolean{
  if(expected?.nativeApproximation)return approximationEqual(actual,expected.value,expected);
  if(actual?.nativeApproximation)return pyEqual(expected,actual);
  if(Array.isArray(actual)&&Array.isArray(expected))return actual.length===expected.length&&actual.every((value,index)=>pyEqual(value,expected[index]));
  return exactEqual(actual,expected);
}
export const round = numericRound;
export function captureOutput(t: any) { let out = '', err = ''; const oldLog = console.log, oldError = console.error; console.log = (...a: any[]) => { out += a.join(' ') + '\n'; }; console.error = (...a: any[]) => { err += a.join(' ') + '\n'; }; t.after(() => { console.log = oldLog; console.error = oldError; }); return { readouterr() { const result = { out, err }; out = ''; err = ''; return result; } }; }
