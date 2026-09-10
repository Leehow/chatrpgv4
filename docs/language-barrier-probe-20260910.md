# Language at the table: what the probe showed, 2026-09-10

Scope: Natural NPC 1.1.0's language barrier, from the capability under it to a real Keeper
writing with it. Work is on `claude/mod-vocabulary-20260909`. The probe is a staged
diagnostic, not acceptance: it shows the chain carries and the Keeper uses it. Whether the
feature plays well is still a question for a real session.

## What was proven, and how

| Link | Evidence |
| --- | --- |
| A package can add a word to the dossier spine | `graph.vocabulary.v1`; Natural NPC 1.1.0 contributes `language`, arriving as `speaks` |
| The reader is asked for it by name | A real `module.read.claim` packet carried `contributed: ['language']` with the package's own ask |
| The module records what it was read under | That book's `module.json` carried `vocabulary.actor_profile_keys = ['language']` |
| It reaches the Keeper | `look focus=npc` showed `speaks: "Italian; almost no English"` in the turn dossier |
| It survives the package being turned off | The key still projects; provenance is the module's, not the campaign's locks |
| The Keeper writes with it | Four live turns on `xai/grok-4.6`, below |

The first staging bound a synthetic PDF. `lookup kind=source` correctly reported the read
as pending and the Keeper correctly refused to play; the product was right and the staging
was not. The second used a starter, which has no source to read.

## What the Keeper wrote

Investigator: `own_language: English`, `Language (Other: Italian) 20` -- the rulebook's
broken-speech band (10-30). NPC: a tenant the book gives `Italian; a few words of English`.

Speaking and listening both degraded, in every turn and never the same way twice: "词挤出来，
断成一截一截", "你只抓住夜里、有东西、压下来", "其余音节滑过去，像水". Every line carried the
play language with the other tongue as fragments inside it, which is also the only shape the
delivery floor permits.

The half that is a mechanic rather than texture arrived without being asked for. Told "带我去
地下室" in broken Italian, the tenant caught the nouns and not the request, refused to guide,
and the landlord -- a third party -- changed his own behaviour because of the failed exchange:
「海斯。说英语。」... 「她是来答话的，不是来当向导的。」 The Keeper also declined to invent a
cellar door the scene did not have.

`language_mixing` was checked against itself on the same question. At `light`, foreign
fragments (`cantina`, `là… male… non`) and an NPC's English kept verbatim. At `off`, no foreign
characters at all, while the barrier itself remained in narration: "你听得懂的只有：不要。下面
——不要。其余的话滑过去". The setting turns off the rendering, not the mechanic.

## What the probe staged rather than played

The tenant's `language` and her presence in the opening scene were written into a scratch copy
of the book, and the investigator's Italian into a scratch pregen. In a real module the reader
extracts all of it, which the first staging proved end to end. The equipment materializer was
disabled for the probe: reconciling unregistered starting kit is right at a real table and spent
most of a turn before the Keeper reached the scene under test.

## Defects the probe found

| Defect | Status |
| --- | --- |
| A Mod agent timeout always blamed the definition agent, so an audit deadline told the Keeper to "retry with fewer define effects" on a turn that defined nothing. It retried the same narration three times and burned about ten minutes. | Fixed: `mod_agent_failed` carries `role`, and the roles are told opposite things. |
| The audit gate failed closed when it could not reach a verdict, losing the turn rather than the audit. | Fixed (contract 26.1): a deadline lets the delivery through and is recorded as an unaudited turn; every other failure still refuses. |
| Natural NPC 1.1.0's audit read a language checklist on every turn that settled a first impression, barrier or not. | Fixed: the section skips itself unless the narration carries a barrier, and asks three things rather than eight. |
| A turn that timed out left the kernel turn open, so the next session replayed it and the new input never got in. | Follows from the two above; not separately fixed. |
| The driver read the opening run's `agent_settled` as the answer to the first turn's prompt: the turn was recorded empty in a tenth of a second while the Keeper played it unwatched. | Fixed: a turn now begins from a quiet agent, and a settle arriving before any work is recorded as `stale_settles`. |
| The Keeper once sent `ask` with the prompt `test`. | Not fixed: the kernel requires a non-empty prompt and cannot judge whether a question is meaningful without classifying prose. |

## Not carried over

`driver.py` has no thinking-level flag, so the runs were `reasoning_effort: medium` rather
than the low that was asked for. Whether `full` mixing differs from `light`, and whether the
barrier holds across a long session, are unmeasured.
