/**
 * Tests for TokenAuthAdapter — single-token authentication.
 *
 * Covers: authenticate with/without AUTH_TOKEN, extractToken from three
 * sources (query param, Bearer header, cookie), admin role logic,
 * requireAuth middleware behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { IncomingMessage } from "http";
import { TokenAuthAdapter } from "../auth/token-auth.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function mockReq(opts: {
  url?: string;
  host?: string;
  cookie?: string;
  authorization?: string;
}): IncomingMessage {
  const headers: Record<string, string> = {
    host: opts.host ?? "localhost:3000",
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.authorization) headers.authorization = opts.authorization;
  return {
    url: opts.url ?? "/",
    headers,
  } as unknown as IncomingMessage;
}

// Express-like mock for requireAuth
function mockExpressReq(incomingOpts: Parameters<typeof mockReq>[0] & { accept?: string }): any {
  const inc = mockReq(incomingOpts);
  if (incomingOpts.accept) {
    (inc.headers as any).accept = incomingOpts.accept;
  }
  // Express Request adds originalUrl
  (inc as any).originalUrl = incomingOpts.url ?? "/";
  return inc;
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
  };
  return res;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("TokenAuthAdapter", () => {
  let savedToken: string | undefined;
  let savedAdmins: string | undefined;

  beforeEach(() => {
    savedToken = process.env.AUTH_TOKEN;
    savedAdmins = process.env.ADMIN_USERS;
    delete process.env.AUTH_TOKEN;
    delete process.env.ADMIN_USERS;
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = savedToken;
    if (savedAdmins === undefined) delete process.env.ADMIN_USERS;
    else process.env.ADMIN_USERS = savedAdmins;
  });

  describe("authenticate — no AUTH_TOKEN set", () => {
    it("admits everyone as default admin user", () => {
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(mockReq({}));
      expect(user).not.toBeNull();
      expect(user!.id).toBe("default");
      expect(user!.isAdmin).toBe(true);
    });

    it("admits even requests with no credentials at all", () => {
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(mockReq({ url: "/ws" }));
      expect(user).not.toBeNull();
    });
  });

  describe("authenticate — AUTH_TOKEN set", () => {
    it("rejects request with no token", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      expect(adapter.authenticate(mockReq({}))).toBeNull();
    });

    it("rejects request with wrong token in query param", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      expect(adapter.authenticate(mockReq({ url: "/ws?token=wrong" }))).toBeNull();
    });

    it("accepts correct token in query param", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(mockReq({ url: "/ws?token=my-secret" }));
      expect(user).not.toBeNull();
      expect(user!.id).toBe("default");
    });

    it("accepts correct token in Bearer header", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(
        mockReq({ authorization: "Bearer my-secret" }),
      );
      expect(user).not.toBeNull();
      expect(user!.id).toBe("default");
    });

    it("rejects wrong token in Bearer header", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      expect(
        adapter.authenticate(mockReq({ authorization: "Bearer wrong-token" })),
      ).toBeNull();
    });

    it("accepts correct token in cc_token cookie", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(mockReq({ cookie: "cc_token=my-secret" }));
      expect(user).not.toBeNull();
      expect(user!.id).toBe("default");
    });

    it("rejects wrong token in cookie", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      expect(
        adapter.authenticate(mockReq({ cookie: "cc_token=wrong" })),
      ).toBeNull();
    });

    it("query param takes priority over cookie", () => {
      process.env.AUTH_TOKEN = "my-secret";
      const adapter = new TokenAuthAdapter();
      // Query param has correct token, cookie has wrong
      const user = adapter.authenticate(
        mockReq({ url: "/ws?token=my-secret", cookie: "cc_token=wrong" }),
      );
      expect(user).not.toBeNull();
    });
  });

  describe("admin role", () => {
    it("grants admin when no ADMIN_USERS and token matches", () => {
      process.env.AUTH_TOKEN = "secret";
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(mockReq({ url: "/?token=secret" }));
      expect(user!.isAdmin).toBe(true);
    });

    it("grants admin when ADMIN_USERS includes 'default'", () => {
      process.env.AUTH_TOKEN = "secret";
      process.env.ADMIN_USERS = "default";
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(mockReq({ url: "/?token=secret" }));
      expect(user!.isAdmin).toBe(true);
    });

    it("denies admin when ADMIN_USERS is set but doesn't include 'default'", () => {
      process.env.AUTH_TOKEN = "secret";
      process.env.ADMIN_USERS = "some-other-user";
      const adapter = new TokenAuthAdapter();
      const user = adapter.authenticate(mockReq({ url: "/?token=secret" }));
      expect(user!.isAdmin).toBe(false);
    });
  });

  describe("requireAuth middleware", () => {
    it("calls next() with user attached when authenticated", () => {
      const adapter = new TokenAuthAdapter(); // no AUTH_TOKEN → everyone in
      const req = mockExpressReq({});
      const res = mockRes();
      let nextCalled = false;
      adapter.requireAuth(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe("default");
    });

    it("returns 401 JSON when unauthenticated", () => {
      process.env.AUTH_TOKEN = "secret";
      const adapter = new TokenAuthAdapter();
      const req = mockExpressReq({ url: "/api/something" });
      const res = mockRes();
      let nextCalled = false;
      adapter.requireAuth(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
    });
  });

  describe("setupRoutes", () => {
    it("is a no-op (token auth needs no login routes)", () => {
      const adapter = new TokenAuthAdapter();
      const app = {} as any;
      // Should not throw
      adapter.setupRoutes(app);
    });
  });
});
