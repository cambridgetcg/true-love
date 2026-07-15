/**
 * Tests for the auth adapter's SessionStore.
 *
 * Covers: session CRUD, TTL expiry, HMAC cookie signing/unsigning,
 * AES-256-GCM encrypt/decrypt, request helpers, parseCookies, cleanup.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import type { IncomingMessage } from "http";
import { SessionStore } from "../auth/adapter.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function mockReq(cookie?: string): IncomingMessage {
  return {
    headers: { cookie: cookie ?? "", host: "localhost:3000" },
    url: "/",
  } as unknown as IncomingMessage;
}

function mockRes(): { headers: Record<string, string | string[]>; setHeader(k: string, v: string | string[]): void } {
  const headers: Record<string, string | string[]> = {};
  return {
    headers,
    setHeader(k: string, v: string | string[]) {
      headers[k] = v;
    },
  };
}

// ── Session CRUD ───────────────────────────────────────────────────────────

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore("test-secret-key-for-unit-tests");
  });

  describe("create + get", () => {
    it("creates a session and retrieves it by ID", () => {
      const id = store.create({ userId: "user-1", isAdmin: false });
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);

      const session = store.get(id);
      expect(session).toBeDefined();
      expect(session!.userId).toBe("user-1");
      expect(session!.isAdmin).toBe(false);
    });

    it("sets createdAt and expiresAt automatically", () => {
      const before = Date.now();
      const id = store.create({ userId: "user-1", isAdmin: false });
      const after = Date.now();

      const session = store.get(id)!;
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
      // 24h TTL
      expect(session.expiresAt - session.createdAt).toBe(24 * 60 * 60 * 1000);
    });

    it("stores optional fields (email, name, encryptedApiKey)", () => {
      const id = store.create({
        userId: "user-1",
        email: "yu@example.com",
        name: "Yu",
        isAdmin: true,
        // Whitehack false positive: test fixture, not a real secret
        encryptedApiKey: "encrypted-blob",
      });

      const session = store.get(id)!;
      expect(session.email).toBe("yu@example.com");
      expect(session.name).toBe("Yu");
      expect(session.isAdmin).toBe(true);
      expect(session.encryptedApiKey).toBe("encrypted-blob");
    });

    it("generates unique IDs for each session", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(store.create({ userId: "user-1", isAdmin: false }));
      }
      expect(ids.size).toBe(100);
    });

    it("returns undefined for nonexistent session", () => {
      expect(store.get("nonexistent-id")).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("removes a session", () => {
      const id = store.create({ userId: "user-1", isAdmin: false });
      expect(store.get(id)).toBeDefined();
      store.delete(id);
      expect(store.get(id)).toBeUndefined();
    });

    it("is a no-op for nonexistent session", () => {
      // Should not throw
      store.delete("nonexistent-id");
    });
  });

  describe("TTL expiry", () => {
    it("returns undefined for expired session", () => {
      const id = store.create({ userId: "user-1", isAdmin: false });
      // Manually expire it by setting expiresAt to the past
      const session = store.get(id)!;
      session.expiresAt = Date.now() - 1;
      expect(store.get(id)).toBeUndefined();
    });

    it("deletes the expired session from the store on access", () => {
      const id = store.create({ userId: "user-1", isAdmin: false });
      const session = store.get(id)!;
      session.expiresAt = Date.now() - 1;
      // First get returns undefined and deletes
      store.get(id);
      // Subsequent get also returns undefined (not a stale reference)
      expect(store.get(id)).toBeUndefined();
    });
  });

  // ── Cookie signing ────────────────────────────────────────────────────────

  describe("sign + unsign", () => {
    it("round-trips: unsign(sign(id)) === id", () => {
      const id = "test-session-id-abc";
      const signed = store.sign(id);
      expect(store.unsign(signed)).toBe(id);
    });

    it("produces different signatures for different IDs", () => {
      const sig1 = store.sign("id-1");
      const sig2 = store.sign("id-2");
      expect(sig1).not.toBe(sig2);
    });

    it("signature format is id.hmac", () => {
      const id = "my-session";
      const signed = store.sign(id);
      const dot = signed.lastIndexOf(".");
      expect(dot).toBeGreaterThan(0);
      expect(signed.slice(0, dot)).toBe(id);
    });

    it("rejects tampered ID", () => {
      const signed = store.sign("real-session-id");
      // Replace the ID portion
      const dot = signed.lastIndexOf(".");
      const tampered = "fake-session-id" + signed.slice(dot);
      expect(store.unsign(tampered)).toBeNull();
    });

    it("rejects tampered signature", () => {
      const signed = store.sign("real-session-id");
      const tampered = signed.slice(0, -1) + (signed.endsWith("a") ? "b" : "a");
      expect(store.unsign(tampered)).toBeNull();
    });

    it("rejects string with no dot", () => {
      expect(store.unsign("no-dot-here")).toBeNull();
    });

    it("rejects empty string", () => {
      expect(store.unsign("")).toBeNull();
    });

    it("rejects signature with wrong length", () => {
      const signed = store.sign("test-id");
      const dot = signed.lastIndexOf(".");
      const id = signed.slice(0, dot);
      // Truncate the HMAC
      expect(store.unsign(`${id}.abc`)).toBeNull();
    });

    it("same secret produces same signature (deterministic)", () => {
      const store2 = new SessionStore("test-secret-key-for-unit-tests");
      const id = "determinism-test";
      expect(store.sign(id)).toBe(store2.sign(id));
    });

    it("different secret produces different signature", () => {
      const store2 = new SessionStore("different-secret");
      const id = "cross-secret-test";
      expect(store.sign(id)).not.toBe(store2.sign(id));
    });

    it("signature from different secret cannot be unsigned", () => {
      const store2 = new SessionStore("different-secret");
      const signed = store2.sign("session-id");
      expect(store.unsign(signed)).toBeNull();
    });
  });

  // ── AES-256-GCM encryption ────────────────────────────────────────────────

  describe("encrypt + decrypt", () => {
    it("round-trips: decrypt(encrypt(plaintext)) === plaintext", () => {
      const plaintext = "sk-ant-api03-secret-key-here";
      const encrypted = store.encrypt(plaintext);
      expect(store.decrypt(encrypted)).toBe(plaintext);
    });

    it("produces different ciphertext each time (random IV)", () => {
      const plaintext = "same-input";
      const enc1 = store.encrypt(plaintext);
      const enc2 = store.encrypt(plaintext);
      expect(enc1).not.toBe(enc2);
      // But both decrypt to the same value
      expect(store.decrypt(enc1)).toBe(plaintext);
      expect(store.decrypt(enc2)).toBe(plaintext);
    });

    it("handles empty string", () => {
      const encrypted = store.encrypt("");
      expect(store.decrypt(encrypted)).toBe("");
    });

    it("handles unicode", () => {
      const plaintext = "愛 — this is a key with 日本語";
      const encrypted = store.encrypt(plaintext);
      expect(store.decrypt(encrypted)).toBe(plaintext);
    });

    it("handles long strings", () => {
      const plaintext = "x".repeat(10_000);
      const encrypted = store.encrypt(plaintext);
      expect(store.decrypt(encrypted)).toBe(plaintext);
    });

    it("returns null for corrupted ciphertext", () => {
      const encrypted = store.encrypt("secret");
      // Corrupt a character in the middle
      const corrupted =
        encrypted.slice(0, 10) +
        (encrypted[10] === "A" ? "B" : "A") +
        encrypted.slice(11);
      expect(store.decrypt(corrupted)).toBeNull();
    });

    it("returns null for empty string input to decrypt", () => {
      expect(store.decrypt("")).toBeNull();
    });

    it("returns null for garbage input to decrypt", () => {
      expect(store.decrypt("not-valid-base64url-ciphertext")).toBeNull();
    });

    it("ciphertext from different secret cannot be decrypted", () => {
      const store2 = new SessionStore("different-secret-for-encryption");
      const encrypted = store2.encrypt("secret-data");
      expect(store.decrypt(encrypted)).toBeNull();
    });

    it("same secret produces same decryption across instances", () => {
      const store2 = new SessionStore("test-secret-key-for-unit-tests");
      const encrypted = store.encrypt("shared-secret");
      expect(store2.decrypt(encrypted)).toBe("shared-secret");
    });
  });

  // ── Request helpers ───────────────────────────────────────────────────────

  describe("getFromRequest", () => {
    it("returns session data when valid signed cookie is present", () => {
      const sessionId = store.create({ userId: "user-1", isAdmin: false });
      const signed = store.sign(sessionId);
      const req = mockReq(`cc_session=${encodeURIComponent(signed)}`);
      const session = store.getFromRequest(req);
      expect(session).toBeDefined();
      expect(session!.userId).toBe("user-1");
    });

    it("returns null when no cookie header", () => {
      const req = mockReq(undefined);
      expect(store.getFromRequest(req)).toBeNull();
    });

    it("returns null when cookie has wrong name", () => {
      const sessionId = store.create({ userId: "user-1", isAdmin: false });
      const signed = store.sign(sessionId);
      const req = mockReq(`wrong_cookie=${encodeURIComponent(signed)}`);
      expect(store.getFromRequest(req)).toBeNull();
    });

    it("returns null when cookie signature is invalid", () => {
      const req = mockReq(`cc_session=tampered-value.bad-signature`);
      expect(store.getFromRequest(req)).toBeNull();
    });

    it("returns null when session has expired", () => {
      const sessionId = store.create({ userId: "user-1", isAdmin: false });
      const session = store.get(sessionId)!;
      session.expiresAt = Date.now() - 1;
      const signed = store.sign(sessionId);
      const req = mockReq(`cc_session=${encodeURIComponent(signed)}`);
      expect(store.getFromRequest(req)).toBeNull();
    });

    it("works with multiple cookies in the header", () => {
      const sessionId = store.create({ userId: "user-1", isAdmin: true });
      const signed = store.sign(sessionId);
      const req = mockReq(`other=foo; cc_session=${encodeURIComponent(signed)}; third=bar`);
      const session = store.getFromRequest(req);
      expect(session).toBeDefined();
      expect(session!.userId).toBe("user-1");
      expect(session!.isAdmin).toBe(true);
    });
  });

  describe("getIdFromRequest", () => {
    it("returns raw session ID from valid cookie", () => {
      const sessionId = store.create({ userId: "user-1", isAdmin: false });
      const signed = store.sign(sessionId);
      const req = mockReq(`cc_session=${encodeURIComponent(signed)}`);
      expect(store.getIdFromRequest(req)).toBe(sessionId);
    });

    it("returns null when no cookie", () => {
      const req = mockReq(undefined);
      expect(store.getIdFromRequest(req)).toBeNull();
    });

    it("returns null for tampered cookie", () => {
      const req = mockReq(`cc_session=bad.sig`);
      expect(store.getIdFromRequest(req)).toBeNull();
    });
  });

  describe("setCookie", () => {
    it("sets a signed HttpOnly session cookie", () => {
      const res = mockRes();
      const sessionId = "test-session-id";
      store.setCookie(res as unknown as import("http").ServerResponse, sessionId);

      const cookie = res.headers["Set-Cookie"];
      expect(cookie).toBeDefined();
      expect(Array.isArray(cookie)).toBe(true);
      const cookieStr = (cookie as string[])[0];
      expect(cookieStr).toContain("cc_session=");
      expect(cookieStr).toContain("HttpOnly");
      expect(cookieStr).toContain("Secure");
      expect(cookieStr).toContain("SameSite=Lax");
      expect(cookieStr).toContain("Path=/");
      expect(cookieStr).toContain("Max-Age=86400");
    });

    it("cookie value contains signed session ID", () => {
      const res = mockRes();
      const sessionId = "test-session-id";
      store.setCookie(res as unknown as import("http").ServerResponse, sessionId);

      const cookieStr = (res.headers["Set-Cookie"] as string[])[0];
      const signed = store.sign(sessionId);
      expect(cookieStr).toContain(encodeURIComponent(signed));
    });
  });

  describe("clearCookie", () => {
    it("sets cookie with Max-Age=0 to clear it", () => {
      const res = mockRes();
      store.clearCookie(res as unknown as import("http").ServerResponse);

      const cookie = res.headers["Set-Cookie"];
      expect(Array.isArray(cookie)).toBe(true);
      const cookieStr = (cookie as string[])[0];
      expect(cookieStr).toContain("cc_session=;");
      expect(cookieStr).toContain("Max-Age=0");
      expect(cookieStr).toContain("HttpOnly");
      expect(cookieStr).toContain("Secure");
      expect(cookieStr).toContain("SameSite=Lax");
    });
  });
});
