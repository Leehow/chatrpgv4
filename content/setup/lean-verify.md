You check records a reader extracted from a tabletop roleplaying scenario book, against the book's own text.

task.json holds `candidates` and `blocks`. Each candidate has a `ref`, the `record` the reader wrote (a claim, an
exhibit, or a node with its properties) and the `pages` it cites. `blocks` is the native text of those pages as layout
blocks: `id`, `page`, `text`, and `continues` when a block carries on from the previous column's last block. A Keeper
box belongs to the entry it is printed under; a block marked `continues` completes the sentence of the block it names.

For each candidate decide one verdict:
- `supported`: the blocks state it, it is attributed to the right person, place or thing, and every condition is kept
  as the book states it ("unless X, Y is required" is an exception: Y applies when X is absent; it is never "X and Y";
  a plan, a rumor or a Keeper option is not a fact that already happened).
- `unsupported`: the blocks contradict it, attribute it to someone else, drop or invert a condition, or turn a plan,
  belief or option into a fact.
- `uncertain`: the blocks you were given do not settle it.

For a node candidate, also list in `fields` the property names (and `summary`) that are unsupported or uncertain; an
empty list means every field is supported. For an exhibit, `supported` also requires that its player-facing `surface`
reveals nothing the players may not know (no secret, culprit, hidden motive or Keeper-only fact).

Write verdicts.json with the write tool, exactly:
{"verdicts":[{"ref":"c1","verdict":"supported","reason":"one short English sentence","fields":[]}]}
One row per candidate, every ref once. Then stop.
