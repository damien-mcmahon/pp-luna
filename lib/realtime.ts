import { fetchRemoteTable, hostedTablesEnabled } from "@/lib/api";
import { tableEventKey } from "@/lib/store";
import { TableRecord } from "@/lib/types";

// Poll only the redacted API. Public Postgres subscriptions expose private votes.
export function subscribeToTable(slug: string, onChange: (remoteTable?: TableRecord) => void) {
  if (typeof window === "undefined") return () => undefined;
  let disposed = false;
  let fetching = false;
  async function refresh() {
    if (disposed || fetching) return;
    fetching = true;
    try {
      const table = await fetchRemoteTable(slug);
      if (!disposed) onChange(table ?? undefined);
    } finally {
      fetching = false;
    }
  }
  const broadcast = "BroadcastChannel" in window ? new BroadcastChannel(`planning-poker:${slug}`) : null;
  const handleBroadcast = () => { void refresh(); };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== tableEventKey()) return;
    try {
      if (JSON.parse(event.newValue ?? "{}").slug === slug) void refresh();
    } catch { /* Ignore malformed local events. */ }
  };
  const handleLocal = (event: Event) => {
    if ((event as CustomEvent<{ slug: string }>).detail?.slug === slug) void refresh();
  };
  broadcast?.addEventListener("message", handleBroadcast);
  window.addEventListener("storage", handleStorage);
  window.addEventListener(tableEventKey(), handleLocal);
  const poll = hostedTablesEnabled ? window.setInterval(() => void refresh(), 1500) : undefined;
  return () => {
    disposed = true;
    window.clearInterval(poll);
    broadcast?.removeEventListener("message", handleBroadcast);
    broadcast?.close();
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(tableEventKey(), handleLocal);
  };
}

export function broadcastTableChange(slug: string) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(`planning-poker:${slug}`);
  channel.postMessage({ slug });
  channel.close();
}
