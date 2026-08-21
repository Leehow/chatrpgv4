# Grok Build OAuth + Image Extension — Canonical Spec

> **Status:** Spec — frozen decisions, no production code.
> **ID:** `grok-build-oauth`
> **Scope:** Cross-host canonical spec for PipiUI + pi-coc (single source, single package).
> **Tracks:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc` — Codex track off-limits. Shared kernel (`plugins/coc-keeper`) is read-only unless explicitly authorized.
> **Template:** to-spec (Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes)

---

## 1. Problem Statement

### 1.1 User job

- PipiUI 用户与 chatrpgv4 pi-coc 用户希望用 xAI Grok 订阅（OAuth）登录一次后，在任意 Pi 会话（PipiUI 普通 Pi 会话、pi-coc terminal、`pi-coc --mode rpc` 驱动的 Web/Electron）中通过模型工具调用生成/编辑图片，凭证自动刷新、跨会话与跨进程安全、无需重复登录或手填 API key。
- COC portrait 等现有图片消费者希望从“宿主自带 xAI relay/直调”迁移到统一的 Pi 工具路径，但不把 OAuth 逻辑塞进 COC shared kernel。

Success looks like: 一包安装后，`/login grok-build`（browser/device）在两宿主可达，登录状态、剩余有效期、凭证来源在设置/UI 可见；`image_gen`/`image_edit` 由模型触发经同一 HTTP 路径到达官方 `images/generations` 并把文件落到宿主约定目录；token 提前刷新、401 单次强刷、并发去重、0600 原子落盘均生效；旧 `pipiui-media` / `portrait-image-route` / relay 重复路径被兼容层收敛并最终移除。

Hollow delivery would be:
- 两份复制的 TS 实现（PipiUI 一份、pi-coc 一份）声称完成；
- 只在 PipiUI 宿主生效而 terminal pi-coc / Web RPC 行为不一致；
- 仅演示生成成功而未覆盖过期/并发/401/取消/timeout/secret 红隐；
- 把 OAuth 状态写入 COC campaign/state 或全局 `~/.pi` 静默读取。

### 1.2 Pain today (evidence-anchored, no file-path hardcoding)

- PipiUI 已有 `pipiui-media` 式 image extension，但仅读取 `XAI_API_KEY` 或项目隔离 `auth.json` 的 `xai` 条目、过期仅回退到 API key，无 refresh-token 动态刷新与并发/原子性保障。
- chatrpgv4 Web 的 portrait 生成走服务端 `xai` 专用路由与 PipiUI loopback relay 常量，`tokenFromXaiEntry` 接受 OAuth access token 但路由文档声称仅 API key，存在凭证策略不一致与重复 transport。
- 官方 Grok Build 的 device OAuth 与 image 协议在开源 Rust 树中已有完整客户端/存储/锁证据（issuer 驱动、device_code 轮询、tier gate、`x-grok-session-id`），但无 Pi extension 形态；需以 wire contract 移植而非整段代码复制。
- Pi 已有标准 `registerProvider` + `ModelRuntime.login` OAuth 通道（browser/device），但 `grok-build` 需作为独立 provider（不覆盖官方 `xai`）并以 Pi 原生持久化承载 refresh 轮转。

---

## 2. Solution

### 2.1 One package, two halves, one build artifact

提供**单一源码、可安装/可发布的 PipiUI extension package**，`id = grok-build-oauth`，遵循 `docs/extension-architecture-v1.md` 的双半包 + `pipiui-extension.json` 粘接合约：

```
grok-build-oauth/
├── pipiui-extension.json        # id/name/version/agent/app/capabilities/lifecycle
├── agent/                       # Pi extension — provider + tools (L1)
│   ├── index.ts                 # default export (pi: ExtensionAPI) => void
│   └── auth/                    # OAuth state machine, refresh, persistence
└── app/                         # Electron extension — settings/login UI (L0/L1)
    ├── settings-section.tsx
    └── panel.tsx                # 可选：状态/重登/退出/tier 提示
```

- 单一构建产物同时被两宿主消费：PipiUI 的 Bundled/App/project 三位置扫描与 `SpawnRegisteredExtension` 挂载；chatrpgv4 repo-local `.pi/coc-agent` 通过同一构建产物（npm tarball 或同步的 runtime tree）加载。**禁止复制 TS 实现**；任一宿主的修复必须回到单一源码。
- App 半与 agent 半共享 `id`、`ext.grok-build-oauth.*` 设置命名空间与 `ext.grok-build-oauth` 桥通道（如需事件）。Agent 半是标准 Pi extension（`registerProvider`/`registerTool`/`registerCommand`），不依赖 TUI `ctx.ui` 以外的宿主私有 API。

### 2.2 Provider & tools

- Agent 半注册**独立 provider `grok-build`**（`displayName: Grok Build`），不覆盖官方 `xai` provider。`xai` 保持 API-key 形态，`grok-build` 承载 OAuth 形态，二者可并存。
- 同时注册 `image_gen` / `image_edit` 工具（tool 名与官方 `xai-grok-tools` 对齐）。工具走同一请求路径：官方 `POST {xai_api_base_url}/images/generations`，默认 `https://api.x.ai/v1`，payload 含 `model`/`prompt`/`n`/`aspect_ratio`/`resolution`/`response_format`，header 含 `Authorization: Bearer` 与 `x-grok-session-id`。见 §4.4。
- 标准 Pi OAuth：`pi.registerProvider("grok-build", { … oauth … })` 使 `/login grok-build`、` /logout grok-build` 与 `ModelRuntime.login("grok-build", "oauth")` 原生可用，支持 browser 与 device_code 两模式。凭证类型为 `oauth`，与 `.env` 静态 key 隔离（见 §4.3 Key Management 衔接）。

### 2.3 Credential lifecycle

Wire contract 按官方 Grok Build（见 §4.2）：issuer/config 驱动、device_code/token endpoints、client_id/scopes/referrer、pending/slow_down/denied/expired、access/refresh/expires/issuer、refresh rotation、提前刷新、401 单次强刷重试、进程内去重 + 跨进程文件锁、0600 原子持久化。禁止静默读全局 `~/.grok`；可提供**显式一次性导入**命令。

### 2.4 Host parity

功能在三平面等价：

1. **Terminal pi-coc** — 通过 package 的 `pi` 扩展发现加载（`settings.packages` / `.pi/extensions` 约束见 §4.1）。
2. **Web/Electron RPC** — 通过 `pi-coc --mode rpc -e <resolved grok-build-oauth agent entry>` 挂载（与现有 `HOST_PI_EXTENSION_RELS` 同通道）。
3. **PipiUI 普通 Pi 会话** — 通过宿主三位置扫描 + 新会话 `-e` 挂载。

设置/登录状态/凭证来源/compat fallback 开关在 app 半提供；新会话挂载语义遵循 `extension-architecture-v1` D9（启用仅影响新会话，禁用 app 半立即 dispose）。

### 2.5 Migration

PipiUI 现有 `pipiui-media` 与 chatrpgv4 `portrait-image-route` / relay 逻辑在首版保留为**消费者/兼容层**：优先走 `grok-build` provider 的 `image_gen` 工具；当且仅当 `grok-build` 未登录/被 gate 时按 §4.7 降级。最终移除重复 OAuth 与 xAI image transport；COC shared kernel (`plugins/coc-keeper`) 不承载 OAuth。

---

## 3. User Stories

> 编号稳定，供测试与验收引用。`[M]` = 必须（MVP），`[N]` = 下一阶段。语言：zh-Hans（用户可见）。

### 3.1 安装与发现

- **US-01 [M]** 作为扩展作者，我把 `grok-build-oauth` 目录或 npm 包放到 PipiUI 三位置之一（Bundled / App `pi-agent/extensions/<id>` / 项目 `.pi/agent/extensions/<id>`）即可被扫描发现，manifest 校验失败进入 `error` 并显示原因。
- **US-02 [M]** 作为 chatrpgv4 开发者，我在 repo-local `.pi/coc-agent` 消费**同一构建产物**（npm 依赖或同步的 runtime tree），无需复制 `agent/` 源码即可使 terminal pi-coc 加载该扩展。
- **US-03 [M]** 作为用户，我在任一宿主安装后看到该包的 `capabilities` 与信任分级（L1 agent 代码一次确认），未授权能力调用被 `capability_denied` 拒绝。
- **US-04 [M]** 作为用户，我禁用该扩展后 app 半立即整组 dispose、新会话不再 `-e` 挂载；已运行会话的 agent 半随会话结束而卸载，不热卸。

### 3.2 登录（OAuth）

- **US-05 [M]** 作为用户，我在任意 Pi 会话执行 `/login grok-build` 可选择 browser 或 device_code 模式；browser 模式打开 `verification_uri`（优先 `verification_uri_complete`），device 模式展示 `user_code` 与轮询提示。
- **US-06 [M]** 作为用户，我在 device 模式看到明确的过期与重试上限（默认 10 分钟、最小 interval 1s，`slow_down` 时递增），`authorization_pending` 继续、`access_denied`/`expired_token` 终端化并提示重登。
- **US-07 [M]** 作为用户，登录成功后凭证持久化到**当前宿主的 Pi home**（PipiUI: `PI_CODING_AGENT_DIR` 指向的 `auth.json`；pi-coc: repo-local `.pi/coc-agent/auth.json` 或 `PI_COC_AGENT_DIR` 覆盖），包含 `access_token` / `refresh_token?` / `expires_at` / `issuer` / `client_id` / `scopes`。
- **US-08 [M]** 作为用户，我执行 `/logout grok-build` 或在设置页点“退出登录”可清除该 provider 的 OAuth 凭证并使后续 `image_gen` 走 gate/降级路径。
- **US-09 [M]** 作为从旧 `~/.grok/auth.json` 迁移的用户，我可通过**显式一次性导入**命令（需确认）导入凭证，导入后原文件不受影响；**禁止静默读取全局 `~/.grok`**。
- **US-10 [M]** 作为用户，我在未登录或 token 失效时收到的错误是可操作的（“请先 /login grok-build” / “已过期，请重新登录”），且错误消息中密钥已被 `[redacted]`。

### 3.3 凭证刷新与并发

- **US-11 [M]** 作为用户，我的 access token 在过期前被**提前刷新**（默认提前 60s 窗口，可配置），无需我手动重登。
- **US-12 [M]** 作为频繁调用 `image_gen` 的用户，当 token 恰好过期时，仅触发**一次** refresh，其余并发请求等待同一刷新结果（进程内去重）。
- **US-13 [M]** 作为多进程用户（两个 Pi 会话同时刷新），跨进程文件锁保证仅一个进程执行网络刷新，其余进程在锁内重读已更新的 `auth.json` 并复用新 token。
- **US-14 [M]** 作为遇到 401 的用户，扩展对该请求执行**单次强刷重试**（无论是否在提前窗口内），重试仍 401 则向用户提示重登，不无限重试。
- **US-15 [M]** 作为 refresh 失败的用户，我看到明确失败原因（网络/无效 refresh_token/issuer 不匹配），旧 token 不被半写覆盖；无效 refresh 导致回到未登录态并提示重登。

### 3.4 图像生成/编辑

- **US-16 [M]** 作为用户，我让模型调用 `image_gen`（prompt + 可选 `aspect_ratio`）时，扩展以当前有效 Bearer token 向 `POST {base}/images/generations` 发起请求，默认 model `grok-imagine-image-quality`，`n=1`、`resolution=1k`、`response_format=b64_json`，并附 `x-grok-session-id`。
- **US-17 [M]** 作为需要编辑的用户，我可通过 `image_edit` 传入参考图（`image`/`mask` 按官方 ImageGenInput 形态），同样走 Bearer 认证与 `b64_json` 解码路径。
- **US-18 [M]** 作为用户，我收到的结果包含**宿主约定目录下的已落盘文件路径**与 typed `image` 内容（`b64_json` 严格解码、空/畸形拒绝），PipiUI 侧为 `.pi/attachments/` 或等效隔离目录，pi-coc 侧为会话/项目约定目录，路径永不穿越隔离根。
- **US-19 [M]** 作为未配置 base_url 的用户，请求默认命中 `https://api.x.ai/v1/images/generations`；配置了 `xai_api_base_url` 时使用该 base 的 `/images/generations`，尾斜杠被规范化。
- **US-20 [M]** 作为使用 OAuth 与 API key 两种凭证的用户，二者**共用同一请求路径与 payload 形状**，仅 `Authorization` 来源不同；OAuth 路径受 tier gate 影响而 API key 路径不受限（见 US-22）。
- **US-21 [M]** 作为用户，我可在 manifest/settings 中覆盖默认 model（如 `grok-imagine-image`）与 base_url，非法 model/aspect 值在客户端被拒绝并返回可操作错误。

### 3.5 Tier gate 与 header

- **US-22 [M]** 作为 Free/空 tier / X Basic（受限 tier）用户，我在调用 `image_gen` 前看到**客户端 advisory gate 提示**（需订阅/付费），调用被短路且不计费；服务端仍为最终权威，gate 不作为授权依据。
- **US-23 [M]** 作为未知/未来 tier 或已付费用户，我的请求不受 gate 阻拦。
- **US-24 [M]** 作为需要归因的调用，请求头包含 `x-grok-session-id`（会话/项目稳定 ID，无则生成并复用），且不泄露 token 明文到日志。

### 3.6 设置与状态（app 半）

- **US-25 [M]** 作为用户，我在 PipiUI 设置页看到 Grok Build 段：登录状态（已登录/未登录/过期）、到期剩余、凭证来源（`oauth`/`api_key`/`env`）、当前 model/base、tier 提示、compat fallback 开关。
- **US-26 [M]** 作为用户，我可在设置页触发“登录/重新登录/退出登录”，其效果与 `/login`/`/logout` 等价，且 secret 字段（`ext.grok-build-oauth.*` 中 `format: secret` 项）永不落入普通 settings JSON，仅进 vault/Provider auth。
- **US-27 [M]** 作为用户，我切换 compat fallback 开关（默认**关闭**）后，新会话生效；开启时仅在 `grok-build` 未就绪时回退到旧 `xai` API key / relay 兼容路径，且该回退被标记为 deprecated。
- **US-28 [N]** 作为用户，我在 settings 搜索/分组中可按 `ext.grok-build-oauth` 前缀筛选该扩展的受控设置，且迁移失败时扩展进入 `error` 而不半写。

### 3.7 兼容与迁移

- **US-29 [M]** 作为 COC portrait 用户，我在 chatrpgv4 Web 点击生成 portrait 时优先走 `grok-build` 的 `image_gen` 工具；未登录/受限时按 compat 开关决定是否回退到旧 `xai` 直调，UI 错误文案不再独指“xAI key 未配置”。
- **US-30 [M]** 作为 PipiUI 老用户，原 `pipiui-media` 的 `image_gen`/`image_edit` 调用在安装本扩展后自动由新 provider 承接，旧 transport 仅作为显式 compat fallback 保留。
- **US-31 [M]** 作为维护者，我可在移除旧 transport 前通过 deprecation 警告与测试覆盖确认无回退依赖；最终移除后 `image_gen` 唯一路径为本扩展。

### 3.8 跨宿主等价与新会话语义

- **US-32 [M]** 作为用户，我在 terminal pi-coc、Web/Electron RPC、PipiUI 普通 Pi 会话中执行相同操作得到等价结果（登录态、刷新、生成、错误码一致），差异仅在宿主 home 路径。
- **US-33 [M]** 作为用户，我启用/禁用/改设置后，已运行会话不受影响，**新会话**才挂载/卸载/注入新快照（遵循 extension-architecture-v1 D9）。
- **US-34 [M]** 作为并发用户，我的中途 abort（Ctrl+C / 关闭面板 / 超时）能取消 device 轮询与 refresh 网络请求，不泄露 token 且不写半新状态。

---

## 4. Implementation Decisions

### D1 — 单一源码、可安装/可发布的 extension package（id=`grok-build-oauth`），一包两半

- **Id/分发：** `id = grok-build-oauth`（`[a-z][a-z0-9-]*`），`version` semver。包以目录 + npm tarball 双形态发布；`pipiui-extension.json` 为唯一粘接点。
- **布局：**

```
grok-build-oauth/
├── pipiui-extension.json
├── agent/                 # L1 — Pi 子进程
│   ├── index.ts           # default export (pi: ExtensionAPI) => void
│   ├── provider.ts        # registerProvider("grok-build", …)
│   ├── tools.ts           # image_gen / image_edit
│   ├── oauth/             # device/browser, refresh, lock, persistence
│   └── images/            # HTTP client, payload, tier gate
└── app/                   # L0/L1 — 渲染进程
    ├── manifest.ui.json   # panels/toolRenderers/settingsSections（声明式）
    ├── settings-section.tsx
    └── panel.tsx
```

- **单一产物消费：**
  - **PipiUI：** 宿主三位置扫描（Bundled runtime / App `pi-agent/extensions/<id>` / 项目 `.pi/agent/extensions/<id>`）发现 manifest；`SpawnRegisteredExtension` 把已启用包的 `agent/dist/index.js` 注入新会话 `-e`；设置落盘与 vault 按 `extension-architecture-v1` D6。
  - **chatrpgv4 pi-coc：** 消费**同一构建产物**——repo 通过 `package.json` 依赖或安装时同步的 runtime tree 解析到同一 `agent/dist/index.js`；terminal 加载走 Pi package 的 `pi.extensions` 发现，RPC 走 `buildPiCocArgs` 的 `-e <resolved entry>`。两宿主解析到同一文件内容（构建时校验 hash）。
- **禁止复制：** 任何宿主不得维护 `grok-build` OAuth/image 的第二份 TS 源码；差异仅在宿主 home/路径/开关等配置。

### D2 — 独立 provider `grok-build` 与工具注册（不覆盖 `xai`）

- **Provider：**

```ts
pi.registerProvider("grok-build", {
  // Pi 原生 OAuth 通道
  auth: { type: "oauth", /* issuer/config 驱动, browser+device */ },
  // 模型目录由该 provider 的 auth 形态决定；与 xai 并存
  models: [ /* 从 issuer/.well-known 或构建配置注入 */ ],
})
```

- **工具：**

```ts
pi.registerTool({
  name: "image_gen",
  description: "Generate image via Grok Imagine",
  parameters: Type.Object({
    prompt: Type.String(),
    aspect_ratio: Type.Optional(Type.String()),
    // resolution/model 可选，默认见 D4
  }),
  execute: async (id, params, signal, onUpdate, ctx) => { /* D4 */ }
})
pi.registerTool({ name: "image_edit", … })
```

- **命令：** 复用 Pi 原生 `/login grok-build` / `/logout grok-build`；扩展可另注册 `/grok-build:import`（显式导入 `~/.grok`）与 `/grok-build:status`（诊断）。
- **隔离：** `grok-build` 的 OAuth 凭证与 `xai` 的 `XAI_API_KEY`/`.env` 静态 key 隔离；`.env` 不承载 refresh_token。

### D3 — 标准 Pi `registerProvider` OAuth（browser/device）

- **触发：** `/login grok-build` 触发 `ModelRuntime.login("grok-build", "oauth")`，UI 侧（PipiUI 设置页 / `pi-coc` login 面板）承载 `auth_url` / `device_code` / `user_code` / `interval` / `expires_in` 的展示与交互。
- **模式：**
  - **browser：** 打开 `verification_uri`（优先 `verification_uri_complete`），等待回调/轮询完成。
  - **device：** 展示 `user_code` 与 `verification_uri`，按 `interval` 轮询 `token` 端点。
- **不自建 OAuth 舞台：** 不在扩展内另起 HTTP 回调服务器或自实现浏览器交互；仅实现 `registerProvider` 的 OAuth 配置与 device 轮询的状态机（见 D5），其余由 Pi 原生 `ModelRuntime` 与宿主 UI 协作。

### D4 — OAuth wire contract（按官方 Grok Build，可内联）

> 以下为**协议形状**，非代码片段；生产 issuer/client/scopes 以构建配置与官方发行物为准（见 §7 Unknowns）。

- **Config 来源（优先级从高到低）：**

```
env GROK_OAUTH2_ISSUER / GROK_OAUTH2_CLIENT_ID / GROK_OAUTH2_SCOPES / referrer/principal
  → 构建注入的默认 issuer/client/scopes
  → Pi provider 配置的 issuer（.well-known 发现）
```

  - 构建默认 `client_id`（开源 HEAD 已知 `b1a00492-073a-47ea-816f-4c329264a828`）与 issuer 仅作**可旋转配置**，不得 hardcode 为不可覆盖常量。

- **Device code 请求：**

```
POST {issuer}/oauth2/device/code
Content-Type: application/x-www-form-urlencoded
Headers: x-grok-client-version, x-grok-client-surface（宿主可注）

body: client_id=<id>&scope=<space-joined>&referrer=grok-build
```

  - 响应：`device_code`, `user_code`, `verification_uri`, `verification_uri_complete?`, `expires_in`, `interval?`
  - 校验：`user_code` 仅 ASCII 字母数字/连字符；`verification_uri*` 必须为 https URL，展示前校验，非法则报错而非打开。

- **Token 轮询：**

```
POST {issuer}/oauth2/token
body: grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=…&client_id=…
```

  - 首次轮询前按 `interval` sleep；最小 1s；`expires_in` 默认 10 分钟；超出则 `expired_token`。
  - **状态机：**

```
request_device_code
  → poll(token) ── authorization_pending ──→ continue (wait interval)
               ├── slow_down ──→ interval *= 1.5 (cap), continue
               ├── access_denied ──→ terminal error (user denied)
               ├── expired_token ──→ terminal error (re-login)
               └── other error ──→ terminal error (exchange failed)
               └── success {access_token, refresh_token?, expires_in, issuer?}
                    → persist (D5)
```

- **Refresh（见 D5）：**

```
POST {issuer}/oauth2/token
body: grant_type=refresh_token&refresh_token=…&client_id=…
```

  - 成功返回新 `access_token` + 可选新 `refresh_token`（rotation）+ `expires_in`；失败分类见 D5。

### D5 — 凭证结构、刷新、锁与持久化

- **凭证结构（Pi auth.json 中 `grok-build` 条目）：**

```ts
type GrokBuildOAuthCredential = {
  access_token: string
  refresh_token?: string
  expires_at: number        // epoch ms，服务端 expires_in 换算
  expires_in?: number
  issuer: string            // 颁发者，与 config 一致性校验
  client_id: string
  scopes: string[]          // 空格/逗号归一化后存储
  token_type?: "Bearer"
  obtained_at: number
  principal?: string
}
```

- **刷新触发：**
  1. **提前刷新：** `expires_at - now < 60s`（可配置 30–120s）即在 `before_provider_request` / 工具执行前触发 refresh。
  2. **401 强刷：** 任意 `images/generations` 401 触发**单次**强制 refresh 并重试一次；重试仍 401 则上抛 `auth_expired` 需重登。

- **Refresh 语义：**
  - 无 `refresh_token` 则直接要求重登。
  - 成功后原子写回新 `access_token` / 新 `refresh_token?` / `expires_at` / `issuer`；若服务端未返回新 refresh_token 则保留旧值。
  - 失败：`invalid_grant` / `invalid_request` → 清除凭证、提示重登；网络/5xx → 保留旧凭证、向调用方抛可重试错误，不半写。

- **并发与原子性：**
  - **进程内去重：** 同进程并发 refresh 复用同一 Promise（watch/in-flight 标记），不并发发请求。
  - **跨进程锁：** 以 `auth.json.lock`（或宿主 Pi home 下等效）`flock` 互斥；**锁内重读** `auth.json`，若已被其他进程刷新则直接复用新 token，不覆盖。
  - **0600 原子持久化：** `writeFile(tmp) → chmod 0600 → fsync → rename`；陈旧 refresh_token 不得覆盖更新鲜的已轮转 token（freshness guard：比较 `obtained_at`/`expires_at`）。
  - **永不静默读全局：** 仅读写当前 `PI_CODING_AGENT_DIR` / `PI_COC_AGENT_DIR` / repo-local `.pi/coc-agent` 指向的 `auth.json`；全局 `~/.grok/auth.json` 仅在用户显式执行导入命令且确认后读取一次。

### D6 — Images API（与官方 `xai-grok-tools/image_gen` 对齐）

- **Endpoint：** `POST {xai_api_base_url}/images/generations`，`xai_api_base_url` 默认 `https://api.x.ai/v1`，尾斜杠规范化。`xai_api_base_url` 来源：宿主 env / 扩展设置 / 构建默认，按优先级。
- **Auth：** `Authorization: Bearer <resolved token>`。Token 解析优先级：`grok-build` OAuth access_token（经 D5 刷新后）> `XAI_API_KEY`（仅当 OAuth 未登录且 compat fallback 开启时）。OAuth 与 API key **共用同一路径与 payload**。
- **Payload：**

```json
{
  "model": "grok-imagine-image-quality",
  "prompt": "<string>",
  "n": 1,
  "aspect_ratio": "auto",
  "resolution": "1k",
  "response_format": "b64_json"
}
```

  - `model` 默认 `grok-imagine-image-quality`（可用 `grok-imagine-image` 等覆盖）；`aspect_ratio` 白名单与官方一致（`1:1`/`16:9`/`9:16`/`4:3`/`3:4`/`3:2`/`2:3`/`2:1`/`1:2`/`19.5:9`/`9:19.5`/`20:9`/`9:20`/`auto`），非法直接返回 `invalid_params`。
  - `n` 固定 1；`resolution` 默认 `1k`；`response_format` 固定 `b64_json`。

- **Headers：** `Content-Type: application/json`，`x-grok-session-id: <stable id>`（会话/项目稳定 ID，无则生成并复用），可选 `x-grok-client-version`/`x-grok-client-surface`。
- **Response：** 2xx JSON 含 `b64_json` 字段（或等效 `data[].b64_json`），严格 base64 解码，空/畸形则抛 `invalid_response`；非 2xx 截断 body（不含 token）并分类：401→`auth_expired`，403→`tier_restricted`，429→`rate_limited`，5xx→`upstream_error`。
- **落盘：** 解码后 bytes 以原子写落到宿主约定目录并返回 typed 结果：

```ts
{
  content: [{ type: "text", text: "Image generated: <path>" }],
  details: { path: "<absolute>", mime: "image/jpeg", backend: "grok-build", model: "<id>" }
}
```

  - PipiUI：`<PI_CODING_AGENT_DIR>/attachments/` 或项目隔离等效；pi-coc：`<workspace>/.pi/attachments/` 或会话 `images/<n>.jpg`（与官方 `SessionFileWriter` 语义一致，原子 tmp + fsync + rename，编号递增）。
  - **路径穿越防护：** 仅在隔离根内写，拒绝 `..` / 绝对路径拼接。

- **Tier gate：** 客户端 advisory——`Free` / `""` / `X Basic` 短路并返回用户文案“需订阅/付费 tier”；`paid`/`unknown` 不阻拦。Gate 仅 UX，不替代服务端鉴权；`xai` API key 调用者永不被 gate。

- **Loopback relay：** **默认关闭**。仅当设置 `ext.grok-build-oauth.compatFallback = true` 且 `grok-build` 未就绪时，旧 `pipiui-media` relay 可作为 fallback；该路径标记 deprecated，日志中明示。

### D7 — App 半：设置 / 登录状态 / 凭证来源 / compat 开关

- **Manifest 声明：**

```json
{
  "id": "grok-build-oauth",
  "name": "Grok Build",
  "version": "1.0.0",
  "agent": { "extension": "agent/dist/index.js", "skills": [] },
  "app": {
    "settings": {
      "scope": "app",
      "schema": {
        "type": "object",
        "required": [],
        "properties": {
          "ext.grok-build-oauth.xaiApiBaseUrl":   { "type": "string", "format": "uri", "default": "https://api.x.ai/v1" },
          "ext.grok-build-oauth.defaultModel":    { "type": "string", "default": "grok-imagine-image-quality" },
          "ext.grok-build-oauth.issuer":          { "type": "string", "format": "uri" },
          "ext.grok-build-oauth.clientId":        { "type": "string" },
          "ext.grok-build-oauth.scopes":          { "type": "string" },
          "ext.grok-build-oauth.earlyRefreshSec": { "type": "integer", "default": 60, "minimum": 30, "maximum": 120 },
          "ext.grok-build-oauth.compatFallback":  { "type": "boolean", "default": false },
          "ext.grok-build-oauth.sessionId":       { "type": "string" },
          "ext.grok-build-oauth.accessToken":     { "type": "string", "format": "secret" }
        }
      }
    },
    "ui": {
      "panels": [{ "slot": "toolPanel", "id": "grok-build-status", "title": "Grok Build", "entry": "app/dist/panel.js" }],
      "toolRenderers": [{ "tool": "image_gen", "entry": "app/dist/image-card.js" }, { "tool": "image_edit", "entry": "app/dist/image-card.js" }],
      "settingsSections": [{ "id": "grok-build-oauth", "title": "Grok Build" }],
      "slashCommands": []
    }
  },
  "capabilities": ["settings.read", "settings.write", "bridge.emit", "invoke.agent", "stream.render"],
  "lifecycle": { "onDisable": "dispose-app-immediate; unmount-agent-on-next-session" },
  "settingsVersion": 1
}
```

- **Settings 语义：**
  - 键强制 `ext.grok-build-oauth.*`，`scope: "app"` 落 App profile，`scope: "project"` 可选但默认 `app`。
  - `format: secret` 项（token）进 vault/Provider auth，不进普通 settings JSON；list API 仅返回存在性。
  - `compatFallback` 默认 `false`；改后新会话生效，已运行会话通过 `ext.settings_changed` 收到推送但不热挂。

- **UI：**
  - 设置段展示：登录态（未登录/已登录/刷新中/过期）、`expires_at` 倒计时、凭证来源（`oauth`/`api_key`/`env`/`imported`）、当前 base/model、tier 提示、错误原因。
  - 操作：`登录`（browser/device 选择）→ 触发 `invokeExtension("grok-build-oauth", "login", {mode})`；`重新登录`；`退出登录`；`导入 ~/.grok`（二次确认）；`清除`。

### D8 — 存量迁移：消费者/兼容层，最终移除重复

- **PipiUI：** `pipiui-media` 转为兼容层——若 `grok-build` 已登录则委托本扩展的 `image_gen` 工具；否则按 `compatFallback` 决定是否走旧 relay/API key 路径。旧 `tokenFromXaiEntry` 的 expiry 回退逻辑保留但标记 deprecated，由本扩展的 refresh 接管。
- **chatrpgv4：** `portrait-image-route` 与 `portrait-generate` 的 `provider=xai` 分支改为：优先 `grok-build` provider + `grok-imagine-image-quality`；未就绪时按 `compatFallback` 与 `portraitImageProvider` 偏好回退。错误文案从“xAI key 未配置”泛化为 provider-aware。
- **移除条件：** 当两宿主真实登录+生成验收通过且旧路径 30 天无生产命中后，删除 `pipiui-media` 的 relay 常量/路由与 `xai-image.mjs` 的 relay/旧凭证 helper；测试同步更新。
- **COC 禁止：** `plugins/coc-keeper`（含 `pi/extensions/index.ts`）不新增 OAuth/凭证/image transport 代码；COC 仅消费宿主已生成的图片文件路径。

### D9 — 跨宿主等价与会话挂载语义

- **等价：** 三平面（terminal pi-coc / Web-Electron RPC / PipiUI 普通 Pi）共享同一 OAuth 状态机、刷新、Images 请求与错误分类；差异仅在 home 路径与 UI 载体。
- **挂载：** 遵循 `extension-architecture-v1` D9 — 启用/禁用/设置变更仅影响**新会话**的 `-e` 挂载与 env 快照；已运行会话不热挂/热卸 agent 半，`ext.settings_changed` 仅推送可读快照。
- **Home：** PipiUI 以 `PI_CODING_AGENT_DIR` 为权威；pi-coc 以 `PI_COC_AGENT_DIR`（若设）否则 repo-local `.pi/coc-agent` 为权威；禁止回退到全局 `~/.pi`。

### D10 — API、状态机、错误、安全与可观测性

- **扩展 API（app ↔ agent）：**

```ts
// app → agent (invokeExtension)
invoke("login",  { mode: "browser" | "device" }) => { ok: true, data: { verification_uri, user_code? } } | { ok: false, error: { code } }
invoke("logout", {})                             => { ok: true } | { ok: false, error }
invoke("status", {})                             => { ok: true, data: { loggedIn, expires_at, issuer, source, tier } }
invoke("importGrok", { confirm: true })          => { ok: true, data: { imported: boolean } }

// agent → app (ext.emit, channel: "ext.grok-build-oauth")
emit("login_progress", { phase, user_code?, verification_uri?, interval?, expires_in? })
emit("token_refreshed", { expires_at })
emit("auth_error", { code, message_redacted })
```

  - 错误码：`not_found` / `disabled` / `no_session` / `capability_denied` / `agent_error` / `timeout` / `auth_expired` / `tier_restricted` / `rate_limited` / `upstream_error` / `invalid_params` / `invalid_response`。

- **Auth 状态机：**

```
unconfigured → device_requested → polling → authenticated
                ↘ browser_opened ↗          ↘ refreshing → authenticated
                                              ↘ expired/invalid → unconfigured
authenticated → logged_out → unconfigured
any → error (reason visible, no auto-retry)
```

- **错误语义：**
  - 4xx（除 401/429）→ 用户可操作错误，不重试。
  - 401 → 单次强刷重试，仍 401 → `auth_expired`。
  - 429/5xx → 指数退避（仅 Images 请求），不触发 refresh。
  - 所有错误消息与日志经 `redact(token)`，永不输出 Bearer 明文。

- **版本/兼容：**
  - 扩展 `settingsVersion` 从 1 起，`migrations[]` 按 `from→to` 顺序；迁移失败进 `error` 不半写。
  - 生产 issuer/client/scopes 旋转时旧凭证 `issuer` 不一致则视为过期，要求重登（见 §7）。

- **安全：**
  - 0600 权限、原子 rename、锁内重读、freshness guard（D5）。
  - `auth.json` 仅宿主 Pi home 内；`ext.grok-build-oauth.*` secret 仅 vault。
  - `verification_uri` https 校验；`user_code` 字符集校验。

- **可观测性：**
  - 结构化日志：`grok_build_oauth.login_start/success/failure`、`token_refresh`、`token_refresh_dedup`、`image_gen.request/response/error`（均 redacted）。
  - 指标：refresh 次数/去重命中/401 强刷命中/tier gate 短路次数。

---

## 5. Testing Decisions

### 5.1 最高测试缝（按优先级）

**缝 A — OAuth fake server + time + lock（协议与并发）：**

- Device code 请求：断言 form `client_id`/`scope`（空格连接）/`referrer=grok-build` 与 header `x-grok-client-*`；响应校验（user_code 字符集、verification_uri https）。
- 轮询状态机：fake token 端点按序返回 `authorization_pending` → `slow_down`（interval 递增）→ `access_denied`/`expired_token`/`success`；断言 sleep/重试/终端化行为与过期上限。
- Refresh：提前刷新窗口、401 单次强刷、无效 refresh_token 清理、issuer 不一致重登。
- 并发：同进程 N 并发 refresh 仅 1 次网络请求；跨进程 flock + 锁内重读 + 陈旧 token 不覆盖。

**缝 B — Provider auth persistence（凭证落盘）：**

- 登录后 `auth.json` 含 `access_token`/`refresh_token?`/`expires_at`/`issuer`/`client_id`/`scopes`，0600 权限，原子 rename，无半写。
- 刷新后旧 token 不可用，新 token 生效；rotation 时旧 refresh_token 被替换且 freshness guard 生效。
- `~/.grok` 默认不读；显式导入命令一次读取并复制，不删除源文件。

**缝 C — Images request / output（请求与产物）：**

- 请求断言：`POST {base}/images/generations`、payload `model`/`n=1`/`aspect`/`resolution=1k`/`b64_json`、Bearer 与 `x-grok-session-id`。
- Base 默认 `https://api.x.ai/v1`，尾斜杠规范化；非法 aspect/model 被拒。
- 响应：`b64_json` 严格解码、空/畸形拒绝；非 2xx 分类（401/403/429/5xx）与截断 body；secret 永不进日志。
- 落盘：原子 tmp+fsync+rename 到隔离目录，路径不穿越，返回 typed `image`/`path`。

**缝 D — Extension package lifecycle / spawn（包生命周期与挂载）：**

- Manifest 校验、扫描顺序（Bundled→App→Project）、启用状态覆盖、非法 manifest 进 `error`。
- 启用仅新会话 `-e` 出现 `grok-build-oauth` agent 入口；禁用后新会话不再出现、已运行会话不热卸；app 半整组 dispose 无残留（panel/renderer/slash）。
- 两宿主同产物：PipiUI 三位置与 pi-coc repo-local 解析到同一构建产物 hash。

**缝 E — 两宿主真实登录+生成验收（E2E，隔离 workspace）：**

- PipiUI 真实设备流登录（或 mock issuer）后模型触发 `image_gen` 产生文件；pi-coc terminal 与 Web/Electron RPC 同样触发并落盘。
- Portrait 路由在 `grok-build` 已登录时走新工具，未登录时按 compat 开关回退；UI 文案 provider-aware。

### 5.2 失败/边界/安全矩阵

| 场景 | 期望 |
|---|---|
| 网络超时/5xx（device/token/images） | 可重试/退避，错误红隐，不半写 |
| `slow_down` / `authorization_pending` 无限 | 受 `expires_in` 上限约束，超时→`expired_token` |
| `access_denied` / `expired_token` | 终端化，需重登 |
| 并发 refresh + 进程崩溃持锁 | 锁超时/释放后可恢复，不死锁 |
| 401 单次强刷仍 401 | 上抛 `auth_expired`，不循环 |
| 空/畸形 `b64_json` | `invalid_response`，不落盘 |
| 非法 `aspect_ratio`/`model` | `invalid_params`，不发请求 |
| 路径穿越/绝对路径 | 拒绝，日志不含路径明文 |
| tier gate（Free/Basic） | advisory 短路，不计费 |
| abort/timeout（用户取消/超时） | 取消网络请求，不写半新状态 |
| secret redaction | 日志/错误/快照中 token 均 `[redacted]`，仅存在性可见 |
| 旧 `compatFallback=true` + 未登录 | 走 deprecated 回退并告警 |

### 5.3 不做的测试

- 不在渲染像素、main 进程内部对象图、磁盘路径字符串字面上做一等断言；均钉宿主可观察行为（API、spawn 参数、落盘文件、错误码）。
- 不在 COC kernel 内为 OAuth 建测试；COC 侧仅测“消费已落盘图片路径”的集成。

---

## 6. Out of Scope

- 不在 `plugins/coc-keeper` 或任何 COC shared kernel/state/registry/contract/skill 中新增 OAuth/凭证/image transport 代码。
- 不实现自有 OAuth 舞台（回调服务器、浏览器自动化）；仅实现 Pi `registerProvider` 形态的 device 轮询状态机。
- 不引入全局 `~/.pi` 扩展家目录；不恢复 `settings.json` `packages` 自动发现。
- 不为扩展单独开第二套设置存储；不做扩展市场/在线分发（v1 = 本地目录 + npm 包）。
- 不把 agent 半热挂进已运行会话（遵循 D9）。
- 不复制官方 Rust 内部的混淆/telemetry/私有 URL/生成代码；仅移植 wire contract 与安全/并发不变量。
- 不把 PipiUI `loopback relay` 作为默认路径；仅显式 `compatFallback=true` 时作为 deprecated fallback，且默认关闭。
- 不在 COC 侧实现图片模型本身；服务端 Imagine 仍为远端权威。

---

## 7. Further Notes

### 7.1 与 `extension-architecture-v1` 的关系

本 spec 是该架构的**首个 dogfood 包**：双半包、三位置、启用分层、信任 L0/L1/L2、可逆 registry、`format: secret` vault、仅新会话挂载等均直接复用其合约，不另起通道。

### 7.2 文档与实现边界

- 本 spec **不使用易过时的具体实现文件路径或代码片段**作为合约；协议形状/状态机可内联（如 §4.4/§4.5），其余以行为与接口为准。
- 任何“已实现”的宣称必须满足：单一源码、两宿主等价、真实登录+生成验收通过，否则标记 `invalid-for-acceptance`。

### 7.3 未知（实现前必须锁定，不得猜）

若以下来自构建配置，需在**实现前从当前官方源码/发行物锁定**（以 `xai-org/grok-build` 的 HEAD 与发行 channel 为准，已知 HEAD `19d42e35c07a9c9244f03f6df0c4c353f970d4f9` / 2026-08-19）：

1. **生产 issuer**（`xai_oauth2_issuer()` 返回值）与 `.well-known` 发现 URL。
2. **生产 `client_id` / `scopes` / `referrer` 约束**（开源 HEAD 的 `b1a00492-073a-47ea-816f-4c329264a828` / 默认 scopes 是否为生产值）。
3. **Token/refresh 端点响应字段**与 rotation 规则（是否每次返回新 `refresh_token`、`expires_in` 语义、`token_type`）。
4. **`x-grok-client-surface` / `x-grok-client-version` 在 Pi 形态下的必填值与取值。**
5. **Images 支持的 model/aspect/resolution 全集**与 `response_format` 变体（`b64_json` 是否唯一）。
6. **OAuth token 是否在所有 tier/所有 Images 变体上等价于 API key**（是否有 audience/ scope 限制）。
7. **`x-grok-session-id` 是否必填**及其计费/路由语义。

实现前由作者从官方当前发行物或可信 env 文档确认并记录于 `Further Notes` 的“Resolved config”附录；未确认项不得 hardcode 为常量。

---

## 8. Proposed Implementation Phases

> 仅阶段划分，不含生产代码。每个阶段以 §5 的缝验收为准，跨宿主等价为硬门槛。

### Phase 1 — 单包骨架与 Provider 注册

- 建 `grok-build-oauth` 单一源码包与 `pipiui-extension.json`，agent 空实现注册 `grok-build` provider（browser/device 配置占位），app 声明 settings schema 与设置段占位。
- 打通 PipiUI 三位置扫描与 pi-coc 同产物解析（hash 校验），新会话 `-e` 挂载可观测。
- 验收：缝 D（lifecycle/spawn）+ 空 provider 的 `/login grok-build` 可达（fake issuer）。

### Phase 2 — OAuth device 轮询与凭证持久化

- 实现 D4 device_code/token 状态机、输入校验、超时/slow_down/denied/expired 终端化；实现 D5 凭证结构、0600 原子持久化、显式 `~/.grok` 导入。
- 验收：缝 A（fake server/time）+ 缝 B（persistence/perm/atomic/导入）+ app 登录状态/错误红隐。

### Phase 3 — Refresh、并发与 401 强刷

- 实现提前刷新、进程内去重、跨进程 flock + 锁内重读 + freshness guard、401 单次强刷；贯通 `before_provider_request` 注入。
- 验收：缝 A 的并发/锁/401 矩阵 + 缝 B 的 rotation/freshness。

### Phase 4 — Images 工具与落盘

- 实现 D6 Images client、payload/header、tier gate、`b64_json` 解码、原子落盘与 typed 返回；OAuth 与 API key 共用路径。
- App 渲染 `image_gen`/`image_edit` 结果卡；secret 全链路 redaction。
- 验收：缝 C（request/output/tier/redaction）+ 真实（或 mock）Images 端点生成并落盘。

### Phase 5 — 兼容层与迁移收敛

- PipiUI `pipiui-media` 与 chatrpgv4 portrait 路由改为消费者/兼容层（优先 `grok-build`，`compatFallback` 默认关）；错误文案 provider-aware；deprecation 警告。
- 最终移除旧 relay/transport 重复代码，测试同步更新；确认 COC kernel 无 OAuth 残留。
- 验收：缝 E（两宿主真实登录+生成 + portrait 优先路径 + 回退受控）与旧路径移除后的回归。

### Phase 6 —  hardening 与发布

- 超时/abort、限流退避、设置迁移、版本兼容、日志指标、安全审计（0600/原子/锁/校验/redaction 全覆盖）。
- 产出 npm 包与 Bundled 集成说明，补“Resolved config”附录（§7.3 已锁定值）。
- 验收：全缝回归 + 三平面等价验收 + 发布物 hash/权限校验。

---

## Appendix — References

- PipiUI `docs/extension-architecture-v1.md`（双半包/三位置/可逆 registry/secret vault/仅新会话挂载）
- Pi `docs/extensions.md`（`registerProvider`/`registerTool`/`-e` 挂载）
- 官方 `xai-org/grok-build` HEAD `19d42e35` — `auth/device_code.rs`, `auth/config.rs`, `image_gen/mod.rs`, `credentials.rs`, `oauth.rs`, `tier.rs`
- Recon findings: `agent-753a8a768a77680e`, `agent-e1ffeef2129d5b10`, `agent-72ce033e8f12cc6a`, `agent-b191354b90ecb22d`
