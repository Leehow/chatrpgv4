import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installOwnedRuntimeShutdown,
  OWNED_RUNTIME_SHUTDOWN_WATCHDOG_MS,
} from "./app-lifecycle.js";

function createApp() {
  let beforeQuit: ((event: { preventDefault(): void }) => void) | undefined;
  const app = {
    on: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => {
      if (event === "before-quit") beforeQuit = listener;
    }),
    quit: vi.fn(),
    exit: vi.fn(),
  };
  return { app, getBeforeQuit: () => beforeQuit };
}

describe("installOwnedRuntimeShutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds before-quit until the Terminal and Pi runtimes have shut down exactly once", async () => {
    const { app, getBeforeQuit } = createApp();
    const closeAll = vi.fn();
    let finishPiClose!: () => void;
    const closePi = vi.fn(() => new Promise<void>((resolve) => {
      finishPiClose = resolve;
    }));
    installOwnedRuntimeShutdown(app, { closeAll }, { close: closePi });
    const beforeQuit = getBeforeQuit();
    const first = { preventDefault: vi.fn() };
    const repeated = { preventDefault: vi.fn() };

    beforeQuit?.(first);
    beforeQuit?.(repeated);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(repeated.preventDefault).toHaveBeenCalledOnce();
    expect(closeAll).toHaveBeenCalledOnce();
    expect(closePi).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();

    finishPiClose();
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
    expect(app.exit).not.toHaveBeenCalled();

    const resumed = { preventDefault: vi.fn() };
    beforeQuit?.(resumed);
    expect(resumed.preventDefault).not.toHaveBeenCalled();
    expect(closePi).toHaveBeenCalledOnce();
  });

  it("force-exits after the watchdog if the runtime never settles", async () => {
    vi.useFakeTimers();
    const { app, getBeforeQuit } = createApp();
    const closePi = vi.fn(() => new Promise<void>(() => {}));
    installOwnedRuntimeShutdown(app, { closeAll: vi.fn() }, { close: closePi });

    getBeforeQuit()?.({ preventDefault: vi.fn() });
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OWNED_RUNTIME_SHUTDOWN_WATCHDOG_MS);
    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("ignores a later before-quit after the watchdog has already exited", async () => {
    vi.useFakeTimers();
    const { app, getBeforeQuit } = createApp();
    const closePi = vi.fn(() => new Promise<void>(() => {}));
    installOwnedRuntimeShutdown(app, { closeAll: vi.fn() }, { close: closePi });
    const beforeQuit = getBeforeQuit();

    beforeQuit?.({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(OWNED_RUNTIME_SHUTDOWN_WATCHDOG_MS);
    expect(app.exit).toHaveBeenCalledOnce();

    const late = { preventDefault: vi.fn() };
    beforeQuit?.(late);
    expect(late.preventDefault).not.toHaveBeenCalled();
    expect(closePi).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
  });
});
