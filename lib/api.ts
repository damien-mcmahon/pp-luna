import { TableRecord } from "@/lib/types";

async function parseResponse<T>(response: Response) {
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function fetchRemoteTable(slug: string) {
  try {
    const response = await fetch(`/api/tables/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    return await parseResponse<TableRecord>(response);
  } catch {
    return null;
  }
}

export async function persistRemoteTable(table: TableRecord) {
  try {
    await fetch(`/api/tables/${encodeURIComponent(table.slug)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(table),
    });
  } catch {
    // The local store is the offline/demo fallback.
  }
}

export async function createRemoteTable(table: TableRecord) {
  try {
    await fetch("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(table),
    });
  } catch {
    // The local store is the offline/demo fallback.
  }
}

export async function deleteRemoteTable(slug: string) {
  try {
    await fetch(`/api/tables/${encodeURIComponent(slug)}`, { method: "DELETE" });
  } catch {
    // The local store is the offline/demo fallback.
  }
}
