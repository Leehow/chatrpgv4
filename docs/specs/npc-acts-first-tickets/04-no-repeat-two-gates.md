Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ f098fdae6，2026-09-26；全量套件见 spec 第八节）
Spec: docs/specs/npc-acts-first.md（D2 不重复两道、D6）

# 04 — 不重复的两道与欠账衔接

## Scope

- 结构一道：生成行的 `intentRef` 等于他任一未结（`attempted`）行的 ref → 不新开行，绑定时带 `intent_ref`，结果按 §138.15（passed→done、failed→failed、intention_only→仍 attempted）。
- 语义一道：Jev 闭合问题「这句与他最近 N 行（命名默认值 5，`intentsView`）中的哪一行是同一件事 / 都不是」，选项就是那 N 行的文字。选中且该行无终态 → 重问生成器一次，包加「他已经做过 X，没有结果；这次要么给它结果，要么做别的」；第二次仍选中 → 按「继续 X」绑定，X 结为 `abandoned`（`why: repeated`），不再重问。选中且该行已有终态 → 视为新行（做过的事在新处境下再做一次是合法的，例如又被打了再躲一次），不重问。
- 欠账衔接：D1 的包里「做过什么」带上回合的行与结果；`intention_only` 连续两回合被判同一件事 → 第二次结 `abandoned`。§138.7 的 narrate 闸门不改。
- 禁止：任何词表、正则、文本相似度（`Agents.md`）。

## Not in scope

- 生成器指令的措辞以外的内容审计。

## Acceptance

- 夹具端口返回同一行两次（第二次是换了说法的同一件事，Jev 夹具判「同一」）→ 第一回合 `attempted`，第二回合重问一次、夹具仍同 → 收据：上一行 `abandoned` + 本回合按「继续」绑定；第三回合包里不再有该行为 attempted。
- 夹具判「都不是」→ 两行各自登记，不重问。
- 上一行已 `failed`，本回合同一件事 → 不重问，新行登记。
- 变异：把「第二次仍同则 abandoned」删掉，用例必须逮住（会看到第三回合仍 attempted）；把重问删掉，「重问一次」的遥测断言逮住。
