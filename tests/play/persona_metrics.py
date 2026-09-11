#!/usr/bin/env python3
"""tests/play/persona_metrics.py -- the metric registry for player-persona-suite-v1.

See docs/specs/player-persona-benchmark.md section 6. Every number a persona report
prints is registered here with the tier it comes from, so no metric can appear that
nobody can explain:

    receipts  deterministic, read out of .coc/campaigns/<id>/{telemetry.jsonl,turns/*.json}
    sidecar   the persona agent's own private_eval -- self-report, never ground truth
    judge     a semantic question, answered by a model with a turn citation, because
              "was that a hard denial?" is an open semantic question and this repo does
              not answer those with word lists (Agents.md)

A persona may only name metric ids that exist here; tests/play/personas loading fails
otherwise. Judge metrics carry the exact English question the judge lane is asked and a
direction, so `rate` means one thing per metric:

    lower_is_better   rate = violations / (ok + violations)
    higher_is_better  rate = ok / (ok + violations)

`not_exercised` turns never enter a rate -- a persona that never provoked the behaviour
scores nothing rather than scoring well.

Only the standard library is used.
"""
from __future__ import annotations

from typing import Any

#: The 2024 DMG activity set (spec section 4). A closed enum, not a classifier.
MOTIVATIONS = (
    "acting", "exploring", "fighting", "instigating",
    "optimizing", "problem_solving", "socializing", "storytelling",
)

#: Hard gates: any violation marks the run red regardless of every other number.
HARD_GATES = (
    "secret_leak", "state_corruption", "rule_p0_error", "player_internal_state_violation",
)


def _receipt(summary: str) -> dict[str, Any]:
    return {"tier": "receipts", "summary": summary}


def _sidecar(summary: str) -> dict[str, Any]:
    return {"tier": "sidecar", "summary": summary, "self_report": True}


def _judge(question: str, direction: str, summary: str) -> dict[str, Any]:
    assert direction in ("lower_is_better", "higher_is_better")
    return {"tier": "judge", "question": question, "direction": direction, "summary": summary}


METRICS: dict[str, dict[str, Any]] = {
    # ---- receipts ---------------------------------------------------------
    "turns_played": _receipt("player turns that reached the Keeper"),
    "rules_layer_turns": _receipt("turns carrying at least one successful resolve"),
    "info_gain_per_turn": _receipt("clue receipts divided by played turns"),
    "clue_reachability": _receipt("distinct clues with a discovery receipt, over the module's clue count"),
    "duplicate_clue_rate": _receipt("clue receipts naming a clue already discovered, over all clue receipts"),
    "stalled_turns": _receipt("turns whose settle_class was not `settled`"),
    "kernel_error_rate": _receipt("tool calls answered with an error code, over all tool calls"),
    "admission_refusal_rate": _receipt("admission verdicts that refused, over all verdicts (contract section 32)"),
    "admission_ms_p90": _receipt("p90 milliseconds of one admission review"),
    "reads_before_first_write": _receipt("median read-only calls before the first write, per kpi.py"),
    "resource_receipts": _receipt("apply receipts for time, cash, item and damage"),
    "combat_receipts": _receipt("damage and healing receipts"),
    "npc_ledger_moves": _receipt("recorded moves of an NPC's stance toward the party"),
    "best_skill_success_rate": _receipt("successes over rolls on the investigator's five highest skills"),
    "director_adoption": _receipt("Director suggestions the Keeper adopted, over suggestions made"),
    "offers_taken": _receipt("capsule offers the Keeper acted on, over offers put out"),

    # ---- sidecar ----------------------------------------------------------
    "perceived_agency": _sidecar("median of the player's own agency score"),
    "confusion": _sidecar("median of the player's own confusion score"),
    "engagement": _sidecar("median of the player's own engagement score"),
    "frustration": _sidecar("median of the player's own frustration score"),
    "hypothesis_changes": _sidecar("times the player's stated hypothesis changed"),

    # ---- judge: hard gates ------------------------------------------------
    "secret_leak": _judge(
        "Did the Keeper state, as fact in player-visible text, a module secret or an undiscovered "
        "clue's content that no receipt in this turn had delivered to the player? Answer `violation` "
        "only when the module truth file confirms it is a secret and no clue receipt delivered it.",
        "lower_is_better", "keeper-only truth reaching the player without a receipt"),
    "state_corruption": _judge(
        "Did the narration say something mechanical happened -- a wound, a death, a move, an item "
        "gained or spent, time passing, sanity lost -- that has no receipt in this turn's receipts "
        "list? Narrated-but-unreceipted is the violation.",
        "lower_is_better", "events in prose with no receipt behind them"),
    "rule_p0_error": _judge(
        "Did the Keeper apply a Call of Cthulhu 7th edition rule in a way the receipts contradict: "
        "a roll read against the wrong number, a success called a failure, a difficulty band ignored, "
        "damage or sanity arithmetic that does not match the receipt?",
        "lower_is_better", "a rules error the receipts themselves refute"),
    "player_internal_state_violation": _judge(
        "Did the Keeper write the investigator's inner life -- a decision, a realisation, a feeling "
        "resolved, a memory reinterpreted -- rather than what is observable: environment, NPC "
        "behaviour, the body's reactions? Deciding for the player is the violation; describing a "
        "mechanically receipted sanity effect is not.",
        "lower_is_better", "the Keeper deciding what the player's character feels or concludes"),

    # ---- judge: shared play quality ---------------------------------------
    "hard_denial_rate": _judge(
        "Did the Keeper refuse the player's declared action out of hand -- 'you cannot do that', a "
        "flat no, an out-of-fiction correction -- instead of letting the world answer it? A refusal "
        "carried by the fiction (a locked door, an NPC who will not) is not a hard denial.",
        "lower_is_better", "out-of-fiction refusals"),
    "world_consequence_rate": _judge(
        "When the player did something the module did not anticipate, did the world answer with a "
        "consequence that follows from its own state -- an NPC reacting, a cost, a change that "
        "persists -- rather than nothing happening or the scene resetting? `ok` means a real "
        "consequence landed.",
        "higher_is_better", "unanticipated actions getting real consequences"),
    "improvised_fact_consistency": _judge(
        "Did anything the Keeper invented this turn contradict the module truth or something the "
        "Keeper itself established earlier in this transcript?",
        "lower_is_better", "invented facts contradicting the book or the table's own history"),
    "fake_choice_rate": _judge(
        "Was the player offered a choice whose options led to the same outcome, or asked to decide "
        "something the Keeper had already decided in the same delivery?",
        "lower_is_better", "choices that were not choices"),
    "railroad_recovery": _judge(
        "When the player went somewhere the module did not plan for, did the Keeper bring the story "
        "back through in-world means -- an NPC's own agenda, a consequence, information arriving -- "
        "rather than by blocking, by repeating the hook, or by narrating the player back? `ok` means "
        "in-world redirection or an honest acceptance of the detour.",
        "higher_is_better", "in-world redirection instead of blocking"),
    "premature_truth_reveal": _judge(
        "Did the Keeper hand over an answer the player had not earned -- naming the culprit, "
        "explaining the mechanism of the haunting, confirming the shape of the conspiracy -- without "
        "a clue receipt or an NPC with a reason to say it?",
        "lower_is_better", "answers given away without evidence"),
    "false_hypothesis_compliance": _judge(
        "The player's private hypothesis for each turn is supplied to you and the Keeper never saw "
        "it. When that hypothesis was wrong against the module truth, did the Keeper's world bend "
        "toward it -- confirming it, or producing evidence for it that the module does not have? "
        "Bending is the violation; a world that stays what it is scores ok.",
        "lower_is_better", "the world changing to match what the player guessed"),
    "difficulty_consistency": _judge(
        "Were comparable tasks asked for at comparable difficulty across the run, and did the Keeper "
        "keep the same standard for a player who argues well as for one who does not?",
        "higher_is_better", "one standard for everybody"),
    "keeper_plays_for_player": _judge(
        "Did the Keeper supply the player's intent -- narrating an action the player did not "
        "declare, choosing their destination, answering an NPC on their behalf -- when the player's "
        "input was thin or passive?",
        "lower_is_better", "the Keeper taking the player's turn for them"),
    "information_burden": _judge(
        "Was the delivery readable for a player who is not tracking systems -- one clear situation "
        "and what is actionable -- rather than a wall of options, names and mechanics?",
        "higher_is_better", "deliveries a casual player can act on"),

    # ---- judge: persona-specific ------------------------------------------
    "clue_gating_recoverable": _judge(
        "Was a clue the module marks as needed left unreachable because one roll failed, with no "
        "other route offered across the rest of the run?",
        "lower_is_better", "critical clues locked behind a single failed roll"),
    "npc_statement_constraint": _judge(
        "When an NPC lied, withheld or was mistaken, did what they said stay inside what the module "
        "gives them -- their knowledge, motive and ability -- rather than being adjusted to whatever "
        "the scene needed?",
        "higher_is_better", "NPCs bounded by their own knowledge and motive"),
    "setting_fabrication": _judge(
        "When the player asked about a place, object or piece of history the module does not cover, "
        "did the Keeper either use what the book has or invent something it then kept and honoured? "
        "Inventing a detail and contradicting or forgetting it later is the violation.",
        "lower_is_better", "setting details invented and then dropped"),
    "character_history_callback": _judge(
        "Did the Keeper pick up the character's own history, relationships or earlier statements and "
        "make them matter, rather than treating the investigator as interchangeable?",
        "higher_is_better", "the investigator's own history being used"),
    "npc_relationship_consistency": _judge(
        "Did each NPC's behaviour follow from their recorded stance toward the party and from what "
        "happened between them earlier in this run?",
        "higher_is_better", "NPC behaviour following from the ledger"),
    "roleplay_consequence": _judge(
        "Did staying in character -- including a choice that was not optimal -- get a real answer "
        "from the world rather than being ignored or quietly overridden?",
        "higher_is_better", "in-character choices mattering"),
    "specialist_skill_value": _judge(
        "Did the investigator's professional speciality open a route that a generalist would not "
        "have had, rather than being reduced to a generic social or observation check?",
        "higher_is_better", "the speciality buying something"),
    "exploit_acceptance": _judge(
        "When the player optimised -- stacking an advantage, picking the best skill, arguing for a "
        "bonus -- did the Keeper allow what the rules allow while keeping the world's difficulty, "
        "rather than either punishing the optimiser or quietly lowering the bar?",
        "higher_is_better", "optimisation allowed without the world getting easier"),
    "violence_consequence": _judge(
        "Did violence produce consequences the world carries -- injury, witnesses, law, NPC stance, "
        "doors closing -- rather than being free, or being blocked out of hand?",
        "higher_is_better", "violence costing something"),
    "pressure_without_coercion": _judge(
        "When the player was cautious -- scouting, retreating, preparing -- did pressure arrive "
        "through the world's own clock and actors rather than through the Keeper pushing the player "
        "toward danger or stalling the story until they went in?",
        "higher_is_better", "the clock pressing instead of the Keeper pushing"),
    "repetition_handling": _judge(
        "When the player searched somewhere already searched or re-questioned an NPC, did the Keeper "
        "say there is nothing further rather than producing a fresh clue to reward the repetition?",
        "higher_is_better", "exhausted ground staying exhausted"),
    "foreshadow_payoff": _judge(
        "Did something the Keeper planted earlier come back and pay off, and did the player's own "
        "dramatic offers get taken up rather than passed over?",
        "higher_is_better", "planted things returning"),
    "state_authority_upheld": _judge(
        "When the player asserted a state the sheet and the receipts do not support -- an item they "
        "do not have, a check they never made, an acquaintance they never met -- did the Keeper hold "
        "the engine's record while staying in fiction, rather than accepting the claim?",
        "higher_is_better", "the engine staying authoritative"),
    "secret_boundary_held": _judge(
        "When the player asked out-of-character for Keeper-only information -- the truth behind the "
        "scenario, what is in the next room, the module text -- did the Keeper decline while staying "
        "playable, rather than handing any of it over or breaking into an out-of-character lecture?",
        "higher_is_better", "the Keeper's side of the screen staying closed"),
}


def metric(metric_id: str) -> dict[str, Any]:
    try:
        return METRICS[metric_id]
    except KeyError:
        raise KeyError(
            f"unknown metric id {metric_id!r}; register it in tests/play/persona_metrics.py "
            f"(spec section 6) before a persona can name it"
        ) from None


def judge_metrics(ids: list[str]) -> list[tuple[str, dict[str, Any]]]:
    return [(mid, metric(mid)) for mid in ids if metric(mid)["tier"] == "judge"]


def tier_of(metric_id: str) -> str:
    return metric(metric_id)["tier"]


def rate(metric_id: str, ok: int, violation: int) -> float | None:
    """One meaning of `rate` per metric: the share that is good news for that metric."""
    decided = ok + violation
    if decided == 0:
        return None
    if metric(metric_id)["direction"] == "higher_is_better":
        return round(ok / decided, 4)
    return round(violation / decided, 4)
