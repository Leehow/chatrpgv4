/**
 * Contract §135.27.1.3: the launcher's notices, placed in the transcript as §55 service notices and kept out of every
 * model request. The launcher (`runtime/launch.ts`) decides them; the kernel extension takes them at `session_start`.
 */
import { hostNoticeText, type HostNotice } from "../../runtime/host-notices.ts";
import type { ExtensionWords } from "../ui/words.ts";

/** The subject flag on the notice's `details`: what makes the row a service notice to the App (§55, `first-prose.ts`). */
export const HOST_NOTICE_FLAG = "host_notice";

/**
 * The `pi.sendMessage` payload for one notice, in the table's play language when its words read, in English otherwise.
 * A `coc-delivery` with an integer `turn` is closed noise to the context projection once a turn boundary follows it.
 */
export function hostNoticeMessage(notice: HostNotice, words: ExtensionWords | undefined, turn: number) {
  let content = hostNoticeText(notice);
  if (words) {
    const models = notice.notice === "models_json_operator_comments" ? notice.missing.join(", ") : "";
    const error = notice.notice === "models_json_unparsable" ? notice.error : "";
    try {
      content = notice.notice === "models_json_unparsable"
        ? words.line("models_json_unparsable_notice", { path: notice.path, error })
        : words.line("models_json_comments_notice", { path: notice.path, models });
    } catch {
      /* the English line stands */
    }
  }
  return { customType: "coc-delivery", content, display: true as const,
    details: { coc_delivery: true, turn, [HOST_NOTICE_FLAG]: notice.notice } };
}

/** A host notice among a request's messages: it is for the person at the table, never for a model. */
export function isHostNoticeMessage(message: unknown): boolean {
  const row = message as { role?: unknown; customType?: unknown; details?: Record<string, unknown> } | null;
  return row?.role === "custom" && row.customType === "coc-delivery" && typeof row.details?.[HOST_NOTICE_FLAG] === "string";
}
