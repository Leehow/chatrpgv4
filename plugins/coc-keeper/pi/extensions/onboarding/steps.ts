/**
 * The onboarding step table: the single source of truth for what happens next.
 *
 * Everything the player and the Keeper see about sequencing is DERIVED from
 * this table -- the active tool surface, every refusal, the progress line, the
 * next-step instruction. Nothing about ordering may be written down twice.
 *
 * That rule is the whole point. On 2026-09-02 the old path failed six times in
 * one evening, and five of those were one of two shapes: a card advertising
 * actions the gate did not accept, or an instruction naming a tool the surface
 * did not carry. Both are unrepresentable here, because the surface and the
 * wording come from the same row.
 *
 * `done` reads the campaign directory, never in-memory state: a step is
 * complete when the canonical write it owns is on disk, so a restarted or
 * resumed onboarding session recomputes the same position.
 */
import type { OnboardingState } from "./state.ts";

export type StepAction =
  | { kind: "ask_player" }
  | { kind: "operation"; tool: string; args: (state: OnboardingState) => Record<string, unknown> }
  | { kind: "subagent"; agent: string }
  | { kind: "external"; producer: string };

export type Step = {
  readonly id: string;
  readonly needs: readonly string[];
  readonly action: StepAction;
  /** Tools this step may use. Anything else is refused with `say(state)`. */
  readonly tools: readonly string[];
  /** True when this step's canonical receipt exists on disk. */
  readonly done: (state: OnboardingState) => boolean;
  /** What the Keeper should do now, in the player's language. */
  readonly say: (state: OnboardingState) => string;
  /**
   * A method document this step must follow, repo-relative. The extension
   * reads it and delivers its text with the instruction: the session has no
   * `read` tool, so naming a path would point the Keeper at a file it cannot
   * open -- the same shape as an instruction naming a tool it does not carry.
   */
  readonly guide?: string;
  /** Steps skipped entirely on the built-in starter path. */
  readonly skipForStarter?: boolean;
};

const SETUP_INVOKE = "coc_setup_invoke";

export const STEPS: readonly Step[] = [
  {
    id: "choose-source",
    needs: [],
    action: { kind: "ask_player" },
    tools: ["coc_setup_inspect"],
    done: (s) => s.source !== null,
    say: () => (
      "问玩家想玩哪一本：内置示例模组，或者一本 PDF 模组（给出路径）。"
      + "只问这一件事。"
    ),
  },
  {
    id: "build-bundle",
    needs: ["choose-source"],
    skipForStarter: true,
    action: { kind: "external", producer: "coc-pdf-pipeline" },
    tools: [],
    done: (s) => s.bundlePath !== null,
    say: (s) => (
      `《${s.sourceTitle ?? "该模组"}》需要先由 PDF 管线做成资料包，`
      + "这一步在桌外完成，引导不能代劳：\n\n"
      + `    coc-pdf-pipeline pipeline --pdf <文件> --work <目录>\n\n`
      + "做好后把 bundle 目录放进工作区（`.coc/module-library/<id>`），"
      + "告诉玩家正在等这个，然后等待——不要重试，不要猜路径，"
      + "更不要改用内置示例模组。"
    ),
  },
  {
    id: "create-campaign",
    needs: ["choose-source"],
    action: {
      kind: "operation",
      tool: SETUP_INVOKE,
      args: (s) => (s.isStarter
        ? { kind: "campaign.quick_start", payload: { scenario_id: s.starterId, campaign_id: s.campaignId } }
        : {
            kind: "campaign.create",
            payload: {
              campaign_id: s.campaignId,
              title: s.sourceTitle,
              play_language: s.playLanguage,
            },
          }),
    },
    tools: [SETUP_INVOKE, "coc_setup_quick_start"],
    done: (s) => s.campaignExists,
    say: (s) => (s.isStarter
      ? `用 setup.quick_start 建战役（scenario_id=${s.starterId}，campaign_id=${s.campaignId}）。`
        + "这是第一次写入，不要先 campaign.create。"
      : `用 setup.invoke / campaign.create 建战役 ${s.campaignId}。`
        + "这一步战役尚不存在，不要带外层 campaign 选择器。"),
  },
  {
    id: "bind-source",
    needs: ["build-bundle", "create-campaign"],
    skipForStarter: true,
    action: {
      kind: "operation",
      tool: SETUP_INVOKE,
      args: (s) => ({
        kind: "scenario.bind_pdf",
        payload: {
          campaign_id: s.campaignId,
          scenario_id: s.scenarioId,
          title: s.sourceTitle,
          source_bundle_path: s.bundlePath,
        },
      }),
    },
    tools: [SETUP_INVOKE],
    done: (s) => s.scenarioBound,
    say: (s) => (
      `用 setup.invoke / scenario.bind_pdf 绑定 ${s.bundlePath}。`
      + " source_bundle_path 必须是已经做好的 bundle 目录，不是 PDF 文件。"
    ),
  },
  {
    id: "source-review",
    needs: ["bind-source"],
    skipForStarter: true,
    action: { kind: "subagent", agent: "coc-opening-source-coordinator" },
    // Review and adoption are one step on purpose. The review's product lives
    // only in the subagent result until it is adopted, so the sole durable
    // trace of both is the adopted fact set. Split into two rows, the review
    // row could never read as done and the adoption tool would never be on the
    // surface -- a deadlock the table cannot express this way.
    tools: [
      "subagent",
      "subagent_status",
      "subagent_result",
      "await_subagent",
      "coc_capabilities",
      "coc_setup_adopt_source_facts",
    ],
    done: (s) => s.factsAdopted,
    say: () => (
      "派一个 coc-opening-source-coordinator 子代理做视觉复核："
      + "先调 coc_capabilities，把 "
      + "`data.cold_start.opening_source_coordinator.task_static` 逐字复制，"
      + "补上 task_variable_fields 里的每一项。"
      + "拿到结果后用 setup.adopt_source_facts 采纳那六项开场事实——"
      + "facts 必须是复核产出的原样，不是你自己写的；"
      + "读不出来的问题填 unresolved 并附已查页码，这比编一个答案容易。"
      + "没有任何桌面操作能推进这一步。"
    ),
  },
  {
    id: "briefing",
    needs: ["source-review"],
    action: {
      kind: "operation",
      tool: SETUP_INVOKE,
      args: (s) => ({ kind: "campaign.render_briefing", payload: { campaign_id: s.campaignId } }),
    },
    tools: [SETUP_INVOKE],
    done: (s) => s.briefingPath !== null,
    say: () => "生成 player-safe 建卡简报（campaign.render_briefing）。",
  },
  {
    id: "create-investigator",
    needs: ["briefing"],
    action: {
      kind: "operation",
      tool: "coc_setup_chargen_run",
      args: (s) => ({ campaign_id: s.campaignId }),
    },
    // `setup.chargen_run` is create + link + render_card under one lock, so
    // there is no separate link step: the campaign's party.json is the receipt
    // for the whole of character creation.
    tools: ["coc_setup_investigator_contract", "coc_setup_chargen_run"],
    done: (s) => s.investigatorLinked,
    guide: "docs/methods/immersive-character-creation.md",
    say: () => (
      "带玩家建调查员，完全照下面这份方法做。"
      + "第一个问题只问姓名与职业概念，全程不向玩家提问任何数值——"
      + "属性优先级由你从职业概念推出来，交给 setup.chargen_run 分配。"
      + "backstory.scenario_bound 必须指向这一本模组的开场，不是泛泛的克苏鲁味。"
    ),
  },
  {
    id: "complete",
    needs: ["create-investigator"],
    action: {
      kind: "operation",
      tool: "coc_setup_complete",
      args: (s) => ({ campaign_id: s.campaignId, decision_id: `setup-complete:${s.campaignId}` }),
    },
    tools: ["coc_setup_complete"],
    done: (s) => s.readyForTable,
    say: () => (
      "调 setup.complete 完成交接。之后引导会话结束，"
      + "游玩由另一个会话接手——不要在这里开场叙事。"
    ),
  },
];

// A `needs` entry naming no step is satisfied vacuously below, because that is
// how the starter path skips the source half. That same leniency would swallow
// a typo or a deleted row, so the ids are checked once at load instead.
const STEP_IDS = new Set(STEPS.map((step) => step.id));
for (const step of STEPS) {
  for (const need of step.needs) {
    if (!STEP_IDS.has(need)) {
      throw new Error(`onboarding step ${step.id} needs unknown step ${need}`);
    }
  }
}

/** The steps that apply to this run: the starter path skips the source half. */
export function applicableSteps(state: OnboardingState): readonly Step[] {
  return state.isStarter ? STEPS.filter((step) => !step.skipForStarter) : STEPS;
}

/**
 * The first step whose receipt is missing and whose needs are all satisfied.
 * `null` means onboarding is finished.
 */
export function currentStep(state: OnboardingState): Step | null {
  // The handoff receipt outranks every upstream one. `setup.complete` refuses
  // a campaign that is not actually finished, so its receipt is proof that
  // everything before it happened -- including steps whose own receipt this
  // table would look for and not find, as with a campaign an older path built.
  if (state.readyForTable) return null;
  const steps = applicableSteps(state);
  const satisfied = new Set(steps.filter((step) => step.done(state)).map((step) => step.id));
  for (const step of steps) {
    if (satisfied.has(step.id)) continue;
    if (step.needs.every((need) => satisfied.has(need) || !steps.some((s) => s.id === need))) {
      return step;
    }
  }
  return null;
}

/** Tools legal right now. Derived, never written down a second time. */
export function activeTools(state: OnboardingState): readonly string[] {
  const step = currentStep(state);
  return step === null ? [] : step.tools;
}

/** Why an off-step call was refused, in terms of the table itself. */
export function refusal(state: OnboardingState, attempted: string): string {
  const step = currentStep(state);
  if (step === null) {
    return (
      `${attempted} 不可用：引导已经完成，战役已交接给游玩会话。`
    );
  }
  const blocking = step.needs.filter((need) => {
    const dependency = applicableSteps(state).find((s) => s.id === need);
    return dependency !== undefined && !dependency.done(state);
  });
  const because = blocking.length > 0
    ? `（还差：${blocking.join("、")}）`
    : "";
  return `${attempted} 不是这一步。现在该做 ${step.id}${because}：${step.say(state)}`;
}
