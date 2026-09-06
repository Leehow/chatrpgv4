# resolve regression corpus

Each file is one recorded `rules.settle` payload from the old repo
(`tests/fixtures/rules-settle-recorded/`) translated into an equivalent `table.resolve` action.
`test_corpus.py` replays each through the RPC seam and asserts the same decision is selected and the
effect/event kinds match; dice are random and never compared.

Translated: 42. Skipped (session families, second half of slice 1): chase-start-090232bd.json (chase:start), combat-attack-69d75d17.json (combat:attack), combat-end-bd1fcaba.json (combat:end), sanity-check-093c39cd.json (sanity:check), sanity-check-1cab0929.json (sanity:check), sanity-check-269b1f01.json (sanity:check), sanity-check-34753d73.json (sanity:check), sanity-check-5d064528.json (sanity:check), sanity-check-67a578c9.json (sanity:check), sanity-check-94961aa2.json (sanity:check), sanity-check-a1faf771.json (sanity:check), sanity-check-b6080a38.json (sanity:check), sanity-check-bout-dfcd31d4.json (sanity:check), sanity-check-da76d64d.json (sanity:check), sanity-check-dfcd31d4.json (sanity:check), sanity-check-f8cc9a42.json (sanity:check), sanity-check-trigger-df198a61.json (sanity:check)
