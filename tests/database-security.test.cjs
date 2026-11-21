const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

test("security migration and transactional permissions", async (t) => {
  const db = new PGlite();
  const read = (name) => readFileSync(path.join(__dirname, "..", name), "utf8");
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create publication supabase_realtime;
    `);
    // The auth PR runs against today's manual bootstrap as well as the separate
    // CLI workflow's migration chain, so both PRs can be validated independently.
    if (existsSync(path.join(__dirname, "..", "supabase/schema.sql"))) {
      await db.exec(read("supabase/schema.sql"));
    } else {
      const directory = path.join(__dirname, "..", "supabase/migrations");
      for (const file of readdirSync(directory).filter((file) =>
        file.endsWith(".sql") && file < "20261120000200_secure_auth.sql").sort()) {
        await db.exec(read(`supabase/migrations/${file}`));
      }
    }
    // Exercise an actual upgrade from the old plaintext credential table.
    await db.exec(`drop table public.admin_users; create table public.admin_users(username text primary key, password text not null);
      insert into public.admin_users values ('admin','admin');
      drop policy if exists "public can read votes" on public.votes;
      create policy "public can read votes" on public.votes for select using (true);
      insert into public.tables(id,slug,name,creator_id) values ('legacy','legacy-abc12','Legacy','old-creator');`);
    await db.exec(read("supabase/migrations/20261120000200_secure_auth.sql"));
    assert.match((await db.query("select slug from public.tables where id='legacy'")).rows[0].slug, /^legacy-abc12-[a-f0-9]{32}$/);
    await db.exec("delete from public.tables where id='legacy'");

    const creatorHash = "a".repeat(64);
    const playerHash = "b".repeat(64);
    const outsiderHash = "c".repeat(64);
    const create = (id, creatorId = `${id}-creator`) => db.query(
      "select public.create_planning_table($1::jsonb, $2)", [JSON.stringify({
        id, slug: id, name: "Security test", deck: "fibonacci", creatorId, creatorName: "Dealer", isDealer: false, roundId: `${id}-round`,
      }), creatorHash]);
    const mutate = (action, payload, hash = creatorHash) => db.query(
      "select public.mutate_planning_table('room', $1, $2, $3::jsonb)", [hash, action, JSON.stringify(payload)]);

    await t.test("raw database reads and RPC execution are denied to browsers", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        for (const table of ["tables", "participants", "rounds", "votes", "admin_users", "admin_audit_log", "admin_login_attempts"]) {
          await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
        }
        await assert.rejects(db.query("select public.consume_admin_login_attempt('key')"), /permission denied/);
        await assert.rejects(db.query("select public.admin_mutate_table(null,'room','delete')"), /permission denied/);
        await assert.rejects(db.query("select public.mutate_planning_table('room','token','join','{}')"), /permission denied/);
        await db.exec("reset role");
      }
    });

    await db.exec("set role service_role");
    await create("room");

    await t.test("table creation cannot overwrite existing IDs", async () => {
      await assert.rejects(create("room"), /duplicate key/);
      await assert.rejects(create("other-room", "room-creator"), /duplicate key/);
      assert.equal((await db.query("select count(*)::int as count from public.tables")).rows[0].count, 1);
    });

    await t.test("joining cannot grant creator or dealer privileges", async () => {
      await mutate("join", { participant: { id: "player", name: "Player", team: "", isCreator: true, isDealer: true } }, playerHash);
      const player = (await db.query("select is_creator, is_dealer from public.participants where id='player'")).rows[0];
      assert.deepEqual(player, { is_creator: false, is_dealer: false });
      await assert.rejects(mutate("rename", { name: "Hijacked" }, playerHash), /Creator access required/);
      await assert.rejects(mutate("role", { isDealer: true }, playerHash), /Creator access required/);
    });

    await t.test("forged or missing seat credentials cannot mutate the room", async () => {
      await assert.rejects(mutate("rename", { name: "Hijacked" }, outsiderHash), /Seat required/);
      await assert.rejects(mutate("vote", { roundId: "room-round", participantId: "room-creator", value: 8 }, playerHash), /Vote not allowed/);
      await assert.rejects(mutate("vote", { roundId: "room-round", participantId: "player", value: "XL" }, playerHash), /Invalid card/);
      await assert.rejects(mutate("vote", { roundId: "old-round", participantId: "player", value: 8 }, playerHash), /Stale round/);
    });

    await t.test("reveal checks readiness, freezes votes, and enforces countdown", async () => {
      await mutate("vote", { roundId: "room-round", participantId: "room-creator", value: 8 });
      await assert.rejects(mutate("start-reveal", { roundId: "room-round" }), /Waiting for votes/);
      await mutate("vote", { roundId: "room-round", participantId: "player", value: 5 }, playerHash);
      await mutate("start-reveal", { roundId: "room-round" });
      await assert.rejects(mutate("finish-reveal", { roundId: "room-round" }), /countdown not finished/);
      await assert.rejects(mutate("vote", { roundId: "room-round", participantId: "player", value: 13 }, playerHash), /Vote not allowed/);
      await db.query("update public.rounds set reveal_started_at = now() - interval '3 seconds'");
      await mutate("finish-reveal", { roundId: "room-round" });
      await assert.rejects(mutate("vote", { roundId: "room-round", participantId: "player", value: null }, playerHash), /Vote not allowed/);
      await mutate("next-round", { roundId: "room-round", nextRoundId: "round-2", clearTask: true });
    });

    await t.test("admin mutations recheck allowlist and atomically write audit records", async () => {
      const adminId = "11111111-1111-4111-8111-111111111111";
      await assert.rejects(db.query("select public.admin_mutate_table($1,'room','delete')", [adminId]), /Administrator access required/);
      await db.exec("reset role");
      await db.query("insert into auth.users(id) values ($1)", [adminId]);
      await db.exec("set role service_role");
      await db.query("insert into public.admin_users(user_id) values ($1)", [adminId]);
      await db.query("select public.admin_mutate_table($1,'room','rename','Renamed')", [adminId]);
      await db.query("select public.admin_mutate_table($1,'room','delete')", [adminId]);
      const log = (await db.query("select action, actor_id from public.admin_audit_log order by id")).rows;
      assert.deepEqual(log, [{ action: "rename", actor_id: adminId }, { action: "delete", actor_id: adminId }]);
    });

    await t.test("login throttling persists across requests and resets after its window", async () => {
      for (let index = 0; index < 10; index++) {
        assert.equal((await db.query("select public.consume_admin_login_attempt('email-hash') as allowed")).rows[0].allowed, true);
      }
      assert.equal((await db.query("select public.consume_admin_login_attempt('email-hash') as allowed")).rows[0].allowed, false);
      await db.query("update public.admin_login_attempts set started_at = now() - interval '16 minutes'");
      assert.equal((await db.query("select public.consume_admin_login_attempt('email-hash') as allowed")).rows[0].allowed, true);
    });

    await t.test("T-shirt votes remain valid after the auth migration", async () => {
      await create("shirts");
      await db.query("update public.tables set deck='t-shirt-sizes' where id='shirts'");
      await db.query("select public.mutate_planning_table('shirts',$1,'vote',$2::jsonb)", [
        creatorHash, JSON.stringify({ roundId: "shirts-round", participantId: "shirts-creator", value: "XXL" }),
      ]);
      assert.equal((await db.query("select value from public.votes where table_id='shirts'")).rows[0].value, "XXL");
    });
  } finally {
    await db.close();
  }
});
