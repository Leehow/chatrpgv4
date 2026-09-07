// @vitest-environment jsdom
import * as React from "react";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createComponent } from "../../../packs/deepwood-sync/app/panel.tsx";

const Panel = createComponent(React);

type StatusOverrides = Partial<{
  loggedIn: boolean;
  email: string;
  projectRoot: string | null;
  project: { id: string; name: string } | null;
  lastSync: Record<string, unknown> | null;
}>;

function status(overrides: StatusOverrides = {}) {
  return {
    loggedIn: true,
    baseUrl: "https://deepwood.cn",
    email: "me@example.com",
    projectRoot: "/tmp/project",
    mirrorDir: "deepwood",
    project: { id: "proj-1", name: "写作项目" },
    lastSync: null,
    running: null,
    lastError: null,
    ...overrides,
  };
}

/**
 * The agent half answers an `ExtInvokeResult` and the host wraps its own around it,
 * so the panel is fed the doubled envelope on purpose here.
 */
function apiFor(handlers: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (method: string) => {
    if (!(method in handlers)) return { ok: true, data: { ok: true, data: {} } };
    return { ok: true, data: { ok: true, data: handlers[method] } };
  });
  const update = vi.fn(async () => ({ ok: true }));
  return {
    api: {
      invoke,
      settings: { update },
      data: { read: vi.fn(async () => { throw new Error("no file"); }) },
      subscribeExt: vi.fn(() => () => undefined),
      ...extras,
    },
    invoke,
    update,
  };
}

function renderPanel(api: unknown) {
  return render(createElement(Panel, { api, id: "deepwood" } as never));
}

afterEach(cleanup);

describe("deepwood panel", () => {
  it("asks for credentials when the account is not connected, and hands the token to the vault", async () => {
    const { api, invoke, update } = apiFor({
      deepwood_status: status({ loggedIn: false, email: "", project: null }),
      deepwood_login: { token: "jwt-123", email: "me@example.com" },
    });
    renderPanel(api);

    const button = await screen.findByTestId("deepwood-login");
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByTestId("deepwood-login"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("deepwood_login", { email: "me@example.com", password: "hunter2" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      "ext.deepwood-sync.token": "jwt-123",
      "ext.deepwood-sync.email": "me@example.com",
    }));
  });

  it("syncs the bound project on demand and passes the selected content kinds", async () => {
    const { api, invoke } = apiFor({ deepwood_status: status() });
    renderPanel(api);

    expect((await screen.findByTestId("deepwood-bound")).textContent).toContain("写作项目");
    const sync = screen.getByTestId("deepwood-sync") as HTMLButtonElement;
    await waitFor(() => expect(sync.disabled).toBe(false));

    fireEvent.click(screen.getByLabelText("图片库"));
    fireEvent.click(sync);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("deepwood_sync_start", {
      options: { originals: true, markdown: true, notes: true, gallery: false },
    }));
  });

  it("will not sync before a project directory exists", async () => {
    const { api } = apiFor({ deepwood_status: status({ projectRoot: null }) });
    renderPanel(api);

    await screen.findByTestId("deepwood-no-project");
    expect((screen.getByTestId("deepwood-sync") as HTMLButtonElement).disabled).toBe(true);
  });

  it("will not sync before a remote project is bound", async () => {
    const { api } = apiFor({ deepwood_status: status({ project: null }) });
    renderPanel(api);

    await screen.findByTestId("deepwood-load-projects");
    expect((screen.getByTestId("deepwood-sync") as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains the missing session rather than showing a raw error code", async () => {
    const api = {
      invoke: vi.fn(async () => ({ ok: false, error: { code: "no_session", message: "no active session" } })),
      settings: { update: vi.fn() },
      data: { read: vi.fn(async () => { throw new Error("no file"); }) },
      subscribeExt: vi.fn(() => () => undefined),
    };
    renderPanel(api);

    expect((await screen.findByTestId("deepwood-error")).textContent).toContain("活动会话");
  });

  it("reports the last run, calling out files it refused to overwrite", async () => {
    const { api } = apiFor({
      deepwood_status: status({
        lastSync: { at: "2026-03-01T10:00:00Z", written: 3, unchanged: 7, skippedLocalEdits: 2, failed: 0 },
      }),
    });
    renderPanel(api);

    const summary = await screen.findByTestId("deepwood-summary");
    expect(summary.textContent).toContain("新增/更新 3");
    expect(summary.textContent).toContain("本地已改动 2");
  });
});
