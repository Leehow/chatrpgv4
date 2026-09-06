/**
 * 扩展共用的宿主环境两件小事，不是扩展，只被 import。
 *
 * 一是这个进程在做什么：`bin/pi-coc` 开桌时导出 `PI_COC_MODE=play`，
 * `bin/pi-coc setup` 导出 `setup`（契约 §14.4）。工具面按它分岔：play 只有守秘人的七个动词，
 * setup 只有建卡的一个 `setup`。模式在扩展工厂里读，不在模块顶层读——
 * 同一个进程里跑多张桌子（测试台）时顶层常量会被第一次加载的值冻住。
 *
 * 二是往工作区里追加一行 JSONL（遥测、构建日志）：路径由调用方给，写不进去就算了，
 * 一条日志不该弄坏一回合。
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type CocMode = "play" | "setup";

/** 缺省是 play：不认识的值（拼错、老脚本）也当开桌，别把桌子变成没有工具的空壳。 */
export function cocMode(): CocMode {
	return process.env.PI_COC_MODE?.trim() === "setup" ? "setup" : "play";
}

/** 追加一行 JSON；目录不存在就建。任何失败都吞掉。 */
export async function appendJsonl(path: string, line: Record<string, unknown>): Promise<void> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
	} catch {
		/* 日志写不进去不该冒出去 */
	}
}
