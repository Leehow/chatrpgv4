Status: ready (filed 2026-09-24 from the 血色公路 batch-5 table; batch 6)
Stage: SL-51 (P2, admission / kernel entities; follows SL-47)
Spec: docs/kernel-rpc.md §22.4.7 (SL-47 landing text), §135.31 (carried views), the `unknown_entity` refusal, §11.5 (NPC definition)

# SL-51 — A person the carried source text names is known to the run: a write about them registers them from the passage

## Evidence (ticket 29 batch-5 entry)
- `esso-station`'s carried pages (17–19) name three NPCs verbatim, 内特·帕特森 among them. At t7, before the scene's detail record landed (`read-5`), the Keeper placed him as present and was refused `unknown_entity: no npc named '内特·帕特森'`: the book named him in the text the host itself carried, and the product treated the write as an invention. A race inherent to SL-47's landing: the text arrives before the record.

## Ruling (owner, 2026-09-24)
What the carried source text names is not invented. A `person`/`npc` write whose name appears in the passages carried this run is accepted and registers the person provisionally from that passage (name, the page, the sentence), marked `from_passage`; the detail record, when it lands, replaces the provisional entry by name. The typed reviewer's grounds include the carried passages.

## Scope
1. Contract: §11.5 / §22.4.7 amendment (new subsection): provisional persons from carried passages; replacement on record landing; `unknown_entity` only when neither the graph nor the carried text names them.
2. Kernel (`kernel-ts/apply/entities.ts`, the npc registry) and the host (the carried view's names passed with the write): the name check consults the run's carried passages (structural: exact name match in the carried text, no fuzzy matching in code; a Jev question for a variant spelling is allowed).
3. Tests, mutation-killable: a person named in the carried text is accepted and registered `from_passage`; a person named nowhere is still refused; the record landing replaces the provisional entry once.

## Comments
