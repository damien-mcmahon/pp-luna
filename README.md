# Vegas

Vegas-inspired realtime planning poker for teams.

## Run locally

Use Node.js 22 or later.

```bash
npm install
npm run dev
```

The app works without environment variables. In that mode tables are persisted in `localStorage`, a participant seat is persisted in a table-scoped cookie, and updates are synchronized between tabs with `BroadcastChannel` and storage events.

## Hosted persistence and realtime

The production path uses Supabase Postgres and Supabase Realtime:

1. Create a Supabase project.
2. For an **empty** project, install dependencies and run:

   ```bash
   npm run db:login
   npm run db:link -- --project-ref YOUR_PROJECT_REF
   npm run db:plan
   npm run db:migrate
   ```
3. Copy `.env.example` to `.env.local` and provide:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

4. Deploy the project to Vercel and add the same variables to the project settings.

The browser subscribes to table, participant, round, and vote changes over Supabase Realtime. API route handlers use the service role only on the server to persist the normalized relational records. The local event/polling layer remains as a safe fallback if hosted configuration is unavailable.

**Existing database:** follow the [one-time CLI adoption guide](./supabase/README.md#existing-database-one-time-adoption) before pushing. SQL already applied manually must not be blindly rerun.

### Database workflow

```bash
npm run db:new -- describe_your_change
# Edit the generated timestamped SQL migration.
npm test
npm run db:plan
npm run db:migrate
```

Supabase tracks applied versions and skips them on later pushes. The migration chain replaces the separate bootstrap SQL file. `npm run build` stays database-independent: migrations are a deliberate deployment step, never part of a Vercel build or preview. See [the database guide](./supabase/README.md) for local development, credentials, and future CI automation.

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
- `/admin` provides the prototype admin console. The seeded access is `admin / admin` as requested; replace this with real identity management before exposing it publicly.

## Checks

```bash
npm test
npm run build
```
