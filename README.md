# Dealer's Choice

Vegas-inspired realtime planning poker for teams.

## Run locally

```bash
npm install
npm run dev
```

The app works without environment variables. In that mode tables are persisted in `localStorage`, a participant seat is persisted in a table-scoped cookie, and updates are synchronized between tabs with `BroadcastChannel` and storage events.

## Hosted persistence and realtime

The production path uses Supabase Postgres and Supabase Realtime:

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor.
3. Copy `.env.example` to `.env.local` and provide:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

4. Deploy the project to Vercel and add the same variables to the project settings.

The browser subscribes to table, participant, round, and vote changes over Supabase Realtime. API route handlers use the service role only on the server to persist the normalized relational records. The local event/polling layer remains as a safe fallback if hosted configuration is unavailable.

## Product behavior

- Create a named table and choose `Play the hand` or `Deal only`.
- Share `/table/<slug>` with the rest of the room.
- Visitors can either take a seat or watch as a spectator without joining the roster. Spectators see live table state but cannot vote or reveal cards.
- New seats provide a name and optional team. The seat or spectator role is remembered in a cookie for that table on that device.
- Tables support up to 20 seats. Larger rooms use a compact perimeter layout, and revealed hands show every participant in a responsive card grid.
- Fibonacci cards are `1, 2, 3, 5, 8, 13, 21`.
- The creator can deal, remove players, rename the room, copy the invite, and switch between participant and dealer mode.
- Revealing counts down from 3, turns every card face up, and calculates table/team alignment, average score, and session coherence.
- `Replay hand` keeps the task and deals a new vote. `Clear table` deals a new vote and clears the task.
- `/admin` provides the prototype admin console. The seeded access is `admin / admin` as requested; replace this with real identity management before exposing it publicly.

## Checks

```bash
npm run build
```
