import { describe, expect, it, vi } from "vitest";

import { createWorkbenchStore } from "./workbench-store";

describe("Workbench plan seam", () => {
  it("atomically replaces one form's contributions with another product pack's plan", () => {
    const store = createWorkbenchStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const disposeCoding = store.apply({
      packId: "demo-workbench",
      containers: [
        { id: "demo.sessions", location: "primarySidebar", title: "项目与会话" },
        { id: "demo.subagents", location: "auxiliarySidebar", title: "Subagents" },
      ],
      views: [
        { id: "demo.sessions.tree", container: "demo.sessions" },
        { id: "demo.subagents.tree", container: "demo.subagents" },
      ],
      layout: { primarySidebar: "demo.sessions", auxiliarySidebar: "demo.subagents" },
    });
    expect(store.snapshot()).toMatchObject({
      packId: "demo-workbench",
      containers: [
        { id: "demo.sessions", location: "primarySidebar" },
        { id: "demo.subagents", location: "auxiliarySidebar" },
      ],
    });

    const disposeCampaign = store.apply({
      packId: "campaign-fixture",
      containers: [{ id: "campaign.navigator", location: "primarySidebar", title: "战役" }],
      views: [{ id: "campaign.scenes", container: "campaign.navigator" }],
      layout: { primarySidebar: "campaign.navigator" },
    });
    expect(store.snapshot()).toEqual({
      packId: "campaign-fixture",
      containers: [{ id: "campaign.navigator", location: "primarySidebar", title: "战役" }],
      views: [{ id: "campaign.scenes", container: "campaign.navigator" }],
      layout: { primarySidebar: "campaign.navigator" },
    });
    expect(store.snapshot().containers.some(item => item.id.startsWith("coding."))).toBe(false);

    disposeCoding();
    expect(store.snapshot().packId).toBe("campaign-fixture");
    disposeCampaign();
    expect(store.snapshot()).toEqual({ packId: "empty", containers: [], views: [], layout: {} });
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
