# The opening a new player reads (2026-09-16)

Status: landed on branch `claude/opening-guidance-20260916`; both flows tested through the real setup assistant and the real Keeper (below).

## 1. The report

The user (2026-09-16): the guidance at the very start reads stiffly, is hard to follow, and it is hard to tell what is going on — on the shipped starter and on a PDF module alike; and the "Welcome, Investigator" card pinned above the transcript hides the conversation and is itself hard to read; fold it into the first line of guidance.

Read from the user's own App sessions (`~/Library/Application Support/Pipi/pipicoc/pi-coc/agent/ui-sessions/`), the first thing a player met was three pieces by three producers, and each was stiff in its own way:

1. **The prologue** (`guidance.opening`, written once per module by the character-guidance lane, shipped for starters as `content/starters/<id>/character-guidance/<tag>.json`). It dropped the player into a room with no orientation — 「秋日的波士顿，一间租务办公室里纸张堆得老高……」 — then a landlord's speech carrying four proper names that mean nothing yet (科比特宅、马卡里奥、疗养院、诺特), then 「你是哪位？平时做什么营生？」 with nothing to say that this is the player being asked to invent a character. The PDF module's was denser: 古比雪夫、内务人民委员部、卡西维依阿克塔伯三号农场、鲍里斯·加庞、第〇〇四四七号令, no line about who "you" are.
2. **The setup guide's replies.** Its voice was undefined: the landlord's gestures, an unnamed "我" inside the scene and rulebook words (栏、额度、信用评定、掷骰法) in one breath — 「诺特点了点头……在把你这张卡写出来之前，我想先问两三件小事……」. The guided-creation package's questions each opened with 「这一问定的是：……」.
3. **The Keeper's opening** re-asked who the visitor was after the card existed (「刚才我问你是谁、干什么营生，不是客套话……先说清楚你是谁」) and spent 300 characters on wind, clocks and knuckles before saying anything.

Plus the pinned intro card, a fourth voice above all three.

## 2. What changed

- **Prologue** (`content/setup/character-guidance.md`, review prompt): three parts in order — orientation in two or three plain sentences to "you" (when and where, who you are here in public terms, why you are in this room), then the guide's talk in the guide's own mouth, then one gesture and the question, worded so a rough answer is plainly enough. The city and the year do not count as names; beyond them at most two proper names, each with what it is; no street, house, family, organisation, decree or rank the player cannot yet use. The bar: a reader who has never played can answer where and when am I, why am I here, what is being asked of me now. The reviewer checks those three questions, counts the names and lists them. The starters' bundles were rebuilt (`scripts/build-starter-guidance.ts`); a PDF module regenerates on next setup because the fingerprint covers the prompts.
- **Setup guide** (`prompts/setup.md`; `guided-creation` 1.1.1): after the prologue's last line, the guide speaks as the host at the table, outside the story — never an unnamed "I" in the scene, never a question in the guide's mouth; plain words, no rulebook terms unless asked; one question per reply with one clause on why it matters and one example answer, five short lines at most; the draft is a five-line account and one invitation.
- **Keeper's opening** (host instruction in `extensions/kernel/index.ts`, `prompts/keeper.md`): with a committed prologue the identity is settled and is never asked again; open with one short paragraph that says where the player stands, then the guide reacts to who the visitor turned out to be and puts one concrete question or offer; talk over atmosphere, one sentence of room, one gesture per line, at most two new names each with what it is, the whole opening shorter than the prologue. Without a prologue: orientation first, same rules.
- **The intro card** (`Electron/packages/ui/src/CocGameIntro.tsx`, `content/ui/*/intro.json`) is gone. What it had to say now lives behind a **"?"** after the guide's question (user ruling, same day: immersion and guidance both — the prologue stays pure story, the explanation is one click away). The onboarding extension sends the `coc-setup-opening` message with `details.help = {title, lines}` from the extension surface (`setup_help_title`, `setup_help_1..4`, `setup_help_skip`; projected per play language, the zh-Hans seed shipped); the backend projects it as `help` on the history entry on the live reading and on every re-read; the transcript's opening renderer draws a small round button after the revealed text that opens and closes a fold: this is your investigator being made, a name and a trade is enough, two or three more questions then the sheet, the story goes on from this room, say "make the card now" to skip. `AssistantTranscriptContent.opening.test.tsx` pins the button, the fold and the re-read path.

## 3. Tested

Setup mode driven through `tests/play/driver.py` with a wrapper launcher (`bin/pi-coc setup …`), grok-4.6 as the guide; then the table opened in play mode for the Keeper's opening.

**Starter (The Haunting, `guide-starter-1`).** Prologue now: 「一九二〇年秋天，波士顿。你应一位房东的约，坐进他那间光线一般的小办公室。他需要有人来看看他刚继承的一处老宅——房客不肯住，名声也坏了。」 then Knott in his own words, then 「你是谁？平时靠什么吃饭？大概说说就行。」 The guide's first reply: two plain lines and one question with an example (「比如：我叫玛丽·柯林斯，给本市报纸跑社会新闻。」); the draft five lines; the Keeper's opening after the card: 「空屋子、坏名声，我这边每天都在赔。周先生，听清楚——这活儿按日算。一天二十块，先付一天。……接不接？」, 170 characters, no second asking of who he is.

**PDF (冰冷的收获, `guide-pdf-1`).** Prologue regenerated at setup: 「一九三七年十月，你被叫进安全机关一间指挥室报到……「我是格里戈里·帕维洛维奇·阿加宁，这儿管事的。上面把你派来了。乡下有些事要人下去看……你是谁？平时干什么的？说个大概就行。」」 — one name, "安全机关" in place of the acronym. The guide, the questions and the draft in the same host voice; the Keeper's opening reoriented (「你已经报过名——伊万·索科洛夫，州里的民警。差事还没落到纸上」) before the briefing. The briefing still carried three of the book's names in one breath (the farm, the family, the supervisor); the names cap now applies to the opening with a prologue too, added after this table.

Not verified as pixels: the App's rendering of the lead paragraph above the prologue (the pinned card is removed at the source; `CocGameIntro.test.tsx` went with it).

## 4. Design: three moments, one line each, once per device (2026-09-16, proposed)

What the research says (sources in the session log: Chaosium's *Alone Against the Flames*, Failbetter's Sunless Skies opening, Citizen Sleeper, AI Dungeon's Do/Say/Story, IxDF progressive disclosure, KP practice): teach inside the fiction where the fiction can carry it; where it cannot, a hint that fires **at the moment it is needed**, **once**, and is **ignorable** — never a card up front, never a spray of tooltips, and a veteran must be able to switch the whole thing off. The "?" of §2 is the right affordance; what it lacks is timing and memory.

### 4.1 The three moments

| moment | where it lives | what it says (one fold, ≤ 5 lines) | first time on this device | after that |
| --- | --- | --- | --- | --- |
| **the guide's question** (prologue) | the `coc-setup-opening` message's `help` fold (exists) | this is your investigator being made; a name and a trade is enough; two or three more questions, then the sheet; the story goes on from here; "make the card now" skips | fold **open** under the question, with a close | the "?" only |
| **what to type** (composer) | the composer placeholder, by phase | setup: *answer him — your name and what you do*; play: *say what your investigator does or says* | always (a placeholder costs nobody anything) | same |
| **the Keeper's opening** (first delivery) | the opening turn's delivery card gets the same `help` fold | you say what your investigator does or says, one thing at a time; when the outcome is uncertain the Keeper rolls and the roll appears as a card beside the words; ask "what is that?" whenever you like — an answer is never a penalty | fold **open** under the opening | the "?" only |

A fourth moment — the first dice card — is deliberately left for later: the card already names the check, and one more auto-open is one too many.

### 4.2 Memory and the switch

- `localStorage` per device, one key per moment (`pipicoc.hints.setup-opening`, `pipicoc.hints.play-opening`): unset means never seen, so the fold opens and writes the key when the player closes it or sends their first line. A new campaign on a seen device shows the "?" only.
- One product setting, **新手提示 / Beginner hints**, in the pack's settings surface beside difficulty and lane model: off means no fold ever opens by itself; the "?" buttons stay, because a veteran who forgets a detail should still have somewhere to click. Default on.
- Nothing is stored on the campaign and nothing reaches the model: the hints are the host's, in the play language, from the extension surface's captions (the two moments' lines are `setup_help_*`, already shipped, and `play_help_*`, new).

### 4.3 Where each piece goes

- **Prologue fold, first-time open**: `OpeningHelp` in `AssistantTranscriptContent.tsx` takes `defaultOpen`; the decision (key unseen and hints on) is made in the renderer from `localStorage`, the same place the speaker-colour slots and the old intro card kept their per-device state.
- **Composer placeholder**: `App.tsx` reads `timeline.ui.words.composer` (a new surface `content/ui/en/composer.json`: `placeholder_setup`, `placeholder_play`; the zh-Hans seed shipped) and the session's phase; the host already binds a session to `setup` or `play` (`PI_COC_MODE`) and the timeline's `ui` block carries the phase alongside the words. The generic shell text stays as the fallback for non-PipiCOC products.
- **Keeper's opening fold**: the kernel extension marks the opening turn's delivery (`details.help` on the narrate result it hands the card, turn 0 only, words from the extension surface); `pipicoc/mechanics.js` draws the same fold under the prose (the pack renderer cannot import, so it carries its own thirty lines; `speaker-colour.test.mjs`'s "copies do not drift" pattern applies).
- **Setting**: `pipicoc/settings-hints.js` beside `settings-difficulty.js`, a checkbox bound to `localStorage`; the folds read it.

### 4.4 Acceptance

A fresh device (cleared storage), one starter: the prologue arrives with its fold open under the question; the composer says what to answer; the Keeper's opening arrives with its fold open; both folds closed once stay closed on the next campaign; with the setting off nothing opens by itself and both "?" remain. Tests: `AssistantTranscriptContent.opening.test.tsx` (first-time open, seen key, setting off), a `mechanics.js` renderer test for the opening fold, an App test for the placeholder by phase, and the words tests for the two new surfaces.
