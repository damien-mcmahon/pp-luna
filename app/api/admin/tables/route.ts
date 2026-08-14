import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function authenticated(request: Request) {
  return request.headers.get("cookie")?.includes("dealers-choice-admin=admin") ?? false;
}

export async function GET(request: Request) {
  if (!authenticated(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const client = getSupabaseAdmin();
  if (!client) return NextResponse.json({ tables: [] });

  const result = await client.from("tables").select("*").order("updated_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ tables: result.data ?? [] });
}
