import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const campaign = "graph-table-opening-host-binding";
const previousRole = process.env.COC_PI_SESSION_ROLE;
const previousCampaign = process.env.PI_COC_CAMPAIGN_ID;
process.env.COC_PI_SESSION_ROLE = "play";
process.env.PI_COC_CAMPAIGN_ID = campaign;

const extension = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const tools = new Map();
const handlers = new Map();
const calls = [];
const canonicalRollId = (
  "npc-first-impression-roll-v2:"
  + "e6c60fb32ff1704f738d073654ef1175f251b83a"
);
const firstImpressionRef = (
  "npc-first-impression-v2:"
  + "1690ebc995c7b76d4881a04ba4152dff6f8de47b"
);
const npcIdentityRef = (
  "npc-identity-v2:"
  + "a1650c3896ef62dd2d904569"
);
let engagementCallCount = 0;

const canonicalCall = async (name, params) => {
  assert.equal(name, "coc_invoke");
  calls.push(structuredClone(params));
  if (params.operation === "session.resume") {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaign,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
        current_turn: {
          rows: [{
            call_index: 1,
            tool: "setup.complete",
            ok: true,
            data_ref: "logs/toolbox-calls.jsonl#call-1",
            data_digest: "a".repeat(64),
            data_bytes: 128,
          }],
        },
        scene_context: {
          schema_version: 1,
          campaign_id: campaign,
          active_scene_id: "commission-briefing",
          party: ["thomas-hayes"],
          party_investigators: [{
            investigator_id: "thomas-hayes",
            name: "托马斯·海斯",
          }],
          route_index: [{
            route_id: "commission-briefing-to-newspaper-morgue",
            route_type: "scene_transition",
            resolution_kind: "direct_delivery",
            grants_clue_ids: [],
          }],
        },
      },
    };
  }
  if (params.operation === "evidence.table_opening") {
    assert.equal(params.root, root);
    assert.equal(params.campaign, campaign);
    assert.deepEqual(params.arguments, {
      text: "诺特把科比特宅邸的钥匙推过桌面。",
      presented_roll_ids: [canonicalRollId],
      run_id: `run-${campaign}`,
      decision_id: `table-opening:${campaign}:opening-1`,
    });
    return {
      ok: true,
      tool: "evidence.table_opening",
      data: {
        schema_version: 1,
        campaign_id: campaign,
        turn: 0,
        text: params.arguments.text,
      },
    };
  }
  if (params.operation === "npc.reaction") {
    assert.equal(params.root, root);
    assert.equal(params.campaign, campaign);
    assert.equal(params.arguments.investigator, "thomas-hayes");
    assert.equal(params.arguments.run_id, `run-${campaign}`);
    assert.equal(
      params.arguments.decision_id,
      "opening-reaction-steven-knott-1",
    );
    return {
      ok: true,
      tool: "npc.reaction",
      data: {
        schema_version: 2,
        receipt_id: firstImpressionRef,
        campaign_id: campaign,
        run_id: `run-${campaign}`,
        decision_id: "opening-reaction-steven-knott-1",
        investigator_id: "thomas-hayes",
        npc_id: "npc-steven-knott",
        npc_display_name: "史蒂文·诺特",
        app: 50,
        credit_rating: 25,
        governing_attribute: "app",
        governing_value: 50,
        roll_id: canonicalRollId,
        roll_record: {
          roll_id: canonicalRollId,
          kind: "npc_first_impression",
          actor: "thomas-hayes",
          investigator_id: "thomas-hayes",
          npc_id: "npc-steven-knott",
          npc_display_name: "史蒂文·诺特",
          display_skill: "初印象",
          target: 50,
          required_level: "regular",
          achieved_level: "regular",
          passed: true,
          outcome: "regular",
          roll: 37,
          visibility: "public",
          source_ref: `logs/rolls.jsonl#${canonicalRollId}`,
          payload: { roll_id: canonicalRollId, npc_id: "npc-steven-knott" },
        },
        required_level: "regular",
        achieved_level: "regular",
        outcome: "regular",
        passed: true,
        surplus_levels: 0,
        reaction_tier: "open",
        disposition: "neutral",
        context: { semantic_reason: "first material meeting" },
        rule_ref: "keeper-rulebook-p191-percentile-levels",
        integrity_digest: `sha256:${"c".repeat(64)}`,
        first_impression_ref: firstImpressionRef,
        record_engagement_operation: {
          operation: "state.record_npc_engagement",
          invoke_via: "coc_invoke",
          prefilled_arguments: {
            npc_id: "npc-steven-knott",
            investigator: "thomas-hayes",
            first_impression_ref: firstImpressionRef,
            run_id: `run-${campaign}`,
          },
          missing_arguments: [
            "interaction_kind",
            "decision_id",
            "first_impression_realization",
          ],
          authority: "advisory",
          hard_gate: false,
        },
      },
    };
  }
  if (params.operation === "npc.query") {
    assert.equal(params.campaign, campaign);
    assert.equal(params.arguments.investigator, "thomas-hayes");
    assert.equal(params.arguments.npc_id, "npc-steven-knott");
    return {
      ok: true,
      tool: "npc.query",
      data: {
        npcs: [{
          npc_id: "npc-steven-knott",
          name: "Steven Knott",
          identity_ref: npcIdentityRef,
          first_contact_readiness: {
            requested_pair_first_impression: {
              status: "settled",
              investigator_id: "thomas-hayes",
              receipt_exists: true,
              first_impression_ref: firstImpressionRef,
            },
          },
        }],
      },
    };
  }
  if (params.operation === "state.record_npc_engagement") {
    engagementCallCount += 1;
    if (engagementCallCount === 1) {
      assert.deepEqual(params.arguments, {
        interaction_kind: "dialogue",
        first_impression_realization: {
          observable_manner: "诺特务实地把钥匙推过桌面。",
          causal_explanation: "专业态度让他愿意直入正题。",
          boundary_preserved: "雇佣关系和截止压力不变。",
          opportunity_or_friction: "调查员可直接追问委托细节。",
        },
        npc_id: "npc-steven-knott",
        investigator: "thomas-hayes",
        first_impression_ref: firstImpressionRef,
        run_id: `run-${campaign}`,
        decision_id: `npc-engagement-${campaign}-npc-steven-knott-1`,
      });
    } else {
      const laterArguments = structuredClone(params.arguments);
      const laterDecisionId = laterArguments.decision_id;
      delete laterArguments.decision_id;
      assert.match(
        laterDecisionId,
        new RegExp(
          `^npc-engagement:${campaign}:npc-steven-knott:player-epoch-\\d+$`,
        ),
      );
      assert.deepEqual(laterArguments, {
        interaction_kind: "dialogue",
        route_completion: {
          scene_id: "commission-briefing",
          route_id: "ask-macario-tragedy",
          semantic_reason: "诺特直接回答了马卡里奥一家的遭遇。",
        },
        identity_ref: npcIdentityRef,
        npc_id: "npc-steven-knott",
        investigator: "thomas-hayes",
        first_impression_ref: firstImpressionRef,
        run_id: `run-${campaign}`,
      });
    }
    return {
      ok: true,
      tool: "state.record_npc_engagement",
      data: { schema_version: 1, status: "recorded" },
    };
  }
  throw new Error(`unexpected canonical operation ${params.operation}`);
};

const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  registerShortcut() {},
  on(type, handler) {
    const rows = handlers.get(type) ?? [];
    rows.push(handler);
    handlers.set(type, rows);
  },
  appendEntry() {},
  sendMessage() {},
  setActiveTools() {},
  getActiveTools: () => [],
  getThinkingLevel: () => "off",
};

extension.default(pi, {
  coordinatorEnabled: () => false,
  startupCampaignId: () => null,
  createClient: () => ({
    callTool: canonicalCall,
    async callToolWithTransportMeta(name, params) {
      return { value: await canonicalCall(name, params), transport: null };
    },
    async close() {},
  }),
});

const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "offline", id: "offline" },
  sessionManager: {
    getSessionId: () => "graph-table-opening-host-binding",
    getEntries: () => [],
  },
  hasUI: false,
};
const emit = async (type, event) => {
  for (const handler of handlers.get(type) ?? []) await handler(event, ctx);
};
const invoke = async (id, params) => JSON.parse((
  await tools.get("coc_invoke").execute(
    id,
    params,
    undefined,
    undefined,
    ctx,
  )
).content[0].text);

try {
  await emit("session_start", { type: "session_start" });
  const resumed = await invoke("resume-first", {
    operation: "session.resume",
    root,
    campaign,
    arguments: {},
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.data.current_turn.rows[0].data_ref, undefined);
  assert.equal(resumed.data.current_turn.rows[0].data_digest, undefined);
  assert.match(
    resumed.data.scene_context.route_index[0].route_id,
    /^route:/,
  );

  // A real player turn clears turn-scoped bindings. The exact investigator
  // identity belongs to the resumed session/scene and must remain host-bound.
  await emit("before_agent_start", {
    role: "user",
    content: "我向诺特点头，先问清楚这栋房子的情况。",
  });

  const reactionTool = tools.get("coc_npc_reaction");
  for (const hostField of ["root", "campaign", "investigator", "run_id"]) {
    assert.ok(!reactionTool.parameters.properties[hostField], hostField);
  }
  const reaction = JSON.parse((await reactionTool.execute(
    "first-reaction",
    {
      npc_id: "npc-steven-knott",
      npc_display_name: "史蒂文·诺特",
      decision_id: "opening-reaction-steven-knott-1",
      context: { semantic_reason: "first material meeting" },
    },
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(reaction.ok, true, JSON.stringify(reaction));
  assert.match(reaction.data.roll_id, /^roll:/);
  assert.equal(JSON.stringify(reaction).includes(canonicalRollId), false);
  assert.equal(reaction.data.first_impression_ref, undefined);

  const engagement = tools.get("coc_state_record_npc_engagement");
  for (const hostField of [
    "root", "campaign", "npc_id", "investigator",
    "first_impression_ref", "run_id", "decision_id",
  ]) {
    assert.ok(!engagement.parameters.properties[hostField], hostField);
  }
  const engagementResult = JSON.parse((await engagement.execute(
    "record-first-engagement",
    {
      interaction_kind: "dialogue",
      first_impression_realization: {
        observable_manner: "诺特务实地把钥匙推过桌面。",
        causal_explanation: "专业态度让他愿意直入正题。",
        boundary_preserved: "雇佣关系和截止压力不变。",
        opportunity_or_friction: "调查员可直接追问委托细节。",
      },
    },
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(engagementResult.ok, true, JSON.stringify(engagementResult));

  const opening = tools.get("coc_evidence_table_opening");
  assert.ok(opening, "play role must expose the typed table-opening operation");
  const properties = Object.keys(opening.parameters.properties ?? {}).sort();
  assert.deepEqual(properties, ["presented_roll_ids", "speaker", "text"]);
  assert.deepEqual(
    [...(opening.parameters.required ?? [])].sort(),
    ["presented_roll_ids", "text"],
  );
  const opened = JSON.parse((await opening.execute(
    "open-table",
    {
      text: "诺特把科比特宅邸的钥匙推过桌面。",
      presented_roll_ids: [reaction.data.roll_id],
    },
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(
    calls.filter((call) => call.operation === "evidence.table_opening").length,
    1,
  );

  // A later player turn clears the first-contact engagement binding. A
  // successful exact npc.query for that already-met pair must re-arm the
  // model-hidden campaign/NPC/investigator/run identity before another
  // material engagement can be recorded.
  await emit("before_agent_start", {
    role: "user",
    content: "我问诺特：马卡里奥一家到底出了什么事？",
  });
  const queried = JSON.parse((await tools.get("coc_npc_query").execute(
    "query-knott-later-turn",
    {
      campaign,
      investigator: "current-investigator",
      npc_id: "npc-steven-knott",
    },
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(queried.ok, true, JSON.stringify(queried));

  const laterEngagement = tools.get("coc_state_record_npc_engagement");
  for (const hostField of [
    "root", "campaign", "npc_id", "investigator", "identity_ref",
    "first_impression_ref", "run_id", "decision_id",
  ]) {
    assert.ok(!laterEngagement.parameters.properties[hostField], hostField);
  }
  const laterResult = JSON.parse((await laterEngagement.execute(
    "record-later-engagement",
    {
      interaction_kind: "dialogue",
      route_completion: {
        scene_id: "commission-briefing",
        route_id: "ask-macario-tragedy",
        semantic_reason: "诺特直接回答了马卡里奥一家的遭遇。",
      },
    },
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(laterResult.ok, true, JSON.stringify(laterResult));
  assert.equal(engagementCallCount, 2);
} finally {
  if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = previousRole;
  if (previousCampaign === undefined) delete process.env.PI_COC_CAMPAIGN_ID;
  else process.env.PI_COC_CAMPAIGN_ID = previousCampaign;
}
