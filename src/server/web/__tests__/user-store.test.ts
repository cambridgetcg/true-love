/**
 * Tests for UserStore — in-memory user tracking.
 *
 * Covers: touch (create + update), release, list, get, metadata handling,
 * multi-user isolation, session counting, cleanup semantics.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { UserStore } from "../user-store.js";

describe("UserStore", () => {
  let store: UserStore;

  beforeEach(() => {
    store = new UserStore();
  });

  // ── touch ────────────────────────────────────────────────────────────────

  describe("touch", () => {
    it("creates a new user record on first touch", () => {
      store.touch("user-1");
      const record = store.get("user-1");
      expect(record).toBeDefined();
      expect(record!.id).toBe("user-1");
      expect(record!.sessionCount).toBe(1);
    });

    it("increments sessionCount on subsequent touches", () => {
      store.touch("user-1");
      store.touch("user-1");
      store.touch("user-1");
      expect(store.get("user-1")!.sessionCount).toBe(3);
    });

    it("sets firstSeenAt on first touch", () => {
      const before = Date.now();
      store.touch("user-1");
      const after = Date.now();
      const record = store.get("user-1")!;
      expect(record.firstSeenAt).toBeGreaterThanOrEqual(before);
      expect(record.firstSeenAt).toBeLessThanOrEqual(after);
    });

    it("updates lastSeenAt on every touch", () => {
      store.touch("user-1");
      const first = store.get("user-1")!.lastSeenAt;
      // Busy-wait just enough to get a different timestamp
      const start = Date.now();
      while (Date.now() === start) { /* tick */ }
      store.touch("user-1");
      const second = store.get("user-1")!.lastSeenAt;
      expect(second).toBeGreaterThanOrEqual(first);
    });

    it("preserves firstSeenAt across touches", () => {
      store.touch("user-1");
      const firstSeen = store.get("user-1")!.firstSeenAt;
      store.touch("user-1");
      store.touch("user-1");
      expect(store.get("user-1")!.firstSeenAt).toBe(firstSeen);
    });

    it("stores email and name metadata", () => {
      store.touch("user-1", { email: "yu@example.com", name: "Yu" });
      const record = store.get("user-1")!;
      expect(record.email).toBe("yu@example.com");
      expect(record.name).toBe("Yu");
    });

    it("fills in metadata on later touch if not set initially", () => {
      store.touch("user-1"); // no meta
      store.touch("user-1", { email: "yu@example.com", name: "Yu" });
      const record = store.get("user-1")!;
      expect(record.email).toBe("yu@example.com");
      expect(record.name).toBe("Yu");
    });

    it("does not overwrite existing metadata with new values", () => {
      store.touch("user-1", { email: "first@example.com", name: "First" });
      store.touch("user-1", { email: "second@example.com", name: "Second" });
      const record = store.get("user-1")!;
      // First values win — the code only fills in if !existing.email
      expect(record.email).toBe("first@example.com");
      expect(record.name).toBe("First");
    });

    it("handles touch with no metadata", () => {
      store.touch("user-1");
      const record = store.get("user-1")!;
      expect(record.email).toBeUndefined();
      expect(record.name).toBeUndefined();
    });

    it("handles touch with partial metadata", () => {
      store.touch("user-1", { email: "yu@example.com" });
      const record = store.get("user-1")!;
      expect(record.email).toBe("yu@example.com");
      expect(record.name).toBeUndefined();
    });
  });

  // ── release ──────────────────────────────────────────────────────────────

  describe("release", () => {
    it("decrements sessionCount", () => {
      store.touch("user-1");
      store.touch("user-1");
      store.release("user-1");
      expect(store.get("user-1")!.sessionCount).toBe(1);
    });

    it("removes user record when sessionCount reaches zero", () => {
      store.touch("user-1");
      store.release("user-1");
      expect(store.get("user-1")).toBeUndefined();
    });

    it("does not go below zero", () => {
      store.touch("user-1");
      store.release("user-1"); // sessionCount → 0, record deleted
      store.release("user-1"); // no-op (no record)
      expect(store.get("user-1")).toBeUndefined();
    });

    it("is a no-op for unknown user", () => {
      // Should not throw
      store.release("nonexistent");
      expect(store.list()).toHaveLength(0);
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns empty array when no users", () => {
      expect(store.list()).toEqual([]);
    });

    it("returns all connected users", () => {
      store.touch("user-1");
      store.touch("user-2");
      store.touch("user-3");
      const users = store.list();
      expect(users).toHaveLength(3);
      const ids = users.map((u) => u.id).sort();
      expect(ids).toEqual(["user-1", "user-2", "user-3"]);
    });

    it("does not include released users", () => {
      store.touch("user-1");
      store.touch("user-2");
      store.release("user-1");
      const users = store.list();
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe("user-2");
    });
  });

  // ── get ──────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns undefined for unknown user", () => {
      expect(store.get("nonexistent")).toBeUndefined();
    });

    it("returns the correct record for a known user", () => {
      store.touch("user-1", { email: "yu@test.com" });
      store.touch("user-2", { name: "Beta" });
      expect(store.get("user-1")!.email).toBe("yu@test.com");
      expect(store.get("user-2")!.name).toBe("Beta");
    });
  });

  // ── Multi-user isolation ─────────────────────────────────────────────────

  describe("multi-user isolation", () => {
    it("tracks users independently", () => {
      store.touch("user-1");
      store.touch("user-1");
      store.touch("user-2");
      expect(store.get("user-1")!.sessionCount).toBe(2);
      expect(store.get("user-2")!.sessionCount).toBe(1);
    });

    it("releasing one user does not affect another", () => {
      store.touch("user-1");
      store.touch("user-2");
      store.release("user-1");
      expect(store.get("user-1")).toBeUndefined();
      expect(store.get("user-2")!.sessionCount).toBe(1);
    });
  });
});
