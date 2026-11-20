# Database migrations

The pinned Supabase CLI is installed by `npm ci` / `npm install`. SQL in `migrations/` is the single source of truth; there is no separate `schema.sql` bootstrap step.

## Empty hosted project

```bash
npm run db:login
npm run db:link -- --project-ref YOUR_PROJECT_REF
npm run db:history
npm run db:plan
npm run db:migrate
```

Find the project reference in its dashboard URL/settings. Check that it is the intended environment before confirming a push. The CLI prompts for credentials as needed; a service-role API key is **not** the database password or CLI access token.

`db:migrate` explicitly targets the linked hosted project (`--remote`) and skips vault synchronization. It applies pending SQL files in order and records each successful version in `supabase_migrations.schema_migrations`. The CLI asks for confirmation before hosted changes. Repeating the command skips already-applied migrations. Hosted migration commands do not require Docker.

Linking is per checkout/machine and writes ignored files under `.temp/`; no hosted project reference, database password, or access token is committed. `config.toml` contains local defaults only. Linking/pushing migrations does **not** push local Auth settings into production; configure hosted Auth separately as described in the main README.

## Existing database: one-time adoption

Do this once per environment if you previously pasted SQL into the dashboard. **Back up the database, verify the target, and inspect its schema and migration history before repairing anything.** Do not run the empty-project instructions blindly against an existing database.

1. Log in, link the intended project, then run `npm run db:history`.
2. Compare its existing schema with the checked-in SQL. A read-only inventory can help:

   ```bash
   npx supabase db query --remote --read-only \
     "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name in ('tables', 'participants', 'rounds', 'votes', 'admin_users') order by table_name, ordinal_position"
   ```

   The inventory is not a complete schema comparison: inspect constraints, RLS/grants, functions, indexes, and the records affected by a migration too. If the schema has diverged or a manual application was incomplete, stop and reconcile that difference; do not guess which migrations ran.
3. Record **only the migrations whose complete effects already exist** using the matching commands below. `migration repair --status applied` changes history only; it does not execute SQL, verify the schema, or apply missing security protections.

   | Version | Meaning / evidence required |
   | --- | --- |
   | `20261120000000` | Original relational tables (`tables`, `participants`, `rounds`, `votes`) and their baseline columns, constraints and RLS exist. Later deck/auth additions are fine. The baseline does not seed any admin account. |
   | `20261120000100` | `tables.deck` and its allowed-deck constraint exist; `votes.value` is text and permits both Fibonacci values and all six T-shirt sizes. This includes databases bootstrapped from the later `schema.sql` that already contained these changes. |
   | `20261120000200` | The complete former `20261120_secure_auth.sql` was successfully applied: UUID-based admin membership, seat-token hashes/index, private grants/RLS, service-only action functions, audit/throttling tables, removal of public Realtime feeds, and legacy invite rotation. Merely having an `admin_users` table is not sufficient. |

   **Example: original Fibonacci-only database, no T-shirt migration yet:**

   ```bash
   npx supabase migration repair --remote --status applied 20261120000000
   ```

   **Example: original schema plus T-shirt Sizes already applied, auth not applied yet:**

   ```bash
   npx supabase migration repair --remote --status applied 20261120000000 20261120000100
   ```

   **Only if all three migrations' effects already exist**, record all three:

   ```bash
   npx supabase migration repair --remote --status applied 20261120000000 20261120000100 20261120000200
   ```

   These are alternative examples, not a sequence to copy wholesale. Do not mark pending migrations as applied just to bypass an error.

4. If the history already contains the old shared version `20261120`, identify exactly which old SQL completed before changing its history. Both old migration filenames used that same version, so it cannot unambiguously represent both. After verifying the completed effects and recording their new versions, remove **only that obsolete history entry**:

   ```bash
   npx supabase migration repair --remote --status reverted 20261120
   ```

   This removes the old history row, not its SQL effects. Do not revert unrelated migration history. If any other remote-only versions exist, resolve their provenance before proceeding.
5. Run `npm run db:history` and `npm run db:plan`. Confirm that only genuinely missing migrations are pending, then run `npm run db:migrate` during the planned deployment window.

For this auth release, the migration intentionally retires unsigned seats and rotates short invite URLs. Recreate active planning tables and provision an administrator before reopening the app. CLI adoption does not remove that one-time product compatibility requirement.

## Everyday workflow

```bash
npm run db:new -- add_your_feature
# Edit the generated supabase/migrations/<unique_timestamp>_add_your_feature.sql.
npm test
npm run build
npm run db:plan
npm run db:migrate
# Deploy the compatible app version.
```

Use unique 14-digit UTC timestamp versions. Once a migration has been deployed through the CLI, do not rename or edit it; create a new corrective migration instead. The initial version normalization in this PR is a one-time transition from manually applied files.

Test on staging first. Prefer backwards-compatible additive changes, deploy the consuming app next, and remove old structures in a later migration. Breaking migrations need a maintenance window. Builds and preview deployments must never run production migrations.

## Local database development (optional)

Docker is needed for the full local Supabase stack, but not for `npm test` (which uses PGlite):

```bash
npx supabase start
npx supabase db reset
```

With the pinned CLI, reset targets the **local** stack by default and recreates it from the full migration chain. It destroys local test data. **Never add `--remote` to reset a shared/staging/production database.** Local Auth disables signups and enables TOTP; create local test admins through Studio and the allowlist.

`npm test` validates both fresh setup and a legacy-schema upgrade without requiring Docker, login, a project link, or hosted credentials. It does not replace a staging test against the complete Supabase services.

## Credentials and future CI

For unattended commands, the CLI supports `SUPABASE_ACCESS_TOKEN` (a personal/scoped management token) and `SUPABASE_DB_PASSWORD`. Export them from a secret manager or CI secrets, never committed files or command-line arguments. They are distinct from the application's anon/service-role keys. The CLI does not read Next.js `.env.local` as application configuration.

This PR does not automatically migrate any hosted project. A future deployment workflow can:

1. Run tests/build without database secrets.
2. Require approval for the selected deployment environment.
3. Read that environment's `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and `SUPABASE_DB_PASSWORD` from protected CI configuration.
4. Link that project, review the migration plan, then run `npm run db:migrate -- --yes`.
5. Deploy the matching app release.

Serialize deployments per database so concurrent jobs cannot race. Use separate staging/production links and credentials; never give arbitrary PR/preview jobs production database secrets.
