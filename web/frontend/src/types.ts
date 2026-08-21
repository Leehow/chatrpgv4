export interface ModelInfo {
  id: string;
  label: string;
  /** Levels the model actually supports (pi rule); absent → unknown, menu
   *  falls back to the generic list. */
  thinkingLevels?: string[];
  /** True when catalog/models.json `input` includes image. */
  image?: boolean;
}

export interface ProviderInfo {
  label: string;
  hasAuth: boolean;
  models: ModelInfo[];
}

export interface ModelsResponse {
  providers: Record<string, ProviderInfo>;
  default: { provider: string; model: string };
}

export interface CampaignSummary {
  campaign_id: string;
  title?: string | null;
  status?: string | null;
  era?: string | null;
  active_scenario_id?: string | null;
  compatible?: boolean;
  schema_version?: number;
  investigator_name?: string | null;
  last_active_at?: string | null;
}

export interface Pregen {
  pregen_id: string;
  name?: string;
  occupation?: string;
  era?: string;
}

export interface Starter {
  scenario_id: string;
  title: string;
  one_liner?: string;
  era?: string;
  pregens: Pregen[];
}

export interface SourceBundle {
  bundle_id: string;
  path: string;
  title?: string;
  source_pdf?: string | null;
  page_count?: number | null;
  file_sha256?: string | null;
  location_hint?: string;
}

export interface PdfUploadResult {
  filename: string;
  file_sha256: string;
  stored_path: string;
  size_bytes: number;
  location_hint?: string;
  status: "matched_bundle" | "stored_pending_ingest" | string;
  matched_bundle?: SourceBundle | null;
  message?: string;
  source_bundles_dir?: string;
}

export interface InvestigatorSummary {
  investigator_id: string;
  name?: string;
  occupation?: string;
  era?: string;
  path?: string;
}

export interface LibraryModule {
  canonical_module_id: string;
  title?: string;
  chapter?: string | null;
  era?: string | null;
  rules_edition?: string | null;
  parent_module_id?: string | null;
  location_hint?: string;
}

export interface BootstrapResult {
  campaigns: CampaignSummary[];
  starters: Starter[];
  investigators: InvestigatorSummary[];
  source_bundles?: SourceBundle[];
  library_modules?: LibraryModule[];
}

/** One recoverable campaign in the workspace trash (24h retention). */
export interface TrashEntry {
  trash_key: string;
  campaign_id: string;
  title?: string | null;
  deleted_at?: string | null;
  purge_at?: string | null;
}

export interface BootstrapResponse {
  result: BootstrapResult;
}

export interface DisplayValue {
  key: string;
  label: string;
  value: number | string;
}

export interface Weapon {
  label?: string;
  skill_label?: string;
  damage?: string;
  range?: string;
  ammo?: number | string;
}

/** One live inventory entry merged from the character sheet plus the
 *  campaign-local runtime inventory (grants/losses/uses during play). */
export interface InventoryItem {
  item_id: string;
  label: string;
  kind: "gear" | "weapon";
  /** Charges left; only meaningful for consumables. */
  quantity?: number;
  /** True when using the item spends charges (state.item_use). */
  consumable?: boolean;
  note?: string;
  source?: "sheet" | "campaign";
}

/** One row from the campaign-local cash ledger (state.cash_query). */
/** Player-safe campaign clock fragment on a cash row. */
export interface CashPlayerTime {
  phase?: string;
  appearance_mode?: string;
  display_label?: string | null;
  display?: string;
}

export interface CashGameTime {
  elapsed_minutes?: number;
  display?: string;
  day_phase?: string;
  player_time?: CashPlayerTime;
}

export interface CashLedgerEntry {
  op: "grant" | "spend";
  amount: string;
  currency?: string;
  unit?: string;
  localized_reason?: string;
  decision_id?: string;
  balance_before?: string;
  balance_after?: string;
  game_time?: CashGameTime;
  player_time?: CashPlayerTime | string;
}

export interface CashBalance {
  amount: string;
  unit?: string;
}

/** Live cash purses + recent ledger; absent/null outside a campaign. */
export interface CashView {
  schema_version?: number;
  balances: Record<string, CashBalance>;
  ledger: CashLedgerEntry[];
  labels?: {
    current_cash?: string;
    cash?: string;
    empty_ledger?: string;
    no_record?: string;
    no_reason?: string;
  };
}

export interface CharacterSheet {
  name?: string;
  occupation?: string;
  era?: string;
  age?: number;
  sex?: string;
  residence?: string;
  birthplace?: string;
  characteristics?: DisplayValue[];
  derived?: Record<string, number | string>;
  /** Canonical derived Luck; also present as derived.Luck. */
  luck?: number | null;
  backstory?: {
    field?: string;
    label: string;
    items: string[];
    starred?: boolean;
  }[];
  skills?: DisplayValue[];
  weapons?: Weapon[];
  equipment?: string[];
  /** Live campaign-merged inventory; absent/null outside a campaign context
   *  (then `equipment` is the sheet-only fallback). */
  inventory_items?: InventoryItem[] | null;
  /** Live campaign cash ledger; absent/null outside a campaign context. */
  cash?: CashView | null;
  /** Live campaign finance when present; otherwise a labeled chargen snapshot. */
  assets?: {
    amount?: number | string | null;
    currency?: string;
    display?: string;
    source?: string;
    living_standard?: string;
    spending_level?: string;
    current?: boolean;
    baseline?: boolean;
    labels?: {
      assets?: string;
      cash?: string;
      living_standard?: string;
      spending_level?: string;
      empty_ledger?: string;
      no_record?: string;
      no_reason?: string;
      pair_sep?: string;
    };
  } | null;
  localized?: boolean;
}

export interface TimeInfo {
  display?: string;
  /** Secondary calm line, e.g. "上午 · 十时整". */
  display_sub?: string | null;
  local_datetime?: string;
  location_id?: string;
  elapsed_minutes?: number;
  scale?: string;
  safe_place?: boolean;
  phase?: string | null;
  phase_label?: string | null;
}

export interface Actor {
  id: string;
  resources: Record<string, number | null>;
  conditions: string[];
  [key: string]: unknown;
}

export interface ChoiceOption {
  action: string;
  label?: string;
}

export interface CombatChoiceContext {
  attack_kind: "melee" | "firearm";
  dodge_skill: number;
  fighting_skill: number;
  counter_damage: string;
  already_defended_this_round: boolean;
  incoming_bonus_dice: number;
  incoming_penalty_dice: number;
}

export interface PendingChoice {
  choice_id?: string;
  kind?: string;
  command_id?: string;
  responder?: string;
  revision?: number;
  prompt?: string;
  options?: ChoiceOption[];
  attack_id?: string;
  audience?: string;
  combat_context?: CombatChoiceContext;
}

/** Host-confirmed semantic evidence accepted by the Pi-Coc runtime. */
export interface PlayerIntent {
  primary_intent: string;
  secondary_intents: string[];
  target_entities: string[];
  risk_posture: "cautious" | "neutral" | "reckless";
  explicit_roll_request: boolean;
  player_hypothesis: string | null;
  action_atoms: Record<string, unknown>[];
  npc_interactions: Record<string, unknown>[];
}

export interface DiscoveredClue {
  clue_id: string;
  /** Player-safe summary in play_language when available. */
  summary: string;
}

export interface CombatInitiativeRow {
  actor_id: string;
  display_name: string;
  side: "investigator" | "opponent";
  dex: number | null;
  initiative_value: number | null;
  ready_firearm: boolean;
  status: string;
  current: boolean;
}

export interface CombatInitiative {
  /** Session id from save/combat.json; a fresh encounter restarts with a new
   *  id, so the UI keys "战斗结束" dismissal on it. */
  combat_id?: string | null;
  /** Engine-owned session state: combat.json persists after conclusion. */
  status?: "active" | "concluded";
  /** Engine-owned outcome when concluded (investigators_win | monsters_win |
   *  fled | stalemate). */
  outcome?: string | null;
  round: number;
  rule: "dex_order";
  rows: CombatInitiativeRow[];
}

/** Player-safe opening lifecycle projection (single phase authority: the
 *  plugin's derive_opening_phase; the UI reads it and never re-derives). */
export interface OpeningPhaseInfo {
  schema_version: number;
  phase: "module_preparation" | "character_creation" | "ready_for_table" | "active";
  campaign_status: string | null;
  session_role: "setup" | "play";
  module_preparation_satisfied: boolean;
  module_preparation_sub_phase: string | null;
  source_gated: boolean;
  character_setup_confirmed: boolean;
  character_setup_policy: string | null;
  next_operation: string | null;
  blocking_reason_code: string | null;
}

export interface GameState {
  campaign_id: string;
  /** Module-stage/location-protagonist title from player-safe projections. */
  display_title?: string | null;
  play_language?: string | null;
  active_scene_id?: string | null;
  /** Player-facing scene label from story-graph (display_name / localized). */
  active_scene_label?: string | null;
  tension_level?: string | null;
  /** Player-facing tension label (e.g. 平缓). */
  tension_label?: string | null;
  turn_number?: number;
  discovered_clue_ids?: string[];
  /** Resolved player-facing discovered clues (order matches ids). */
  discovered_clues?: DiscoveredClue[];
  actors: Actor[];
  pending_choice?: PendingChoice | null;
  character?: CharacterSheet | null;
  /** Authoritative opening lifecycle phase (server-side projection). */
  opening_phase?: OpeningPhaseInfo | null;
  /** True until the opening phase reports a confirmed investigator (derived
   *  server-side from opening_phase; placeholder sheets stay pending). */
  character_setup_pending?: boolean;
  /** Host session role for this campaign (setup table vs play table). */
  session_role?: "setup" | "play" | null;
  /** True while setup→play attach is in flight. */
  transitioning?: boolean;
  time?: TimeInfo | null;
  /** Canonical CoC DEX order for the active combat round. */
  combat?: CombatInitiative | null;
  error?: string;
}

export interface RuntimeEvent {
  type: string;
  id: string;
  ts: string;
  visibility: string;
  payload: Record<string, unknown>;
}

export interface SessionInfo {
  session_id: string;
  campaign_id: string;
  investigator_id: string;
  /** Investigator-less table: attach the host's coc-character opening. */
  character_setup?: boolean;
  /** Product turn channel is the pi-coc RPC host. */
  host?: "pi-coc";
  /** Fresh host, or investigator-less setup: frontend should attach. */
  host_opening?: boolean;
  state: GameState;
}

export interface TranscriptMessage {
  role: string;
  text: string;
  /** Ordered, hash-verified player output projected from turn finalization. */
  content_blocks?: KeeperContentBlock[];
  /** Canonical turn-finalization id when the row is hash-bound. */
  finalization_id?: string;
  /** Stable table-transcript row id when present. */
  entry_id?: string;
  /** Campaign turn index from table-transcript, when present. */
  turn?: number | string;
  /** Client-issued live turn token echoed by the web settle payload. */
  live_id?: string;
  /** Epoch ms (local projection of log wall-clock). */
  at?: number;
  /** ISO timestamp from campaign logs when available. */
  ts?: string;
  /** Keeper turn start epoch ms. */
  started_at?: number;
  /** Keeper reply total duration in ms (player send → finalize). */
  duration_ms?: number;
}

export interface RollDisplay {
  roll_id: string;
  roll: number;
  display_skill?: string;
  skill?: string;
  characteristic?: string;
  npc_display_name?: string;
  kind?: string;
  difficulty?: string;
  required_level?: string;
  achieved_level?: string;
  outcome?: string;
  die?: string;
  expression?: string;
  die_expression?: string;
  governing_attribute?: string;
  reason?: string;
  target?: number;
  base_target?: number;
  effective_target?: number;
  required_target?: number;
  app?: number;
  credit_rating?: number;
  governing_value?: number;
  source?: string;
  final_total?: number;
  total?: number;
  bonus?: number;
  penalty?: number;
  bonus_penalty_dice?: number;
  passed?: boolean;
  success?: boolean;
  pushed?: boolean;
  die_rolls?: number[];
  /** Canonical CoC percentile dice: every tens die plus the shared units die. */
  tens_values?: number[];
  units?: number;
  /** The first tens die before applying a bonus or penalty die. */
  unmodified_roll?: number;
  /** Optional flat compat fields (legacy receipts / Chat layout). */
  san_before?: number;
  san_after?: number;
  san_delta?: number;
  san_loss?: number;
  san_loss_expression?: string;
  san_loss_resolution?: string;
  combat_role?: "attack" | "defense" | "attack_reroll" | "damage";
  action?: string | null;
  defense_kind?: string | null;
  opposed_outcome?: string | null;
  combat_outcome?: string | null;
  damage_source?: "fight_back";
  attack_modifiers?: Record<string, boolean | number>;
  damage_expression?: string;
  raw_damage?: number;
  armor_absorbed?: number;
  hp_before?: number;
  hp_delta?: number;
  hp_after?: number;
  armor_before?: number;
  armor_after?: number;
}

export type RollGroupLayout = "check" | "sanity" | "opposed" | "combat" | "damage";

export interface SanityPayload {
  check_roll_id: string;
  loss_roll_id?: string;
  check: RollDisplay;
  loss?: RollDisplay | null;
  san_before?: number;
  san_after?: number;
  san_delta?: number;
  san_loss?: number;
  san_loss_expression?: string;
  san_loss_resolution?: string;
  source?: string;
}

export interface OpposedPayload {
  left: RollDisplay;
  right: RollDisplay;
  winner?: string | null;
  decision_id?: string;
}

export interface DamagePayload {
  damage_roll_id: string;
  roll: RollDisplay;
  source?: "fight_back" | string | null;
  damage_expression?: string;
  raw_damage?: number;
  armor_absorbed?: number;
  hp_before?: number;
  hp_delta?: number;
  hp_after?: number;
  armor_before?: number;
  armor_after?: number;
}

export interface CombatShotPayload {
  shot?: number;
  attack_roll_id: string;
  damage_roll_id?: string;
  outcome?: string | null;
  attack?: RollDisplay | null;
  damage?: DamagePayload | null;
}

export interface CombatVolleyPayload {
  volley?: number;
  attack_roll_id: string;
  damage_roll_ids: string[];
  outcome?: string | null;
  hits?: number;
  attack?: RollDisplay | null;
  damages?: DamagePayload[];
}

export interface CombatPayload {
  turn_id?: string | null;
  action?: string | null;
  defense_kind?: string | null;
  opposed_outcome?: string | null;
  combat_outcome?: string | null;
  attack_modifiers?: Record<string, boolean | number>;
  attack_roll_id?: string | null;
  defense_roll_id?: string | null;
  attack?: RollDisplay | null;
  defense?: RollDisplay | null;
  attack_reroll?: RollDisplay | null;
  damage?: DamagePayload | null;
  fight_back_damage?: DamagePayload | null;
  shots?: CombatShotPayload[];
  volleys?: CombatVolleyPayload[];
}

/** Structured cash settlement from turn.finalize asset/state delta (never prose). */
export interface CashChangeDisplay {
  effect_id: string;
  source_decision_id?: string;
  amount: string;
  currency: string;
  direction: "gain" | "spend";
  after?: string;
  localized_reason?: string;
  game_time?: CashGameTime;
  player_time?: CashPlayerTime | string;
}

export interface ItemChangeDisplay {
  effect_id: string;
  source_decision_id?: string;
  item_id: string;
  label: string;
  action: string;
  quantity?: string | number;
  delta?: string | number;
  before?: number;
  after?: string | number;
  remaining?: number;
  present_before?: boolean;
  present_after?: boolean;
  localized_reason?: string;
  game_time?: CashGameTime;
  weapon?: {
    weapon_id?: string;
    damage?: string;
    skill?: string;
    range?: string | number;
    ammo?: string | number;
    label?: string;
  };
}

export interface MechanicEffect {
  category: "state_delta" | "exceptional_effect";
  effect_id?: string;
  event_id?: string;
  effect_kind?: string;
  resource?: string;
  before?: number;
  after?: number;
  delta?: number;
  direction?: string;
  player_visible_impact?: string;
  condition?: string;
  action?: string;
  source_roll_id?: string;
}

export type KeeperContentBlock =
  | { type: "prose"; text: string }
  | { type: "roll"; text: string; source_ids: string[]; roll?: RollDisplay | null }
  | {
      type: "roll_group";
      text: string;
      source_ids: string[];
      rolls: RollDisplay[];
      layout?: RollGroupLayout;
      sanity?: SanityPayload;
      opposed?: OpposedPayload;
      combat?: CombatPayload;
      damage?: DamagePayload;
      effects?: MechanicEffect[];
    }
  | { type: "cash"; text: string; source_ids: string[]; changes: CashChangeDisplay[] }
  | {
      type: "asset_changes";
      source_ids: string[];
      cash_changes: CashChangeDisplay[];
      item_changes: ItemChangeDisplay[];
      count: number;
    };

/** Wall-clock metadata attached by the web client (not campaign canon). */
export type MessageTiming = {
  /** Epoch ms when this message was posted / finalized (local system clock). */
  at?: number;
  /** Epoch ms when the keeper turn started (keeper messages only). */
  startedAt?: number;
  /** Total turn duration in ms once the keeper reply finishes. */
  durationMs?: number;
};

export type ChatMessage =
  | ({ kind: "player"; text: string; turn?: number | string; entryId?: string } & MessageTiming)
  | ({
      kind: "keeper";
      text: string;
      /** Text streamed before tool calls in the same turn: workflow chatter
       *  ("resuming the campaign…"), kept out of the reply body and rendered
       *  as a collapsed dim prelude. */
      interimText?: string;
      streaming?: boolean;
      usage?: TokenUsage;
      contentBlocks?: KeeperContentBlock[];
      finalizationId?: string;
      entryId?: string;
      turn?: number | string;
      liveId?: string;
    } & MessageTiming)
  | ({ kind: "note"; text: string; tone?: "error" | "info" } & MessageTiming);

/** Keeper worker token usage for one settled turn (from runtime telemetry). */
export interface TokenUsage {
  input?: number;
  output?: number;
}

/** One keeper tool step in the live turn feed. */
export interface ToolStep {
  id: number;
  label: string;
  startedAt: number;
  endedAt?: number;
}
