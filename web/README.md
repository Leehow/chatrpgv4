# COC Keeper Web UI（pi）

浏览器里的 pi 版 Keeper 界面：左侧战役列表，中间对话（**真 SSE 流式** +
Markdown 渲染），右侧角色参数 / 物品 / 游戏时间，顶栏可选择 Keeper 模型。

## 新战役

三种开局：

1. **预置剧本**：`campaign.quick_start`（官方 starter + pregen）。
2. **已解析剧本**：从 `.coc/module-library/<id>/` 安装已编译七文件剧本到新战役
   （`coc_module_registry.install_to_campaign`）。**跨战役复用**，不重解析 PDF。
3. **PDF 源包**：
   - 源包位置：`.coc/source-bundles/<id>/`（须含 `manifest.json`）。
   - 拖拽/上传 PDF → `POST /api/uploads/pdf`：只做 SHA-256 登记与去重，**不解析**。
   - 开局：`campaign.create` → `scenario.bind_pdf` → `campaign.link_investigator`。

**新建调查员**（PDF / 已解析剧本模式）：侧栏调查员下拉第一项「＋ 新建调查员…」，
点「开局」后先建战役（不预建卡），中间主界面由 **live KP 按 coc-character skill**
引导创建（与 CLI 同一套：briefing → 属性生成方式 → 确认 →
`investigator.create` + `link_investigator`）。

## 启动

```bash
# 1. 构建前端（只需在源码变化后重新执行）
cd web/frontend && npm install && npm run build && cd ../..

# 2. 启动服务器（默认 workspace 为仓库根，端口 8765）
uv run --frozen python web/server/app.py --workspace . --port 8765

# 3. 打开 http://127.0.0.1:8765
```

前端联调可用 `cd web/frontend && npm run dev`（Vite 把 `/api` 代理到
127.0.0.1:8765）。

## 架构

- `web/server/app.py` — 纯 stdlib HTTP + SSE 桥（无新增 Python 依赖），只包装
  `runtime/sdk/api.py`：`onboarding.inspect` / `campaign.quick_start` /
  `create_session` / `send` / `get_state`，外加只读的角色卡与
  `save/time-state.json` 投影。所有规则、状态、叙事语义仍属 canonical
  runtime 与 keeper runner。
- `runtime/adapters/keeper/run_keeper_turn.mjs` — 在原有 `session.subscribe`
  上把玩家安全的实时进度以 `{"$stream":...}` NDJSON 标记行写到 stderr：
  工具活动（仅工具名，不含参数）与 `turn.finalize` 成功之后的叙述
  `text_delta`。stdout 结果契约不变。支持 `--server` JSONL 热会话：同一
  agent 跨回合保留聊天记忆（CLI 式），玩家仍只看到 finalize 定稿。
- `runtime/adapters/keeper/adapter.py` — `keeper_send_turn(..., on_stream=...)`
  默认对带 `runtime_session_id` 的请求走 warm `--server` 进程池（按
  session/campaign/model 键控）；失败或关会话时退役 worker。
  `session.send` / `sdk.send` 透传。
- `POST /api/sessions/<sid>/turns` — SSE：`status` → `tool`* / `delta`* →
  `turn`（最终 events + 最新 state）/ `error`；15s 心跳。回合由全局锁串行。

## 剧透边界

keeper 回合中模型在 `turn.finalize` 之前的文本是主持人内部推演，可能引用
模组秘密。流式只转发 finalize **执行成功**之后的最终叙述 token（keeper
系统提示词禁止 finalize 后再调工具，且最终消息逐字等于
`rendered_text`）。闸门只认真实执行（toolbox bash 调用或
`coc_invoke:turn.finalize`），schema 发现（`coc_discover` /
`coc_capabilities`）不会打开闸门；若 finalize 之后模型又发起工具调用，
runner 发出 `delta_reset` 让前端丢弃已流出的草稿，等下一次成功
finalize 再重新流出。工具活动也只暴露工具名。

## 模型选择

顶栏下拉来自 `$PI_AGENT_DIR/models.json`（缺省 `~/.pi/agent/models.json`，
即 pi 的模型注册表），例如 `coding-relay` / `grok-relay` 下的各个模型。
选择随每个回合请求通过 `COC_KEEPER_MODEL_PROVIDER` / `COC_KEEPER_MODEL_ID`
环境变量传给 keeper runner，可在会话中途切换。缺省
`coding-relay / gpt-5.6-luna`。

## 战役兼容性

运行时遵循清洁重开策略：只接受 `schema_version == 2` 且带 `ruleset_id`
的战役。旧版（v1）战役在左侧列表灰显为「旧版存档」且不可加入，不做任何
迁移；想玩同一剧本请从「＋ 新战役」重新开局。

## 界面语言

叙述层的语言规则来自 canonical `coc_language.language_profile`：每个 keeper
回合的系统提示词都会携带 output_instruction、name_policy（外文人名按
目标语言习惯音译）、term_policy（术语用 localized_terms）三条，由
`runtime/engine/session.py` 随回合请求注入，runner 原样拼入系统提示词。

右侧面板的角色名、属性、技能、武器、物品标签全部来自 canonical 中文渲染层：
优先读角色卡自带的 `player_facing_sheet_zh`（缺省时由
`coc_starter.ensure_pregen_player_facing_sheet` 为官方预生成角色现场构建，
含预生成角色的中文装备列表），再回退到 `coc_language` 的术语表；均与
keeper 自己的角色卡渲染一致。物品优先用 `player_facing_sheet_zh.equipment`；
仅当该层缺失时才回退到 machine sheet 的源语言字符串。

时间 / 场景 / 张力同属展示层：
- 时间：有 `local_datetime` 时渲染为沉静的中文两行（`一九二〇年十月十二日` +
  `上午 · 十时整`），不再直接展示 ISO 数字串；
- 场景：读战役 `story-graph.json` 的 `display_name` /
  `destination_identity.localized_names`，不把机器 `scene_id` 甩给玩家；
- 张力：封闭枚举 `low|medium|high|climax` → `平缓|升高|紧绷|高潮`；
- 线索：按 `discovered_clue_ids` 从 `clue-graph.json` 投影
  `localized_text.<lang>.player_safe_summary`（缺省回退英文
  `player_safe_summary`），侧栏列出内容而不只报条数。

## CLI / Web 双端互通

战役状态与日志（`save/*.json`、`logs/events.jsonl`、
`logs/turn-finalizations.jsonl`）是 canonical 磁盘事实，web 与 CLI
（pi TUI、各 coding host）都只是其上的 host：两端写同一批
`state.journal` / `turn.finalize` 工件，因此可以**交替**游玩——CLI 玩的
回合，web 打开同一战役（或点顶栏「⟳ 刷新」，切回浏览器标签页也会自动
刷新）即可看到并继续；web 玩的回合，CLI 端 `session.resume` 同样接着跑。

限制：同一时刻只能一端在跑回合（并发写同一战役不安全）；`setup` 阶段
的战役还没有调查员绑定，web 会拒绝并说明；web 不监听文件变化，CLI 的
进度靠手动/聚焦刷新拉取。
