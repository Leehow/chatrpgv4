/** Literal numeral/unit candidates only. Jev, never this lexer, decides whether an interval is chosen now. */
export interface DeclaredDuration {text:string;start:number;end:number;minutes:number}
const DIGITS='\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d';
const POWERS:Record<string,number>={'\u5341':10,'\u767e':100,'\u5343':1000};
const SMALL=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const words=`(?:${SMALL.join('|')}|(?:${TENS.join('|')})(?:[- ](?:${SMALL.slice(1,10).join('|')}))?)`;
const quantity=`(?:[0-9]+(?:\\.[0-9]+)?|[${DIGITS}\\u5341\\u767e\\u5343]+|${words})`;
const unit='(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|\\u5206\\u949f|\\u5206\\u9418|(?:\\u4e2a|\\u500b)?\\u5c0f\\u65f6|(?:\\u4e2a|\\u500b)?\\u5c0f\\u6642|\\u5929|\\u79d2)';
const syntax=new RegExp(`(${quantity})\\s*(${unit})`,'giu');
function numeral(text:string):number|undefined {
    if(/^[0-9]+(?:\.[0-9]+)?$/.test(text))return Number(text);
    const lower=text.toLowerCase(),small=SMALL.indexOf(lower);if(small>=0)return small;
    const parts=lower.split(/[- ]/),tens=TENS.indexOf(parts[0]);
    if(tens>=0)return (tens+2)*10+(parts[1]?SMALL.indexOf(parts[1]):0);
    const digit=(value:string)=>{const at=DIGITS.indexOf(value);return at<0?undefined:at<2?0:at===2?1:at<5?2:at-2;};
    if(Array.from(text).every(value=>digit(value)!==undefined))return Number(Array.from(text).map(digit).join(''));
    let total=0,pending:number|undefined,previous=10000,explicitGap=false;
    for(const value of text){const d=digit(value);if(d!==undefined){if(pending!==undefined&&pending!==0)return undefined;if(d===0)explicitGap=true;pending=d;continue;}
        const power=POWERS[value];if(!power||power>=previous)return undefined;
        total+=(pending??1)*power;previous=power;pending=undefined;explicitGap=false;
    }
    if(previous>=100&&pending&& !explicitGap)return undefined;
    return total+(pending??0);
}
function multiplier(unit:string):number {
    const word=unit.toLowerCase();
    if(/^(?:hours?|hrs?)$/.test(word)||/\u5c0f[\u65f6\u6642]/u.test(word))return 60;
    if(/^(?:days?)$/.test(word)||word==='\u5929')return 1440;
    if(/^(?:seconds?|secs?)$/.test(word)||word==='\u79d2')return 1/60;
    return 1;
}
export function declaredDurations(input:string):Record<string,DeclaredDuration> {
    const found:DeclaredDuration[]=[];
    // Bound the complete lexer input; never turn a partial source window into a different interval.
    if(input.length>16000)return {};
    syntax.lastIndex=0;
    for(let match=syntax.exec(input);match;match=syntax.exec(input)){
        const start=match.index,end=start+match[0].length,before=input[start-1]??'',after=input[end]??'';
        if(/[A-Za-z0-9_.:+\-/\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343]/u.test(before)||/[A-Za-z0-9_]/.test(after))continue;
        // Do not expose the supported tail of an unsupported larger numeral or fractional expression.
        if(/\b(?:hundred|thousand|million)\s+(?:and\s+)?$/iu.test(input.slice(0,start))
            ||/^\s*(?:and\s+)?(?:a\s+half|half)\b/iu.test(input.slice(end))||after==='\u534a')continue;
        const value=numeral(match[1]),minutes=value===undefined?NaN:value*multiplier(match[2]);
        found.push({text:match[0],start,end,minutes});
        if(found.length>16)return {};
    }
    // A compound interval is not either of its components. Unsupported syntax stays unbound.
    const compound=new Set<number>();
    for(let i=1;i<found.length;i++)if(/^(?:\s*(?:and|\u53c8|\u96f6)?\s*)$/iu.test(input.slice(found[i-1].end,found[i].start))){compound.add(i-1);compound.add(i);}
    return Object.fromEntries(found.filter((value,i)=>!compound.has(i)&&Number.isSafeInteger(value.minutes)&&value.minutes>=0).map((value,i)=>[`duration:${i}`,value]));
}
