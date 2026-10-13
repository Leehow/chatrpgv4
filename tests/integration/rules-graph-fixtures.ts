/** Closed specification constants copied from test_rule_graph_data.py. */
export const paths=[
  "campaign.ruleset_id",
  "campaign.ruleset_version",
  "actor.id",
  "actor.resources.hp",
  "actor.resources.hp_max",
  "actor.resources.san",
  "actor.resources.mp",
  "actor.resources.luck",
  "actor.sheet.con",
  "actor.conditions",
  "actor.conditions.dying",
  "actor.conditions.unconscious",
  "actor.conditions.major_wound",
  "actor.conditions.dead",
  "actor.recovery.major_wound_week_due",
  "development.settlement.pending",
  "subsystem.kind",
  "subsystem.snapshot.active",
  "scene.id",
  "intent.method",
  "intent.action_kind",
  "intent.pushed",
  "intent.complete_rest",
  "intent.poor_environment",
  "intent.rescuer_count",
  "receipt.last_outcome",
  "receipt.push_eligible",
  "time.day",
  "time.minutes_since_injury",
  "clock.dying",
  "chase.session.active",
  "chase.session.inactive",
  "chase.start.ready",
  "chase.pending.kind",
  "chase.conflict.receipt-ready",
  "magic.spell.known",
  "magic.learn.source-available",
  "sanity.bout.pending",
  "sanity.delusion.active",
  "sanity.treatment.due",
  "sanity.recovery.due",
  "sanity.insane",
  "sanity.gain.pending"
];
export const intents={
  "decision:coc7:combat:attack": [
    "combat"
  ],
  "decision:coc7:combat:aim": [
    "combat"
  ],
  "decision:coc7:combat:maneuver": [
    "combat"
  ],
  "decision:coc7:combat:reload": [
    "combat"
  ],
  "decision:coc7:combat:defend": [
    "combat"
  ],
  "decision:coc7:combat:context": [
    "combat"
  ],
  "decision:coc7:combat:flee": [
    "flee"
  ],
  "decision:coc7:combat:end": [
    "combat",
    "flee"
  ],
  "decision:coc7:chase:start": [
    "flee"
  ],
  "decision:coc7:chase:move": [
    "flee",
    "move",
    "combat"
  ],
  "decision:coc7:chase:barrier": [
    "flee",
    "move",
    "combat"
  ],
  "decision:coc7:chase:hazard": [
    "flee",
    "move",
    "combat"
  ],
  "decision:coc7:chase:conflict": [
    "flee",
    "move",
    "combat"
  ],
  "decision:coc7:chase:end": [
    "flee",
    "move",
    "combat"
  ],
  "decision:coc7:core-check:ordinary-check": [
    "investigate",
    "move",
    "social"
  ],
  "decision:coc7:core-check:combined-check": [
    "investigate",
    "move"
  ],
  "decision:coc7:core-check:opposed-check": [
    "investigate",
    "social",
    "move"
  ],
  "decision:coc7:social:adjudicate-difficulty": [
    "social"
  ],
  "decision:coc7:psychology:observe-concealed": [
    "social",
    "investigate"
  ],
  "decision:coc7:psychology:realize-player-safe": [
    "social",
    "investigate"
  ],
  "decision:coc7:magic:cast-spell": [
    "cast"
  ],
  "decision:coc7:magic:learn-spell": [
    "investigate",
    "cast"
  ],
  "decision:coc7:healing:first-aid-ordinary": [
    "investigate"
  ],
  "decision:coc7:healing:first-aid-stabilization": [
    "investigate"
  ],
  "decision:coc7:healing:medicine-ordinary": [
    "investigate"
  ],
  "decision:coc7:healing:medicine-stabilization": [
    "investigate"
  ],
  "decision:coc7:sanity:check": [
    "investigate",
    "combat",
    "flee",
    "move",
    "social"
  ]
};
export const absent=[
  "decision:coc7:healing:dying-hour-clock",
  "decision:coc7:healing:dying-round-clock",
  "decision:coc7:healing:weekly-major-wound-recovery",
  "decision:coc7:sanity:bout-tick",
  "decision:coc7:sanity:bout-end",
  "decision:coc7:sanity:reality-check",
  "decision:coc7:sanity:recover-temporary",
  "decision:coc7:sanity:apply-treatment",
  "decision:coc7:sanity:gain-current-san",
  "decision:coc7:sanity:insane-insight",
  "decision:coc7:sanity:context",
  "decision:coc7:push-luck:pushed-roll",
  "decision:coc7:push-luck:luck-spend",
  "decision:coc7:push-luck:luck-roll",
  "decision:coc7:core-check:idea-roll",
  "decision:coc7:development:end-session",
  "decision:coc7:development:settle-ending"
];
export const directors={
  "ref:director:investigate-intent": [
    "investigate"
  ],
  "ref:director:social-intent": [
    "social"
  ],
  "ref:director:explicit-move-intent": [
    "move"
  ],
  "ref:director:combat-flee-cast-intent": [
    "combat",
    "flee",
    "cast"
  ]
};
