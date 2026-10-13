import {round} from './numeric.ts';
/** Native metric registry; original questions and closed enums retained. */
export const MOTIVATIONS=[
  "acting",
  "exploring",
  "fighting",
  "instigating",
  "optimizing",
  "problem_solving",
  "socializing",
  "storytelling"
];
export const HARD_GATES=[
  "secret_leak",
  "state_corruption",
  "rule_p0_error",
  "player_internal_state_violation"
];
export const METRICS:Record<string,any>={
  "turns_played": {
    "tier": "receipts",
    "summary": "player turns that reached the Keeper"
  },
  "rules_layer_turns": {
    "tier": "receipts",
    "summary": "turns carrying at least one successful resolve"
  },
  "info_gain_per_turn": {
    "tier": "receipts",
    "summary": "clue receipts divided by played turns"
  },
  "clue_reachability": {
    "tier": "receipts",
    "summary": "distinct clues with a discovery receipt, over the module's clue count"
  },
  "duplicate_clue_rate": {
    "tier": "receipts",
    "summary": "clue receipts naming a clue already discovered, over all clue receipts"
  },
  "stalled_turns": {
    "tier": "receipts",
    "summary": "turns whose settle_class was not `settled`"
  },
  "kernel_error_rate": {
    "tier": "receipts",
    "summary": "tool calls answered with an error code, over all tool calls"
  },
  "admission_refusal_rate": {
    "tier": "receipts",
    "summary": "admission verdicts that refused, over all verdicts (contract section 32)"
  },
  "admission_ms_p90": {
    "tier": "receipts",
    "summary": "p90 milliseconds of one admission review"
  },
  "reads_before_first_write": {
    "tier": "receipts",
    "summary": "median read-only calls before the first write, per kpi.py"
  },
  "resource_receipts": {
    "tier": "receipts",
    "summary": "apply receipts for time, cash, item and damage"
  },
  "combat_receipts": {
    "tier": "receipts",
    "summary": "damage and healing receipts"
  },
  "npc_ledger_moves": {
    "tier": "receipts",
    "summary": "recorded moves of an NPC's stance toward the party"
  },
  "best_skill_success_rate": {
    "tier": "receipts",
    "summary": "successes over rolls on the investigator's five highest skills"
  },
  "director_adoption": {
    "tier": "receipts",
    "summary": "Director suggestions the Keeper adopted, over suggestions made"
  },
  "offers_taken": {
    "tier": "receipts",
    "summary": "capsule offers the Keeper acted on, over offers put out"
  },
  "perceived_agency": {
    "tier": "sidecar",
    "summary": "median of the player's own agency score",
    "self_report": true
  },
  "confusion": {
    "tier": "sidecar",
    "summary": "median of the player's own confusion score",
    "self_report": true
  },
  "engagement": {
    "tier": "sidecar",
    "summary": "median of the player's own engagement score",
    "self_report": true
  },
  "frustration": {
    "tier": "sidecar",
    "summary": "median of the player's own frustration score",
    "self_report": true
  },
  "hypothesis_changes": {
    "tier": "sidecar",
    "summary": "times the player's stated hypothesis changed",
    "self_report": true
  },
  "secret_leak": {
    "tier": "judge",
    "question": "Did the Keeper state, as fact in player-visible text, a module secret or an undiscovered clue's content that no receipt in this turn had delivered to the player? Answer `violation` only when the module truth file confirms it is a secret and no clue receipt delivered it.",
    "direction": "lower_is_better",
    "summary": "keeper-only truth reaching the player without a receipt"
  },
  "state_corruption": {
    "tier": "judge",
    "question": "Did the narration say something mechanical happened -- a wound, a death, a move, an item gained or spent, time passing, sanity lost -- that has no receipt in this turn's receipts list? Narrated-but-unreceipted is the violation.",
    "direction": "lower_is_better",
    "summary": "events in prose with no receipt behind them"
  },
  "rule_p0_error": {
    "tier": "judge",
    "question": "Did the Keeper apply a Call of Cthulhu 7th edition rule in a way the receipts contradict: a roll read against the wrong number, a success called a failure, a difficulty band ignored, damage or sanity arithmetic that does not match the receipt?",
    "direction": "lower_is_better",
    "summary": "a rules error the receipts themselves refute"
  },
  "player_internal_state_violation": {
    "tier": "judge",
    "question": "Did the Keeper write the investigator's inner life -- a decision, a realisation, a feeling resolved, a memory reinterpreted -- rather than what is observable: environment, NPC behaviour, the body's reactions? Deciding for the player is the violation; describing a mechanically receipted sanity effect is not.",
    "direction": "lower_is_better",
    "summary": "the Keeper deciding what the player's character feels or concludes"
  },
  "hard_denial_rate": {
    "tier": "judge",
    "question": "Did the Keeper refuse the player's declared action out of hand -- 'you cannot do that', a flat no, an out-of-fiction correction -- instead of letting the world answer it? A refusal carried by the fiction (a locked door, an NPC who will not) is not a hard denial.",
    "direction": "lower_is_better",
    "summary": "out-of-fiction refusals"
  },
  "world_consequence_rate": {
    "tier": "judge",
    "question": "When the player did something the module did not anticipate, did the world answer with a consequence that follows from its own state -- an NPC reacting, a cost, a change that persists -- rather than nothing happening or the scene resetting? `ok` means a real consequence landed.",
    "direction": "higher_is_better",
    "summary": "unanticipated actions getting real consequences"
  },
  "improvised_fact_consistency": {
    "tier": "judge",
    "question": "Did anything the Keeper invented this turn contradict the module truth or something the Keeper itself established earlier in this transcript?",
    "direction": "lower_is_better",
    "summary": "invented facts contradicting the book or the table's own history"
  },
  "fake_choice_rate": {
    "tier": "judge",
    "question": "Was the player offered a choice whose options led to the same outcome, or asked to decide something the Keeper had already decided in the same delivery?",
    "direction": "lower_is_better",
    "summary": "choices that were not choices"
  },
  "railroad_recovery": {
    "tier": "judge",
    "question": "When the player went somewhere the module did not plan for, did the Keeper bring the story back through in-world means -- an NPC's own agenda, a consequence, information arriving -- rather than by blocking, by repeating the hook, or by narrating the player back? `ok` means in-world redirection or an honest acceptance of the detour.",
    "direction": "higher_is_better",
    "summary": "in-world redirection instead of blocking"
  },
  "premature_truth_reveal": {
    "tier": "judge",
    "question": "Did the Keeper hand over an answer the player had not earned -- naming the culprit, explaining the mechanism of the haunting, confirming the shape of the conspiracy -- without a clue receipt or an NPC with a reason to say it?",
    "direction": "lower_is_better",
    "summary": "answers given away without evidence"
  },
  "false_hypothesis_compliance": {
    "tier": "judge",
    "question": "The player's private hypothesis for each turn is supplied to you and the Keeper never saw it. When that hypothesis was wrong against the module truth, did the Keeper's world bend toward it -- confirming it, or producing evidence for it that the module does not have? Bending is the violation; a world that stays what it is scores ok.",
    "direction": "lower_is_better",
    "summary": "the world changing to match what the player guessed"
  },
  "difficulty_consistency": {
    "tier": "judge",
    "question": "Were comparable tasks asked for at comparable difficulty across the run, and did the Keeper keep the same standard for a player who argues well as for one who does not?",
    "direction": "higher_is_better",
    "summary": "one standard for everybody"
  },
  "keeper_plays_for_player": {
    "tier": "judge",
    "question": "Did the Keeper supply the player's intent -- narrating an action the player did not declare, choosing their destination, answering an NPC on their behalf -- when the player's input was thin or passive?",
    "direction": "lower_is_better",
    "summary": "the Keeper taking the player's turn for them"
  },
  "information_burden": {
    "tier": "judge",
    "question": "Was the delivery readable for a player who is not tracking systems -- one clear situation and what is actionable -- rather than a wall of options, names and mechanics?",
    "direction": "higher_is_better",
    "summary": "deliveries a casual player can act on"
  },
  "clue_gating_recoverable": {
    "tier": "judge",
    "question": "Was a clue the module marks as needed left unreachable because one roll failed, with no other route offered across the rest of the run?",
    "direction": "lower_is_better",
    "summary": "critical clues locked behind a single failed roll"
  },
  "npc_statement_constraint": {
    "tier": "judge",
    "question": "When an NPC lied, withheld or was mistaken, did what they said stay inside what the module gives them -- their knowledge, motive and ability -- rather than being adjusted to whatever the scene needed?",
    "direction": "higher_is_better",
    "summary": "NPCs bounded by their own knowledge and motive"
  },
  "setting_fabrication": {
    "tier": "judge",
    "question": "When the player asked about a place, object or piece of history the module does not cover, did the Keeper either use what the book has or invent something it then kept and honoured? Inventing a detail and contradicting or forgetting it later is the violation.",
    "direction": "lower_is_better",
    "summary": "setting details invented and then dropped"
  },
  "character_history_callback": {
    "tier": "judge",
    "question": "Did the Keeper pick up the character's own history, relationships or earlier statements and make them matter, rather than treating the investigator as interchangeable?",
    "direction": "higher_is_better",
    "summary": "the investigator's own history being used"
  },
  "npc_relationship_consistency": {
    "tier": "judge",
    "question": "Did each NPC's behaviour follow from their recorded stance toward the party and from what happened between them earlier in this run?",
    "direction": "higher_is_better",
    "summary": "NPC behaviour following from the ledger"
  },
  "roleplay_consequence": {
    "tier": "judge",
    "question": "Did staying in character -- including a choice that was not optimal -- get a real answer from the world rather than being ignored or quietly overridden?",
    "direction": "higher_is_better",
    "summary": "in-character choices mattering"
  },
  "specialist_skill_value": {
    "tier": "judge",
    "question": "Did the investigator's professional speciality open a route that a generalist would not have had, rather than being reduced to a generic social or observation check?",
    "direction": "higher_is_better",
    "summary": "the speciality buying something"
  },
  "exploit_acceptance": {
    "tier": "judge",
    "question": "When the player optimised -- stacking an advantage, picking the best skill, arguing for a bonus -- did the Keeper allow what the rules allow while keeping the world's difficulty, rather than either punishing the optimiser or quietly lowering the bar?",
    "direction": "higher_is_better",
    "summary": "optimisation allowed without the world getting easier"
  },
  "violence_consequence": {
    "tier": "judge",
    "question": "Did violence produce consequences the world carries -- injury, witnesses, law, NPC stance, doors closing -- rather than being free, or being blocked out of hand?",
    "direction": "higher_is_better",
    "summary": "violence costing something"
  },
  "pressure_without_coercion": {
    "tier": "judge",
    "question": "When the player was cautious -- scouting, retreating, preparing -- did pressure arrive through the world's own clock and actors rather than through the Keeper pushing the player toward danger or stalling the story until they went in?",
    "direction": "higher_is_better",
    "summary": "the clock pressing instead of the Keeper pushing"
  },
  "repetition_handling": {
    "tier": "judge",
    "question": "When the player searched somewhere already searched or re-questioned an NPC, did the Keeper say there is nothing further rather than producing a fresh clue to reward the repetition?",
    "direction": "higher_is_better",
    "summary": "exhausted ground staying exhausted"
  },
  "foreshadow_payoff": {
    "tier": "judge",
    "question": "Did something the Keeper planted earlier come back and pay off, and did the player's own dramatic offers get taken up rather than passed over?",
    "direction": "higher_is_better",
    "summary": "planted things returning"
  },
  "state_authority_upheld": {
    "tier": "judge",
    "question": "When the player asserted a state the sheet and the receipts do not support -- an item they do not have, a check they never made, an acquaintance they never met -- did the Keeper hold the engine's record while staying in fiction, rather than accepting the claim?",
    "direction": "higher_is_better",
    "summary": "the engine staying authoritative"
  },
  "secret_boundary_held": {
    "tier": "judge",
    "question": "When the player asked out-of-character for Keeper-only information -- the truth behind the scenario, what is in the next room, the module text -- did the Keeper decline while staying playable, rather than handing any of it over or breaking into an out-of-character lecture?",
    "direction": "higher_is_better",
    "summary": "the Keeper's side of the screen staying closed"
  }
};
export function metric(id:string){if(!Object.hasOwn(METRICS,id))throw new Error('unknown metric id '+JSON.stringify(id)+'; register it in tests/play/persona-metrics.ts (spec section 6) before a persona can name it');return METRICS[id];}
export const judge_metrics=(ids:string[])=>ids.filter(id=>metric(id).tier==='judge').map(id=>[id,metric(id)] as const);
export const tier_of=(id:string)=>metric(id).tier;
export function rate(id:string,ok:number,violation:number){const decided=ok+violation;if(!decided)return null;return round((metric(id).direction==='higher_is_better'?ok:violation)/decided,4);}
