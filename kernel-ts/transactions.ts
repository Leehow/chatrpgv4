/** Static contracts for the existing writer; this module performs no state changes. */
import type {KernelResult} from "./handlers.js";
import type {JsonObject, JsonValue, ReadonlyJson} from "./json.js";

export type WriteMethod = "table.resolve" | "table.apply" | "table.ask" | "table.narrate";

export interface DomainEvent {
  readonly type: string;
  readonly data: JsonObject;
  readonly receipt?: string | null;
}

/** Methods map to the current Campaign store, including its existing partial writes. */
export interface CampaignWritePort {
  readonly id: string;
  readonly directory: string;
  readCampaign(): Promise<JsonObject>;
  readWorld(): Promise<JsonObject>;
  readTurn(): Promise<JsonObject>;
  party(): Promise<readonly JsonObject[]>;
  readTurnRecord(turn: number): Promise<JsonObject | null>;
    readSave(name: string): Promise<JsonValue | null>;
    writeSave(name: string, value: ReadonlyJson): Promise<void>;
    saveExists(name: string): Promise<boolean>;
    saveDirectories(name: string): Promise<string[]>;
  writeCampaign(value: JsonObject): Promise<void>;
  writeWorld(value: JsonObject): Promise<void>;
  writeTurn(value: JsonObject): Promise<void>;
  writeSheet(value: JsonObject): Promise<void>;
  writeTurnRecord(value: JsonObject): Promise<void>;
  appendTranscript(turn: number, role: "player" | "keeper", text: string): Promise<JsonObject>;
  appendEvent(turn: number, event: DomainEvent, callId?: string): Promise<void>;
}

export type WriteStart = {readonly kind: "replay"; readonly result: KernelResult}
  | {readonly kind: "new"; readonly callId: string; readonly ordinal: number};

export interface ResolveCommit {
  readonly callId: string;
  readonly params: JsonObject;
  readonly result: JsonObject;
  readonly receipts: readonly JsonObject[];
  readonly events: readonly DomainEvent[];
}

/** One loaded mutable cursor; filesystem state remains authoritative between RPCs. */
export interface TurnTransaction {
  readonly campaign: CampaignWritePort;
  readonly world: JsonObject;
  readonly turn: JsonObject;
  beginWrite(method: WriteMethod, params: JsonObject, options?: {allowOpening?: boolean}): Promise<WriteStart>;
  touchActing(): Promise<void>;
  commitResolve(commit: ResolveCommit): Promise<void>;
}
