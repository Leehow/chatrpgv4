# Source-grounded review of 0.9.5a

Pinned commit: `6478133878b1fc574f98324401a60bd165d9b5f2` in `Leehow/chatrpgv4`.

This is a targeted static review, not a whole-repository audit or execution. Paths were followed from the real repository tree; old v1 assumptions about a different directory layout are not used.

## Verified source seams

| Path | Inspected evidence | Consequence for this revision |
|---|---|---|
| `content/craft/beat-directives.json` | Six `axis_lines`, eleven `directive_lines`, existing beat mapping and four floor lines | Positive replacement uses the actual consumed fields and preserves identities |
| `kernel-ts/read/content.ts` | `TextGraph` constructor and `style(language,register,beat,full)` | Do not add all new cards as graph directives; full mode selects all directive IDs |
| `prompts/keeper.md` | Keeper laws, tools, context/prose paragraph, NPC dossier interpretation, Writing, opening and source-reading instructions | English canonical instructions and direct play_language generation already exist; extend rather than replace |
| `mods/narration-audit/auditor.md` | Full continuity review instructions | Compatible invention is allowed; aesthetic grading is excluded; do not add a style refusal |
| `kernel-ts/read/capsule.ts` | Initial helpers and selected NPC projection sections, including `npcView` | Reuse existing NPC knowledge, relationships, commitments and recent speech |
| `runtime/jev/contracts.ts` | Decision question, batch, answer, result and normalization contracts in the first 210 source lines | Use the actual typed question shapes; existing adapter owns validation and usage |
| `runtime/jev/decision-port.ts` | `decide(batch, lease)` | No second client or key flow |
| `runtime/jev/presentation-references.ts` | Exact text aliases and translation/token handling | Presentation translation is not a prose-selection mechanism; do not conflate them |
| `extensions/jev/agent/index.js` | Existing configuration/status surface | No new Keeper writing tool is required |
| `kernel-ts/README.md` | Backend/build and Python-oracle boundary | New deliverable implementation is TypeScript; README claims are not fresh execution evidence |

## Source links

All links are fixed to the inspected commit, not a moving branch:

- [Craft table](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/content/craft/beat-directives.json)
- [TextGraph implementation](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/kernel-ts/read/content.ts)
- [Keeper prompt](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/prompts/keeper.md)
- [Existing audit](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/mods/narration-audit/auditor.md)
- [NPC projections](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/kernel-ts/read/capsule.ts)
- [Jev contracts](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/runtime/jev/contracts.ts)
- [Decision port](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/runtime/jev/decision-port.ts)
- [Presentation references](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/runtime/jev/presentation-references.ts)
- [Jev extension entry](https://github.com/Leehow/chatrpgv4/blob/6478133878b1fc574f98324401a60bd165d9b5f2/extensions/jev/agent/index.js)

## Exact patch baseline

| Target | Git blob SHA-1 |
|---|---|
| `content/craft/beat-directives.json` | `63fb86062f2df595eb1fd7a0151163ec2b25a8d8` |
| `prompts/keeper.md` | `dd6e1aa72c6f9cc64df670101243aeb38dfd2e3c` |
| Auditor, deliberately untouched | `3426413ddf968f403ca5a20a80db8db4c2ab483e` |

The patch tool checks target bytes using the Git blob hashing convention. Tests cover patch transformations and mismatch refusal on fixtures. The tool was **not** applied to a local checkout of the actual repository in this run.

## Findings that should not be hidden

1. `full` craft projection can flood the opening if cards are installed as ordinary directives. A separate optional host slot is necessary.
2. The Keeper's existing opening instruction still contains a local description/gesture quota. Its original orientation goal and scope must be considered before removing it.
3. The prompt says repeated spoken lines can be refused. This review has not located and rerun that specific validator. A meaningful-repeat card does not automatically override it.
4. `style.reference` and a registered craft task family are **new proposed interfaces**, not discovered installed features. The reference library does not prove that a new field survives assembly and budget reduction.
5. The existing audit permits incidental invention but also requires causal consistency and proper settlement. Neither v1's blanket no-new-facts rule nor an unrestricted prose world-writer matches that boundary.
6. New positive text may overlap the strong existing turn-floor paragraph. The initial patch replaces one paragraph rather than appending a long manual; test net behavior instead of accumulating reminders indefinitely.

## Coverage limits

No entire source tree, local campaign data, complete historical transcripts, compiled app, source-generation jobs, private credentials or running provider were inspected. Source files establish the seams above. They do not establish that all registrations, startup paths and fallback configurations behave correctly.
