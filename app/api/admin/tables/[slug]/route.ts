import { withAdmin } from "@/lib/admin-auth";
import { privateJson, readJson } from "@/lib/http-security";

type RouteContext = { params: { slug: string } };

async function mutate(request: Request, context: RouteContext, action: "rename" | "delete") {
  return withAdmin(request, async ({ client, userId }) => {
    let name: string | null = null;
    if (action === "rename") {
      try {
        const body = await readJson(request);
        if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) {
          return privateJson({ error: "Enter a table name (up to 120 characters)." }, 400);
        }
        name = body.name.trim();
      } catch {
        return privateJson({ error: "Invalid request." }, 400);
      }
    }
    const result = await client.rpc("admin_mutate_table", {
      p_user_id: userId, p_slug: context.params.slug, p_action: action, p_name: name,
    });
    if (result.error) return privateJson({ error: "Unable to update table." }, 503);
    if (!result.data) return privateJson({ error: "Table not found." }, 404);
    return privateJson({ success: true });
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return mutate(request, context, "rename");
}

export async function DELETE(request: Request, context: RouteContext) {
  return mutate(request, context, "delete");
}
