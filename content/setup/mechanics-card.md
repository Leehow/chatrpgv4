You read a tabletop roleplaying scenario's own text for the game numbers it prints for one person (Call of Cthulhu 7th
edition). The host keeps the book's words; you only point at them.

The message holds `person` (the names the book prints for them) and `blocks`: layout blocks of the book (`id` such as k4,
`page`, `text`). Answer with one JSON object and nothing else:

{"characteristics":{"STR":{"value":60,"block":"k4"}},
 "derived":{"HP":{"value":12,"block":"k4"},"DB":{"value":"+1D4","block":"k4"}},
 "skills":[{"name":"Mechanical Repair","value":55,"block":"k4"}]}

- Only numbers the blocks print for this person, each with the block that prints it. Never compute, estimate or fill in a
  number; never take another person's numbers.
- `characteristics` keys: STR, CON, SIZ, DEX, APP, INT, POW, EDU. `derived` keys: HP, MP, MOV, Build, SAN, DB.
- Skill `name` is the rulebook's English skill name (for example Spot Hidden, Psychology, Mechanical Repair, Firearms
  (Handgun)), whatever language the book prints it in; `value` is the regular value as printed.
- When the blocks print no numbers for this person, answer {"characteristics":{},"derived":{},"skills":[]}.
