import type { CharacterSheet } from "./types";

export type PortraitView = NonNullable<CharacterSheet["portrait"]>;

export function canGeneratePortrait({
  setupPending,
  investigatorId,
  campaignId,
}: {
  setupPending?: boolean;
  investigatorId?: string | null;
  campaignId?: string | null;
}): boolean {
  return (
    setupPending !== true &&
    Boolean(investigatorId && investigatorId.trim()) &&
    Boolean(campaignId && campaignId.trim())
  );
}

export function hasPersistedPortrait(portrait: PortraitView | null | undefined): boolean {
  return Boolean(portrait?.image_url || portrait?.portrait_path);
}

export function portraitButtonLabel(portrait: PortraitView | null | undefined): string {
  return hasPersistedPortrait(portrait) ? "重新生成" : "生成头像";
}

export function portraitImageSrc(portrait: PortraitView | null | undefined): string | null {
  const url = portrait?.image_url?.trim();
  if (url) return url;
  return null;
}

export function mapPortraitError(err: unknown, aborted: boolean): string {
  if (aborted) return "已取消";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/[\u4e00-\u9fff]/.test(message)) return message;
  if (/unauthorized|not configured|401/i.test(message)) {
    return "未配置 xAI 密钥，无法生成头像。";
  }
  if (/403/.test(message) || /forbidden/i.test(message)) {
    return "头像生成被拒绝。";
  }
  if (/429|rate limited/i.test(message)) {
    return "生成过于频繁，请稍后重试。";
  }
  if (/timed out|504/i.test(message)) {
    return "头像生成超时，请稍后重试。";
  }
  if (/cancelled|aborted|499/i.test(message)) {
    return "已取消";
  }
  return message ? `头像生成失败：${message}` : "头像生成失败。";
}

export function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
