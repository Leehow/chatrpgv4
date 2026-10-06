export const EMBEDDED_ARGUMENTS: Readonly<Record<string, Readonly<Record<string,string>>>>;
export type PrefixStrip={field:string;prefix:string};
export function dialectPrefix(value:string,parameter:string):string|undefined;
export function stripDialectPrefixes(tool:string,args:unknown):{args:unknown;strips:PrefixStrip[]};
export function omitEmptyEmbeddedArguments(tool:string,args:unknown):{args:unknown;fields:string[]};
