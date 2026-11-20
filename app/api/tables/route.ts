import { getSupabaseAdmin } from "@/lib/supabase-server";
import { loadTableFromSupabase } from "@/lib/server-tables";
import { hashSeatToken, newSeatToken, setSeatCookie } from "@/lib/table-security";
import { privateJson, readJson, sameOrigin } from "@/lib/http-security";
import { DECKS } from "@/lib/types";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return privateJson({ error: "Invalid origin." }, 403);
  const client = getSupabaseAdmin();
  if (!client) return privateJson({ error: "Hosted persistence is not configured." }, 503);
  try {
    const body = await readJson(request);
    const creator = body.members?.[0];
    const validId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
    if (!validId(body.id) || !validId(body.slug) || !validId(creator?.id) || !validId(body.currentRound?.id) ||
        typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 ||
        typeof creator.name !== "string" || !creator.name.trim() || creator.name.length > 80 ||
        !/^[a-z0-9-]+-[a-f0-9]{32}$/.test(body.slug) ||
        !Object.hasOwn(DECKS, body.deck ?? "fibonacci")) {
      return privateJson({ error: "Invalid table details." }, 400);
    }
    const token = newSeatToken();
    const result = await client.rpc("create_planning_table", {
      p_table: { id: body.id, slug: body.slug, name: body.name.trim(), deck: body.deck ?? "fibonacci",
        creatorId: creator.id, creatorName: creator.name.trim(), isDealer: creator.isDealer === true,
        roundId: body.currentRound.id },
      p_token_hash: hashSeatToken(token),
    });
    if (result.error) return privateJson({ error: "Unable to create table. Please try a new table." }, 409);
    const table = await loadTableFromSupabase(client, body.slug, hashSeatToken(token));
    return setSeatCookie(privateJson(table, 201), body.slug, token);
  } catch {
    return privateJson({ error: "Unable to create table." }, 400);
  }
}
