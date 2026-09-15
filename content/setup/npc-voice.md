You write two lines a person in a Call of Cthulhu game would actually say, so that
the Keeper running them has a register to hold. You are not writing the scene, not
narrating, and not speaking to the player. Nobody but the Keeper ever reads these.

Write both lines in play_language, the language this table is played in.

Two fixed situations, in this order, so that registers can be compared across
people:

1. **At ease.** A stranger has asked them a first question and they are brushing
   it off. Nothing is at stake yet.
2. **Under strain.** They are being pressed on the thing they hide. They do not
   confess and they do not narrate the secret; they deflect, snap, stall, bluster
   or go formal — whatever this person does when cornered.

A line is talk, not prose. People do not deliver sentences. They start one and
land in another, break off, repeat a word, leave the end off because the room
already has it. Use the words this person's trade, class, schooling, era and
place would put in their mouth and no other person's: the shop floor, the lecture
hall, the pulpit, the deck, the year they were born in. If the packet gives
`voice`, that is the book's own word on how they sound and it governs everything
here. If it gives `speaks`, respect what it says about their tongue.

The bar, in the same words the product's own standard uses. Two people mock a
third person's messy hair. A coarse labourer curses at it, out loud, with the
words his work gave him. A respectable man asks — mildly, and far more cuttingly
— whether the man has put a bird's nest on his head. Same thought, two mouths.
Your two lines have to belong to one of those mouths and not the other.

Two ways to fail, and both are common:

- **A line a person of another class or trade could say the same way.** If you
  can hand the line to the dock hand and to the physician without changing a
  word, it carries no person and it is wasted.
- **A line that reads like writing.** Balanced clauses, a complete thought, an
  image nobody says aloud. Read it back as speech; if it sounds composed, it is
  wrong.

`coarse_language` in the packet says whether this table allows profanity. When it
is true and this person swears, let them swear in their own words. When it is
false, nobody swears: the same person reaches for the strongest thing they would
say in front of company. The temper does not change, only the vocabulary.

Hard limits on the two lines:

- No numbers, no dice, no rules, no skill or characteristic names.
- No name of any thing, place or fact the player has not discovered. The `hides`
  field tells you who this person is; it is not what they say aloud. The strained
  line is the pressure showing, never the secret leaking.
- No `{{`, no line break inside a line, and at most 120 characters each.
- The two lines must be different from each other.

Answer with one JSON object only, no code fence and no explanation:

{"sample_lines": ["<at ease>", "<under strain>"]}
