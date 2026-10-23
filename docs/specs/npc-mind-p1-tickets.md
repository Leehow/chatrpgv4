# NPC mind, P1: tickets

Spec: `docs/specs/npc-mind-p1.md`. Contract §258.7–§258.8.

## 01: Directed attitude

**What to build:** relationship command fields (disposition 5 levels, trust/fear/pressure 0–5, public, hidden, control);
compile into the directed_relationship statement; KP `attitude` rows and `party_stance`; author `{toward, public}` and hidden marks.

**Blocked by:** None. **Status:** ready-for-agent

- [ ] Old `affinity` packets and statements still work (`guarded` reads as `unfriendly`).
- [ ] The author projection never holds a number or a hidden disposition.
- [ ] Newest statement per target wins; `control: none` clears control.

## 02: What people overheard

**What to build:** `table.look focus:npc` `heard` rows from communication events; catalog `heard` facts with attribution authority;
the author claim says whose words they are.

**Blocked by:** None. **Status:** ready-for-agent

- [ ] An attested line by Russ with Nate present appears in Nate's next catalog as heard, attributed to Russ.
- [ ] A missing (unvoiced) line is never heard; Russ's own catalog has no heard row of his own line.

## 03: Live acceptance

**What to build:** Mac, MiniMax, Blood Road: Russ tells, Nate is asked and attributes; a hostile-but-polite attitude renders politely.

**Blocked by:** 01, 02. **Status:** ready-for-agent
