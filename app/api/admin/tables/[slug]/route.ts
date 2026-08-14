import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type RouteContext = { params: { slug: string } };

export async function DELETE(request: Request, context: RouteContext) {
  if (!request.headers.get("cookie")?.includes("dealers-choice-admin=admin")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const client = getSupabaseAdmin();
  if (!client) return NextResponse.json({ deleted: true });

  const result = await client.from("tables").delete().eq("slug", context.params.slug);
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}
