import type { ContextCapsule, ModelReceipt, NarrationDraft, NarrativeFrame, TurnPlan, VerificationReport } from "../../contracts/src/index.js";
export interface LaneResult<T>{value:T;receipt:ModelReceipt;}
export interface DirectorPort{propose(capsule:ContextCapsule):Promise<LaneResult<TurnPlan>>;}
export interface NarratorPort{render(frame:NarrativeFrame):Promise<LaneResult<NarrationDraft>>;}
export interface VerifierPort{verify(frame:NarrativeFrame,draft:NarrationDraft):Promise<LaneResult<VerificationReport>>;}
export interface StructuredModelRequest<TInput>{lane:"director"|"narrator"|"verifier";systemContract:string;input:TInput;outputSchemaId:string;}
export interface StructuredModelClient{call<TInput,TOutput>(request:StructuredModelRequest<TInput>):Promise<LaneResult<TOutput>>;}
