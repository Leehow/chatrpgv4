# Pi runtime roles and persistence

Before changing launchers, role prompts, onboarding, context delivery or persistence. The product launchers use `--no-context-files`; a reference added to root AGENTS.md does not reach a live KP automatically. Stages without `read` must keep their existing runtime-delivered instructions.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## Pi-Coc 两个进程（pi-coc-setup / pi-coc）

开局引导与上桌游玩是**两个命令、两个进程**，不是一个会话里的两个 role。
`COC_PI_SESSION_ROLE=setup` 已退休：`sessionRoleFromEnv` 会拒绝它并告警。

- **`pi-coc-setup --campaign <id>`** — 引导。加载 `pi/extensions/onboarding/`
  与 `pi/prompts/onboarding-system.md`，`--no-extensions` 所以它**不加载宿主扩展**：
  没有阶段机、没有游玩工具面、没有投影登记表。顺序由
  `pi/extensions/onboarding/steps.ts` 这一张表派生（工具面、拒绝语、下一步说明
  同源），每一步的 `done` 读战役目录而不是内存计数。做完 `setup.complete` 就结束。
- **`pi-coc --campaign <id>`** — 桌子。只开 `ready_for_table` / `active` 的战役；
  否则打印 `pi-coc-setup --campaign <id>` 并以 3 退出。它不会变成引导进程。
- **清单**：`plugins/coc-keeper/pi/session-roles.json` 只剩 `play` 半边。
- **交接**：`setup.complete`（幂等、`decision_id`）写 `ready_for_table` 与
  `setup_handoff`，引导进程结束；玩家另开 `pi-coc`，它 `session.resume` 后经
  `evidence.table_opening` 开场。**没有退出码 42、没有 re-exec、没有角色重判**。
- **建卡**照 `docs/methods/immersive-character-creation.md`；那份文档由引导扩展
  随步骤指令原文投送，因为引导会话没有 `read` 工具。
- **开场六项快速事实（`setup.adopt_source_facts` + opening source coordinator）
  已退休**：它读 3 页答 6 个字段，而模组真实结构由 ModuleGraph 负责。引导不再
  派任何子代理。

### Non-LLM Three-Second Diagnostic Rule

Any operation that does not involve LLM/model inference and exceeds 3 seconds is
an active diagnostic incident. Immediately inspect the exact command or test
node, whether real output is advancing, CPU/IO, locks, and child processes.
Wrapper or driver heartbeats and CPU activity alone do not prove healthy
progress; never merely report elapsed time and continue waiting. If real
progress is not demonstrated, split the work into smaller observable units,
repair or re-point the progress channel, or abort and resume the same
worker/worktree by a materially different route. Exceeding 3 seconds triggers
inspection; it does not require killing an operation whose exact node-level
progress is proven. LLM/model inference calls are the only timing exemption.

## Runtime Track And Clean-Slate Persistence Policy

`runtime/` is the open headless interface (Event SDK plus debug/Pi adapters).
It consumes canonical skills and rules from `plugins/coc-keeper/`; project brain
selection lives at `.coc/runtime.json`.

`web/` and the Electron shell in `desktop/` are the **UI of the pi-coc
interactive host**. The product turn channel is a `pi-coc` RPC session
(`pi --mode rpc` with the canonical COC package loaded): the browser/Electron
surface renders that host's event stream and sends player input, so character
creation, onboarding, steward dispatch, live turns, and output boundaries all
come from the same pi-coc host a terminal player gets — never from a second
keeper shell with its own prompt or turn contract. The legacy web turn path
over `runtime/sdk` + `runtime/adapters/keeper` (per-message finalization
transport gate, `web-char-setup-draft` shell, chargen kickoff prompt) is
**deprecated for the UI**: do not extend it, and retire it from web/desktop as
the pi-coc RPC bridge lands. `runtime/` remains the open headless interface
for unattended acceptance only, not the web/desktop turn channel. Campaign
management and read-only state projections may keep their file-level
implementations. See `web/README.md`.

This is clean-slate. Reject loading campaign/runtime/cache state without an exact current schema/version, preserve the existing evidence, and create fresh state under a new identity. Schema mismatch is not permission to delete old campaigns, transcripts, source caches or reports; deletion requires explicit user authorization. Never add migrations, dual readers,
compatibility fallbacks, or old-ID remapping. Historical reports stay read-only;
same-version atomic crash backup/restore is allowed.

Coverage plans and cross-run visited unions are post-run evidence only. They may
identify gaps or motivate another fresh playtest, but never allow, deny, force,
reorder, or suppress scenes, clues, narration, actions, rewards, development, or
endings.
