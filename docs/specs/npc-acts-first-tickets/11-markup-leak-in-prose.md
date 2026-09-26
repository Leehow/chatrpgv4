Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ 3860ffeb7，2026-09-26；全量套件见 spec 第八节）
Spec: docs/specs/npc-acts-first.md（第七节「复核漏报的处置」）

# 11 — 玩家看到的正文里漏出标记

## 证据

- A2 桌 T6 交付正文末尾是字面的 `</text>`（`.coc/campaigns/npc-actor-gate-a2/turns/0006.json` 的 `text` / `rendered_text`，driver 的 `turn-6.json` `final_text` 同）。仓库的 prompts、mods、content、extensions/table、runtime 里没有 `<text>`（已 grep），来源待查：narrate 的参数原文（turn 记录 `calls` 里的 args）、vendored Pi 的输出包装、还是模型自己的习惯。
- A2 桌 T7 正文里夹了两行 markdown 列表（`- 钥匙还躺在……`、`- 桌上那幅……`）。

## Scope

- 先查来源：读 T6 的 narrate 调用参数（`turns/0006.json` → `calls`）判断标记是模型写进 `text` 的还是宿主渲染加的；查 `vendor/pi` 与 `Electron` 里有没有 `<text>` 包装；结论写进契约。
- 交付闸门（结构，不是语义）：narrate 的 `text` 含 XML/HTML 形状的标签（`</?[a-z_]+>` 这种**语法类**，不是词表）或以 markdown 列表/标题标记开头的行 → 拒一次并 steer「player-facing prose carries no markup; write it as prose」，同 `repeated_line` 的形状（§113 D、§135.11 的 steer 预算）；第二次照收但 `warnings` 里记 `lane: delivery, kind: markup_in_prose`。`{{say}}` 等宿主自己的记号不算（先按 §40 的记号语法剔除再判）。
- 遥测 `lane: delivery` 记 `markup_in_prose` 次数。

## Not in scope

- 文风；prose mod 的写法。

## Acceptance

- ext 用例：narrate 文本尾带 `</text>` → 第一次 `needs` 且 steer 文本到位；改写后交付；带 `{{say:...}}` 记号的正常正文不被误拒；markdown 列表行同样一次拒；两次仍带 → 交付并有 warnings 行。
- 变异：把闸门去掉，第一条用例逮住。
- handoff 写明 `</text>` 的来源结论。
