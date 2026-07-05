# Call of Cthulhu 7e (40th Anniversary) — Machine-Checkable Rule Checklist

Extracted from the rulebook PDF via pypdf. Page references are the **rulebook's printed page numbers** (the "display" value = PDF index + 1). All quotes are verbatim from the extracted text. Predicates use a generic pseudo-notation against playtest data fields (`roll.value`, `skill.value`, `skill.regular/hard/extreme`, `outcome.level`, `san.current`, `san.max`, etc.).

Legend for outcome levels (used throughout): `fumble < failure < regular < hard < extreme < critical`.

---

## A. Skill Rolls — Difficulty Levels & Success Tiers

### A1. Regular difficulty target = full skill
- **Rule name:** Regular difficulty target number
- **Page:** p83 (PDF idx 94)
- **Predicate:** `target.regular == skill.value` (the value used at Regular difficulty equals the investigator's full skill/characteristic percentage)
- **Quote:** "the player needs to roll equal to or below the target set by the Keeper … require Harvey's player to roll equal to or below Harvey's full Persuade skill in order to succeed."

### A2. Hard difficulty target = floor(half skill)
- **Rule name:** Hard target number
- **Page:** p83 (PDF idx 94)
- **Predicate:** `target.hard == floor(skill.value / 2)`
- **Quote:** "Hard difficulty level … requiring Harvey to roll 10 or below (half Harvey's STR)." (STR 20 → half = 10)

### A3. Extreme difficulty target = floor(fifth skill)
- **Rule name:** Extreme target number
- **Page:** p83 (PDF idx 94)
- **Predicate:** `target.extreme == floor(skill.value / 5)`
- **Quote:** "Extreme difficulty level … the player needs to roll equal to or below a fifth of their skill or characteristic in order to succeed."

### A4. Opposed-roll difficulty set by opponent's skill bracket
- **Rule name:** Difficulty-from-opponent thresholds (50/90)
- **Page:** p83 (PDF idx 94)
- **Predicate:** opponent.skill < 50 ⇒ Regular; 50 ≤ opponent.skill < 90 ⇒ Hard; opponent.skill ≥ 90 ⇒ Extreme
- **Quote:** "If the opponent's skill or characteristic is below 50, the difficulty level is Regular. If … equal to or above 50 … Hard. If … equal to or above 90 … Extreme."

### A5. Six possible skill-roll results and their numeric bands
- **Rule name:** Result bands
- **Page:** p91 (PDF idx 102)
- **Predicate:** Given `roll` and Regular target `T = skill.value`:
  - `critical` ⇔ `roll == 1`
  - `extreme` ⇔ `2 <= roll <= floor(T/5)`
  - `hard` ⇔ `roll <= floor(T/2)` (and not extreme/critical)
  - `regular` ⇔ `roll <= T` (and not hard/extreme/critical)
  - `failure` ⇔ `T < roll < fumble_band`
  - `fumble` per A8/A9
- **Quote:** "A skill roll can yield one of six results: Fumble … Failure … Regular success … Hard success … Extreme success … Critical success: a roll of 01."

### A6. Success-level ordering for opposed/tie-breaking
- **Rule name:** Level precedence
- **Page:** p91 (PDF idx 102)
- **Predicate:** ordering `critical > extreme > hard > regular > failure`, and `fumble` is worst of all; if same level, higher skill wins.
- **Quote:** "A Critical success beats an Extreme success. An Extreme success beats a Hard success. A Hard success beats a Regular success. A Regular success beats a Failure or Fumble. In the case of a tie, the side with the higher skill (or characteristic) wins."

---

## B. Fumbles & Criticals

### B1. Critical = roll of 01
- **Rule name:** Critical success band
- **Page:** p89 (PDF idx 100)
- **Predicate:** `roll == 1` ⇒ `critical` (regardless of skill)
- **Quote:** "01: A Critical Success. A roll of 01 means that something beneficial occurs beyond simply achieving the goal."

### B2. Critical in combat = maximum damage
- **Rule name:** Combat critical damage
- **Page:** p89 (PDF idx 100)
- **Predicate:** If an attack roll is `critical`, damage applied = weapon's maximum damage (and max damage bonus).
- **Quote:** "In combat, for example, a critical success means that the attacker has hit a vulnerable spot and causes maximum damage."

### B3. Fumble band — high skill (target ≥ 50): only on 100
- **Rule name:** Fumble when target ≥ 50
- **Page:** p90 (PDF idx 101)
- **Predicate:** If `target.regular >= 50`, fumble ⇔ `roll == 100`
- **Quote:** "If the dice roll required for success is 50 or over and the dice read 100, a fumble has occurred."

### B4. Fumble band — low skill (target < 50): 96–100
- **Rule name:** Fumble when target < 50
- **Page:** p90 (PDF idx 101)
- **Predicate:** If `target.regular < 50`, fumble ⇔ `96 <= roll <= 100`
- **Quote:** "If the dice roll required for success is below 50 and the dice read 96—100, a fumble has occurred."

### B5. Fumble applies at the rolled difficulty's target (Hard/Extreme fumble widening)
- **Rule name:** Difficulty-scaled fumble band
- **Page:** p90 (PDF idx 101)
- **Predicate:** The "< 50 / ≥ 50" comparison must use the **effective target number for the difficulty being rolled** (e.g. Hard target = floor(skill/2)). If Harvey skill 55 → Hard target 27 → fumble on 96–100.
- **Quote:** "If Harvey were furtively searching through a private library in the dark … requiring a roll of 27. In this case, Harvey would fumble on a roll of 96 to 100."

### B6. Fumble impact is immediate, cannot be pushed away
- **Rule name:** Fumble not negatable by push
- **Page:** p89 (PDF idx 100)
- **Predicate:** If a roll is a fumble, no pushed roll may remove its consequence.
- **Quote:** "The impact of Fumbles should take effect immediately and may not be negated through pushing the roll."

---

## C. Bonus & Penalty Dice

### C1. Bonus die = take lower tens die
- **Rule name:** Bonus die resolution
- **Page:** p91 (PDF idx 102)
- **Predicate:** With one bonus die, two tens dice `t1, t2` and one units die `u` are rolled; effective roll = `min(t1,t2)*10 + u`.
- **Quote:** "If you have a bonus die, you should use the 'tens' die that yields the better (lower) result."

### C2. Penalty die = take higher tens die
- **Rule name:** Penalty die resolution
- **Page:** p91 (PDF idx 102)
- **Predicate:** With one penalty die, effective roll = `max(t1,t2)*10 + u`.
- **Quote:** "For a penalty, use the 'tens' die that yields the worse (highest) result."

### C3. Bonus and penalty cancel one-for-one
- **Rule name:** Bonus/penalty cancellation
- **Page:** p91 (PDF idx 102)
- **Predicate:** Net dice modifier = `(bonus_dice - penalty_dice)`; one of each ⇒ none applied.
- **Quote:** "One bonus die and one penalty die cancel each other out."

### C4. Skill rolls use difficulty; opposed rolls use bonus/penalty dice
- **Rule name:** Difficulty vs BP dice scope
- **Page:** p92 (PDF idx 103)
- **Predicate:** Opposed rolls (e.g. melee combat) never set a difficulty level; modifiers are bonus/penalty dice only. Single-side skill rolls set a difficulty level (bonus/penalty dice only as exception).
- **Quote:** "Skill rolls: Set level of difficulty. Opposed rolls: Award penalty dice or bonus dice."

---

## D. Pushed Rolls

### D1. What can be pushed
- **Rule name:** Pushable roll types
- **Page:** p85 (PDF idx 96)
- **Predicate:** Push is allowed only for skill rolls and characteristic rolls; NOT for Luck, Sanity, combat, damage, or SAN-loss rolls.
- **Quote:** "Only skill and characteristic rolls can be pushed, not Luck, Sanity, or combat rolls, or rolls to determine an amount of damage or Sanity loss."

### D2. Push requires player justification (not a Keeper yes/no)
- **Rule name:** Push consent protocol
- **Page:** p84 (PDF idx 95)
- **Predicate:** A pushed-roll event must record the player's described action/effort; absence of justification ⇒ push invalid.
- **Quote:** "A pushed roll is only allowed if it can be justified, and it is up to the player to do this … It is not for the Keeper to simply say yes or no; it is for the player to describe the extra effort or time taken."

### D3. Pushed roll uses same skill/difficulty (unless situation changes); not a re-roll — time passes
- **Rule name:** Push is a second and final attempt
- **Page:** p85 (PDF idx 96)
- **Predicate:** A push is at most one extra roll; target skill/difficulty same as original unless explicitly modified; time elapses between.
- **Quote:** "When making a pushed roll, the goal must still be achievable. The skill and difficulty level normally remain unchanged … a pushed roll is not simply a re-roll; time always passes between rolls."

### D4. Opposed rolls cannot be pushed
- **Rule name:** No pushing opposed rolls
- **Page:** p90 (PDF idx 101)
- **Predicate:** If the roll was an opposed roll, no push is permitted.
- **Quote:** "Opposed skill rolls cannot be pushed."

### D5. Combat rolls cannot be pushed
- **Rule name:** No pushing combat rolls
- **Page:** p104 (PDF idx 115)
- **Predicate:** No pushed event may exist for a Fighting/Firearms roll.
- **Quote:** "There is no option to push combat rolls (either Fighting or Firearms)."

### D6. Foreshadowing protocol before a pushed roll
- **Rule name:** Foreshadowing consequence
- **Page:** p85 (PDF idx 96)
- **Predicate:** When a push is attempted, the recorded consequence-of-failure (foreshadowing) should be present before the second roll resolves.
- **Quote:** "Before rolling the dice for a pushed roll, the consequence of failure may be foreshadowed by the Keeper. To foreshadow, the Keeper says, 'If you fail…'"

### D7. Pushed-success negates failure consequences; pushed-failure grants Keeper dire consequences
- **Rule name:** Pushed outcome handling
- **Page:** p86 (PDF idx 97)
- **Predicate:** On pushed success, original failure consequences do not occur. On pushed failure, recorded consequences (damage/SAN loss/etc.) apply.
- **Quote:** "Pushed Roll: Success … None of the consequences of failure happen. Pushed Roll: Failure … grants the Keeper free rein over the outcome, including damage, Sanity checks, loss of equipment, isolation …"

---

## E. Investigator Development Phase (Skill Improvement)

### E1. Tick earned on successful skill use
- **Rule name:** Skill-check earning condition
- **Page:** p94 (PDF idx 105)
- **Predicate:** A skill may receive an experience tick only if a roll against that skill was a success (Regular/Hard/Extreme/Critical).
- **Quote:** "When an investigator successfully uses a skill in play, the player should check the box beside that skill."

### E2. No tick when a bonus die was used
- **Rule name:** No tick with bonus die
- **Page:** p94 (PDF idx 105)
- **Predicate:** If the successful roll used a bonus die, no tick is earned for that skill.
- **Quote:** "No tick is earned if the roll used a bonus die."

### E3. Opposed roll: only the winner ticks
- **Rule name:** Opposed-roll tick
- **Page:** p94 (PDF idx 105)
- **Predicate:** In an opposed roll, a tick is awarded only to the winner (the side with the higher success level, or higher skill on a tie).
- **Quote:** "In the case of an opposed roll, both sides may achieve a level of success, but only one will win, and only the winner may tick their skill."

### E4. Cthulhu Mythos and Credit Rating never get ticks
- **Rule name:** Untickable skills
- **Page:** p94 (PDF idx 105)
- **Predicate:** No tick/improvement event exists for `Cthulhu Mythos` or `Credit Rating`.
- **Quote:** "The Cthulhu Mythos and Credit Rating skills never receive a skill check, and no box for such a check exists on the investigator sheet."

### E5. At most one development check per skill per phase
- **Rule name:** One tick per skill
- **Page:** p94 (PDF idx 105)
- **Predicate:** Regardless of number of successes in play, the development phase rolls at most once per skill.
- **Quote:** "No matter how many times a skill is used successfully in play, only one check per skill can be made to see if the investigator improves."

### E6. Development roll outcome (improvement condition)
- **Rule name:** Development roll result
- **Page:** p94 (PDF idx 105)
- **Predicate:** Roll 1D100 vs current skill `S`. Improvement ⇔ `roll > S` OR `roll > 95`. On improvement, gain `1D10` points.
- **Quote:** "If the player rolls higher than the current skill number, or the result is over 95, then the investigator improves in that skill: roll 1D10 and immediately add the result to the current skill points."

### E7. Skills may exceed 100% via development
- **Rule name:** Skill > 100 allowed
- **Page:** p94 (PDF idx 105)
- **Predicate:** A skill value > 100 is valid after development.
- **Quote:** "Skills may rise above 100% by this method."

### E8. SAN reward when a skill reaches 90%+
- **Rule name:** 90%-skill SAN reward
- **Page:** p94 (PDF idx 105)
- **Predicate:** When a skill reaches ≥ 90 during development, the investigator gains `2D6` Sanity points.
- **Quote:** "When an investigator attains 90% or more ability in a skill during an investigator development phase, add 2D6 points to their current Sanity."

### E9. Optional Luck recovery works like a development roll, capped at 99
- **Rule name:** Luck recovery
- **Page:** p99 (PDF idx 110)
- **Predicate:** Each session, roll 1D100 vs current Luck `L`; if `roll > L`, gain 1D10 Luck. Luck may not exceed 99.
- **Quote:** "if the roll is above their present Luck score they add 1D10 points to their Luck score … an investigator's Luck score … may not exceed 99."

### E10. Spending Luck does not earn a tick
- **Rule name:** No tick when Luck spent
- **Page:** p99 (PDF idx 110)
- **Predicate:** If Luck points were spent to alter a roll, no skill-improvement tick is earned.
- **Quote:** "no skill improvement check is earned if Luck points were used to alter the dice roll."

### E11. Pushed roll earns a tick on success
- **Rule name:** Pushed success still ticks
- **Page:** p94 (PDF idx 105) [implied by E1; clarified by examples]
- **Predicate:** A successful pushed skill roll still earns a tick (it is a skill roll that succeeded), provided no bonus die / no Luck spent.
- **Quote:** "When an investigator successfully uses a skill in play, the player should check the box beside that skill." (pushed success is still a successful use)

---

## F. Sanity — Core Mechanics

### F1. Sanity roll target = current Sanity
- **Rule name:** SAN roll target
- **Page:** p154 (PDF idx 165)
- **Predicate:** `san_roll.target == san.current`; success ⇔ `1D100 <= san.current`.
- **Quote:** "Each player whose investigator experiences this source of horror rolls 1D100. A success is a roll equal to or less than the investigator's current Sanity points."

### F2. No bonus/penalty dice on Sanity rolls (except Self-Help)
- **Rule name:** SAN rolls use no BP dice
- **Page:** p154 (PDF idx 165)
- **Predicate:** A Sanity roll event must not carry bonus or penalty dice (Self-Help key-connection bonus is the only documented exception).
- **Quote:** "Bonus dice and penalty dice are not applied to Sanity rolls (with one exception, Self-Help, page 167)."

### F3. Luck may not be spent on Sanity rolls
- **Rule name:** No Luck on SAN rolls
- **Page:** p154 (PDF idx 165); p99 (PDF idx 110)
- **Predicate:** No Luck-spend event may modify a Sanity roll.
- **Quote:** "If using the optional rule for spending Luck points, these may not be spent on Sanity rolls." / "Luck points may not be spent on … Sanity rolls."

### F4. SAN-loss notation X / YdZ
- **Rule name:** SAN loss notation
- **Page:** p154 (PDF idx 165)
- **Predicate:** For a source with notation `X/Y`: on SAN-roll **success** lose `X` points; on **failure** roll `Y` and lose that many. `0/Y` ⇒ success loses nothing.
- **Quote:** "The number to the left of the slash is the number of Sanity points lost if the Sanity roll succeeds. The die roll to the right of the slash is the number of Sanity points lost if the Sanity roll is failed."

### F5. Failed SAN roll always costs SAN
- **Rule name:** Failed SAN ⇒ loss
- **Page:** p154 (PDF idx 165)
- **Predicate:** On `san_roll.outcome == failure`, `san_loss > 0` (rolled from the right-hand term).
- **Quote:** "A failed Sanity roll always means the investigator loses Sanity points."

### F6. Failed SAN roll always causes loss of self-control (one of 5 involuntary actions)
- **Rule name:** Involuntary action on failed SAN
- **Page:** p154 (PDF idx 165)
- **Predicate:** On any failed SAN roll, the event records one involuntary action from the set {jump-in-fright/drop-item, cry-out-in-terror, involuntary-movement, involuntary-combat-action, freeze}.
- **Quote:** "Failing a Sanity roll always causes the investigator to lose self-control for a moment, at which point the Keeper should choose an involuntary action …" (list of five: Jump in fright; Cry out in terror; Involuntary movement; Involuntary combat action; Freeze).

### F7. Fumbled SAN roll = maximum loss
- **Rule name:** SAN fumble = max loss
- **Page:** p154 (PDF idx 165)
- **Predicate:** If `san_roll.outcome == fumble`, `san_loss == max(Y)` (the maximum of the right-hand die expression).
- **Quote:** "A fumbled Sanity roll results in the character losing the maximum Sanity points for that particular situation or encounter."

### F8. SAN loss is per encounter, not per creature
- **Rule name:** One SAN roll per encounter
- **Page:** p155 (PDF idx 166)
- **Predicate:** A single SAN event for "N ghouls (0/1D6)" yields a single loss, not N losses.
- **Quote:** "When encountering one ghoul, the Sanity point loss is 0/1D6. It is the same when encountering multiple ghouls; the sanity effect is for the encounter rather than each ghoul seen."

### F9. Maximum Sanity = 99 − Cthulhu Mythos
- **Rule name:** Max SAN formula
- **Page:** p155 (PDF idx 166)
- **Predicate:** `san.max == 99 - cthulhu_mythos`. Current SAN may not exceed this.
- **Quote:** "Maximum Sanity points equal 99 minus current Cthulhu Mythos points (99–Cthulhu Mythos skill)."

### F10. Gaining CM lowers max SAN by the same amount
- **Rule name:** CM↔maxSAN coupling
- **Page:** p155 (PDF idx 166)
- **Predicate:** When `cthulhu_mythos` increases by `Δ`, `san.max` decreases by `Δ`.
- **Quote:** "When gaining Cthulhu Mythos skill points, the player should decrease the investigator's maximum Sanity by the same amount."

### F11. SAN = 0 ⇒ permanently insane, no longer a PC
- **Rule name:** Permanent insanity at 0 SAN
- **Page:** p154 (PDF idx 165)
- **Predicate:** If `san.current == 0`, the character is permanently insane / retired.
- **Quote:** "When Sanity points are reduced to zero, an investigator is permanently and incurably insane, and ceases to be a player character."

---

## G. Sanity — Insanity Thresholds & Bouts

### G1. 5+ SAN lost from a single source ⇒ temporary insanity test
- **Rule name:** 5-point temp-insanity threshold
- **Page:** p155 (PDF idx 166)
- **Predicate:** If `san_loss_from_single_source >= 5`, an INT roll must follow.
- **Quote:** "If an investigator loses 5 or more Sanity points from a single source of Sanity loss … the Keeper must test the investigator's sanity. The Keeper asks for an Intelligence (INT) roll."

### G2. INT roll after 5+ SAN loss — success ⇒ temp insanity; failure ⇒ repressed (no insanity)
- **Rule name:** INT-roll outcome
- **Page:** p155–156 (PDF idx 166–167)
- **Predicate:** On `INT_roll.success` ⇒ temporary insanity (bout + 1D10-hour underlying state). On `INT_roll.failure` ⇒ memory repressed, NOT insane.
- **Quote:** "If the roll is failed, the investigator has repressed the memory … and does not become insane. Perversely, if the INT roll succeeds, the investigator recognizes the full significance … and goes temporarily insane."

### G3. Temporary insanity duration = 1D10 hours
- **Rule name:** Temp insanity duration
- **Page:** p156 (PDF idx 167); p164 (PDF idx 175)
- **Predicate:** A temporary-insanity underlying-state event has duration `1D10` hours.
- **Quote:** "The effects of temporary insanity begin immediately and last for 1D10 hours." / "Temporary insanity lasts 1D10 hours."

### G4. Indefinite insanity: ≥ 1/5 of current SAN lost in one "day"
- **Rule name:** Indefinite insanity threshold
- **Page:** p156 (PDF idx 167)
- **Predicate:** If `sum(san_loss_in_day) >= floor(san.current_at_day_start / 5)` ⇒ indefinite insanity.
- **Quote:** "On losing a fifth or more of current Sanity points in one game 'day,' the investigator becomes indefinitely insane."

### G5. Bout of madness — real-time = 1D10 combat rounds
- **Rule name:** Real-time bout duration
- **Page:** p156 (PDF idx 167); p156 (PDF idx 168, Table VII)
- **Predicate:** A real-time bout lasts `1D10` combat rounds (rolled on Table VII).
- **Quote:** "the bout of madness lasts 1D10 combat rounds (real time) if being played out."

### G6. Bout of madness — summary form (Table VIII), typically 1D10 hours summarized
- **Rule name:** Summary bout duration
- **Page:** p158 (PDF idx 169); p157 (PDF idx 168, Table VIII)
- **Predicate:** A summary bout has a 1D10 roll on Table VIII; the in-fiction elapsed time is summarized (often 1D10 hours).
- **Quote:** "the Keeper can simply fast-forward the action and describe the outcome … typically 1D10 hours."

### G7. Immune to further SAN loss during a bout of madness
- **Rule name:** Bout SAN immunity
- **Page:** p156 (PDF idx 167)
- **Predicate:** While in a bout of madness, no SAN-loss event should be applied.
- **Quote:** "the investigator cannot lose further Sanity points while experiencing a bout of madness."

### G8. During underlying insanity, any further SAN loss (even 1) triggers another bout
- **Rule name:** Fragility in underlying insanity
- **Page:** p158–159 (PDF idx 169–170)
- **Predicate:** If the investigator is in an underlying-insanity window and suffers any `san_loss >= 1`, a new bout of madness begins.
- **Quote:** "any further loss of Sanity points (even a single point) will result in another bout of madness."

### G9. First Mythos-induced insanity grants +5 Cthulhu Mythos; later ones +1
- **Rule name:** Mythos-insanity CM gain
- **Page:** p164 (PDF idx 175)
- **Predicate:** First ever Mythos-induced insanity ⇒ `cm += 5`; subsequent Mythos-induced insanities ⇒ `cm += 1` each.
- **Quote:** "The first instance of Mythos-related insanity always adds 5 points to the Cthulhu Mythos skill. Further episodes of Mythos-induced insanity (temporary or indefinite) each add 1 point to the skill."

### G10. Mythos-Hardened: CM > SAN ⇒ all SAN loss halved (permanent)
- **Rule name:** Mythos-Hardened halving
- **Page:** p169 (PDF idx 180)
- **Predicate:** If `cthulhu_mythos > san.current`, every subsequent SAN loss is halved (round appropriately) and this state never reverts.
- **Quote:** "When an investigator's Cthulhu Mythos skill rises above the value of his or her Sanity score … From that point onward, all Sanity point loss is halved. Once this change has taken place it is permanent."

### G11. "Getting used to the Awfulness" cap = max possible loss for that creature
- **Rule name:** Per-creature SAN-loss cap
- **Page:** p169 (PDF idx 180)
- **Predicate:** Cumulative SAN lost to one creature type ≤ its maximum single-encounter loss (e.g. deep ones 0/1D6 ⇒ cap 6). Cap reduces by 1 each Investigator Development Phase.
- **Quote:** "Once an investigator has lost as many Sanity points for seeing a particular sort of monster as the maximum possible Sanity point loss for that monster, he or she should not lose more Sanity points … With every investigator development phase … reduce all those numbers by 1."

### G12. Self-help recovery: success ⇒ +1D6 SAN; failure ⇒ −1 SAN; key-connection grants bonus die
- **Rule name:** Self-help SAN recovery
- **Page:** p167–169 (PDF idx 178–180)
- **Predicate:** A self-help Sanity roll: success ⇒ `san += 1D6`; failure ⇒ `san -= 1`. If used via key connection, the SAN roll gets one bonus die, and on success also cures indefinite insanity.
- **Quote:** "If the roll is successful, the investigator gains 1D6 Sanity points. If it is unsuccessful, 1 Sanity point is lost … If the player chooses to use their investigator's key connection, they are granted a bonus die when making their Sanity roll."

### G13. Current SAN capped at max SAN (Self-help / awards)
- **Rule name:** SAN cap on recovery
- **Page:** p169 (PDF idx 180)
- **Predicate:** After any gain, `san.current = min(san.current + gain, san.max)`.
- **Quote:** "Current Sanity points can never increase above an investigator's maximum Sanity (99–Cthulhu Mythos skill)."

### G14. First-kill SAN cost (suggested): SAN 0/1D6
- **Rule name:** First-homicide SAN roll
- **Page:** p197 (PDF idx 208)
- **Predicate:** A first-kill event triggers a SAN roll with cost `0/1D6`.
- **Quote:** "you may wish to reflect this in your game by calling for a Sanity roll (SAN 0/1D6) when an investigator first kills a person."

---

## H. Combat — Order, Attacks, Defense

### H1. DEX order, highest → lowest; tie-break by higher combat skill
- **Rule name:** Combat DEX order
- **Page:** p102 (PDF idx 113)
- **Predicate:** Combatants act sorted by `DEX` descending; on equal DEX, higher Fighting/Firearms skill acts first.
- **Quote:** "Determine the order of attack by ranking the combatants' DEX from highest to lowest. In the case of a draw, the side with the higher combat skill goes first."

### H2. Readied firearm acts at DEX + 50
- **Rule name:** Readied-firearm DEX boost
- **Page:** p112 (PDF idx 123)
- **Predicate:** A readied firearm's initiative slot = `DEX + 50`.
- **Quote:** "readied firearms may shoot at DEX + 50 in the DEX order."

### H3. When attacked, defender chooses Dodge OR Fight Back (mutually exclusive)
- **Rule name:** Defense choice
- **Page:** p103 (PDF idx 114)
- **Predicate:** Each incoming melee attack has exactly one declared defense ∈ {fight_back, dodge, none(surprise)}.
- **Quote:** "When attacked, a character has a simple choice: either dodge or fight back."

### H4. Fight-back opposed roll: higher success level wins; tie → attacker wins
- **Rule name:** Fight-back resolution
- **Page:** p103 (PDF idx 114)
- **Predicate:** Compare attacker's vs defender's success level on Fighting; if defender strictly higher ⇒ defender deals damage to attacker; if equal (tie) ⇒ attacker hits; if attacker higher ⇒ attacker hits; if both fail ⇒ no damage.
- **Quote:** "If both sides achieve the same level of success, the character initiating the attack hits the character that is fighting back … In the case of a draw, the attacker wins (when their opponent is fighting back). If both fail, no damage is inflicted."

### H5. Dodge opposed roll: tie → defender (dodger) wins
- **Rule name:** Dodge resolution
- **Page:** p103 (PDF idx 114)
- **Predicate:** Compare attacker Fighting vs defender Dodge levels; if defender strictly higher OR equal ⇒ attack dodged, no damage; if attacker higher ⇒ damage; if both fail ⇒ no damage.
- **Quote:** "If both sides achieve the same level of success, the character dodging wins and evades the attack … In the case of a draw, the defender wins (when the defender is dodging). If both fail, no damage is inflicted."

### H6. Extreme success damage: blunt = max damage (+max DB); impale = max + one extra weapon roll
- **Rule name:** Extreme/impale damage
- **Page:** p103 (PDF idx 114)
- **Predicate:** On attacker Extreme success: blunt weapon ⇒ `weapon.max + db.max`; penetrating weapon (impale) ⇒ `weapon.max + db.max + 1d(weapon)`.
- **Quote:** "If the attacker achieves an Extreme success with a non-impaling weapon … maximum damage (plus maximum damage bonus, if any). If the attacker achieves an Extreme level of success with a penetrating weapon … then an impale has been inflicted … maximum damage plus maximum damage bonus) and add a damage roll for the weapon."

### H7. Extreme/impale only on attacker's own turn (not when fighting back)
- **Rule name:** Extreme only on own turn
- **Page:** p103 (PDF idx 114)
- **Predicate:** An Extreme-success damage bonus applies only if the attacker is the acting character (their DEX slot), not on a fight-back response.
- **Quote:** "This only occurs if the attack is made on a character's turn in the DEX order, not when fighting back."

### H8. Unarmed human damage = 1D3
- **Rule name:** Unarmed damage
- **Page:** p103 (PDF idx 114)
- **Predicate:** Unarmed human attack damage die = `1D3`.
- **Quote:** "the damage for unarmed human attacks is 1D3 (e.g. punching and kicking)."

### H9. Outnumbered: after a character has defended once, subsequent melee attackers get a bonus die
- **Rule name:** Outnumbered bonus die
- **Page:** p108 (PDF idx 119)
- **Predicate:** If a defender has already fought back or dodged this round, each further melee attacker gains one bonus die (does not apply to firearms).
- **Quote:** "Once a character has either fought back or dodged in the present combat round, all subsequent melee attacks on them are made with one bonus die. This does not apply to attacks made using firearms."

### H10. Firearm attack is NOT opposed; difficulty by range; failure deals no damage
- **Rule name:** Firearm resolution
- **Page:** p112 (PDF idx 123)
- **Predicate:** A firearm attack is a single 1D100 vs Firearms skill at a range-set difficulty; on failure, 0 damage.
- **Quote:** "The firearms roll is not opposed. The difficulty level is determined by the range … A failure never deals damage."

### H11. Firearm range difficulty steps
- **Rule name:** Range difficulty
- **Page:** p112 (PDF idx 123)
- **Predicate:** Within base range ⇒ Regular; up to 2× base ⇒ Hard; up to 4× base ⇒ Extreme.
- **Quote:** "Within the base range: Regular … Long range (up to twice the base range): Hard … Very long range (up to four times the base range): Extreme."

### H12. At very-long range, impale only on a critical (01)
- **Rule name:** Very-long-range impale restriction
- **Page:** p112 (PDF idx 123)
- **Predicate:** When range difficulty is Extreme, an "impale" (full impale damage) requires a critical (roll 1); a mere Extreme success yields only a normal hit.
- **Quote:** "At very long range, when only an Extreme success will hit the target, an impale only occurs with a critical hit (a roll of 01)."

### H13. Point-blank range = within DEX/5 feet ⇒ bonus die
- **Rule name:** Point-blank bonus
- **Page:** p113 (PDF idx 124)
- **Predicate:** Target distance ≤ `floor(DEX / 5)` feet ⇒ one bonus die on the firearm attack.
- **Quote:** "If the target is at point-blank range—within a fifth of the shooter's DEX in feet—the attacker gains a bonus die."

### H14. Aiming one full round ⇒ one bonus die on next shot
- **Rule name:** Aiming bonus
- **Page:** p113 (PDF idx 124)
- **Predicate:** A character who spent the previous round aiming (no other action, no damage/movement) gains one bonus die on the shot.
- **Quote:** "If no other actions are taken before the shot is fired, the attacker gains one bonus die."

### H15. Multiple handgun shots ⇒ penalty die per shot
- **Rule name:** Multi-shot penalty
- **Page:** p113 (PDF idx 124)
- **Predicate:** Firing 2 or 3 handgun shots in one round ⇒ each shot's attack roll takes one penalty die.
- **Quote:** "When firing two or three shots in one round, roll for each shot individually, with all shots receiving one penalty die."

### H16. Malfunction: roll ≥ weapon's malfunction number ⇒ no fire
- **Rule name:** Firearm malfunction
- **Page:** p118 (PDF idx 129)
- **Predicate:** If `roll >= weapon.malfunction_number`, the weapon does not fire (and if the roll is also a fumble, Keeper may pick worse outcome).
- **Quote:** "With any attack roll result equal to or higher than the firing weapon's malfunction number … the shooter does not merely miss—his or her weapon does not fire."

---

## I. Fighting Maneuvers

### I1. Maneuver feasibility by Build difference
- **Rule name:** Build-based maneuver modifiers
- **Page:** p105–106 (PDF idx 116–117)
- **Predicate:** Let `Δ = opponent.build - attacker.build`. Δ ≥ 3 ⇒ maneuver impossible; Δ = 2 ⇒ 2 penalty dice; Δ = 1 ⇒ 1 penalty die; Δ ≤ 0 ⇒ none.
- **Quote:** "If the character performing the maneuver has a Build that is three or more points lower than their opponent's, the maneuver is impossible … two points lower … two penalty dice … one point lower … one penalty die … same (or higher) Build … no additional modifiers."

### I2. Maneuver vs dodging target: attacker higher level ⇒ success; tie ⇒ target dodges
- **Rule name:** Maneuver vs dodge
- **Page:** p106 (PDF idx 117)
- **Predicate:** Attacker success level strictly > dodger ⇒ maneuver succeeds; tie ⇒ maneuver dodged.
- **Quote:** "If the character performing the maneuver achieves a higher level of success than the character dodging, the maneuver is successful (if tied, the target is able to dodge the maneuver)."

### I3. Maneuver vs fighting-back target: defender higher ⇒ maneuver fails (defender damages attacker); tie ⇒ maneuver succeeds
- **Rule name:** Maneuver vs fight-back
- **Page:** p106 (PDF idx 117)
- **Predicate:** Defender level strictly > attacker ⇒ maneuver fails and defender inflicts damage; tie ⇒ maneuver succeeds.
- **Quote:** "If the character fighting back achieves a higher level of success, the maneuver fails and the opponent inflicts damage on the character performing the maneuver (if tied, the maneuver is successful)."

---

## J. Wounds, Healing, Dying

### J1. Major wound threshold: damage ≥ floor(maxHP/2)
- **Rule name:** Major wound threshold
- **Page:** p119 (PDF idx 130)
- **Predicate:** A single attack dealing `damage >= floor(max_hp / 2)` is a Major Wound.
- **Quote:** "Equal to or more than half the character's maximum hit points, it is a Major Wound."

### J2. Major wound effects
- **Rule name:** Major wound consequences
- **Page:** p120 (PDF idx 131)
- **Predicate:** On Major Wound: tick Major Wound box, character falls prone, must make CON roll or fall unconscious.
- **Quote:** "Tick the Major Wound box. The character immediately falls prone. Make a successful CON roll to avoid the character falling unconscious."

### J3. Regular damage does not kill; only at 0 HP from a major wound does death threaten
- **Rule name:** Regular-damage non-lethality
- **Page:** p119 (PDF idx 130)
- **Predicate:** A character whose hit points reach 0 solely via regular (sub-major) damage does NOT die and is not dying.
- **Quote:** "A character cannot die as a result of regular damage."

### J4. No negative HP; track stops at 0
- **Rule name:** HP floor at 0
- **Page:** p120 (PDF idx 131)
- **Predicate:** `current_hp` is never recorded below 0.
- **Quote:** "Cumulative damage ceases to be tracked once current hit points have fallen to zero; do not record negative hit points."

### J5. Dying condition: 0 HP AND Major Wound ticked
- **Rule name:** Dying condition
- **Page:** p120 (PDF idx 131)
- **Predicate:** `current_hp == 0` AND `major_wound == true` ⇒ character is dying.
- **Quote:** "A character is dying when their hit points are reduced to zero and they have also sustained a Major Wound."

### J6. Dying: CON roll at end of each round; one failure ⇒ death
- **Rule name:** Dying CON cycle
- **Page:** p120 (PDF idx 131)
- **Predicate:** A dying character makes a CON roll at the end of each round; first failed CON roll ⇒ immediate death.
- **Quote:** "The player must make a CON roll at the end of the next round and every round thereafter; if one of these CON rolls fails, the character dies immediately."

### J7. Damage > max HP in one attack ⇒ death inevitable
- **Rule name:** Overkill death
- **Page:** p119 (PDF idx 130)
- **Predicate:** A single attack dealing `damage > max_hp` ⇒ death (inevitable).
- **Quote:** "More than the character's maximum hit points, the result is death."

### J8. First Aid: within 1 hour, grants 1 HP; one attempt then must push
- **Rule name:** First Aid
- **Page:** p120 (PDF idx 131)
- **Predicate:** First Aid effective only within 1 hour of injury; restores 1 HP; second+ attempt is a pushed roll.
- **Quote:** "First Aid must be delivered within one hour, in which case it grants 1 hit point recovery. It may be attempted once, with subsequent attempts constituting a Pushed roll."

### J9. Medicine: ≥ 1 hour, restores 1D3 HP; Hard if not same day
- **Rule name:** Medicine
- **Page:** p120 (PDF idx 131)
- **Predicate:** Successful Medicine restores `1D3` HP; if performed on a later day than the injury, difficulty is Hard.
- **Quote:** "Treatment of injuries using the Medicine skill takes a minimum of one hour … If this is not performed on the same day, the difficulty level is increased (requiring a Hard success). A person treated successfully with Medicine recovers 1D3 hit points."

### J10. Regular-damage recovery: 1 HP/day (no major wound)
- **Rule name:** Regular recovery rate
- **Page:** p121 (PDF idx 132)
- **Predicate:** With Major Wound box unchecked, recovery rate = `1 HP / day`.
- **Quote:** "If the character has not sustained a major wound … the character recovers 1 hit point per day."

### J11. Major-wound weekly recovery: weekly CON roll; success 1D3, Extreme 2D3
- **Rule name:** Major-wound recovery
- **Page:** p121 (PDF idx 132)
- **Predicate:** Each week with Major Wound ticked: CON roll. Failure ⇒ 0 HP recovered; Regular/Hard success ⇒ `1D3`; Extreme success ⇒ `2D3`.
- **Quote:** "If the CON roll is failed, no recovery takes place that week. On a success, 1D3 hit points are recovered. On an Extreme success, 2D3 hit points are recovered."

### J12. Major wound clears on Extreme recovery OR HP ≥ half max
- **Rule name:** Major-wound clear condition
- **Page:** p121 (PDF idx 132)
- **Predicate:** Untick Major Wound when (a) the weekly CON roll is Extreme success, OR (b) `current_hp >= ceil(max_hp / 2)` (recovered to half or more).
- **Quote:** "Firstly, when the character rolls an Extreme success for their recovery (CON roll). Secondly, any time their current hit points have recovered to half (or more than half) of their full hit point total."

### J13. Armor reduces damage point-for-point (not vs magic/poison/drowning)
- **Rule name:** Armor reduction
- **Page:** p108 (PDF idx 119)
- **Predicate:** Final damage = `max(0, raw_damage - armor_points)` for physical attacks; armor does not apply to magical/poison/drowning damage.
- **Quote:** "Deduct the number of armor points from damage inflicted by attacks passing through the armor. Note that armor will not reduce damage from magical attacks, poison, drowning, etc."

### J14. Shotgun armor applies per damage die
- **Rule name:** Shotgun vs armor
- **Page:** p126 (PDF idx 137)
- **Predicate:** For shotgun damage rolled as N d6, subtract armor from EACH d6.
- **Quote:** "Armor ratings are factored against every D6 when rolling shotgun damage. Thus … an attack that deals 4D6 damage [is reduced] by 4 points [for 1-point armor]."

---

## K. Chases

### K1. Establishing the chase: speed roll (CON for foot, Drive Auto for vehicle) adjusts MOV
- **Rule name:** Speed-roll MOV adjustment
- **Page:** p132 (PDF idx 143)
- **Predicate:** On success ⇒ MOV unchanged; on Extreme success ⇒ MOV +1; on failure ⇒ MOV −1.
- **Quote:** "On a success: no change to MOV rating … On an extreme success: +1 to MOV rating … On a failure: –1 to MOV rating."

### K2. Fleeing character escapes iff adjusted MOV > pursuer's adjusted MOV
- **Rule name:** Escape-by-speed criterion
- **Page:** p132 (PDF idx 143)
- **Predicate:** Chase is NOT played iff `flee.adjusted_MOV > pursuer.adjusted_MOV`.
- **Quote:** "The fleeing character escapes if their adjusted MOV is higher than their pursuer."

### K3. Default starting range = 2 locations
- **Rule name:** Cut-to-the-chase gap
- **Page:** p133 (PDF idx 144)
- **Predicate:** A played chase begins with the pursuer 2 locations behind the fleeing character (default).
- **Quote:** "the Keeper should move the action onto the point at which pursuer is just two locations behind … The Keeper would normally set the starting range to two locations."

### K4. Movement actions = 1 + (MOV − slowest_MOV)
- **Rule name:** Movement-action count
- **Page:** p134 (PDF idx 145)
- **Predicate:** For each participant: `movement_actions = 1 + (MOV - min(all_participants_MOV))`. Slowest participant has 1.
- **Quote:** "Every character and vehicle gets one movement action by default. To this is added the difference between their movement rating (MOV) and the movement rating of the slowest participant."

### K5. Free movement costs 1 action per location
- **Rule name:** Open-ground movement cost
- **Page:** p134 (PDF idx 145)
- **Predicate:** Moving between two adjacent locations with no hazard/barrier costs 1 movement action.
- **Quote:** "If an area is free of hazards … the cost of moving from one location to the next is 1 movement action."

### K6. Cautious hazard negotiation: 1 movement action buys 1 bonus die (max 2)
- **Rule name:** Cautious-hazard bonus dice
- **Page:** p135 (PDF idx 146)
- **Predicate:** A character may spend movement actions to buy bonus dice on a hazard skill roll, up to 2 bonus dice (2 actions).
- **Quote:** "1 movement action buys 1 bonus die, or 2 movement actions buys 2 bonus dice (2 bonus dice is the maximum that can be rolled)."

### K7. Failed hazard ⇒ damage (Table III) + 1D3 lost movement actions
- **Rule name:** Hazard-failure cost
- **Page:** p135 (PDF idx 146)
- **Predicate:** On a failed hazard skill roll, the participant loses `1D3` movement actions (and may take damage per Table III).
- **Quote:** "Failing to negotiate an obstacle or taking damage is also likely to slow the character or vehicle; roll 1D3 for number of lost movement actions."

### K8. Barrier: blocks progress until broken or its skill passed
- **Rule name:** Barrier behavior
- **Page:** p136 (PDF idx 147)
- **Predicate:** A barrier prevents forward movement until its hit points are reduced to 0 OR the relevant skill roll succeeds; failure may impose damage + 1D3 lost actions but does not advance.
- **Quote:** "if it is a barrier it prevents further movement until the skill roll is passed or the barrier is broken through."

### K9. Breaking a barrier: vehicle inflicts 1D10 damage per Build point; failed breakage wrecks vehicle
- **Rule name:** Vehicle-vs-barrier damage
- **Page:** p137–138 (PDF idx 148–149)
- **Predicate:** A vehicle attacking a barrier deals `1D10 × vehicle.build` damage. If barrier survives, the vehicle is wrecked. If barrier breaks, vehicle takes `floor(barrier_hp_before_impact / 2)` damage.
- **Quote:** "For each point of their build, vehicles inflict 1D10 damage to a barrier … if a vehicle attacks a barrier and fails to destroy it, the vehicle is wrecked … the vehicle suffers an amount of damage equal to half the barrier's hit points prior to impact."

### K10. Conflict (same location) attack costs 1 movement action; resolved as combat
- **Rule name:** Chase conflict cost
- **Page:** p138 (PDF idx 149)
- **Predicate:** Initiating an attack in a chase costs 1 movement action; attack resolved per combat rules.
- **Quote:** "The characters or vehicles must be on the same location to attack one another, unless firearms are involved. Initiating an attack costs 1 movement action."

### K11. Successful fighting maneuver in a chase ⇒ target loses 1D3 movement actions (+ possible damage)
- **Rule name:** Chase maneuver effect
- **Page:** p138 (PDF idx 149)
- **Predicate:** A successful fighting maneuver in a chase causes the loser to lose `1D3` movement actions (and damage per Table III/VI if appropriate).
- **Quote:** "A successful fighting maneuver causes the same outcome as failing a skill roll for a hazard: 1D3 movement actions are lost."

### K12. Vehicle build damage threshold: every full 10 HP ⇒ −1 Build
- **Rule name:** Vehicle build decrement
- **Page:** p138 (PDF idx 149); p145 (PDF idx 156)
- **Predicate:** A vehicle's build decreases by 1 for each full 10 HP of damage taken; remainder < 10 ignored.
- **Quote:** "Each full 10 hit points of damage decreases a vehicle's build by one point (round down); any remaining damage below 10 points is ignored."

### K13. Vehicle impaired at build ≤ half starting build ⇒ 1 penalty die on Drive Auto
- **Rule name:** Vehicle impairment
- **Page:** p145 (PDF idx 156)
- **Predicate:** If `vehicle.build <= floor(starting_build / 2)`, all Drive Auto rolls take one penalty die.
- **Quote:** "If a vehicle's build is reduced to half (round down) of its starting value or lower, it is impaired; one penalty die is applied to all Drive Auto (or appropriate skill) rolls."

### K14. Pushed rolls are not used in a chase
- **Rule name:** No pushing in chases
- **Page:** p134 (PDF idx 145)
- **Predicate:** No pushed-roll event exists within a chase.
- **Quote:** "Pushed rolls are not used in a chase."

---

## L. Cross-Cutting Numeric / Consistency Rules

### L1. Half-threshold is floor (skill/2)
- **Rule name:** Hard target arithmetic
- **Page:** p83 (PDF idx 94); p91 (PDF idx 102)
- **Predicate:** For any `skill.value`, `target.hard == floor(skill.value / 2)` (e.g. 55 → 27).
- **Quote:** "Hard success: the roll is equal to or below a half of the character's skill or characteristic." (Harvey 55 → 27 example confirms floor.)

### L2. Fifth-threshold is floor (skill/5)
- **Rule name:** Extreme target arithmetic
- **Page:** p83 (PDF idx 94); p91 (PDF idx 102)
- **Predicate:** `target.extreme == floor(skill.value / 5)` (e.g. 40 → 8, 25 → 5).
- **Quote:** "Extreme success: the roll is equal to or below a fifth of the character's skill or characteristic." (Old Man Birch Fighting 40 → Extreme 8 confirms floor; Harvey 25 → Extreme 5.)

### L3. Physical human limit: Extreme success caps at skill + 100; beyond = no roll
- **Rule name:** Human-limit ceiling
- **Page:** p88 (PDF idx 99)
- **Predicate:** A character may attempt an opposed physical roll only if `opponent.value <= skill.value + 100`; otherwise impossible (no roll).
- **Quote:** "The upper limit of what can be faced with an Extreme success is 100 + the investigator's skill or characteristic. Anything beyond this is impossible for that character, and no dice roll is allowed."

### L4. Diving for cover ⇒ attacker takes 1 penalty die; diver forfeits next attack
- **Rule name:** Diving for cover
- **Page:** p113 (PDF idx 124)
- **Predicate:** A target that successfully Diving-for-Cover Dodge grants the attacker one penalty die and the diver forfeits their next attack.
- **Quote:** "Diving for cover requires a Dodge roll. If this is successful, the target presents a more difficult target and the attacker gets one penalty die. … A character that opts to dive for cover forfeits their next attack."

### L5. Fast-moving target (MOV ≥ 8) ⇒ 1 penalty die
- **Rule name:** Fast-moving target penalty
- **Page:** p113 (PDF idx 124)
- **Predicate:** Target with `MOV >= 8` ⇒ firearm attack takes one penalty die.
- **Quote:** "A target that is moving at full speed (MOV 8 or more) is hard to hit; apply one penalty die."

### L6. Target size: Build ≤ −2 ⇒ penalty die; Build ≥ 4 ⇒ bonus die
- **Rule name:** Target-size modifiers
- **Page:** p113 (PDF idx 124)
- **Predicate:** Build ≤ −2 ⇒ 1 penalty die; Build ≥ 4 ⇒ 1 bonus die.
- **Quote:** "If the target is Build –2 or smaller, apply one penalty die. Larger targets are easier to hit. If the target is Build 4 or larger, apply one bonus die."

### L7. 50%+ concealment ⇒ 1 penalty die
- **Rule name:** Concealment penalty
- **Page:** p113 (PDF idx 124)
- **Predicate:** If target is ≥ 50% concealed ⇒ 1 penalty die on the firearm attack.
- **Quote:** "Concealment of at least half of the target adds one penalty die to a firearms attack."

### L8. Prone shooter ⇒ +1 bonus die to Firearms; ranged attacks vs prone ⇒ 1 penalty die (ignored at point-blank)
- **Rule name:** Prone modifiers
- **Page:** p128 (PDF idx 139)
- **Predicate:** Prone character's own Firearms rolls gain 1 bonus die; ranged attacks targeting a prone character take 1 penalty die (no penalty at point-blank).
- **Quote:** "a prone character gets one bonus die when making a Firearms roll … those targeting a prone character with a firearm get one penalty die (ignore this if at point blank-range)."

### L9. Movement during combat: max MOV × 5 yards/round
- **Rule name:** Combat movement rate
- **Page:** p127 (PDF idx 138)
- **Predicate:** A character's maximum movement in one combat round = `MOV * 5` yards.
- **Quote:** "The maximum distance a character can move in one combat round is equal to their MOV rating multiplied by 5, in yards."

### L10. Spending Luck cannot buy off criticals/fumbles/malfunctions
- **Rule name:** Luck exclusions
- **Page:** p99 (PDF idx 110)
- **Predicate:** A critical, fumble, or firearm-malfunction outcome must remain regardless of Luck spent.
- **Quote:** "Criticals, fumbles, and firearm malfunctions always apply, and cannot be bought off with Luck points."

### L11. Luck spend is XOR with push (not both)
- **Rule name:** Luck-vs-push exclusivity
- **Page:** p99 (PDF idx 110)
- **Predicate:** For a single failed skill roll, the player either pushes OR spends Luck — not both; Luck may not be spent on a pushed roll.
- **Quote:** "When a skill roll is failed, the player has the option to push the roll OR spend luck; Luck points may not be spent to alter the result of a pushed roll."

### L12. Luck alters roll 1-for-1; only own rolls; not on damage/SAN/Luck/SAN-loss rolls
- **Rule name:** Luck-spend scope
- **Page:** p99 (PDF idx 110)
- **Predicate:** Each Luck point reduces a skill/characteristic roll by 1 (1-for-1); may not apply to Luck rolls, damage rolls, Sanity rolls, or rolls to determine SAN loss.
- **Quote:** "The player can use Luck points to alter a roll on a 1-for-1 basis … Luck points may not be spent on Luck rolls, damage rolls, Sanity rolls, or rolls to determine the amount of Sanity points lost."

---

## Notes for Validator Implementation

1. **Floor vs round.** Every threshold in CoC7e is **floor** (round down): half = ⌊skill/2⌋, fifth = ⌊skill/5⌋, build/2 for vehicle impairment = ⌊build/2⌋, barrier damage to vehicle = ⌊hp/2⌋. There are no rounding-up rules in this set.

2. **Fumble band uses the *effective target*** (the number actually needed at the chosen difficulty), not the raw skill. This is a common implementation bug — see rule B5 and the Harvey-Library-Use example.

3. **"Failed Sanity roll" triggers.** Three independent things fire on a failed SAN roll (rules F5, F6, G-fragility): (a) SAN loss > 0, (b) an involuntary action, (c) eligibility for the 5+ / fifth-based insanity cascades. A validator should assert all three are present in the event log.

4. **Insanity cascades are layered**, not exclusive: a single SAN loss event can simultaneously satisfy (i) ≥5 from one source → INT roll → temp insanity, and (ii) ≥ fifth current SAN in a day → indefinite insanity. Both checks should run.

5. **Bout-of-madness SAN immunity (G7)** interacts with **F4 notation**: a fumbled SAN roll still applies max loss *before* the bout begins; once the bout is active, no further SAN loss that bout.

6. **No-push scope** (rules D1, D4, D5, K14): pushes are forbidden for opposed rolls, combat rolls, chase rolls, and Luck/Sanity/damage/SAN-loss rolls. A validator should flag any pushed event whose source roll is one of these.

7. **Tick eligibility is conjunctive** (rules E1 + E2 + E3 + E10 + E11): a tick requires (a) a success, (b) on a pushable skill/characteristic roll, (c) with no bonus die, (d) on the winning side of any opposed roll, (e) without Luck spend.

8. **Page mapping verification.** All "p-numbers" above were matched to the PDF's printed page footer in the extracted text (e.g. "83", "94", "154") — these are the rulebook's own page numbers, not PDF indices. When the validator cites a page, use the printed number.

9. **Table VII vs Table VIII** distinction for bouts: VII = real-time (1D10 combat rounds, rolled per the table); VIII = summary (1D10 lookup, in-fiction time summarized, often 1D10 hours). A real-time bout event should not also have a Table-VIII summary roll, and vice versa.

10. **Page 209 "Failed Sanity Rolls" reference.** The user-flagged p209 in the PDF corresponds to rulebook p198 and is part of "Playing the Game"; the actual failed-SAN-roll mechanics live on rulebook pp154–156 (PDF idx 165–167). Rule F6 + G8 capture the relevant in-play rules.
