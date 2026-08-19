import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { loadTableFromSupabase, saveParticipantToSupabase, saveTableToSupabase } from "@/lib/server-tables";
import { TableMutation, TableRecord } from "@/lib/types";

type RouteContext = { params: { slug: string } };

export async function GET(_request: Request, context: RouteContext) {
  const client = getSupabaseAdmin();
  if (!client) {
    return NextResponse.json({ error: "Hosted persistence is not configured." }, { status: 503 });
  }

  const table = await loadTableFromSupabase(client, context.params.slug);
  if (!table) return NextResponse.json({ error: "Table not found." }, { status: 404 });
  return NextResponse.json(table);
}

export async function PUT(request: Request, context: RouteContext) {
  const client = getSupabaseAdmin();
  if (!client) {
    return NextResponse.json({ error: "Hosted persistence is not configured." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as TableRecord | { table: TableRecord; mutation?: TableMutation };
    const table = "table" in body ? body.table : body;
    const mutation = "table" in body ? body.mutation : undefined;
    if (table.slug !== context.params.slug) {
      return NextResponse.json({ error: "Table slug mismatch." }, { status: 400 });
    }

    if (mutation?.type === "join") {
      const persistedTable = await saveParticipantToSupabase(client, table, mutation.participant);
      return NextResponse.json(persistedTable);
    }

    await saveTableToSupabase(client, table);
    return NextResponse.json(table);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save table." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!request.headers.get("cookie")?.includes("dealers-choice-admin=admin")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const client = getSupabaseAdmin();
  if (!client) {
    return NextResponse.json({ error: "Hosted persistence is not configured." }, { status: 503 });
  }

  const body = (await request.json()) as { name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: "A table name is required." }, { status: 400 });
  const result = await client
    .from("tables")
    .update({ name: body.name.trim(), updated_at: new Date().toISOString() })
    .eq("slug", context.params.slug)
    .select("*")
    .maybeSingle();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  if (!result.data) return NextResponse.json({ error: "Table not found." }, { status: 404 });
  return NextResponse.json(result.data);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const client = getSupabaseAdmin();
  if (!client) {
    return NextResponse.json({ error: "Hosted persistence is not configured." }, { status: 503 });
  }

  const result = await client.from("tables").delete().eq("slug", context.params.slug);
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}
