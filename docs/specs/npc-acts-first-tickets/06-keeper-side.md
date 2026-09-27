Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ 87b57e7e3，2026-09-26；全量套件见 spec 第八节）
Spec: docs/specs/npc-acts-first.md（D7）

# 06 — KP 侧：提示词、工具说明、否决面

## Scope

- `prompts/keeper.md` 在场段加一句：在场的人这一回合已经做的事在收据里（`present[].history.intents` 与本回合收据），正文写出它；要改结果，用 `apply npc {intent_ref, intent_outcome}` 明写，不许当它没发生。删掉 §142 时加的「spend_turn / first blow」教学句里与书记员默认攻击相关的措辞（现在没有默认攻击）。
- `extensions/kernel/tools.ts`：`intends` 描述加「桌子已替在场的人写过行动时，只在推翻它时再写」；压缩 `IntentResult` 在 10 个 effect 变体里的重复描述（同一句在 schema 里出现 10 次，8.9 KB；改成短句 + 一处长说明），改完过一次真桌（说明文字影响模型用法）。
- 拒绝的 `fix` 指明 ref 从哪来（复核漏报 A T12：KP 写了 `intent_ref: "@intent-placeholder"`）：`intent_settled` / `intent_unresolved` / 未知 ref 三种拒绝的 `fix` 都写「refs are on the capsule: present[].history.intents[].ref, or details.options here」，`details.options` 在三种里都给（`kernel-ts/apply/intent.ts`）。
- 桌上铸的人名用 play_language（复核漏报 A2 T10：`the doorkeeper` 出现在中文桌的名册里）：`apply npc`/person 的 `name` 描述加一句「a person this table mints is named in play_language: that name is what the player sees」；不做语言检测（记忆 `i18n-languages-and-ui-words-as-data`），只改说明并在 08 的真桌上数。
- 否决面用例：KP 在同一回合写 `intent_outcome: abandoned` + 自己的 `intends` → 两条收据，闸门不拦，下一回合包里两行都在。

## Not in scope

- 文风（prose mod 的事）。

## Acceptance

- ext 用例：KP 否决路径（上述）通过；`long-campaign-context` 的请求字节不高于现在（工具说明压缩后应更低，记数字）。
- 真桌一回合（08 的 C 桌顺带）看 KP 是否按收据写正文；不单独开桌。
