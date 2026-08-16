export interface ModelInfo {
  id: string;
  label: string;
  /** Levels the model actually supports (pi rule); absent → unknown, menu
   *  falls back to the generic list. */
  thinkingLevels?: string[];
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
  skills?: DisplayValue[];
  weapons?: Weapon[];
  equipment?: string[];
  /** Live campaign-merged inventory; absent/null outside a campaign context
   *  (then `equipment` is the sheet-only fallback). */
  inventory_items?: InventoryItem[] | null;
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
  round: number;
  rule: "dex_order";
  rows: CombatInitiativeRow[];
}

export interface GameState {
  campaign_id: string;
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
  /** True while the linked investigator is the setup draft shell (creation
   *  guided in chat; its placeholder numbers are not a real sheet). */
  character_setup_pending?: boolean;
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
  /** Deprecated: web no longer opens a setup-draft keeper session. */
  character_setup?: boolean;
  /** Product turn channel is the pi-coc RPC host. */
  host?: "pi-coc";
  /** Fresh host: frontend should attach to the auto-open turn. */
  host_opening?: boolean;
  state: GameState;
}

export interface TranscriptMessage {
  role: string;
  text: string;
  /** Ordered, hash-verified player output projected from turn finalization. */
  content_blocks?: KeeperContentBlock[];
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
  san_before?: number;
  san_after?: number;
  san_delta?: number;
  san_loss?: number;
  san_loss_expression?: string;
  san_loss_resolution?: string;
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

export type KeeperContentBlock =
  | { type: "prose"; text: string }
  | { type: "roll"; text: string; source_ids: string[]; roll?: RollDisplay | null }
  | { type: "roll_group"; text: string; source_ids: string[]; rolls: RollDisplay[] };

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
  | ({ kind: "player"; text: string } & MessageTiming)
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
