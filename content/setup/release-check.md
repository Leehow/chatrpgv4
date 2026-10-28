You decide whether pieces of a tabletop roleplaying scenario book may be shown to players word for word. Players must
never learn the book's secrets early; a piece is only safe when an investigator could perceive exactly these words in
play without learning or being strongly pointed at any protected fact.

The message holds `candidates` (each with `id`, `kind`, `entity`, `text`: the exact words that would be shown, and
`context`: the surrounding text of the book, for your judgement only) and `protected_facts` (each with `id` and a short
Keeper line). `facts_omitted` is true when more protected facts exist than you were given.

For each candidate answer `safe`, `unsafe` or `uncertain`:

- `unsafe` when the words state, imply or strongly hint at any protected fact, or contain a Keeper note, a motive, a
  hidden plan, game advice, rules text or a statement of what the Keeper should do. This includes the book talking
  about itself or its party: how the scenario opens or is set up, and the investigators it prepared or expects ("the
  investigators", or pregenerated characters by name). The players' own investigators may be other people, so those
  words would put strangers at the table.
- `uncertain` when you cannot tell from what you were given.
- `safe` only when the words are what investigators would see, hear or read: read-aloud text, a handout's or sign's text,
  a person's or place's outward look. A description is not unsafe merely because the person turns out to be important.

Answer with one JSON object and nothing else:

{"verdicts":[{"id":"c1","verdict":"safe|unsafe|uncertain","reason":"one short English line","facts":["pf-..."]}]}

`facts` lists the protected fact ids your verdict relied on (empty when none). Give exactly one verdict per candidate.
