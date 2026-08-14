import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { saveTableToSupabase } from "@/lib/server-tables";
import { TableRecord } from "@/lib/types";

export async function POST(request: Request) {
  const client = getSupabaseAdmin();
  if (!client) {
    return NextResponse.json({ error: "Hosted persistence is not configured." }, { status: 503 });
  }

  try {
    const table = (await request.json()) as TableRecord;
    await saveTableToSupabase(client, table);
    return NextResponse.json(table, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create table." },
      { status: 400 },
    );
  }
}
