import { withAdmin } from "@/lib/admin-auth";
import { privateJson } from "@/lib/http-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdmin(request, async ({ client }) => {
    const result = await client.from("tables")
      .select("slug,name,updated_at,participants(count),rounds(round_number)")
      .order("updated_at", { ascending: false });
    if (result.error) return privateJson({ error: "Unable to load tables." }, 503);
    return privateJson({ tables: (result.data ?? []).map((table) => ({
      slug: table.slug, name: table.name, updatedAt: table.updated_at,
      members: table.participants[0]?.count ?? 0,
      round: Math.max(1, ...table.rounds.map((round) => round.round_number)),
    })) });
  });
}
