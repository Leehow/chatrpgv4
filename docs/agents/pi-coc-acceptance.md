# Pi-Coc acceptance

Only for Pi-Coc product acceptance. Grok is the KP and the main testing session is the player. This does not assign the coding assistant a KP role.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## Pi-Coc Playtest Method

Pi-Coc 验收 / 体验 / **开桌** / **实机测试** / **端到端** 的唯一方法。
用户说这些词，就是在点这条，不是在点建战役、pytest、或把 CLI 扔给用户。

1. 通过 pi-coc **RPC 模式**启动插件（`tests/pi/_lib/rpc-driver.py` 只做传输）。
2. **Grok 当 KP**（默认 `xai/grok-4.6`），驱动全部 Keeper 判断、叙事、NPC、规则调用。
3. **本主会话就是唯一玩家。** 一次一句自然回复，从建卡/开场跑到结构化结局或真阻断。
   不要问「要我当玩家吗」「你要接着走吗」。角色已经定死。
4. 沿途覆盖要测的能力点（建卡、开场、线索、战斗、SAN、结局等），
   不预设固定脚本，由 KP 正常推进。
5. 慢可以，假不行。不得用批处理、工厂、canned scene 制造回合数。
6. 跑完后用 `coc-export-battle-report` 出战报；战报是实际游玩证据。

硬禁止（违反即 `invalid-for-acceptance`，即使战役目录已经存在）：

- 只用 `setup.quick_start` / `coc_toolbox` 建战役，然后让用户自己去开 `pi-coc`。
- 把「开桌」理解成 TUI/PipiUI 窗口交给用户点。
- 用 pytest、fixture、scripted player、第二套 Keeper 冒充游玩。
- 开场一句之后停下来征求许可。桌已开就必须继续当玩家，直到结局或真阻断。
- 绑错 starter 还接着演（例如要测 `mystery-house` 却装上 `the-haunting`）。停、留证据、新战役 ID 重开。

本节是 Pi-Coc 轨道的验收方法；其它宿主目录中仍可能提供 `coc-playtest`，它不替代本轨道的方法。任何声称「测完」或「体验等价」
的工作必须匹配上述流程，否则标记 `invalid-for-acceptance`。

<!-- Restored 2026-09-05. The AGENTS.md split dropped this section
     entirely -- not reworded, not moved: every distinctive phrase in it
     had zero hits anywhere in the tree. It is the one rule in the file
     that records having been violated four times, and losing it in a
     refactor is how it gets violated a fifth. -->

## Standing Memory: Never Destroy Playtest Evidence Without Authorization

This is permanent project law. A playtest run's campaign state, logs, tool
calls, transcripts, and session files are the **sole evidence** for battle
reports, bug diagnosis, and experience claims. Destroying them after a run
— by habit, by "clean-slate" reflex, or to tidy up — has repeatedly wiped
out the exact data needed to export reports and root-cause issues. **This
error has been made four separate times. It must not happen again.**

1. **Never `rm -rf` a campaign, its `.coc/campaigns/<id>/` directory, its
   logs, its investigators, or its module-assets root after a real run** —
   not even "to clean up for the next test." Keep it until the user
   explicitly says to delete it, or until a battle report has been
   successfully exported from it via `coc-export-battle-report`.
2. Module-assets (`source-bundles`, `module-assets/`) are reusable parse
   caches; deleting them invalidates `lookup_by_sha256` reuse and forces
   re-parse. Do not delete them to "start clean" unless the user asks.
3. If a new run needs a fresh campaign, **create a new campaign ID** (e.g.
   `amaranthine-16`) — do not destroy the previous one to reuse its slot.
4. The `coc-export-battle-report` skill is the **sole** final report owner.
   A hand-written Markdown summary is a draft, never a substitute. Before
   writing any report, confirm the campaign evidence still exists; if it
   was destroyed, state that honestly and do not reconstruct from memory.
5. This rule survives compaction and handoff. "I forgot" or "I was just
   cleaning up" is never an acceptable reason for missing run evidence.
