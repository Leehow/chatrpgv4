/** Closed structural contracts shared by the model-facing tools and canonical kernel. */
import {Type} from 'typebox';

const nonblank=(description:string)=>Type.String({minLength:1,pattern:'\\S',description});
export const ClueEstablishment=Type.Object({summary:nonblank('New evidence discovered here, consistent with established causes and the holder knowledge; include how it was obtained. Existing authored clues use their names without establish. This is a campaign fact, not a source quotation.')},{additionalProperties:false});
export const PlaceEstablishment=Type.Object({summary:nonblank('Brief description of a new campaign place; preserve known causes and access conditions. This adds a place rather than replacing a registered source place.'),
    within:Type.Optional(Type.Union([nonblank('The containing registered place; omitted uses the current scene, null establishes no containing place'),Type.Null()]))},{additionalProperties:false});
export const REUNION_LINE_FIELDS=['background','reports','open_threads'] as const;
export const REUNION_MAX_LINES=4,REUNION_MAX_CHARACTERS=600;
const lines=()=>Type.Optional(Type.Array(Type.String({minLength:1,maxLength:REUNION_MAX_CHARACTERS,pattern:'\\S'}),{maxItems:REUNION_MAX_LINES}));
export const NpcReunion=Type.Object({background:lines(),reports:lines(),open_threads:lines(),extend:Type.Optional(Type.Boolean())},
    {additionalProperties:false,description:'At a real return encounter offered by the NPC view, establish modest compatible offstage continuity without simulation. These are English background, attributed reports and optional open threads; empty arrays establish a quiet interval. Preserve personality, facts and player decisions. This changes no location, items, money, skills, conditions or promise fulfillment. Keep reunion alone in its NPC effect. Existing interval history is immutable; extend true only appends genuinely new compatible detail, without copying old lines. Narrate naturally in play_language.'});
export const DocumentDivision=Type.Object({action:Type.Literal('divide'),
    part_text:Type.String({maxLength:64000,description:'Complete current text on the separated document-bearing part, in play_language'}),
    remainder_text:Type.String({maxLength:64000,description:'Complete current text on the original document-bearing remainder, in play_language'})},{additionalProperties:false});
