# rerank 扩展（`extensions/rerank`）

一条能力扩展，把「交叉编码器重排」接进本产品：用户在设置里**选一个供应商、贴一个 API key**，agent 侧就能用一次 HTTP 调用把候选文档按与查询的相关度重排。

## 为什么是扩展，而不是改动现有链路

重排只对「候选列表」有意义，而候选列表来自检索。当前产品里真正产生候选列表的是 `lookup`（模组文本检索）与 `recall`（战役记忆），两者现在都返回未排序列表。把它们改成先重排再交给守秘人，是**产品行为的变化**，不属于「加一个可配置的供应商」这件事本身。所以本切片只交付能力与配置面：

- **谁写**：PipiUI 设置面板。本包贡献一个**受控设置节**（`app/settings-rerank.js`）：选供应商 → 该厂商的模型下拉 → 贴 API key。`provider` 与 `model` 是普通设置，`apiKey` 是 `format: "secret"`（进 vault，不落盘）。
- **谁读**：`agent/index.js` 的 `rerank()`，配置经 spawn 注入的 env 读入（见下）。
- **谁据它行动**：本切片只有 `/rerank:test`（一次性验证 key 能不能用）。真正的消费者（`lookup` / `recall` / 模组深读）**尚未接线**，接哪条是下一步的产品决定。

### 受控设置节需要宿主收录（否则不存在）

贡献一个节**不等于**它会显示：`ModelVisibilityModal` 只渲染 id 在宿主白名单 `HOST_SETTINGS_TAB_IDS`（`Electron/packages/ui/src/ui-registries.ts`）里的节，且导航要 `SETTINGS_NAV_HINTS` 里有一个副标题——两样都在 2026-09-19 按 `image-model` / `coc-difficulty` 的先例为 `rerank` 办了（`coc-difficulty-settings.test.tsx` 里有一条同样的收录断言）。这也是为什么纯 schema 设置（如 deepseek）不需要收录：它自己长在扩展卡片里。

## 供应商就是全部配置

**表里一行 = 端点 + 鉴权头 + 模型候选。** 选了供应商，端点就定了；模型从**该厂商的候选列表**里选（下拉），所以面板上没有一个要手打 id 或 URL 的框。2026-09-18 的首版曾把 model / Base URL 做成空白输入框，用户指出那正是外行答不出来的东西（「不是都选择供应商了么」）——现在它们不是可选，是不存在。

模型表是各家文档核验过的**静态目录**（2026-09-18）。**实时拉取做不到**：那要带着 key 发 HTTP，而 key 只活在 agent 进程里（渲染进程 fetch 会被 CORS 挡，vault 只回存在性不回值）；真要实时列表，得等会话在 key 之后起，走 agent 侧的另一条路。

预设（2026-09-18 按各厂商文档核验，来源见 `.pi/findings/rerank-vendors.md`）：

| id | 端点 | 模型 | 备注 |
| --- | --- | --- | --- |
| `cohere` | `api.cohere.com/v2/rerank` | `rerank-v4.0-fast` | 多语言；`v4.0-pro` 更强更贵 |
| `qwen` | `dashscope-intl.aliyuncs.com/compatible-api/v1/reranks` | `qwen3-rerank` | OpenAI 兼容路由；**中国大陆工作区是自己的主机名**，需换行 |
| `jina` | `api.jina.ai/v1/rerank` | `jina-reranker-v3.5` | 超长上下文、多语言 |
| `voyage` | `api.voyageai.com/v1/rerank` | `rerank-2.5` | `-lite` 更便宜 |
| `siliconflow` | `api.siliconflow.com/v1/rerank` | `Qwen/Qwen3-Reranker-8B` | 也挂 4B / 0.6B |
| `zeroentropy` | `api.zeroentropy.dev/v1/models/rerank` | `zerank-2` | 便宜、多语言；有 EU 端点 |
| `fireworks` | `api.fireworks.ai/inference/v1/rerank` | `fireworks/qwen3-reranker-8b` | serverless |
| `pinecone` | `api.pinecone.io/rerank` | `bge-reranker-v2-m3` | 一把 key 多个模型 |
| `openrouter` | `openrouter.ai/api/v1/rerank` | `cohere/rerank-v3.5` | 一把 key 路由多家 |

**故意不在表里**（贴 key 用不了，放进来只会「配置成功然后失败」）：Google Vertex AI Ranking API（OAuth/ADC；**Gemini API 本身没有 rerank**）、AWS Bedrock（SigV4）、Azure Foundry（每个部署一个 URL）、NVIDIA NIM（要自托管；托管路径未核验）、Mixedbread（独立 rerank 端点已下线）、Together（需专用端点）。

## 通道

宿主在 spawn 子进程时注入两样东西（`Electron/packages/pi-backend/src/spawn-assembly.ts`）：

| env | 内容 | 来源 |
| --- | --- | --- |
| `PIPIUI_EXT_SETTINGS_RERANK` | `{"ext.rerank.provider"}` 的 JSON | 扩展非 secret 设置 |
| `EXT_RERANK_APIKEY` | secret 值 | vault（`format: "secret"`） |

两个名字都是宿主按 manifest 的属性键推导出来的（`secretEnvName` / `extensionSettingsEnvName`），`agent/config.js` 里镜像了同一套变换，`tests/extension/rerank.test.mjs` 把两处钉在一起。**agent 半只读不写**：设置面板是唯一写入者。

### 生效时机与 key 的生命周期（2026-09-19 真桌反馈）

宿主在 **spawn 时**把这两样东西塞进子进程环境（`spawn-assembly.ts` 把 `pkg.secretEnv` 赋进 child env），运行中的进程拿不到新值——所以：**保存 key 后要重开桌（新会话）才生效**。改设置会给存活会话发一条 `ext.settings_changed`，但那条只带非 secret 快照，不带 key。面板的描述与 `config.js` 的拒绝文案都把这条写明了（错误码仍是 `unconfigured`）。

**key 不落盘（框架现状）**：`secret-vault.ts` 的 `MEMORY_VAULT_MESSAGE` 就是这句话——密钥只在当前 App 主进程内存里，退出 App 即清除。（设置本身落在 `<agentDir>/pipiui-settings.json` 的 `extensions.rerank.settings`，而 secret 只回存在性。）面板里写明了这一点，免得被当成「存不上」。

**key 只在提交时写**：宿主有一道 `MIN_SECRET_LEN = 8` 的闸（`index.ts:8625`），逐字符写会把半截密钥送进去并被拒；面板改为**失焦或回车才提交**，并且只让最新一次写入的结果点亮错误横幅（旧回复乱序落回会把失败钉在已写成功的值上），错误横幅直接显示宿主的 code 与原文。

## 适配器族

各家的请求/响应形状收敛成几族，`agent/vendors.js` 每个族一个 adapter，供应商表只是数据：

| 族 | 请求 | 响应 | 谁 |
| --- | --- | --- | --- |
| Cohere 形 | `{model, query, documents, top_n}` | `results[].relevance_score` | cohere、qwen(兼容路由)、jina、siliconflow、zeroentropy、openrouter |
| Voyage 形 | 同上（`top_k`） | `data[].relevance_score` | voyage |
| Fireworks | Cohere 请求 | Voyage 响应 | fireworks |
| Pinecone | `{model, query, documents:[{id,text}], top_n}` + `Api-Key` 头 | `data[].score` | pinecone |

闭集路由：按供应商 id 查表，不做任何语义分类。

## 接口

```js
import { rerank } from "../../extensions/rerank/agent/index.js";
const { provider, model, results } = await rerank(query, documents, { topN });
// results: [{ index, score, document? }]，index 回指传入的 documents 下标
```

配置缺失或供应商拒绝时**抛异常**，不静默返回未排序列表：要不要退回未重排顺序，是调用方的决定。

## 未做（明确留白）

- 消费者接线（`lookup` / `recall` / 深读）——产品决定。
- 模型选择：现在每个供应商的模型都在表里（下拉）；同厂商换档已经成立。
- 模型目录的实时刷新（见上）。
- 区域端点 / 代理：表里是各家的国际端点；DashScope 大陆工作区、ZeroEntropy EU 这类要另开字段，等真有需求再说。
- 逐调用成本/速率控制、批量重排、结果缓存。
