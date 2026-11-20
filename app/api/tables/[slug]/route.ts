import { getSupabaseAdmin } from "@/lib/supabase-server";
import { loadTableFromSupabase } from "@/lib/server-tables";
import { hashSeatToken, newSeatToken, seatToken, setSeatCookie } from "@/lib/table-security";
import { privateJson, readJson, sameOrigin } from "@/lib/http-security";
// Keep legacy URLs protected too; the console uses the dedicated admin routes.
export { PATCH, DELETE } from "@/app/api/admin/tables/[slug]/route";

export const dynamic = "force-dynamic";

type RouteContext = { params: { slug: string } };

export async function GET(request: Request, context: RouteContext) {
  const client = getSupabaseAdmin();
  if (!client) return privateJson({ error: "Hosted persistence is not configured." }, 503);
  try {
    const token = seatToken(request, context.params.slug);
    const table = await loadTableFromSupabase(client, context.params.slug, token ? hashSeatToken(token) : undefined);
    return table ? privateJson(table) : privateJson({ error: "Table not found." }, 404);
  } catch {
    return privateJson({ error: "Unable to load table." }, 503);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  if (!sameOrigin(request)) return privateJson({ error: "Invalid origin." }, 403);
  const client = getSupabaseAdmin();
  if (!client) return privateJson({ error: "Hosted persistence is not configured." }, 503);
  try {
    const { mutation } = await readJson(request);
    if (!mutation || typeof mutation.type !== "string") return privateJson({ error: "An explicit action is required." }, 400);
    let token = seatToken(request, context.params.slug);
    if (!token && mutation.type !== "join") return privateJson({ error: "Take a seat before performing this action." }, 401);
    token ??= newSeatToken();
    const result = await client.rpc("mutate_planning_table", {
      p_slug: context.params.slug, p_token_hash: hashSeatToken(token), p_action: mutation.type, p_payload: mutation,
    });
    if (result.error) {
      const status = result.error.code === "42501" ? 403 : result.error.code === "P0002" ? 404 : 400;
      return privateJson({ error: status === 403 ? "This action is not allowed for your seat." : "Unable to apply action. Refresh the table and try again." }, status);
    }
    const table = await loadTableFromSupabase(client, context.params.slug, hashSeatToken(token));
    return setSeatCookie(privateJson(table), context.params.slug, token);
  } catch {
    return privateJson({ error: "Invalid table action." }, 400);
  }
}
