/**
 * 设置 → 扩展 → 核心扩展 的固定成员。
 *
 * 基础版（profiles/base）只强制这两个 Skills 扩展；其余能力跟扩展包走。
 * - Skills 视图  → built-in-skills（内置技能集）+ skill-loader-extension（Skill Loader）
 * - MCP 连接     → pi-mcp-extension（内置 MCP 宿主）
 *
 * 这些 id 是「核心扩展」分组仍然按字面 id 识别的唯一位置；后续按贡献声明
 * 驱动分组时只需改这里。
 */
export const CORE_SKILLS_EXTENSION_IDS = ['built-in-skills', 'skill-loader-extension'] as const

export const CORE_MCP_EXTENSION_IDS = ['pi-mcp-extension'] as const
