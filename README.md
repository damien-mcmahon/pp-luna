# Vegas

Vegas-inspired realtime planning poker for teams.

## Run locally

Use Node.js 22 or later.

```bash
npm install
npm run dev
```

The app works without environment variables as a **local demo only**. Tables and votes are persisted in `localStorage`, and tabs synchronize with `BroadcastChannel` and storage events. This mode is not a security boundary; do not use it for confidential votes. Admin access is disabled without hosted authentication.

## Hosted persistence

The production path uses Supabase Postgres and Supabase Auth:

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](./supabase/schema.sql), then [`supabase/migrations/20261120_secure_auth.sql`](./supabase/migrations/20261120_secure_auth.sql) in the SQL editor.
3. Copy `.env.example` to `.env.local` and provide:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
    ADMIN_REQUIRE_MFA=true
   ```

4. Deploy the project to Vercel and add the same variables to the project settings.

Hosted browsers poll a non-cacheable, redacted table API every 1.5 seconds. Raw tables, participants, rounds, votes, admin membership, and audit records cannot be read through the anon/authenticated database roles. Public Postgres Realtime feeds are disabled to avoid leaking vote values. The service role key stays on the server. Hosted mutations fail closed; they never fall back to authorizing a local snapshot.

### Upgrading an existing project

1. Back up the database and schedule a short maintenance window. The old app is incompatible with the new access controls.
2. Apply [`20261120_t_shirt_sizes.sql`](./supabase/migrations/20261120_t_shirt_sizes.sql) **only if not already applied**.
3. Apply [`20261120_secure_auth.sql`](./supabase/migrations/20261120_secure_auth.sql), provision an administrator below, then deploy the matching code.
4. Recreate active planning tables and share their new invite links. Existing unsigned seat cookies cannot safely prove ownership and are deliberately not upgraded. The migration also rotates short legacy invite URLs; old links stop working. Old tables/history remain in the database under their new slugs and can be removed by an administrator.
5. Clear old browser demo data if it contains confidential votes. Previously public data cannot be made secret retroactively.

## Administrator setup

1. In Supabase Authentication, disable **Allow new users to sign up**. There is no public signup route or shared admin password in this app.
2. Use **Authentication → Users → Add user → Create new user** to provision an individual, confirmed email/password account (or use an existing organization-managed Auth account). Deliver a unique strong password through a secure channel. Account provisioning and password recovery are operator-managed in Supabase, not exposed by this console.
3. Add that user's ID to the administrator allowlist using the SQL editor:

   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where lower(email) = lower('your-admin@example.com')
   on conflict (user_id) do nothing;
   ```

   Confirm that the row was inserted. Auth accounts are **not** administrators unless explicitly allowlisted. No passwords are stored in `public.admin_users`.
4. Enable TOTP in Supabase Auth's MFA settings. Keep `ADMIN_REQUIRE_MFA=true` (the default). On first login at `/admin`, scan the enrollment QR code and verify the authenticator code. Later logins require the code again. Admin session cookies are not issued at AAL1. `ADMIN_REQUIRE_MFA=false` is available for local testing; accounts with an enrolled factor still require MFA.
5. Configure Supabase password policy, breached-password protection where available, Auth rate limits, and production HTTPS. Add edge/WAF IP limits to `/api/admin/login` and the public table creation/join endpoints; the app additionally enforces a shared database-backed limit of 10 login/MFA attempts per normalized email per 15 minutes.

Every admin request validates the Supabase user, current allowlist membership, and required MFA assurance server-side. Access and refresh tokens use HttpOnly, SameSite=Strict cookies (Secure and `__Host-` prefixed in production), with refresh rotation and server-side sign-out. The browser never stores admin tokens in `localStorage` or `sessionStorage`. Cookie-authenticated writes require a matching Origin. All private responses disable caching.

To revoke an administrator, delete their `public.admin_users` row; the next request is rejected even if their Auth token remains valid. Sign-out revokes the current refresh session; like other JWT systems, already-issued access tokens expire according to the configured Supabase JWT lifetime. Keep that lifetime short. Admin renames and deletes are transactionally recorded in `public.admin_audit_log` with actor, action, table, details, and timestamp. Review this log and Supabase Auth logs regularly. MFA recovery/reset is an operator action in Supabase.

### Table permissions and vote privacy

- A private invite URL grants access to table details and revealed history, including spectator access. New links contain a random UUID; treat links as secrets, not public URLs.
- Creating or joining a hosted table issues an unguessable HttpOnly seat token; only its SHA-256 hash is stored in the database. Editable participant identity cookies are display preferences, not credentials.
- Participants can change only their own vote. Only the authenticated creator can rename the table, manage seats, edit tasks, start/finish reveals, and start rounds. All mutations are explicit actions validated and serialized transactionally in Postgres; arbitrary client snapshots cannot overwrite table state.
- Before reveal, the API returns your own vote value and only `null` placeholders for other submitted votes. Spectators receive placeholders for every submitted vote. Everyone can see readiness, but not another player's estimate. Votes freeze during the reveal countdown, which is checked by the database.
- Removing a seat invalidates its token. Losing a creator's seat cookie requires recreating the table; knowing a participant ID cannot recover or impersonate that seat.

### Remaining production requirement

`npm audit --omit=dev` reports pre-existing critical/high advisories in the current Next.js 14 dependency tree. This change updates the Supabase SDK, but deliberately does not perform a breaking framework migration. **Upgrade to a supported, patched Next.js release and re-audit before production exposure.** Apply hosting-level abuse protection as described above; application authentication alone does not mitigate infrastructure DoS.

## Product behavior

- Create a named table and choose `Play the hand` or `Deal only`.
- Share `/table/<slug>` with the rest of the room.
- Visitors can either take a seat or watch as a spectator without joining the roster. Spectators see live table state but cannot vote or reveal cards.
- New seats provide a name and optional team. The seat or spectator role is remembered in a cookie for that table on that device.
- Tables support up to 20 seats. Larger rooms use a compact perimeter layout, and revealed hands show every participant in a responsive card grid.
- Fibonacci cards are `1, 2, 3, 5, 8, 13, 21`.
- Choose Fibonacci (the default) or T-shirt Sizes when creating a table. T-shirt Sizes cards are `XS, S, M, L, XL, XXL`; reveals show the most common size (all tied sizes when applicable) instead of a numeric average.
- The creator can deal, remove players, rename the room, copy the invite, and switch between participant and dealer mode.
- Revealing counts down from 3, turns every card face up, and calculates table/team alignment, average score, and session coherence.
- `Replay hand` keeps the task and deals a new vote. `Clear table` deals a new vote and clears the task.
- `/admin` is invite-only, backed by Supabase Auth and a server-side administrator allowlist.

## Checks

```bash
npm test
npm run build
```

Tests include a local Postgres-compatible PGlite instance that applies the real security migration and checks browser-role isolation, forged seat credentials, creator-only actions, reveal countdown enforcement, admin audit records, and login throttling. Auth unit tests mock Supabase; test the complete email/password → MFA enrollment/verification → refresh → logout flow against a staging Supabase project before deploying. No production database changes are made by the test suite.
