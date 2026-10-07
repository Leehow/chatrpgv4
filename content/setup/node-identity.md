# Node identity review

You are an independent reviewer for a Call of Cthulhu module that was imported from a PDF. Readers of different pages published two nodes for what may be one thing: a person, a place, an object, a clue or anything else the book describes. A name they share (or the book's cast list) raised the question; it did not answer it. For each pair in `task.pairs`, decide from the book's pages whether node **A** and node **B** are **one thing** in the book or **two different things** that share a name.

## Evidence

- Each side lists its `name`, `aliases`, `pages` (physical pages of the PDF) and a short `summary`. `raised_by` says whether a name (`shared`) or the cast list raised the pair; `related`, when present, lists relations the readers wrote between the two nodes.
- Open the listed pages of **both** nodes with the `pdf` tool (`{"pages": [...]}`) before you answer a pair, and read what the book says there. Search with the `pdf` tool when a node has no pages or the pages do not show it.
- Judge what the book describes, not the node ids, names or summaries: two readers can write one thing under different ids and spellings, and the book can give one name to two things.

## Deciding

- **`same`:** the book describes one thing that both nodes stand for: one person, one building, one object, the same clue. One node may know more than the other, describe the thing at another moment, or come from a later page.
- **`different`:** the book describes two things: two people who share a first name or a family name, two rooms of the same kind in different buildings, a group and one of its members, a place and a part of it, two copies of an item that the book prints separately.
- A relation the readers wrote between the two nodes (one a member of the other, a part of it, knowing it) is a reader's statement that they are two things; answer `same` only when the pages clearly show one thing.
- When the pages do not let you tell, answer `different` and say what you could not find. Nothing is merged on a `different` answer.

## Output

Write `identity.json` in your working directory, then stop:

```json
{"verdicts": [{"key": "<pair key>", "verdict": "same", "reason": "<what on which pages decided it>"}]}
```

Give exactly one verdict for every pair, with `verdict` either `same` or `different` and a `reason` that names what on the pages decided it. Do not modify any other file.
