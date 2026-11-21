# Database migrations

The `supabase` npm script pins CLI version 3.2.0 and downloads/caches it on first use through `npx`. CLI tooling is not added to the app's build dependencies; the first CLI invocation needs network access. All `db:*` commands use that pinned script. SQL in `migrations/` is the single source of truth; there is no separate `schema.sql` bootstrap step.

Only the historical baseline and T-shirt migrations are introduced by this workflow-only change. The baseline preserves the pre-auth prototype admin and public Realtime behavior for compatibility. Authentication, seat ownership, invite rotation, and security migrations belong to the separate admin-auth PR; once those later migrations are present, the same `db:migrate` command applies them too.

## Empty hosted project

```bash
npm run db:login
npm run db:link -- --project-ref YOUR_PROJECT_REF
npm run db:history
npm run db:plan
npm run db:migrate
```

Find the project reference in its dashboard URL/settings. Verify the intended environment before confirming a push. A service-role API key is not a database password or CLI management access token.

`db:migrate` explicitly targets the linked hosted project (`--remote`), skips vault synchronization, and asks for confirmation. It applies pending files in order, records successful versions in `supabase_migrations.schema_migrations`, and skips those versions on later runs. Hosted migration commands do not require Docker.

Linking is per checkout/machine and writes ignored `.temp/` files. No hosted reference or credentials are committed. `config.toml` contains local defaults; database pushes do not configure hosted Auth settings.

## Existing database: one-time adoption

Back up the database, verify the linked target, and inspect both schema and `npm run db:history` before repairing history. History repair records completed SQL; it neither executes that SQL nor verifies its effects.

1. Compare the schema against the migrations. A read-only inventory can help:

   ```bash
   npm run supabase -- db query --remote --read-only \
     "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name in ('tables', 'participants', 'rounds', 'votes', 'admin_users') order by table_name, ordinal_position"
   ```

   Also inspect constraints, indexes, policies, grants, publications, and data changes. If a manual application was incomplete or the schema has diverged, stop and reconcile it rather than guessing.
2. Record only versions whose complete effects already exist:

   | Version | Meaning |
   | --- | --- |
   | `20261120000000` | Original Fibonacci relational tables, constraints, RLS, prototype admin table, and public Realtime/read policies. Later deck additions are fine. |
   | `20261120000100` | `tables.deck` and its allowed-deck constraint; text vote values allowing Fibonacci and all six T-shirt sizes. A database bootstrapped from the later `schema.sql` may already include both versions' effects. |

   **Original Fibonacci-only database:**

   ```bash
   npm run supabase -- migration repair --remote --status applied 20261120000000
   ```

   **Original schema plus T-shirt Sizes already applied:**

   ```bash
   npm run supabase -- migration repair --remote --status applied 20261120000000 20261120000100
   ```

   These are alternatives, not a sequence to copy wholesale. Do not mark genuinely pending SQL as applied to bypass errors.
3. If a previous CLI run recorded the old T-shirt version `20261120`, first confirm which SQL completed, record its matching new version above, then remove only that obsolete history row:

   ```bash
   npm run supabase -- migration repair --remote --status reverted 20261120
   ```

   This changes history only, not database effects. Do not remove unrelated history. If another feature used that same old version or unknown remote-only versions exist, resolve their provenance first.
4. Run `npm run db:history` and `npm run db:plan`. Confirm that only missing migrations are pending, then run `npm run db:migrate`.

Do not restore old prototype policies/admin rows into a database that has already been secured. If later feature migrations were manually applied, follow that feature's reconciliation instructions as well; a baseline records historical schema, not a requirement to undo later upgrades.

## Everyday workflow

```bash
npm run db:new -- add_your_feature
# Edit supabase/migrations/<unique_timestamp>_add_your_feature.sql.
npm test
npm run build
npm run db:plan
npm run db:migrate
# Deploy the compatible app.
```

Use unique 14-digit UTC versions. Do not rename or edit CLI-deployed migrations; add corrective migrations instead. The timestamp normalization here is a one-time adoption from manually applied files.

Prefer additive, backwards-compatible changes. Breaking migrations require a coordinated maintenance window. Builds and previews must never migrate production.

## Optional local database development

Docker is required for the complete local stack:

```bash
npm run supabase -- start
npm run supabase -- db reset
```

The pinned CLI resets the local stack by default, destroying local test data and replaying the migration chain. Never add `--remote` to reset a shared database. Match `db.major_version` to your project if needed for local parity.

`npm test` uses PGlite to check fresh setup and the legacy Fibonacci-to-T-shirt upgrade without Docker, a project link, or hosted credentials. It does not replace staging tests against the complete Supabase services.

## Credentials and future CI

For unattended commands, provide `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` through protected CI secrets or a secret manager, not committed files or command-line arguments. They differ from the application's anon/service-role keys. Next.js `.env.local` is not CLI configuration.

This PR does not enable automatic hosted migrations. A future deployment workflow should run tests/build without secrets, require environment approval, load the selected environment's `SUPABASE_PROJECT_REF` and credentials, link that project, review `db:plan`, run `npm run db:migrate -- --yes`, and deploy the compatible app.

Serialize deployments per database. Use separate staging/production credentials; arbitrary PR and preview jobs must not receive production secrets.
