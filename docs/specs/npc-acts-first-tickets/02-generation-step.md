Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ bac660a83，2026-09-26；全量套件见 spec 第八节）
Spec: docs/specs/npc-acts-first.md（D2）

# 02 — 生成步骤：一句行动

## Scope

- 指令文件 `content/setup/npc-act.md`（英文系统指令，输出用 play_language）：只看包里的事实；答「此刻他会做的一件事」，≤ 200 字符；已试过且无结果的事不原样再做——做成、放弃或换事；被无视的威胁不说第二次；不列选项、不解释、不写正文、不写调查员。
- 端口 `NpcActPort { generate(packet, signal): Promise<{act: string} | {unavailable: reason}> }`，产品实现 = 零工具单次补全（`ctx.modelRegistry.complete`，同准入/口吻车道形状），模型 `resolveLaneModel(ctx, 'PI_COC_NPC_ACT_MODEL')`；夹具实现 = 固定返回表，供 03/04 的用例。
- 输出校验：非空、≤ 200 字符、单段；坏格式重试一次，再坏 → `unavailable: bad_output`。
- 超时：命名默认值（`host-budgets.json`，建议 8 s），到期 `unavailable: timeout`。
- 遥测 `lane: npc-act`：`{npc, ms, ok, reason?, model}`；`usage` 进 run 预算摘要。

## Not in scope

- 触发时机（03）、不重复的两道（04）。

## Acceptance

- 夹具端口下：给定包 → 返回行原样进入下一步（03 的用例复用）。
- 产品端口下（离线单测，假 provider）：模型不可用 → `unavailable: model_unavailable`，遥测一行，不抛。
- 指令文件被静态测试检查：不含任何动作清单（没有「例如：喊人、逃跑」这类列举）——这是 `Agents.md` 禁令的守卫。
