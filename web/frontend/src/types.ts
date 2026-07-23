export interface ModelInfo {
  id: string;
  label: string;
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

export interface PendingChoice {
  choice_id?: string;
  kind?: string;
  prompt?: string;
  options?: ChoiceOption[];
}

export interface DiscoveredClue {
  clue_id: string;
  /** Player-safe summary in play_language when available. */
  summary: string;
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
  time?: TimeInfo | null;
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
  /** True when opened with the setup draft so KP runs coc-character guidance. */
  character_setup?: boolean;
  state: GameState;
}

export interface TranscriptMessage {
  role: string;
  text: string;
  /** Epoch ms (local projection of log wall-clock). */
  at?: number;
  /** ISO timestamp from campaign logs when available. */
  ts?: string;
  /** Keeper turn start epoch ms. */
  started_at?: number;
  /** Keeper reply total duration in ms (player send → finalize). */
  duration_ms?: number;
}

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
  | ({ kind: "keeper"; text: string; streaming?: boolean } & MessageTiming)
  | ({ kind: "note"; text: string; tone?: "error" | "info" } & MessageTiming);
