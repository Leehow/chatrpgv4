# Graph grounding probes (contract §199, docs/specs/graph-grounding.md GG-05)

Each probe's outcomes were written here before it ran; the results follow each block. Scripts are beside this file;
they read the App's data only through `cp -c` clones and keys only in memory (the vault for Jev, `auth.json` for the
provider), and write nothing to the App.

# Pre-registered: Jev claim-support (family v2, as shipped) on Vasili's summary — written 2026-10-08 before the probe runs

Input: Vasili node from read-30 draft; cited page 34 native text (cast-source.json); 3 repeats.
Statements:
 F1 (the published one, false): 「嘉琳娜已故的丈夫。」  -- says the husband is dead
 F2 (explicit false): 「瓦西里已经去世。」
 T1 (true paraphrase): 「嘉琳娜的丈夫；嘉琳娜死后他愈发沮丧。」
 T2 (true, the p8 reader's wording): 「嘉琳娜的前夫」

Outcomes:
 (a) Jev usable as a refusal signal: F1 contradicted >= 0.5 in >= 2/3 repeats AND T1,T2 contradicted <= 0.2 in all repeats.
 (b) Jev catches only the explicit one: F2 >= 0.5 but F1 < 0.5 -> modifier attachment is the "indirect reasoning" failure; Jev unusable for this defect.
 (c) Jev noisy: T1/T2 contradicted > 0.2 in any repeat, or F1 between 0.2 and 0.5 -> unusable as a gate.
Decision: (a) -> build the gate on Jev claim-support's contradicted Noul. (b)/(c) -> do not rely on Jev; use the vision reviewer with a field-level pointer.

# Pre-registered: reviewer-style narrow question (gpt-6-luna, thinking low, the reviewer's model) — before the probe
Text-only stand-in for the vision reviewer: page 34 native text + the node + the pointer /nodes/5/summary with the
person-state instruction. 3 repeats for F1 (「嘉琳娜已故的丈夫。」) and 3 for T1 (「嘉琳娜的丈夫；嘉琳娜死后他愈发沮丧。」).
Usable: F1 unsupported 3/3 and T1 supported 3/3. Any F1 supported -> the field pointer + instruction is not enough by itself.
Also run the SAME prompt without the person-state instruction (node-level, as read-30 ran): expected to reproduce "supported" for F1 in >= 2/3 (this is the evidence's failure).

# Result of probe 1 (Jev claim-support, run 2026-10-08): outcome (b).
F1 supported 0.85-0.88 / contradicted 0.08-0.10 (3/3); F2 contradicted 0.74-0.87; T1 supported 0.92-0.93; T2 contradicted 0.54-0.62.
Jev reads the explicit death but not the modifier's attachment. Decision: the vision reviewer, field-level.

# Pre-registered: B-J1 first-meeting sentence filter (Jev Noul per biography sentence), 2 repeats, threshold 0.5
want LOW (< 0.5): Maria s1 (infected / village whore), Maria s3 (tentacles), Aganing (bribery & extortion got him the post),
  Ekaterina (despair Lloigor brings), Dmitri (Lloigor mutation sixth finger; mixed sentence, low preferred, one miss allowed)
want HIGH (> 0.5): Aganing (tall, imposing), Dmitri (lethargic, muddy), Ekaterina (plain, babushka), Raisa (ten, black hair, charcoal), Leonid (weathered face, blond)
Usable: every LOW < 0.5 and every HIGH > 0.5 in both repeats (one miss allowed on the mixed Dmitri sentence).

# Pre-registered: B-J2 word-about-this-person (Jev Noul), 2 repeats
HIGH (>= 0.5): 「戴眼镜、浓密胡须的NKVD医生」 vs Timur; 「沾满木炭灰的十岁女儿」 vs Raisa
LOW (<= 0.3): 「戴眼镜、浓密胡须的NKVD医生」 vs Raisa, vs Aganing; 「沾满木炭灰的十岁女儿」 vs Maria
Observed only (no gate): 「指挥室桌后的高大上校」 vs Aganing (rank not in material), 「睡地板、右手六指的脏儿子」 vs Dmitri ("sleeps on floor" only in the handle)
Usable: all HIGH >= 0.5 and all LOW <= 0.3 in both repeats.

# Result of the live replay GG-05 (reviewer = gpt-6-luna low, field pointer + new instruction), 2026-10-08 10:21
/nodes/5/summary 「嘉琳娜已故的丈夫。」 SUPPORTED in both verify rounds ("...explicitly says she died; the summary correctly calls
him her late husband"). The full repair round's reader wrote the same summary again. Pre-registered bar (F1 unsupported) FAILED:
the same model that writes the error reviews it and shares the misreading. The field pointer alone does not fix it.

# Pre-registered: narrow questions to the same model (gpt-6-luna, thinking low), 3 repeats each, before the probe
Q-statement: "According to this statement alone, who is dead?" with the statement and the two names; JSON {vasili, galena} in {alive, dead, not_stated}.
  F1 「嘉琳娜已故的丈夫。」 expected vasili=dead. T1 「嘉琳娜的丈夫；嘉琳娜死后他愈发沮丧。」 expected vasili!=dead, galena=dead.
Q-page: the same question over page 34's text. Expected vasili!=dead, galena=dead.
Usable for a decomposed check (code compares the two readings): F1 vasili=dead 3/3, T1 vasili!=dead 3/3, page vasili!=dead 3/3.
Otherwise the same model cannot be the judge of this statement at any granularity; a different judge needs the owner's ruling.

# Result of the narrow probe (gpt-6-luna low, 2026-10-08 10:40): F1 vasili=dead 3/3; T1 vasili=alive galena=dead 3/3; PAGE vasili=alive galena=dead 3/3. Usable.
# Decision: the person-state reading (two tool-carrying children that never see each other; the host compares the living state).

# Pre-registered: GG-05 run 2 (same replay, person-state reading wired in)
Pass: round 1's person-state evidence records the mismatch for Vasili's summary (said dead, pages alive) and the gate refuses
the round; the job ends with either a published Vasili whose summary does not call him dead, or no Vasili published (a settled
refusal). Fail: a published summary that calls him dead.
