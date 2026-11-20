const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadModule } = require("./helpers.cjs");
const { privateJson, readJson, sameOrigin } = loadModule("lib/http-security");
const { hashSeatToken, newSeatToken, seatToken, tableForViewer } = loadModule("lib/table-security");

function adminFixture({ user = { id: "admin-id", factors: [] }, member = true, membershipError = null, refreshed = false, mfa = "aal2" } = {}) {
  const token = `header.${Buffer.from(JSON.stringify({ aal: mfa })).toString("base64url")}.signature`;
  let checks = 0;
  const module = loadModule("lib/admin-auth", {
    "@supabase/supabase-js": {
      createClient: () => ({ auth: {
        getUser: async () => ({ data: { user: ++checks === 1 && refreshed ? null : user } }),
        refreshSession: async () => ({ data: { session: { access_token: token, refresh_token: "new-refresh", expires_in: 3600 } } }),
      } }),
    },
    "@/lib/supabase-server": { getSupabaseAdmin: () => ({
      from: () => ({ select: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: member ? { user_id: "admin-id" } : null, error: membershipError }),
      }) }) }),
    }) },
  });
  return { ...module, token };
}

const env = { ...process.env };
test.before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
  delete process.env.ADMIN_REQUIRE_MFA;
});
test.after(() => {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "ADMIN_REQUIRE_MFA"]) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
});

test("legacy fixed admin cookie cannot authenticate", async () => {
  const { withAdmin } = adminFixture({ user: null });
  const response = await withAdmin(new Request("https://vegas.test/api/admin/tables", {
    headers: { cookie: "dealers-choice-admin=admin" },
  }), async () => assert.fail("Protected handler ran"));
  assert.equal(response.status, 401);
});

test("valid Auth user without allowlist membership cannot administer", async () => {
  const { withAdmin, token } = adminFixture({ member: false });
  const response = await withAdmin(new Request("https://vegas.test/api/admin/tables", {
    headers: { cookie: `vegas-admin-access=${token}` },
  }), async () => assert.fail("Protected handler ran"));
  assert.equal(response.status, 403);
});

test("membership lookup failure fails closed", async () => {
  const { withAdmin, token } = adminFixture({ membershipError: new Error("Database unavailable") });
  const response = await withAdmin(new Request("https://vegas.test/api/admin/tables", {
    headers: { cookie: `vegas-admin-access=${token}` },
  }), async () => assert.fail("Protected handler ran"));
  assert.equal(response.status, 503);
});

test("AAL1 token cannot bypass MFA", async () => {
  const { withAdmin, token } = adminFixture({ mfa: "aal1" });
  const response = await withAdmin(new Request("https://vegas.test/api/admin/tables", {
    headers: { cookie: `vegas-admin-access=${token}` },
  }), async () => assert.fail("Protected handler ran"));
  assert.equal(response.status, 403);
});

test("verified administrator can access protected data without caching", async () => {
  const { withAdmin, token } = adminFixture();
  const response = await withAdmin(new Request("https://vegas.test/api/admin/tables", {
    headers: { cookie: `vegas-admin-access=${token}` },
  }), async () => privateJson({ success: true }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("expired access session refreshes and rotates HttpOnly cookies", async () => {
  const { withAdmin, token } = adminFixture({ refreshed: true });
  const response = await withAdmin(new Request("https://vegas.test/api/admin/tables", {
    headers: { cookie: `vegas-admin-access=${token}; vegas-admin-refresh=old-refresh` },
  }), async () => privateJson({ success: true }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(response.headers.get("set-cookie"), /new-refresh/);
});

test("cross-origin admin writes are rejected before authentication", async () => {
  const { withAdmin } = adminFixture();
  const response = await withAdmin(new Request("https://vegas.test/api/admin/tables/room", {
    method: "DELETE", headers: { origin: "https://evil.test" },
  }), async () => assert.fail("Protected handler ran"));
  assert.equal(response.status, 403);
  assert.equal(sameOrigin(new Request("https://vegas.test/api", { method: "POST" })), false);
});

test("seat tokens are unguessable, hashed, and separate from editable identity cookies", () => {
  const first = newSeatToken();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, newSeatToken());
  assert.notEqual(hashSeatToken(first), first);
  assert.equal(seatToken(new Request("https://vegas.test", {
    headers: { cookie: "dealers-choice-seat-room=forged; vegas-seat-room=forged" },
  }), "room"), null);
});

test("unrevealed values are hidden from participants and spectators", () => {
  const table = { currentRound: { revealed: false, votes: { a: 8, b: "XL" } }, history: [] };
  assert.deepEqual(tableForViewer(table, "a").currentRound.votes, { a: 8, b: null });
  assert.deepEqual(tableForViewer(table, null).currentRound.votes, { a: null, b: null });
  assert.deepEqual(table.currentRound.votes, { a: 8, b: "XL" });
  table.currentRound.revealed = true;
  assert.deepEqual(tableForViewer(table, null).currentRound.votes, { a: 8, b: "XL" });
});

test("oversized request bodies are rejected", async () => {
  await assert.rejects(readJson(new Request("https://vegas.test/api", {
    method: "POST", body: JSON.stringify({ value: "a".repeat(20_000) }),
  })), /too large/);
});

test("legacy rename/delete URLs reject the old cookie", async () => {
  const fixture = adminFixture({ user: null });
  const route = loadModule("app/api/tables/[slug]/route", {
    "@/lib/admin-auth": fixture,
  });
  for (const method of ["PATCH", "DELETE"]) {
    const response = await route[method](new Request("https://vegas.test/api/tables/room", {
      method, headers: { origin: "https://vegas.test", cookie: "dealers-choice-admin=admin" },
    }), { params: { slug: "room" } });
    assert.equal(response.status, 401);
  }
});

test("hosted table mutations require explicit actions and a genuine seat cookie", async () => {
  let calls = 0;
  const route = loadModule("app/api/tables/[slug]/route", {
    "@/lib/supabase-server": { getSupabaseAdmin: () => ({ rpc: () => { calls++; } }) },
  });
  const send = (body) => route.PUT(new Request("https://vegas.test/api/tables/room", {
    method: "PUT", headers: { origin: "https://vegas.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: { slug: "room" } });
  assert.equal((await send({ name: "Client snapshot", members: [] })).status, 400);
  assert.equal((await send({ mutation: { type: "rename", name: "Hijacked" } })).status, 401);
  assert.equal(calls, 0);
});
