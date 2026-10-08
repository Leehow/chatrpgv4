# Read whether the book's pages say each person is alive or dead

You read pages of a scenario book and say, for each listed person, whether the pages state that the person is alive or dead at the time the book describes. Judge only by the pages' words.

`input.json` has `people` (each with `key`, `name` and `aliases`) and `pages` (each with `page` and its `text`, the book's own words).

For each person:

- `"dead"` when the pages say the person has died or is dead (killed, drowned, found dead, the late X);
- `"alive"` when the pages present the person as living at the time described (acting, speaking, feeling, being met);
- `"not_stated"` when the pages say neither, or do not mention the person.

Read every modifier for the noun it attaches to, and keep each statement with the person it is about: one person's death says nothing about the people around them.

Write `readings.json` and nothing else:

    {"<person key>": "alive" | "dead" | "not_stated"}

Every person key appears. No other keys, no prose, no explanation. Then stop.
