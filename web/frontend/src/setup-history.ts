import type { SetupHistoryScope } from "./types";

export type SetupHistoryVisibilityInput = {
  hasSession: boolean;
  sessionRole?: "setup" | "play" | null;
  setupPending?: boolean;
  transitioning?: boolean;
};

/** Button only for a session the host has proven is out of character
 *  setup: an explicit play role with no pending setup. Unknown/null role
 *  fails closed — the button stays hidden. */
export function canViewSetupHistory(input: SetupHistoryVisibilityInput): boolean {
  if (!input.hasSession) return false;
  if (input.transitioning) return false;
  if (input.setupPending) return false;
  return input.sessionRole === "play";
}

export function setupHistoryTitle(scope: SetupHistoryScope | undefined): string {
  return scope === "setup_and_table_join" ? "建卡及开桌衔接记录" : "建卡记录";
}

export function setupHistoryDescription(scope: SetupHistoryScope | undefined): string {
  if (scope === "setup_and_table_join") {
    return "未找到可靠的开桌分界，以下为建卡及开桌衔接的宿主会话记录（只读，按宿主消息角色标注）。";
  }
  return "创建角色阶段你与守秘人的对话（只读，按宿主消息角色标注）。";
}
