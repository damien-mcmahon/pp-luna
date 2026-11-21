# Vegas

Vegas-inspired realtime planning poker for teams.

## Run locally

Use Node.js 22 or later.

```bash
npm install
npm run dev
```

The app works without environment variables as a **local demo only**. Tables and votes are persisted in `localStorage`, and tabs synchronize with `BroadcastChannel` and storage events. This is not a security boundary; do not use it for confidential votes. Admin access is disabled without hosted authentication.

## Hosted persistence

The production path uses Supabase Postgres and Supabase Auth:

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor.
3. Copy `.env.example` to `.env.local` and provide:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ADMIN_REQUIRE_MFA=true
   ```

4. Deploy the project to Vercel and add the same variables to the project settings.

Hosted browsers poll a non-cacheable, redacted API every 1.5 seconds instead of subscribing to public Postgres changes. Raw table/vote reads are restricted to the server, other players' unrevealed estimates are hidden, and mutations require an authenticated seat. Hosted failures never authorize a local snapshot.

For an existing Supabase project, run [`supabase/migrations/20261120_t_shirt_sizes.sql`](./supabase/migrations/20261120_t_shirt_sizes.sql) before deploying this version. New projects already include these changes in `schema.sql`.

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
- `/admin` uses Supabase Auth, MFA, and an explicit administrator allowlist. There is no shared admin password.

## Checks

```bash
npm test
npm run build
```

## Admin authentication rollout

Follow [the admin-auth guide](./docs/admin-auth.md) before exposing this version. The separate database-workflow PR supplies CLI configuration, the baseline, and `db:migrate`; this PR supplies only the subsequent security migration and authentication/permission changes. Deployments must apply the security migration before running the secured app.

Existing unsigned seats must be recreated; short legacy invite links are rotated. Admin provisioning and a staging test of the complete Auth/MFA flow are required. Existing critical/high Next.js advisories still need a separate supported-framework upgrade before production exposure.
