const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

const directory = path.join(__dirname, "..", "supabase", "migrations");
const migrations = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
const sql = (name) => readFileSync(path.join(directory, name), "utf8");

async function database() {
  const db = new PGlite();
  // Supabase provides these platform objects; the migrations must not recreate them.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create publication supabase_realtime;
  `);
  return db;
}

test("migration files have unique ordered timestamp versions", () => {
  assert.ok(migrations.length >= 2);
  for (const file of migrations) assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/);
  assert.equal(new Set(migrations.map((file) => file.split("_")[0])).size, migrations.length);
});

test("fresh database setup uses only the ordered migration chain", async () => {
  const db = await database();
  try {
    for (const file of migrations) await db.exec(sql(file));
    assert.equal((await db.query("select data_type from information_schema.columns where table_schema='public' and table_name='votes' and column_name='value'")).rows[0].data_type, "text");
    assert.equal((await db.query("select column_default from information_schema.columns where table_schema='public' and table_name='tables' and column_name='deck'")).rows[0].column_default, "'fibonacci'::text");
    for (const table of ["tables", "participants", "rounds", "votes", "admin_users"]) {
      assert.ok((await db.query("select to_regclass($1) as relation", [`public.${table}`])).rows[0].relation);
    }
  } finally {
    await db.close();
  }
});

test("T-shirt upgrade preserves existing Fibonacci data", async () => {
  const db = await database();
  try {
    await db.exec(sql("20261120000000_initial_schema.sql"));
    await db.exec(`
      insert into public.tables(id,slug,name,creator_id) values ('t','old-link','Existing','p');
      insert into public.participants(id,table_id,name,is_creator) values ('p','t','Player',true);
      insert into public.rounds(id,table_id,round_number) values ('r','t',1);
      insert into public.votes(table_id,round_id,participant_id,value) values ('t','r','p',8);
    `);
    await db.exec(sql("20261120000100_t_shirt_sizes.sql"));
    assert.equal((await db.query("select value from public.votes")).rows[0].value, "8");
    assert.equal((await db.query("select slug,deck from public.tables")).rows[0].slug, "old-link");
    assert.equal((await db.query("select deck from public.tables")).rows[0].deck, "fibonacci");
    await db.query("update public.tables set deck='t-shirt-sizes'");
    await db.query("update public.votes set value='XXL'");
    assert.equal((await db.query("select value from public.votes")).rows[0].value, "XXL");
  } finally {
    await db.close();
  }
});
