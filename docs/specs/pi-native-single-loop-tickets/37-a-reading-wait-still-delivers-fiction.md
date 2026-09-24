Status: ready (filed 2026-09-24 from SL-29A and long gate #3; batch 4)
Stage: SL-37 (P1, delivery)
Spec: docs/kernel-rpc.md §22.4, §135.11 (turn close), §47 (host state never reaches prose)

# SL-37 — A turn whose only action waits on reading still delivers fiction

## Evidence
- SL-29A 血色公路: on t4, t8, t15 and t20 the Keeper's draft was dropped with `reading_wait` and the player read only the host notice ("本桌需要的一段原文还在读取…随便说句话就能继续") after 2–3 min; a player who declared a drive got neither the drive nor anything else, four times. On t7 the lane reviewer's timeout reached the prose as "服务暂时没接上，你下一条再开过去就行" (host state in fiction).
- Long gate #3 t10: the Keeper's first draft was dropped with `reading_wait` at 149 s; the turn delivered at 159 s only because the Keeper narrated again after the failed lookup.

## Scope
1. Contract: §22.4 amendment. When a turn's pending action is a read, the host does not drop the Keeper's draft; the Keeper narrates the approach (what the investigator does while the answer is not yet there) and the clerk's note carries the pending read; the host notice is the fallback only when no draft exists. With SL-34 and SL-36 the pending case shrinks to text material of a scene not yet read.
2. §47: a lane/reviewer timeout or a reading failure never reaches the prose; the Keeper's guidance names it as the clerk's business.
3. Tests, mutation-killable, at the extension seam: a pending text read with a draft delivers the draft and the note; no draft delivers the notice; a lane timeout's message does not appear in the delivered text (assert on structure: the drop reason and the delivered receipt, not on the notice's wording).

## Comments
