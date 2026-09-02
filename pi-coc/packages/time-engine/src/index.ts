import type { DomainEvent, FictionTime, IdGenerator, JsonValue, Visibility } from "../../contracts/src/index.js";
export interface ScheduledEvent { scheduleId:string; dueAt:FictionTime; eventType:string; aggregateId:string; payload:JsonValue; visibility:Visibility; conditionKey?:string; interruptPolicy:"silent"|"after_action"|"interrupt_scene"; sourceRefs:DomainEvent["sourceRefs"]; }
export class TimeEngine {
  private scheduled=new Map<string,ScheduledEvent>();
  constructor(private readonly options:{idGenerator:IdGenerator;conditionEvaluator?:(key:string)=>boolean}){}
  schedule(event:ScheduledEvent):void { if(this.scheduled.has(event.scheduleId))throw new Error("Duplicate schedule"); this.scheduled.set(event.scheduleId,structuredClone(event)); }
  advance(before:FictionTime,seconds:number,causedBy:string[]):{before:FictionTime;after:FictionTime;timeEvent:DomainEvent;due:ScheduledEvent[]} {
    if(!Number.isInteger(seconds)||seconds<0)throw new Error("Invalid time advance");
    const after={epoch:before.epoch,instant:new Date(Date.parse(before.instant)+seconds*1000).toISOString()};
    const due=[...this.scheduled.values()].filter((e)=>e.dueAt.epoch===after.epoch&&Date.parse(e.dueAt.instant)<=Date.parse(after.instant))
      .filter((e)=>!e.conditionKey||(this.options.conditionEvaluator?.(e.conditionKey)??false)).sort((a,b)=>Date.parse(a.dueAt.instant)-Date.parse(b.dueAt.instant)||a.scheduleId.localeCompare(b.scheduleId));
    due.forEach((e)=>this.scheduled.delete(e.scheduleId));
    const timeEvent:DomainEvent={eventId:this.options.idGenerator.next("evt"),eventType:"TimeAdvanced",aggregateId:"fiction-clock",payload:{seconds,before:before.instant,after:after.instant},visibility:{scope:"public"},fictionTime:after,causedBy,ruleRefs:["pi-coc:time.advance"],sourceRefs:[]};
    return{before,after,timeEvent,due};
  }
  materializeDue(e:ScheduledEvent,time:FictionTime,causedBy:string[]):DomainEvent{return{eventId:this.options.idGenerator.next("evt"),eventType:e.eventType,aggregateId:e.aggregateId,payload:e.payload,visibility:e.visibility,fictionTime:time,causedBy,ruleRefs:["pi-coc:time.scheduled-event"],sourceRefs:e.sourceRefs};}
  temporalReset(from:FictionTime,anchor:FictionTime,carryPolicyId:string,causedBy:string[]):{next:FictionTime;event:DomainEvent}{
    const next={epoch:from.epoch+1,instant:anchor.instant};
    return{next,event:{eventId:this.options.idGenerator.next("evt"),eventType:"TemporalReset",aggregateId:"fiction-clock",payload:{fromEpoch:from.epoch,fromInstant:from.instant,toEpoch:next.epoch,anchorInstant:anchor.instant,carryPolicyId},visibility:{scope:"public"},fictionTime:next,causedBy,ruleRefs:["pi-coc:time.temporal-reset"],sourceRefs:[]}};
  }
}
