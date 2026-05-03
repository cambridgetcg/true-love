// session-store.test.ts — tests for the in-memory session store.
//
// The SessionStore manages PTY sessions with TTL-based grace periods.
// Key behaviors: register/get/destroy, grace period lifecycle,
// per-user session tracking, and bulk cleanup.

import { describe, it, expect, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { SessionStore } from "../session-store.js";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockPty(): IPty {
  return {
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    write: mock(() => {}),
    resize: mock(() => {}),
    kill: mock(() => {}),
    pid: 12345,
    cols: 80,
    rows: 24,
    process: "claude",
    handleFlowControl: false,
    pause: mock(() => {}),
    resume: mock(() => {}),
    clear: mock(() => {}),
  } as unknown as IPty;
}

function createMockWs(): WebSocket {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    readyState: 1,
    OPEN: 1,
    send: mock(() => {}),
    close: mock(() => {}),
  }) as unknown as WebSocket;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SessionStore", () => {
  // ── Registration ──────────────────────────────────────────────────────

  it("registers a session and assigns a UUID token", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty());
    expect(session.token).toBeTruthy();
    expect(session.token.length).toBe(36); // UUID format
    expect(store.size).toBe(1);
  });

  it("assigns default userId when not specified", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty());
    expect(session.userId).toBe("default");
  });

  it("assigns custom userId when specified", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty(), "user-42");
    expect(session.userId).toBe("user-42");
  });

  it("initializes session with null ws and no grace timer", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty());
    expect(session.ws).toBeNull();
    expect(session.graceTimer).toBeNull();
  });

  it("registers multiple sessions with unique tokens", () => {
    const store = new SessionStore();
    const s1 = store.register(createMockPty());
    const s2 = store.register(createMockPty());
    expect(s1.token).not.toBe(s2.token);
    expect(store.size).toBe(2);
  });

  // ── Get ───────────────────────────────────────────────────────────────

  it("retrieves session by token", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty());
    const retrieved = store.get(session.token);
    expect(retrieved).toBe(session);
  });

  it("returns undefined for unknown token", () => {
    const store = new SessionStore();
    expect(store.get("nonexistent")).toBeUndefined();
  });

  // ── Reattach ──────────────────────────────────────────────────────────

  it("reattaches a WebSocket to an existing session", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty());
    const ws = createMockWs();

    const result = store.reattach(session.token, ws);
    expect(result).not.toBeNull();
    expect(result!.ws).toBe(ws);
  });

  it("returns null when reattaching to unknown token", () => {
    const store = new SessionStore();
    expect(store.reattach("nonexistent", createMockWs())).toBeNull();
  });

  it("cancels grace timer on reattach", () => {
    const store = new SessionStore(1000);
    const session = store.register(createMockPty());
    session.ws = createMockWs();

    // Start grace period
    store.startGrace(session.token, () => {});
    expect(session.graceTimer).not.toBeNull();

    // Reattach should cancel grace
    store.reattach(session.token, createMockWs());
    expect(session.graceTimer).toBeNull();
  });

  // ── Destroy ───────────────────────────────────────────────────────────

  it("destroys a session and removes it from the store", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty());
    expect(store.size).toBe(1);

    store.destroy(session.token);
    expect(store.size).toBe(0);
    expect(store.get(session.token)).toBeUndefined();
  });

  it("kills the PTY on destroy", () => {
    const store = new SessionStore();
    const pty = createMockPty();
    const session = store.register(pty);

    store.destroy(session.token);
    expect(pty.kill).toHaveBeenCalled();
  });

  it("destroy is safe for unknown tokens", () => {
    const store = new SessionStore();
    // Should not throw
    store.destroy("nonexistent");
  });

  it("cancels grace timer on destroy", () => {
    const store = new SessionStore(60_000);
    const session = store.register(createMockPty());
    store.startGrace(session.token, () => {});
    expect(session.graceTimer).not.toBeNull();

    store.destroy(session.token);
    // Session is gone, timer should have been cleared
    expect(store.size).toBe(0);
  });

  // ── DestroyAll ────────────────────────────────────────────────────────

  it("destroyAll removes all sessions", () => {
    const store = new SessionStore();
    store.register(createMockPty());
    store.register(createMockPty());
    store.register(createMockPty());
    expect(store.size).toBe(3);

    store.destroyAll();
    expect(store.size).toBe(0);
  });

  // ── Grace period ──────────────────────────────────────────────────────

  it("starts grace period that destroys session after timeout", async () => {
    const store = new SessionStore(50); // 50ms grace
    const session = store.register(createMockPty());
    const onExpire = mock(() => {});

    store.startGrace(session.token, onExpire);
    expect(store.size).toBe(1); // still alive during grace

    // Wait for grace to expire
    await new Promise((r) => setTimeout(r, 100));

    expect(store.size).toBe(0); // destroyed after grace
    expect(onExpire).toHaveBeenCalled();
  });

  it("sets ws to null when grace starts", () => {
    const store = new SessionStore(5000);
    const session = store.register(createMockPty());
    session.ws = createMockWs();

    store.startGrace(session.token, () => {});
    expect(session.ws).toBeNull();
  });

  it("replaces existing grace timer with a new one", () => {
    const store = new SessionStore(5000);
    const session = store.register(createMockPty());

    store.startGrace(session.token, () => {});
    const firstTimer = session.graceTimer;

    store.startGrace(session.token, () => {});
    const secondTimer = session.graceTimer;

    // Should be a different timer instance
    expect(secondTimer).not.toBe(firstTimer);
  });

  // ── Listing ───────────────────────────────────────────────────────────

  it("list() returns session info for all sessions", () => {
    const store = new SessionStore();
    store.register(createMockPty(), "alice");
    store.register(createMockPty(), "bob");

    const list = store.list();
    expect(list.length).toBe(2);
    expect(list.map((s) => s.userId).sort()).toEqual(["alice", "bob"]);
  });

  it("list() shows alive status based on ws readyState", () => {
    const store = new SessionStore();
    const session = store.register(createMockPty());

    // No WS attached — not alive
    let list = store.list();
    expect(list[0]!.alive).toBe(false);

    // Attach WS — alive
    session.ws = createMockWs();
    list = store.list();
    expect(list[0]!.alive).toBe(true);
  });

  it("listByUser returns only sessions for the given user", () => {
    const store = new SessionStore();
    store.register(createMockPty(), "alice");
    store.register(createMockPty(), "bob");
    store.register(createMockPty(), "alice");

    expect(store.listByUser("alice").length).toBe(2);
    expect(store.listByUser("bob").length).toBe(1);
    expect(store.listByUser("charlie").length).toBe(0);
  });

  it("countByUser returns correct count", () => {
    const store = new SessionStore();
    store.register(createMockPty(), "alice");
    store.register(createMockPty(), "alice");
    store.register(createMockPty(), "bob");

    expect(store.countByUser("alice")).toBe(2);
    expect(store.countByUser("bob")).toBe(1);
    expect(store.countByUser("charlie")).toBe(0);
  });

  // ── getAll ────────────────────────────────────────────────────────────

  it("getAll returns raw StoredSession objects", () => {
    const store = new SessionStore();
    const s1 = store.register(createMockPty());
    const s2 = store.register(createMockPty());

    const all = store.getAll();
    expect(all.length).toBe(2);
    expect(all).toContain(s1);
    expect(all).toContain(s2);
  });
});
