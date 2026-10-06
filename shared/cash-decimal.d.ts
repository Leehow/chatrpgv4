export interface Decimal {coefficient:bigint;exponent:number}
export function normalize(value:Decimal):Decimal;
export function power(exponent:number):bigint;
export function decimalSpelling(text:unknown):Decimal|undefined;
export function addCash(left:Decimal,right:Decimal):Decimal;
export function multiplyCash(left:Decimal,right:Decimal):Decimal;
export function compareCash(left:Decimal,right:Decimal):number;
export function cashText(value:Decimal):string;
