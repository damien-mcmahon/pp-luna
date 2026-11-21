# Admin authentication and table permissions

This guide covers the auth-only release. Database CLI setup, baseline migrations, and deployment tooling are delivered separately; merge that database-workflow PR first for the supported CLI rollout. The auth tests also run against the existing manual bootstrap so this PR can be reviewed and built independently.

## Deployment

1. Use Node.js 22 or later. Back up the database and schedule a maintenance window: the old app is incompatible with the new access controls.
2. Follow the database-workflow PR's one-time adoption instructions if SQL was previously applied manually.
3. Once that workflow is merged, run `npm run db:plan`, confirm that `20261120000200_secure_auth.sql` is pending, and run `npm run db:migrate`.
4. Provision an administrator below, deploy the matching app, and recreate active planning tables. Unsigned legacy seat cookies cannot safely prove ownership. The security migration also rotates short legacy invite URLs, retaining old tables/history under new slugs for administrators to remove.
5. Clear old browser demo data if it contains confidential votes. Previously public information cannot be made secret retroactively.

If this security migration was already fully applied manually from the original combined PR (`20261120_secure_auth.sql`), verify all its effects before recording `20261120000200` as applied through the database-workflow guide's history-repair process. Do not mark missing protections as applied or blindly rerun historical SQL.

The historical bootstrap file remains untouched by this auth-only PR; the separate workflow PR replaces it with a migration baseline. **The bootstrap alone does not secure the app.** The security migration removes prototype credentials, public policies, and public Realtime access. Never deploy the secured code against only the legacy schema.

## Provision an administrator

1. In Supabase Authentication, disable **Allow new users to sign up**. This app exposes no public signup route.
2. Use **Authentication → Users → Add user → Create new user** to provision an individual, confirmed email/password account, or use an existing organization-managed Auth account. Deliver a unique strong password through a secure channel. Account provisioning/password recovery are operator-managed in Supabase.
3. Allowlist that user's ID through the SQL editor:

   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where lower(email) = lower('your-admin@example.com')
   on conflict (user_id) do nothing;
   ```

   Confirm a row exists. Merely having an Auth account grants no administrator access; passwords are not stored in this table.
4. Enable TOTP in Supabase Auth's MFA settings. Keep `ADMIN_REQUIRE_MFA=true` (the default). First login at `/admin` enrolls the authenticator via QR code and verifies a six-digit code. Later logins require the code again. AAL1 sessions receive no admin cookies. `ADMIN_REQUIRE_MFA=false` is for local testing; accounts with an enrolled factor still require MFA.
5. Configure strong passwords, breached-password protection where available, Auth rate limits, and HTTPS. Add edge/WAF IP limits to login and public creation/join endpoints. The application additionally allows 10 login/MFA attempts per normalized email per 15 minutes, tracked in the database across app instances.

Database migrations do not automatically configure hosted Auth settings.

## Sessions, revocation, and audit

Every admin request validates the Supabase user, current allowlist membership, and required MFA assurance server-side. Access and refresh tokens use HttpOnly, SameSite=Strict cookies, with Secure and `__Host-` prefixes in production. Refreshes rotate tokens. The browser never stores admin tokens in localStorage/sessionStorage. Cookie-authenticated writes require a matching Origin; private responses disable caching.

Delete an administrator's `public.admin_users` row to revoke access on their next request, even if their Auth token is unexpired. Sign-out revokes the current refresh session. Already-issued access JWTs expire according to Supabase's configured lifetime; keep it short. MFA recovery/reset is an operator action in Supabase.

Renames and deletes are transactionally recorded in `public.admin_audit_log` with actor, action, table, details, and timestamp. Review it alongside Supabase Auth logs.

## Table permissions and vote privacy

- Invite URLs grant access to table details/revealed history, including spectator access. New URLs contain a random UUID; treat them as secrets.
- Hosted creation/join issues a random HttpOnly seat token; only its SHA-256 hash is stored. Editable identity cookies are display preferences, not credentials.
- Participants can change only their own vote. Only the authenticated creator can rename the table, manage seats, edit tasks, reveal cards, or start rounds.
- Explicit actions are validated and serialized transactionally in Postgres. Client snapshots cannot overwrite server state.
- Before reveal, the API returns your own vote and `null` placeholders for other submitted votes. Spectators receive only placeholders. Readiness is public to the room; estimates are not. Votes freeze during the database-enforced countdown.
- Raw table/vote/admin/audit access through browser database roles is revoked and public Realtime feeds are removed. Browsers poll the redacted API every 1.5 seconds.
- Removing a seat invalidates that seat's credentials. Losing the creator cookie requires recreating the table; knowing a participant ID does not recover ownership.
- Offline localStorage mode is an insecure local demo, not a confidentiality or authorization boundary. Admin access requires hosted Auth.

## Validation and remaining requirements

`npm test` uses PGlite for the real security migration and permission rules; it makes no hosted database changes. Tests accept both the original manual schema and the separate CLI migration chain. Supabase Auth itself is mocked in unit tests; validate email/password → MFA enrollment/verification → refresh → logout against staging.

The Supabase SDK is updated. Pre-existing critical/high advisories remain in the Next.js 14 dependency tree; upgrade to a supported, patched framework and re-audit before production exposure. Infrastructure DoS/abuse protection still requires hosting-level controls.
