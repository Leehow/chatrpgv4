/** Diagnostic projection of closed review axes; never an intent or permission decision. */
import {KernelError} from './client.ts';
type Row=Record<string,any>;
const guidance={
    move:'Represent the selected route and final local position with {kind:"place",action:"move",to,via?,at?|spot?,relation?,additions?}. Reuse the actual current_position. A descriptive spot needs no fixture registration; a genuinely new room needs its own minimal place definition and qualified destination. Registration, NPC movement and time do not move the investigator.',
    feature:'Represent the selected physical fixture change with {kind:"place",action:"feature",to:"owning place",at:"exact feature",state?,passable?}. Register a missing fixture first with {kind:"place",action:"establish",additions:[{name:"owning place",features:[{name:"fixture",description:"observable appearance"}]}]} in the ordered output batch. A door is a feature, not a child place merely to name it. Registration and movement do not open or close it. State must follow the actual outcome; a real obstacle is not permission to invent success.',
    observation:'Represent the selected sensory contents with {kind:"place",action:"observe",to,sense,access,scope,facts,view?}. Use the actual committed or earlier proposed viewpoint and its logical sensory path. Preserve all actual facts; arrival, greetings and the surface description alone do not read the contents. A real blocked view has its reason and no target facts. Do not repeat an observation already settled for this input.',
} as const;
/** Formatting consumes the already reviewed enum, never player text or semantic keyword rules. */
export function locationCoverageError(coverage:Row,spatial:Row):KernelError {
    const corrections=(Object.keys(guidance) as (keyof typeof guidance)[]).flatMap(axis=>{
        const status=coverage.axes?.[axis];
        return status==='missing'||status==='uncertain'?[{axis,status,guidance:guidance[axis]}]:[];
    });
    const fix=['Nothing in this output proposal executed. Preserve the player declaration and prior successful receipts. Keep accounted but uncommitted steps in the corrected batch; do not replay settled operations.',
        ...(corrections.length?corrections.map(row=>(row.status==='uncertain'?'Verify the uncertain selection or outcome through the existing review; uncertainty grants no action. ':'')+row.guidance):
            ['The completion review was unavailable; do not infer a missing action or permission. Retain the actual state and use the ordinary supported recovery path.'])].join(' ');
    return new KernelError({code:'invalid_params',message:coverage.status==='answered'?'The selected spatial action is not accounted for by this decision':'The spatial decision completion could not be verified',fix,
        details:{reason:'place_decision_incomplete',cause:coverage.reason??'place_decision_incomplete',transaction_state:'uncommitted',before_execution:true,
            current_place:spatial.current_place,current_position:spatial.current_position,known_features:spatial.features.map((feature:Row)=>feature.name),
            ...(coverage.axes?{axes:coverage.axes}:{}),corrections}});
}
