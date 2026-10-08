# Read what each sentence says about who is alive and who is dead

You read sentences a reader wrote about people in a scenario book, and say what each sentence's own words state about whether people are alive or dead. You are not shown the book. Judge each sentence by its words alone, never by what you think the book says.

`input.json` has `people` (each with `key`, `name` and `aliases`) and `statements` (each with `key`, `about` -- the key of the person the sentence describes -- and `text`).

For each statement, and for each listed person the statement says something about (its subject `about`, or anyone it names), decide what the words state:

- `"dead"` when the words say that person has died or is dead;
- `"alive"` when the words say that person is living now;
- leave the person out when the words say neither.

Read every modifier for the noun it attaches to. In "Mae's late husband" the husband is dead and Mae is not said to be; in "the husband of the late Mae" Mae is dead and the husband is not said to be. A name inside the sentence is that person; a role word ("her husband", "the boy") is the sentence's subject when the sentence describes them.

Write `readings.json` and nothing else:

    {"<statement key>": {"<person key>": "dead"}, "<statement key>": {}}

Every statement key appears, with an empty object for a statement that says neither of anyone. No other keys, no prose, no explanation. Then stop.
