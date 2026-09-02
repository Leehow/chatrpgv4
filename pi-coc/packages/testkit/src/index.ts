import type { Clock, IdGenerator } from "../../contracts/src/index.js";
export class SequenceIds implements IdGenerator{private value=0;next(prefix:string):string{this.value+=1;return`${prefix}:${this.value.toString().padStart(4,"0")}`;}}
export class FixedClock implements Clock{constructor(private readonly value:string){}now():string{return this.value;}}
export function assert(condition:unknown,message="Assertion failed"):asserts condition{if(!condition)throw new Error(message);}
export function equal<T>(actual:T,expected:T,message?:string):void{if(!Object.is(actual,expected))throw new Error(message??`Expected ${String(expected)}, received ${String(actual)}`);}
export async function rejects(fn:()=>unknown|Promise<unknown>,pattern?:RegExp):Promise<void>{try{await fn();}catch(error){if(pattern&&!pattern.test(String(error)))throw error;return;}throw new Error("Expected rejection");}
