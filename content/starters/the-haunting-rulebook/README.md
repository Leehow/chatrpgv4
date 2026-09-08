# The Haunting — source-bound build

The same scenario as the `the-haunting` starter next door, built from the book instead of
written around it: pages 446–462 of the *Call of Cthulhu Keeper Rulebook, 40th Anniversary
Edition* (Sandy Petersen, Mike Mason, Paul Fricker), read by the §14.5 build lane.

**Both are shipped and neither replaces the other.** `the-haunting` is the curated original
derivative and the fixture the kernel tests are written against; this one is what the book
itself supports, and every node in it cites the page it came from.

| | `the-haunting` | `the-haunting-rulebook` |
| --- | --- | --- |
| scenes / clues | 12 / 39 | 13 / 19 |
| endings / rules | 1 / 0 | 3 / 12 |
| playability | 2 findings (`actor_in_no_scene`) | none |
| NPC dossier | agenda, fear, secret, voice | those plus `believes` / `hides` / `asserts` / ties, each cited to a span |
| pregens | two | none — build an investigator in setup |

Play it like any starter: `campaign.create {module: "the-haunting-rulebook"}`, or pick it in
`bin/pi-coc setup`.

## What is committed here, and what is not

Only the graph: structure, and the summaries the build wrote. The book's pages, the bundle,
the evidence spans' text and every image stay out of the repository — the spans name a page
(`span-p13-5`) so the graph stays auditable to anyone holding the book, and resolve to text
only against a locally built bundle. `../the-haunting/README.md` has the recipe for
rebuilding that bundle from your own copy of the Rulebook.

The graph is not a substitute for the book: it carries no boxed text, no handout bodies and
no illustrations, and a Keeper running it is expected to own the Rulebook.

## How it was built

Historical provenance (the retired text pipeline): `module.bind` on a 17-page bundle → `module.plan` (one section) → three passes of the §14.5
reader (`grok-relay/grok-4.5`), the second and third as §14.6 deep reads. 90 nodes after the
first pass, 127 after the third, nothing dropped, every pass through all three gates with no
findings. The build telemetry is in the ignored `.coc/modules/the-haunting-rulebook/build.jsonl`.

## Not in the player catalog

`starter-listing.json` here declares `listed: false`. Both builds carry the module name
`The Haunting`, so listing both put two rows in the picker that a player cannot tell apart;
the comparison above is the point of shipping this one, and it is a comparison for us, not
a choice for them. It stays registrable by id — `campaign.create {module:
"the-haunting-rulebook"}` and the kernel tests are unaffected. Flip `listed` to true to put
it in the picker, and give it a title that says which build it is.
