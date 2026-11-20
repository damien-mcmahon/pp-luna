import { TableMutation, TableRecord } from "@/lib/types";

export const hostedTablesEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function tableResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Unable to update table.");
  return data as TableRecord;
}

export async function fetchRemoteTable(slug: string) {
  if (!hostedTablesEnabled) return null;
  try {
    const response = await fetch(`/api/tables/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (response.status === 404) return null;
    return await tableResponse(response);
  } catch {
    return null;
  }
}

export async function persistRemoteTable(table: TableRecord, mutation: TableMutation) {
  if (!hostedTablesEnabled) return null;
  return tableResponse(await fetch(`/api/tables/${encodeURIComponent(table.slug)}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation }),
  }));
}

export async function createRemoteTable(table: TableRecord) {
  if (!hostedTablesEnabled) return null;
  return tableResponse(await fetch("/api/tables", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(table),
  }));
}
