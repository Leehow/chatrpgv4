/** Generated-from-toolbox policy facts for Pi domain tools + execute ACL. */
export const AUDIENCES = ["keeper","setup","host","source_worker","audit"] as const;
export const PLAY_PHASES = ["cold_start","opening","live_turn","pending_finalization","recovery","ending"] as const;
export type PlayPhase = typeof PLAY_PHASES[number];
export const KP_SURFACES = ["context","rules","state","npc","turn","setup","advice","subsystem","none"] as const;
export type KpSurface = typeof KP_SURFACES[number];
export type OperationPolicy = { audience: string; phases: readonly string[]; contract: string; advisory: boolean; kp_surface: KpSurface };
/** Pi dual-session role. Canonical caller: domain-tools sessionRoleFromEnv / evaluateExecuteAcl. Consumer: execute-time ACL + tool visibility. */
export const SESSION_ROLES = ["setup", "play"] as const;
export type SessionRole = typeof SESSION_ROLES[number];
/** Shared across setup|play. Audience alone cannot mark these: setup.inspect is audience=setup, session.resume is audience=host. Consumer: sessionRolesForPolicy. */
export const SESSION_ROLE_SHARED_OPERATIONS = new Set<string>([
  "setup.inspect",
  "session.resume",
]);
export const OPERATION_POLICY: Record<string, OperationPolicy> = {
  "actions.advise": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "advisory",
    "advisory": true,
    "kp_surface": "advice"
  },
  "actions.list": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "chase.context": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "chase.execute": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "clues.query": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "combat.context": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "combat.end": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "combat.resolve": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "development.settle": {
    "audience": "audit",
    "phases": [
      "ending"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "director.advise": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "advisory",
    "advisory": true,
    "kp_surface": "advice"
  },
  "epistemic.query": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "evidence.record_adoption": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "evidence.table_opening": {
    "audience": "keeper",
    "phases": [
      "opening"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "mechanics.ensure": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "narration.brief": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "advisory",
    "advisory": true,
    "kp_surface": "advice"
  },
  "narration.review": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "advisory",
    "advisory": true,
    "kp_surface": "advice"
  },
  "npc.advise": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "advisory",
    "advisory": true,
    "kp_surface": "advice"
  },
  "npc.query": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "npc"
  },
  "npc.reaction": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "npc"
  },
  "personal_horror.query": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "progressive.claim_host_work": {
    "audience": "source_worker",
    "phases": [
      "opening",
      "live_turn"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.follow_mentions": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "progressive.fulfill_host_work": {
    "audience": "source_worker",
    "phases": [
      "opening",
      "live_turn"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.on_enter_scene": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "progressive.opening_bootstrap": {
    "audience": "keeper",
    "phases": [
      "opening"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "progressive.prepare_opening": {
    "audience": "keeper",
    "phases": [
      "opening"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "progressive.project_opening": {
    "audience": "host",
    "phases": [
      "opening"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.publish_skeleton": {
    "audience": "source_worker",
    "phases": [
      "opening",
      "live_turn"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.register_source_bundle": {
    "audience": "host",
    "phases": [
      "cold_start",
      "opening"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.release_host_work_leases": {
    "audience": "source_worker",
    "phases": [
      "opening",
      "live_turn"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.renew_host_work_leases": {
    "audience": "source_worker",
    "phases": [
      "opening",
      "live_turn"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.request_locator_pass": {
    "audience": "host",
    "phases": [
      "opening",
      "live_turn"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.request_mechanics": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "progressive.request_opening_pack": {
    "audience": "host",
    "phases": [
      "opening"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.retry_full_parse": {
    "audience": "host",
    "phases": [
      "opening",
      "recovery"
    ],
    "contract": "source_lifecycle",
    "advisory": false,
    "kp_surface": "none"
  },
  "progressive.status": {
    "audience": "host",
    "phases": [
      "opening",
      "live_turn",
      "recovery"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "rules.build_scale": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.cash_assets": {
    "audience": "keeper",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.check": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.damage": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.dying_check": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.first_aid": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.luck_spend": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.medicine": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.opposed": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.psychology_observe": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.push": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.resource_delta": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.roll": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.roll_dice": {
    "audience": "keeper",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.sanity_check": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.skill_describe": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.social_adjudicate": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "rules.weekly_recovery": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "rules"
  },
  "sanity.context": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "sanity.execute": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "rules",
    "advisory": false,
    "kp_surface": "subsystem"
  },
  "scene.context": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "scene.map": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "secrets.briefing": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "module_secret",
    "advisory": false,
    "kp_surface": "context"
  },
  "session.begin": {
    "audience": "host",
    "phases": [
      "cold_start",
      "recovery",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "session.continuation_detail": {
    "audience": "host",
    "phases": [
      "cold_start",
      "recovery",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "session.delivery_ack": {
    "audience": "host",
    "phases": [
      "cold_start",
      "recovery",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "session.delivery_text": {
    "audience": "host",
    "phases": [
      "cold_start",
      "recovery",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "session.resume": {
    "audience": "keeper",
    "phases": [
      "cold_start",
      "opening",
      "recovery",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "setup.complete": {
    "audience": "setup",
    "phases": [
      "cold_start",
      "opening"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "setup"
  },
  "setup.adopt_source_facts": {
    "audience": "setup",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "setup.inspect": {
    "audience": "setup",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "setup.investigator_contract": {
    "audience": "setup",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "setup.invoke": {
    "audience": "setup",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "setup.quick_start": {
    "audience": "setup",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "setup"
  },
  "state.advance_time": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.backstory_corruption_add": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.belief_apply": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.cash_semantic": {
    "audience": "keeper",
    "phases": [
      "cold_start",
      "opening",
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.clear_transient_condition": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.clock_discontinuity": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.end_session": {
    "audience": "keeper",
    "phases": [
      "ending"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.exceptional_effect": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.inventory_list": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization",
      "opening"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.item_grant": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.item_remove": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.item_use": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.journal": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "turn"
  },
  "state.mark_safe_rest": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.move_scene": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.npc_presence": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.npc_update": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.personal_horror_add": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.personal_horror_mark_woven": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.promote_scene": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.record_clue": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.record_npc_engagement": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.record_route_completion": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.set_flag": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.supersede_settlement": {
    "audience": "keeper",
    "phases": [
      "recovery",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.threat_tick": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.time_appearance": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "state.time_marker": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "state",
    "advisory": false,
    "kp_surface": "state"
  },
  "steward.deliver": {
    "audience": "host",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "steward.deliveries": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "steward.domain_put": {
    "audience": "host",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "steward.mark_consumed": {
    "audience": "host",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "steward.notebook": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "steward.notebook_pay": {
    "audience": "host",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "steward.notebook_put": {
    "audience": "host",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "steward.scene_bundle_put": {
    "audience": "host",
    "phases": [
      "live_turn"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "none"
  },
  "steward.scene_supply": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "storylets.suggest": {
    "audience": "keeper",
    "phases": [
      "live_turn"
    ],
    "contract": "advisory",
    "advisory": true,
    "kp_surface": "advice"
  },
  "threat.query": {
    "audience": "keeper",
    "phases": [
      "opening",
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "context"
  },
  "turn.finalize": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "finalize",
    "advisory": false,
    "kp_surface": "turn"
  },
  "turn.output_context": {
    "audience": "keeper",
    "phases": [
      "live_turn",
      "pending_finalization"
    ],
    "contract": "none",
    "advisory": false,
    "kp_surface": "turn"
  }
};
export const SOURCE_WORKER_LIFECYCLE_OPERATIONS = new Set([
  "progressive.claim_host_work",
  "progressive.fulfill_host_work",
  "progressive.publish_skeleton",
  "progressive.release_host_work_leases",
  "progressive.renew_host_work_leases",
]);
export const HOST_INVOKE_COMPAT_OPERATIONS = new Set([
  "progressive.project_opening",
  "progressive.register_source_bundle",
  "progressive.request_locator_pass",
  "progressive.request_opening_pack",
  "progressive.retry_full_parse",
  "progressive.status",
  "session.begin",
  "session.continuation_detail",
  "session.delivery_ack",
  "session.delivery_text",
]);
export const OPERATIONS_BY_SURFACE: Record<Exclude<KpSurface, "none">, readonly string[]> = {
  context: ["actions.list", "clues.query", "epistemic.query", "evidence.record_adoption", "evidence.table_opening", "personal_horror.query", "scene.context", "scene.map", "secrets.briefing", "steward.deliveries", "steward.notebook", "steward.scene_supply", "threat.query"],
  rules: ["rules.build_scale", "rules.cash_assets", "rules.check", "rules.damage", "rules.dying_check", "rules.first_aid", "rules.luck_spend", "rules.medicine", "rules.opposed", "rules.psychology_observe", "rules.push", "rules.resource_delta", "rules.roll", "rules.roll_dice", "rules.sanity_check", "rules.skill_describe", "rules.social_adjudicate", "rules.weekly_recovery"],
  state: ["state.advance_time", "state.backstory_corruption_add", "state.belief_apply", "state.cash_semantic", "state.clear_transient_condition", "state.clock_discontinuity", "state.end_session", "state.exceptional_effect", "state.inventory_list", "state.item_grant", "state.item_remove", "state.item_use", "state.mark_safe_rest", "state.move_scene", "state.npc_presence", "state.npc_update", "state.personal_horror_add", "state.personal_horror_mark_woven", "state.promote_scene", "state.record_clue", "state.record_npc_engagement", "state.record_route_completion", "state.set_flag", "state.supersede_settlement", "state.threat_tick", "state.time_appearance", "state.time_marker"],
  npc: ["npc.query", "npc.reaction"],
  turn: ["state.journal", "turn.finalize", "turn.output_context"],
  setup: ["progressive.follow_mentions", "progressive.on_enter_scene", "progressive.opening_bootstrap", "progressive.prepare_opening", "progressive.request_mechanics", "session.resume", "setup.adopt_source_facts", "setup.complete", "setup.inspect", "setup.investigator_contract", "setup.invoke", "setup.quick_start"],
  advice: ["actions.advise", "director.advise", "narration.brief", "narration.review", "npc.advise", "storylets.suggest"],
  subsystem: ["chase.context", "chase.execute", "combat.context", "combat.end", "combat.resolve", "mechanics.ensure", "sanity.context", "sanity.execute"],
};
export const DOMAIN_TOOL_NAMES = [
  "coc_context",
  "coc_rules",
  "coc_state",
  "coc_npc",
  "coc_turn",
  "coc_setup",
  "coc_advice",
  "coc_subsystem",
] as const;
export type DomainToolName = typeof DOMAIN_TOOL_NAMES[number];

/** Session-role projection of audience (+ shared set). Caller: evaluateExecuteAcl / activeToolsForPhase. */
export function sessionRolesForPolicy(
  operation: string,
  policy: OperationPolicy,
): readonly SessionRole[] {
  if (SESSION_ROLE_SHARED_OPERATIONS.has(operation)) {
    return SESSION_ROLES;
  }
  if (policy.audience === "setup") return ["setup"];
  if (policy.audience === "keeper") return ["play"];
  return [];
}
