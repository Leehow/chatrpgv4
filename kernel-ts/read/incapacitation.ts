/**
 * A state that takes the action away is a clock, and the Keeper is told where its hands are.
 *
 * Contract §NN, closing BUG-076 of §42.5. The three exits out of `unconscious` were implemented and
 * correct; what no layer had was an obligation to drive one. Retained live evidence, campaign `t9`
 * (The Haunting, `H-MAIN-2`), turns 47-54: an investigator fell into a cellar, took 6 of his 8 hit
 * points, fumbled the major-wound CON roll and went down. The clock then ran from 1966 to 3776 --
 * 1810 minutes, thirty hours and ten -- across seven turns with **zero** `condition` receipts. Two
 * rousing checks happened in the whole stretch, one an outside accident and one because the player
 * named the rule at the table himself. The Keeper's own words closed both doors: "I will not have
 * anyone touch the same wound again", and "I will not move the clock forward for you."
 *
 * Nothing was broken in the rules. What was missing is that the Keeper was never told this body was
 * a clock. `situations` only produces a row for a rule-graph decision whose hard gates pass on a
 * *positive* fact, and no decision in `content/rulesets/coc7/rule-graph.json` reads
 * `actor.conditions.unconscious` at all -- the fact has a writer (`factsFromState`) and, to this
 * day, no reader. `healing:first-aid-ordinary` stops firing sixty minutes after the wound;
 * `healing:medicine-ordinary`'s only hard gate is a negation, so `positiveGateHits` returns nothing
 * and it never becomes a situation; `healing:weekly-major-wound-recovery` waits a week. From the
 * first hour to the end of that campaign the situations list held nothing about him whatever, and
 * `pressures` -- the one section that says what is pressing and what answers it -- was silent.
 *
 * So this is a clock row built from the party's own state rather than from a decision, and it is the
 * only pressure in the capsule whose source is a condition. It does not invent a duration. CoC 7e as
 * this repository carries it gives none: `skill-descriptions.json` says First Aid and Medicine "can
 * rouse an unconscious person to consciousness" and nothing anywhere says how long one stays under.
 * Every number below is the rules' own -- the hour First Aid must be delivered within, the six hours
 * of rest the healing time trigger needs, the week the major-wound recovery roll comes due on -- and
 * a state with no authored timer gets a row that says which operation ends it, never a row that
 * declares it over.
 *
 * `next` carries the exact call, because a clock line the Keeper has to assemble is a clock line the
 * Keeper does not use: the `apply threat` rows only started being taken once each carried what it
 * cost and what it produced on one line (Agents.md, "the seam has three ends"). That is also the
 * answer to what is left to play while a body is down. The one exit that needs nobody else at the
 * table is spelled `apply time`, a verb only the Keeper has, and t9's Keeper refused it in as many
 * words because nothing had told him it would do anything. `next` tells him the minutes and what
 * comes back at the end of them.
 *
 * `dying` and `dead` are not here. Dying already has two clocks of its own (`healing:dying-hour-clock`,
 * `healing:dying-round-clock`) which fire as situations and reach `clockPressures`, and a second row
 * for the same body would be the same rule kept in two places. Death is not a clock.
 */
import { WEEK_MINUTES } from "../healing/session.js";
import { incapacitatedBy } from "../healing/conditions.js";
import { compareUnicode } from "../json.js";
import { array, integer, number, row, string, type Row } from "./values.js";

/** Six hours in one `apply time` is what `healingTimeTrigger` needs before it counts a day of rest. */
const REST_MINUTES = 360;
/** First Aid "must be delivered within one hour" (`rules-json/skill-descriptions.json`, First Aid). */
const FIRST_AID_MINUTES = 60;

/** The most recent active wound's elapsed stamp, the same anchor `factsFromState` measures from. */
function woundAnchor(healing: Row): Row | null {
    const active = array(healing.wound_ledger).map(row).filter(wound => wound.status === "active" && integer(wound.occurred_elapsed_minutes) && typeof wound.wound_id === "string" && wound.wound_id);
    return active.length ? active.reduce((best, wound) => number(wound.occurred_elapsed_minutes) > number(best.occurred_elapsed_minutes) || number(wound.occurred_elapsed_minutes) === number(best.occurred_elapsed_minutes) && compareUnicode(wound.wound_id, best.wound_id) > 0 ? wound : best) : null;
}

/**
 * When the weekly recovery roll comes due, measured exactly as `actor.recovery.major_wound_week_due`
 * measures it: a week after the wound, or after the last attempt recorded against that same wound.
 */
function weeklyDueIn(healing: Row, wound: Row, minutes: number): number {
    let baseline = number(wound.occurred_elapsed_minutes);
    for (const attempt of array(healing.major_wound_recovery_ledger).map(row))
        if (attempt.wound_id === wound.wound_id && integer(attempt.attempt_elapsed_minutes))
            baseline = Math.max(baseline, number(attempt.attempt_elapsed_minutes));
    return WEEK_MINUTES - (minutes - baseline);
}

/**
 * One row per party member held by a state that takes the action away and has an exit nobody is
 * driving. `healingOf` is the campaign's own healing state, because the wound ledger the clock is
 * measured from lives there rather than on the sheet.
 */
export function incapacitationClocks(party: Row[], healingOf: (id: string) => Row, minutes: number): Row[] {
    return array(party).map(row).flatMap(sheet => {
        const id = string(sheet.id), conditions = array(sheet.conditions).map(string);
        if (!incapacitatedBy(conditions).includes("unconscious") || conditions.includes("dying") || conditions.includes("dead"))
            return [];
        const healing = row(healingOf(id)), wound = woundAnchor(healing), major = conditions.includes("major_wound");
        const standing = wound ? Math.max(0, minutes - number(wound.occurred_elapsed_minutes)) : null;
        const hp = `HP ${string(sheet.current_hp ?? "?")}/${string(row(sheet.derived).HP ?? "?")}`;
        // The sooner exits, and only the ones the rules still leave open. First Aid drops out of the
        // list an hour after the wound because the book takes it out, not because the hour is a
        // timer on the condition.
        const sooner = [
            ...(standing !== null && standing <= FIRST_AID_MINUTES ? [`resolve healing:first-aid-ordinary (+1 HP rouses; ${FIRST_AID_MINUTES - standing} min of the hour left)`] : []),
            "resolve healing:medicine-ordinary (+1D3 HP rouses; the rescuer acts, he is the target)",
        ];
        // What the rules run on their own, and the exact call that reaches it. With a major wound
        // ticked there is no daily hit point at all -- `weeklyRecovery` returns zero and
        // `healingTimeTrigger` does not even call it -- so the next thing the rules do by themselves
        // is the weekly roll, and saying otherwise is what sent t9's Keeper to `apply time` twice
        // for nothing.
        const due = major && wound ? weeklyDueIn(healing, wound, minutes) : null;
        const [what, next] = !major
            ? ["natural healing returns one hit point after a day's rest", `apply time {minutes: ${REST_MINUTES}} returns it, and the hit point rouses him`]
            : due !== null && due > 0
                ? [`no hit point returns while the major wound is ticked; the weekly recovery roll comes due in ${due} min`, `apply time {minutes: ${due}} reaches it, then resolve healing:weekly-major-wound-recovery`]
                : ["no hit point returns while the major wound is ticked; the weekly recovery roll is what the rules run next", "resolve healing:weekly-major-wound-recovery (a success returns 1D3 HP, which rouses)"];
        return [{
            kind: "clock",
            name: "unconscious, standing",
            who: string(sheet.name || id),
            state: `${standing === null ? "since the wound" : `${standing} min`}; ${hp}${major ? "; major wound ticked" : ""}`,
            due: what,
            next,
            cue: sooner.join("; "),
        }];
    });
}
