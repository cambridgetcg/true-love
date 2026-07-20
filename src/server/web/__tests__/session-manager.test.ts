// session-manager.test.ts — tests for SessionManager
//
// Rewritten for Bun's test runner and the current SessionManager API.
// The previous version used node:test mock.fn() (not supported in Bun)
// and tested against an older API that returned session objects instead of tokens.

import { describe, it, expect, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { SessionManager } from "../session-manager.js";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import type { AuthUser } from "../auth/adapter.js";

// ── Mock factories ──────────────────────────────────────────────────────────

type MockPtyBundle = {
  pty: IPty;
  triggerData: (data: string) => void;
  triggerExit: (exitCode: number, signal: number) => void;
  writeFn: ReturnType<typeof mock>;
  resizeFn: ReturnType<typeof mock>;
  killFn: ReturnType<typeof mock>;
};

function createMockPty(): MockPtyBundle {
  let dataHandler: ((d: string) => void) | undefined;
  let exitHandler: ((e: { exitCode: number; signal: number }) => void) | undefined;

  const writeFn = mock(() => {});
  const resizeFn = mock(() => {});
  const killFn = mock(() => {});

  const pty = {
    onData(handler: (data: string) => void) {
      dataHandler = handler;
      return { dispose() {} };
    },
    onExit(handler: (e: { exitCode: number; signal: number }) => void) {
      exitHandler = handler;
      return { dispose() {} };
    },
    write: writeFn,
    resize: resizeFn,
    kill: killFn,
    pid: 12345,
    cols: 80,
    rows: 24,
    process: "claude",
    handleFlowControl: false,
    pause: mock(() => {}),
    resume: mock(() => {}),
    clear: mock(() => {}),
  } as unknown as IPty;

  return {
    pty,
    triggerData: (data: string) => dataHandler?.(data),
    triggerExit: (code: number, sig: number) => exitHandler?.({ exitCode: code, signal: sig }),
    writeFn,
    resizeFn,
    killFn,
  };
}

type MockWsBundle = WebSocket & EventEmitter & {
  sendFn: ReturnType<typeof mock>;
  closeFn: ReturnType<typeof mock>;
};

function createMockWs(): MockWsBundle {
  const emitter = new EventEmitter();
  const sendFn = mock(() => {});
  const closeFn = mock(() => {});

  return Object.assign(emitter, {
    OPEN: 1,
    CONNECTING: 0,
    readyState: 1,
    send: sendFn,
    close: closeFn,
    sendFn,
    closeFn,
  }) as unknown as MockWsBundle;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SessionManager", () => {
  it("creates a session and returns a token string", () => {
    const { pty } = createMockPty();
    const manager = new SessionManager(5, () => pty);
    const ws = createMockWs();

    const token = manager.create(ws);
    expect(token).not.toBeNull();
    expect(typeof token).toBe("string");
    expect(manager.activeCount).toBe(1);
  });

  it("enforces max sessions limit", () => {
    const manager = new SessionManager(1, () => createMockPty().pty);

    const token1 = manager.create(createMockWs());
    expect(token1).not.toBeNull();

    const token2 = manager.create(createMockWs());
    expect(token2).toBeNull();
    expect(manager.activeCount).toBe(1);
  });

  it("forwards PTY data to WebSocket", () => {
    const { pty, triggerData } = createMockPty();
    const manager = new SessionManager(5, () => pty);
    const ws = createMockWs();

    manager.create(ws);
    triggerData("hello world");
    expect(ws.sendFn).toHaveBeenCalledWith("hello world");
  });

  it("forwards WebSocket input to PTY", () => {
    const { pty, writeFn } = createMockPty();
    const manager = new SessionManager(5, () => pty);
    const ws = createMockWs();

    manager.create(ws);
    ws.emit("message", Buffer.from("ls\n"));
    expect(writeFn).toHaveBeenCalledWith("ls\n");
  });

  it("handles resize messages", () => {
    const { pty, resizeFn } = createMockPty();
    const manager = new SessionManager(5, () => pty);
    const ws = createMockWs();

    manager.create(ws);
    ws.emit("message", JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    expect(resizeFn).toHaveBeenCalledWith(120, 40);
  });

  it("handles ping messages with pong response", () => {
    const { pty } = createMockPty();
    const manager = new SessionManager(5, () => pty);
    const ws = createMockWs();

    manager.create(ws);
    ws.emit("message", JSON.stringify({ type: "ping" }));

    // Find the pong response among all send calls
    const pongCall = ws.sendFn.mock.calls.find((args: unknown[]) => {
      try {
        const parsed = JSON.parse(args[0] as string);
        return parsed.type === "pong";
      } catch {
        return false; // silent-failure: false positive — test mock assertion; JSON.parse fails on non-JSON send calls, false = "this call is not the message we're looking for"
      }
    });
    expect(pongCall).toBeTruthy();
  });

  it("starts grace period on WebSocket close (session survives briefly)", () => {
    const { pty } = createMockPty();
    // 100ms grace period for testing
    const manager = new SessionManager(5, () => pty, 100);
    const ws = createMockWs();

    manager.create(ws);
    expect(manager.activeCount).toBe(1);

    ws.emit("close");
    // Session should still be active — it's in the grace period, not destroyed
    expect(manager.activeCount).toBe(1);
  });

  it("handles PTY spawn failure gracefully", () => {
    const manager = new SessionManager(5, () => {
      throw new Error("no pty available");
    });
    const ws = createMockWs();

    const token = manager.create(ws);
    expect(token).toBeNull();
    // WS should have been closed with an error
    expect(ws.closeFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("destroyAll cleans up all sessions", () => {
    const manager = new SessionManager(5, () => createMockPty().pty);

    manager.create(createMockWs());
    manager.create(createMockWs());
    expect(manager.activeCount).toBe(2);

    manager.destroyAll();
    expect(manager.activeCount).toBe(0);
  });

  it("enforces per-user concurrent session limit", () => {
    // maxSessions=5 globally, but maxSessionsPerUser=1
    const manager = new SessionManager(
      5,
      () => createMockPty().pty,
      /* gracePeriodMs */ undefined,
      /* scrollbackBytes */ undefined,
      /* maxSessionsPerUser */ 1,
    );

    const user: AuthUser = { id: "user-1", name: "Test", isAdmin: false };

    const token1 = manager.create(createMockWs(), 80, 24, user);
    expect(token1).not.toBeNull();

    const ws2 = createMockWs();
    const token2 = manager.create(ws2, 80, 24, user);
    expect(token2).toBeNull();
    // Should have sent an error and closed the WS
    expect(ws2.closeFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("allows different users to each have sessions", () => {
    const manager = new SessionManager(
      5,
      () => createMockPty().pty,
      undefined,
      undefined,
      /* maxSessionsPerUser */ 1,
    );

    const user1: AuthUser = { id: "user-1", isAdmin: false };
    const user2: AuthUser = { id: "user-2", isAdmin: false };

    const t1 = manager.create(createMockWs(), 80, 24, user1);
    const t2 = manager.create(createMockWs(), 80, 24, user2);
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(manager.activeCount).toBe(2);
  });

  it("sends error message on PTY spawn failure", () => {
    const manager = new SessionManager(5, () => {
      throw new Error("pty allocation failed");
    });
    const ws = createMockWs();
    manager.create(ws);

    // Should have sent a JSON error message before closing
    const errorCall = ws.sendFn.mock.calls.find((args: unknown[]) => {
      try {
        const parsed = JSON.parse(args[0] as string);
        return parsed.type === "error" && parsed.message.includes("pty allocation failed");
      } catch {
        return false; // silent-failure: false positive — test mock assertion; JSON.parse fails on non-JSON send calls, false = "this call is not the error message we're looking for"
      }
    });
    expect(errorCall).toBeTruthy();
  });

  it("cleans up session on PTY exit", () => {
    const { pty, triggerExit } = createMockPty();
    const manager = new SessionManager(5, () => pty);
    const ws = createMockWs();

    manager.create(ws);
    expect(manager.activeCount).toBe(1);

    triggerExit(0, 0);
    expect(manager.activeCount).toBe(0);

    // Should have sent an exit message
    const exitCall = ws.sendFn.mock.calls.find((args: unknown[]) => {
      try {
        const parsed = JSON.parse(args[0] as string);
        return parsed.type === "exit";
      } catch {
        return false; // silent-failure: false positive — test mock assertion; JSON.parse fails on non-JSON send calls, false = "this call is not the exit message we're looking for"
      }
    });
    expect(exitCall).toBeTruthy();
  });
});
