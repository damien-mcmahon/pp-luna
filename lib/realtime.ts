import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import { fetchRemoteTable } from "@/lib/api";
import { tableEventKey } from "@/lib/store";
import { TableRecord } from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function subscribeToTable(slug: string, onChange: (remoteTable?: TableRecord) => void) {
  if (typeof window === "undefined") return () => undefined;

  let supabaseChannel: RealtimeChannel | undefined;
  let changeTimer: number | undefined;
  let queuedRemoteTable: TableRecord | undefined;

  const scheduleChange = (remoteTable?: TableRecord) => {
    queuedRemoteTable = remoteTable ?? queuedRemoteTable;
    if (changeTimer !== undefined) return;
    changeTimer = window.setTimeout(() => {
      const nextRemoteTable = queuedRemoteTable;
      queuedRemoteTable = undefined;
      changeTimer = undefined;
      onChange(nextRemoteTable);
    }, 80);
  };

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    supabaseChannel = supabase
      .channel(`planning-poker:${slug}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tables", filter: `slug=eq.${slug}` },
        () => scheduleChange(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, () => scheduleChange())
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => scheduleChange())
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, () => scheduleChange())
      .subscribe();
  }

  const broadcast = "BroadcastChannel" in window ? new BroadcastChannel(`planning-poker:${slug}`) : null;
  const handleBroadcast = () => scheduleChange();
  broadcast?.addEventListener("message", handleBroadcast);

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== tableEventKey()) return;
    try {
    if (JSON.parse(event.newValue ?? "{}").slug === slug) scheduleChange();
    } catch {
      // Ignore malformed local events.
    }
  };
  const handleLocalEvent = (event: Event) => {
    const customEvent = event as CustomEvent<{ slug?: string }>;
    if (customEvent.detail?.slug === slug) scheduleChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(tableEventKey(), handleLocalEvent);
  const poll = window.setInterval(() => {
    void fetchRemoteTable(slug).then((remoteTable) => {
      if (remoteTable) scheduleChange(remoteTable);
    });
  }, 12000);

  return () => {
    window.clearInterval(poll);
    if (changeTimer !== undefined) window.clearTimeout(changeTimer);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(tableEventKey(), handleLocalEvent);
    broadcast?.removeEventListener("message", handleBroadcast);
    broadcast?.close();
    if (supabaseChannel) {
      void supabaseChannel.unsubscribe();
    }
  };
}

export function broadcastTableChange(slug: string) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(`planning-poker:${slug}`);
  channel.postMessage({ slug, stamp: Date.now() });
  channel.close();
}
