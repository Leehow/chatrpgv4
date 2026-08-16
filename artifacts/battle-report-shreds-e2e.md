# COC Actual-Play Battle Report

This is the final player-readable report produced directly from a real playtest run.

- Report ID: `coc-battle-report-c9424da15779d1cf4af47631`
- Run: `shreds-e2e-0806-blocked-opening`
- Campaign: `shreds-e2e-0806`
- Completeness: **INCOMPLETE**

> Completeness covers report-source evidence only. It does not certify prose quality, Director use, or whole-product KP quality.

## Investigators

### Simon Page

- ID: simon-page
- Occupation: 演员
- Age: 28
- Era: early_modern
- Final HP: 9
- Final SAN: 60
- Final MP: 12
- Final Luck: 30

#### Characteristics

STR: 50 | CON: 50 | SIZ: 40 | DEX: 70 | APP: 80 | INT: 50 | POW: 60 | EDU: 60

#### Initial Derived Values

HP: 9 | MP: 12 | SAN: 60 | Luck: 30 | DB: none | Build: 0 | MOV: 9

#### Era-Adaptive Creation

- Era Adaptive: yes
- KP Guided: yes
- Input Mode: kp_guided_era_adaptive
- Creation Method: quick_fire_array
- Occupation Rationale: 开场钩子为演员西蒙·佩奇接友人来信；与模块 investigator_hook 对齐
- Skill Point Formula: EDU×2 + APP×2
- Formula Rationale: 舞台职业：教育支撑剧本文字与记诵，外貌支撑登台魅力与 patronage
- Skill Budget Provenance:
  - Occupation Points: 280 / 280; allocations: `Charm` +40, `Credit Rating` +40, `Disguise` +40, `History` +40, `Language (Own)` +15, `Listen` +30, `Persuade` +30, `Psychology` +25, `Fast Talk` +20
  - Personal Interest Points: 100 / 100; allocations: `Spot Hidden` +25, `Stealth` +30, `Climb` +10, `Intimidate` +20, `Sleight of Hand` +15

#### Skill Adaptation Provenance

- `Charm`: `Charm` → 魅力
- `Credit Rating`: `Credit Rating` → 信誉/社会地位
- `Disguise`: `Disguise` → 易容/扮相
- `Dodge`: `Dodge` → 闪避
- `History`: `History` → 历史掌故
- `Language (Own)`: `Language (Own)` → 母语（英语）
- `Listen`: `Listen` → 聆听
- `Persuade`: `Persuade` → 说服
- `Psychology`: `Psychology` → 察言观色
- `Fast Talk`: `Fast Talk` → 花言巧语
- `Spot Hidden`: `Spot Hidden` → 侦察/眼力
- `Stealth`: `Stealth` → 潜行
- `Climb`: `Climb` → 攀爬
- `Intimidate`: `Intimidate` → 恐吓
- `Sleight of Hand`: `Sleight of Hand` → 巧手

#### Initial Skills

| Skill | Full | Half | Fifth |
|---|---:|---:|---:|
| 魅力 (`Charm`) | 55 | null | null |
| 信誉/社会地位 (`Credit Rating`) | 40 | null | null |
| 易容/扮相 (`Disguise`) | 45 | null | null |
| 闪避 (`Dodge`) | 35 | null | null |
| 历史掌故 (`History`) | 45 | null | null |
| 母语（英语） (`Language (Own)`) | 75 | null | null |
| 聆听 (`Listen`) | 50 | null | null |
| 说服 (`Persuade`) | 40 | null | null |
| 察言观色 (`Psychology`) | 35 | null | null |
| 花言巧语 (`Fast Talk`) | 25 | null | null |
| 侦察/眼力 (`Spot Hidden`) | 50 | null | null |
| 潜行 (`Stealth`) | 50 | null | null |
| 攀爬 (`Climb`) | 30 | null | null |
| 恐吓 (`Intimidate`) | 35 | null | null |
| 巧手 (`Sleight of Hand`) | 25 | null | null |

## Development and Ending

No structured ending was recorded.

## Investigation Chronicle

### Scene Progression

No visited-scene path was recorded.

### Discovered Clues

No discovered-clue receipts were recorded.

### NPC Interactions

No player-safe NPC interaction receipts were recorded.

### First Impressions

No first-impression receipts were recorded.

### Social Skill Rolls

No public social-skill rolls (Charm, Fast Talk, Intimidate, Persuade) were recorded.

### Recorded Consequences

No structured player-safe combat, HP, or SAN consequences were recorded.

### Exceptional Effects

No source-bound exceptional effects were recorded.

### Relationship / Impression Rewards

No NPC-scoped relationship rewards were recorded.

### Major Decisions

No structured major-decision receipts were recorded.

## Actual Play

### Turn 1 · player

你好，我想开一局新的《克苏鲁的呼唤》。请用全新战役，战役 ID 就叫 shreds-e2e-0806。

### Turn 2 · keeper

全新战役已创建。

**战役 ID**：`shreds-e2e-0806`  
**规则集**：CoC 7e  
**对白语言**：简体中文

目前还没有绑定剧本、也没有调查员。你可以从下面选一条路继续：

1. **内置开箱即玩**
   - **The Haunting**（1920s 波士顿 Corbitt 宅）  
     预生成角色：埃莉诺·里德（记者）/ 托马斯·海斯（私家侦探）
   - **The White War**（1916 阿尔卑斯前线）— 暂无预生成角色

2. **自建调查员**  
   先建角色再进桌；可选用 Quick Fire 数组、掷骰分配、点买等。

3. **绑定自备 PDF 剧本**  
   提供剧本源包路径，走 PDF 导入开场。

你想走哪条？若选内置，直接说场景 + 预生成角色即可。

### Turn 3 · player

我有剧本 PDF，走导入。路径是：/Users/haoli/Documents/TRPG/克苏鲁的呼唤/[COC模组翻译]褴褛之王-The King of Shreds and Patches.pdf

### Turn 4 · keeper

绑定 PDF 需要的是 **源包目录**（含 `manifest.json` 的文件夹），不能直接传单个 PDF 文件。

你给的路径是：
`/Users/haoli/Documents/TRPG/克苏鲁的呼唤/[COC模组翻译]褴褛之王-The King of Shreds and Patches.pdf`

这是文件本身，绑定会失败。

请提供 **Codex pdf-skill 源包目录** 路径，例如类似：

```text
/path/to/some-bundle/          ← 目录
  ├── manifest.json
  ├── pages/ 或 normalized.json 等
  └── ...
```

若你还没有把该 PDF 编成源包，可以：

1. **给我已有源包目录的绝对路径**（推荐，能直接 `scenario.bind_pdf`）  
2. 或说明你希望我怎么处理——例如你是否已有同名/附近的 bundle 目录、是否要走 Progressive OCR 建 corpus  

把正确的 **bundle 目录** 路径发来后，我继续导入《褴褛之王》。

### Turn 5 · player

我只有这个 PDF 文件，没有现成的源包目录。能不能直接用这份 PDF 导入开局？

### Turn 6 · keeper

**不能。** 在本桌面里，`scenario.bind_pdf` 只接受 **Codex pdf-skill 源包目录**（目录内要有 `manifest.json`），**不能直接绑单个 PDF 文件**。

我这边也试了 Progressive OCR 把 PDF 编成源包，环境里 **python 不可用**（`spawn python ENOENT`），所以这台桌面当前也做不了「现场从 PDF 建包」。

### 你现在可以选的路

1. **另开能写文件/有 python 的环境**，先把这份 PDF 编成源包目录，再把 **bundle 目录绝对路径** 发我，我继续绑《褴褛之王》并走开场事实采纳。  
2. **改用内置 starter 先开一局**（如 *The Haunting* + 预生成角色），不依赖 PDF。  
3. **继续这个空战役 `shreds-e2e-0806`**，不绑 PDF，自建调查员后做无源本的自由桌（没有源本事实/开场锚点）。

战役 `shreds-e2e-0806` 还在，只是还没绑上剧本。  
你手头如果已经有编好的源包目录，直接把路径贴过来；否则告诉我选 2 还是 3。

### Turn 7 · player

还是想用刚才那份《褴褛之王》的 PDF 开这局。战役还是 shreds-e2e-0806，请继续帮我导入并开场；如果已经在处理了就接着做。

### Turn 8 · keeper

[host_error] Grok Build stream translation failed

### Turn 9 · player

你还在吗？我想继续《褴褛之王》这局，请接着导入和开场。

### Turn 10 · keeper

开场资料解析失败，游戏尚未开始。系统保留了当前进度；你可以重试原来的开场步骤，在资料就绪前不会自行编写剧情。

### Turn 11 · player

好的，我准备好了。请继续把开场弄好，我是西蒙·佩奇的话就按这个角色开吧。

### Turn 12 · keeper

开场资料解析失败，游戏尚未开始。系统保留了当前进度；你可以重试原来的开场步骤，在资料就绪前不会自行编写剧情。

### Turn 13 · player

我还在，战役 shreds-e2e-0806，角色西蒙·佩奇。请继续推进开场，我想开始玩。

### Turn 14 · keeper

（本回合无玩家可见正文：空回复或仅工具调用/硬门等待）

### Turn 15 · player

如果开场还在准备，就请再试一次把它跑完；我在等开场叙述。

### Turn 16 · keeper

（本回合无玩家可见正文：空回复或仅工具调用/硬门等待）

### Turn 17 · player

还是没有开场吗？请告诉我现在卡在哪一步，或者直接开场。

### Turn 18 · keeper

（本回合无玩家可见正文：空回复或仅工具调用/硬门等待）

## Public Rules and Dice

Public roll count: **0**.
Dice completeness: **FAIL**.

No public or consequence-public rolls occurred.

## Play Conduct Signals

Observational structured facts for human review. They are not pass/fail judgments and do not change the completeness classification.

- Dialogue turns: **18**
- Public rolls: **0**
- Tool calls per turn (from the keeper-internal toolbox log): turn 0: 32
- Discovered clues: 0; module-designed skill-check delivery: 0; without a matching authored-skill roll in the roll log: **0**
- NPC engagements: no structured receipts were recorded

## Completeness and Provenance

- Source Identity: **PASS** — run metadata and campaign directory resolved
- Exact Transcript: **FAIL** — final exact transcript source is missing
- Dice: **FAIL** — structured roll evidence is missing or invalid; public roll rows bound to no finalization and carrying no abandonment disposition: toolbox-shreds-e2e-0806-000001 (source line 1)
- Character And Final State: **PASS** — initial card and final dynamic state are present
- Progression: **FAIL** — world progression sources or visited path are missing
- Ending And Development: **FAIL** — structured ending or development settlement is missing
- Initial Final Snapshot Separation: **PASS** — initial skill snapshot is creation-frozen, never the live final map
- Settlement Session Uniqueness: **PASS** — settlement boundaries are unique per session and investigator
- Player Safe Projection: **PASS** — explicit per-source allowlists applied
- final exact transcript source is missing
- structured roll evidence is missing or invalid
- public roll rows bound to no finalization and carrying no abandonment disposition: toolbox-shreds-e2e-0806-000001 (source line 1)
- world progression sources or visited path are missing
- structured ending or development settlement is missing
- partial transcript exported by explicit request
- 1 public roll rows are bound to no finalization and carry no abandonment disposition: toolbox-shreds-e2e-0806-000001 (source line 1)
- Dialogue rows rendered: 18.
- Public rolls rendered exactly once: 0.
- Keeper-only rolls, scenario truth, hidden logs, runner prompts, NPC identity contracts/agendas/voices, and secret fields are excluded.
- This is evidence/report-source completeness, not a prose-quality, Director-use, or whole-product KP-quality claim.
