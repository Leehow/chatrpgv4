import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const gateLib = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/mechanical-output-gate.ts",
));

// Exact p47 evidence sample (turn-p-cd2a716c79a1.json): zero tool calls, fake
// 【明骰】 blocks and a fabricated SAN transfer in raw KP prose.
const p47Sample = [
  "你道谢离开，回住处把门闩好。公开稿定稿誊清，压在箱底。午后到傍晚你歇着养神，",
  "清点口袋：烟、火柴、手电（若有）。天完全黑透后，你才出门，绕开大路，朝青土片",
  "方向摸去——停在能看见那片地、靴底却不踏垄的距离。",
  "",
  "【时间推进】1937-10-13 约 21:20 · 青土片外田埂",
  "",
  "风停了一阵。土里那股甜腥气比白天更清楚。",
  "",
  "【明骰】侦查｜掷骰：14；基础值：75；门槛：普通（≤75）；达到：极难成功（超出 2 级）；通过",
  "",
  "【明骰】理智｜掷骰：63；基础值：50；门槛：普通（≤50）；达到：失败；未通过 · 损失 1D6 → 4 点（SAN 50→46）",
  "",
  "你看见了。夜里青土片有贴地游走的光；你亲眼见过。",
].join("\n");

const pureProse = "雨水沿着窗玻璃缓缓滑落，风把灯焰压低了半寸。";

// --------------------------------------------------------------------------- #
// Detection surface
// --------------------------------------------------------------------------- #
const p47Markers = gateLib.detectMechanicalMarkers(p47Sample);
const p47Classes = { dice: 0, resource: 0 };
for (const marker of p47Markers) p47Classes[marker.class] += 1;
const proseMarkers = gateLib.detectMechanicalMarkers(pureProse);
const hpMarkers = gateLib.detectMechanicalMarkers(
  "规则生效：HP 9→6，你踉跄退了一步。",
);
const diceLineMarkers = gateLib.detectMechanicalMarkers(
  "掷骰：77，没有过。",
);
const lossMarkers = gateLib.detectMechanicalMarkers(
  "损失 3 点，血从袖口渗出来。",
);

// --------------------------------------------------------------------------- #
// Gate decisions (same-epoch receipt binding)
// --------------------------------------------------------------------------- #
const gate = new main.OpeningTerminalContinuationGate();
gate.markExternalUserInput(); // player turn epoch 1
const noReceiptDecision = gate.acceptVisibleAssistantFinal(p47Sample);
const noReceiptEnvelope = gate.takeMechanicalOutputGateEnvelope();

const diceOnlyGate = new main.OpeningTerminalContinuationGate();
diceOnlyGate.markExternalUserInput();
diceOnlyGate.observeCanonicalReceipt("rules.roll", {
  ok: true,
  data: { roll_id: "toolbox-cold-harvest-02-000017" },
});
const diceOnlyDecision = diceOnlyGate.acceptVisibleAssistantFinal(p47Sample);
const diceOnlyEnvelope = diceOnlyGate.takeMechanicalOutputGateEnvelope();

const boundGate = new main.OpeningTerminalContinuationGate();
boundGate.markExternalUserInput();
boundGate.observeCanonicalReceipt("rules.roll", {
  ok: true,
  data: { roll_id: "toolbox-cold-harvest-02-000017" },
});
boundGate.observeCanonicalReceipt("state.exceptional_effect", {
  ok: true,
  data: { effect_id: "exceptional-effect-v1:abc", decision_id: "ch02-t5-settle-v1" },
});
const boundDecision = boundGate.acceptVisibleAssistantFinal(p47Sample);
const boundEnvelope = boundGate.takeMechanicalOutputGateEnvelope();

const proseGate = new main.OpeningTerminalContinuationGate();
proseGate.markExternalUserInput();
const proseDecision = proseGate.acceptVisibleAssistantFinal(pureProse);

// Receipts are same-epoch bound: a new player turn must re-earn them.
const staleGate = new main.OpeningTerminalContinuationGate();
staleGate.markExternalUserInput(); // epoch 1
staleGate.observeCanonicalReceipt("rules.roll", {
  ok: true,
  data: { roll_id: "toolbox-cold-harvest-02-000017" },
});
staleGate.observeCanonicalReceipt("state.journal", {
  ok: true,
  data: { turn_id: "turn-v1-99b05e3dba7818356a7962032f88b6b1" },
});
staleGate.markExternalUserInput(); // epoch 2: previous receipts do not cover
const staleDecision = staleGate.acceptVisibleAssistantFinal(p47Sample);
const staleEnvelope = staleGate.takeMechanicalOutputGateEnvelope();
staleGate.observeCanonicalReceipt("rules.roll", {
  ok: true,
  data: { roll_id: "toolbox-cold-harvest-02-000018" },
});
staleGate.observeCanonicalReceipt("state.journal", {
  ok: true,
  data: { turn_id: "turn-v1-99b05e3dba7818356a7962032f88b6b2" },
});
const reboundDecision = staleGate.acceptVisibleAssistantFinal(p47Sample);

// Failed tools never bind.
const failedGate = new main.OpeningTerminalContinuationGate();
failedGate.markExternalUserInput();
failedGate.observeCanonicalReceipt("rules.roll", {
  ok: false,
  data: { roll_id: "toolbox-cold-harvest-02-000019" },
});
const failedDecision = failedGate.acceptVisibleAssistantFinal(p47Sample);

// A successful turn.finalize in the epoch already fails closed on unbound
// dice, so it covers both marker classes even when the host digest gate
// declines to arm the exact-replace.
const finalizeGate = new main.OpeningTerminalContinuationGate();
finalizeGate.markExternalUserInput();
finalizeGate.observeCanonicalReceipt("turn.finalize", {
  ok: true,
  data: { decision_id: "ch02-finalize-v1", rendered_text: "settled text" },
});
const finalizeBoundDecision = finalizeGate.acceptVisibleAssistantFinal(p47Sample);

// --------------------------------------------------------------------------- #
// Hidden instruction delivery envelope
// --------------------------------------------------------------------------- #
const appended = [];
const sent = [];
const delivered = main.deliverMechanicalOutputGateInstruction({
  appendEntry: (...args) => appended.push(args),
  sendMessage: (...args) => sent.push(args),
}, noReceiptEnvelope);
const sentMessage = sent[0]?.[0];
const sentOptions = sent[0]?.[1];
const deliveredEmpty = main.deliverMechanicalOutputGateInstruction({
  appendEntry: (...args) => appended.push(args),
  sendMessage: (...args) => sent.push(args),
}, null);

// --------------------------------------------------------------------------- #
// Transcript-gate interception surface
// --------------------------------------------------------------------------- #
const handlers = new Map();
const transcriptGate = new main.OpeningTerminalContinuationGate();
main.registerPlayerTranscriptGate({
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
}, (visibleText) => (
  transcriptGate.acceptVisibleAssistantFinal(visibleText)
), (message) => transcriptGate.observeMessageStart(message));

async function emit(type, message) {
  let result;
  for (const handler of handlers.get(type) || []) {
    result = await handler({ type, message }, {});
  }
  return result;
}

function textParts(message) {
  return (message?.content ?? [])
    .filter((part) => part.type === "text")
    .length;
}

await emit("message_start", {
  role: "user",
  content: [{ type: "text", text: "天黑后我去了青土片。" }],
});
const p47Intercepted = await emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: p47Sample }],
});
const p47InterceptedTextParts = textParts(p47Intercepted?.message);
const prosePassed = await emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: pureProse }],
});

process.stdout.write(JSON.stringify({
  detection: {
    p47Total: p47Markers.length,
    p47Classes,
    p47HasFormalDiceBlock: p47Markers.some((m) => (
      m.class === "dice" && m.pattern === "formal_dice_block"
    )),
    p47HasSanTransfer: p47Markers.some((m) => (
      m.class === "resource" && m.pattern === "san_transfer"
    )),
    p47HasLossPoints: p47Markers.some((m) => (
      m.class === "resource" && m.pattern === "loss_points"
    )),
    prose: proseMarkers.length,
    hpTransfer: hpMarkers.length,
    hpTransferClass: hpMarkers[0]?.class,
    diceLineOnly: diceLineMarkers.length,
    diceLineOnlyClass: diceLineMarkers[0]?.class,
    lossPoints: lossMarkers.length,
  },
  gate: {
    noReceiptIntercepted: noReceiptDecision === false,
    noReceiptEnvelope: {
      kind: noReceiptEnvelope?.kind,
      status: noReceiptEnvelope?.status,
      action: noReceiptEnvelope?.action,
      playerTurnEpoch: noReceiptEnvelope?.player_turn_epoch,
      schemaVersion: noReceiptEnvelope?.schema_version,
      uncoveredClasses: (noReceiptEnvelope?.uncovered_markers ?? [])
        .map((m) => m.class),
      hasInstruction: typeof noReceiptEnvelope?.instruction === "string"
        && noReceiptEnvelope.instruction.length > 20,
    },
    diceOnlyStillIntercepted: diceOnlyDecision === false,
    diceOnlyUncoveredClasses: (diceOnlyEnvelope?.uncovered_markers ?? [])
      .map((m) => m.class),
    boundReleased: boundDecision === true,
    boundEnvelopeEmpty: boundEnvelope === null,
    proseReleased: proseDecision === true,
    staleEpochIntercepted: staleDecision === false,
    staleEpochUncoveredClasses: (staleEnvelope?.uncovered_markers ?? [])
      .map((m) => m.class),
    reboundReleased: reboundDecision === true,
    failedToolsNeverBind: failedDecision === false,
    finalizeBoundReleased: finalizeBoundDecision === true,
  },
  delivery: {
    delivered,
    deliveredEmpty,
    appended: appended.length,
    sent: sent.length,
    customType: sentMessage?.customType,
    display: sentMessage?.display,
    options: sentOptions,
    contentParsed: JSON.parse(sentMessage?.content ?? "null"),
  },
  transcriptGate: {
    p47InterceptedTextParts,
    prosePassed: prosePassed === undefined,
  },
}));
