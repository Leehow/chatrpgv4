/** @deprecated Compatibility types and provider request; Git placement lives in git-capability. */
export type {
	WorktreePlacement,
	WorktreePlacementOptions,
} from "../../git-capability/agent/worktree-placement.ts";
export {
	requestGitWorktreePlacementProviderV1,
	requestGitWorktreePlacementV1,
} from "../../git-capability/agent/worktree-service.ts";
