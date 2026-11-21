const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadModule } = require("./helpers.cjs");
const realAuth = loadModule("lib/admin-auth");

function fixture({ allowed = true, rateAllowed = true, codeValid = true, existingFactor = true } = {}) {
  const token = (aal) => `header.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.signature`;
  let session = { access_token: token("aal1"), refresh_token: "refresh-secret", expires_in: 3600 };
  const user = { id: "admin-id", factors: [] };
  let signIns = 0;
  const auth = { auth: {
    signInWithPassword: async () => {
      signIns++;
      return { data: { session, user }, error: null };
    },
    signOut: async () => ({}),
    getSession: async () => ({ data: { session } }),
    mfa: {
      listFactors: async () => ({ data: { totp: existingFactor ? [{ id: "factor-id", status: "verified" }] : [], all: [] } }),
      enroll: async () => ({ data: { id: "new-factor", type: "totp", totp: { qr_code: "<svg></svg>" } } }),
      challenge: async () => ({ data: { id: "challenge-id" } }),
      verify: async () => {
        if (codeValid) session = { ...session, access_token: token("aal2") };
        return { error: codeValid ? null : new Error("Bad code") };
      },
    },
  } };
  const route = loadModule("app/api/admin/login/route", {
    "@/lib/admin-auth": { ...realAuth, getAuthClient: () => auth, adminAllowed: async () => allowed },
    "@/lib/supabase-server": { getSupabaseAdmin: () => ({
      rpc: async (_name, args) => {
        assert.match(args.p_key, /^[a-f0-9]{64}$/);
        return { data: rateAllowed, error: null };
      },
    }) },
  });
  const login = (extra = {}, origin = "https://vegas.test") => route.POST(new Request("https://vegas.test/api/admin/login", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.test", password: "strong-password", ...extra }),
  }));
  return { login, signIns: () => signIns };
}

test("login with a valid password still requires admin membership", async () => {
  const { login } = fixture({ allowed: false });
  const response = await login();
  assert.equal(response.status, 401);
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /refresh-secret/);
});

test("MFA enrollment happens only after password and allowlist checks", async () => {
  const { login } = fixture({ existingFactor: false });
  const response = await login();
  assert.equal(response.status, 403);
  const data = await response.json();
  assert.equal(data.enrollment.factorId, "new-factor");
  assert.equal(data.mfaRequired, true);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(data.access_token, undefined);
});

test("existing MFA factor requires a six-digit code and issues no cookies beforehand", async () => {
  const { login } = fixture();
  const response = await login();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).mfaRequired, true);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("failed MFA verification issues no admin session", async () => {
  const { login } = fixture({ codeValid: false });
  const response = await login({ code: "000000" });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("successful MFA verification issues HttpOnly cookies, never JSON tokens", async () => {
  const { login } = fixture();
  const response = await login({ code: "123456" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=strict/i);
  assert.deepEqual(await response.json(), { authenticated: true });
});

test("database rate limit stops password/MFA attempts before contacting Auth", async () => {
  const instance = fixture({ rateAllowed: false });
  assert.equal((await instance.login()).status, 429);
  assert.equal(instance.signIns(), 0);
});

test("cross-origin login cannot create a session or enroll a factor", async () => {
  const instance = fixture();
  assert.equal((await instance.login({}, "https://evil.test")).status, 403);
  assert.equal(instance.signIns(), 0);
});
