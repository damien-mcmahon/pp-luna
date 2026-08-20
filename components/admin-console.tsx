"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  ExternalLink,
  LayoutGrid,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  Spade,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { deleteRemoteTable, persistRemoteTable } from "@/lib/api";
import { isAdminSession, setAdminSession } from "@/lib/admin";
import { getTables, removeTable, saveTable } from "@/lib/store";
import { TableRecord } from "@/lib/types";

interface AdminTableRow {
  slug: string;
  name: string;
  updatedAt: string;
  members: number;
  round: number;
  local?: TableRecord;
}

function relativeTime(date: string) {
  const difference = Math.max(0, Date.now() - new Date(date).getTime());
  const minutes = Math.floor(difference / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AdminConsole() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin" });
  const [loginError, setLoginError] = useState("");
  const [tables, setTables] = useState<AdminTableRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminTableRow | null>(null);

  useEffect(() => {
    const current = isAdminSession();
    setAuthenticated(current);
    if (current) void loadTables();
  }, []);

  async function loadTables() {
    const localTables = getTables();
    const localRows = localTables.map<AdminTableRow>((table) => ({
      slug: table.slug,
      name: table.name,
      updatedAt: table.updatedAt,
      members: table.members.length,
      round: table.currentRound.number,
      local: table,
    }));
    setTables(localRows);

    try {
      const response = await fetch("/api/admin/tables", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { tables?: Array<{ slug: string; name: string; updated_at: string }> };
      if (!data.tables) return;
      setTables((current) => data.tables!.map((remote) => {
        const local = current.find((table) => table.slug === remote.slug)?.local;
        return { slug: remote.slug, name: remote.name, updatedAt: remote.updated_at, members: local?.members.length ?? 0, round: local?.currentRound.number ?? 1, local };
      }));
    } catch {
      // Local tables are the demo-mode source of truth.
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    try {
      const response = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(loginForm) });
      if (!response.ok) {
        setLoginError("That key does not open the house console.");
        return;
      }
      setAdminSession(true);
      setAuthenticated(true);
      void loadTables();
    } catch {
      setLoginError("Unable to reach the house console.");
    }
  }

  function startEdit(table: AdminTableRow) {
    setEditing(table.slug);
    setEditName(table.name);
  }

  function saveName(table: AdminTableRow) {
    const local = table.local;
    if (local && editName.trim()) {
      const next = saveTable({ ...local, name: editName.trim() });
      void persistRemoteTable(next);
    } else if (editName.trim()) {
      void fetch(`/api/tables/${encodeURIComponent(table.slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
    }
    setTables((current) => current.map((entry) => entry.slug === table.slug ? { ...entry, name: editName.trim() || entry.name } : entry));
    setEditing(null);
  }

  function deleteTable() {
    if (!deleteTarget) return;
    removeTable(deleteTarget.slug);
    void deleteRemoteTable(deleteTarget.slug);
    setTables((current) => current.filter((table) => table.slug !== deleteTarget.slug));
    setDeleteTarget(null);
  }

  if (!authenticated) return <main className="admin-page"><div className="noise" /><nav className="admin-nav page-width"><button className="brand-lockup" onClick={() => router.push("/")}><span className="brand-mark"><Spade size={18} fill="currentColor" /></span><span><strong>DEALER&apos;S CHOICE</strong><small>PLANNING POKER</small></span></button><a className="back-home" href="/"><ArrowLeft size={15} /> Back to site</a></nav><section className="admin-login"><div className="admin-login-mark"><LockKeyhole size={24} /></div><div className="eyebrow">HOUSE ACCESS / 01</div><h1>Welcome to<br /><em>the console.</em></h1><p>Manage rooms, rename tables, and keep the house tidy.</p><form onSubmit={login}><label>Username<input autoFocus value={loginForm.username} onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })} /></label><label>Password<input type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} /></label>{loginError && <div className="form-error">{loginError}</div>}<button className="button button-primary modal-submit" type="submit">Enter console <ArrowRight size={16} /></button></form></section></main>;

  const liveCount = tables.filter((table) => Date.now() - new Date(table.updatedAt).getTime() < 1000 * 60 * 30).length;
  return <main className="admin-page"><div className="noise" /><nav className="admin-nav page-width"><button className="brand-lockup" onClick={() => router.push("/")}><span className="brand-mark"><Spade size={18} fill="currentColor" /></span><span><strong>DEALER&apos;S CHOICE</strong><small>HOUSE CONSOLE</small></span></button><div className="admin-nav-right"><span className="admin-secure"><i /> SECURE ADMIN</span><button className="back-home" onClick={() => { setAdminSession(false); setAuthenticated(false); }}><ArrowLeft size={15} /> Exit console</button></div></nav><section className="admin-content page-width"><div className="admin-title-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> HOUSE OPERATIONS</div><h1>Keep the rooms <em>running.</em></h1><p>One view of every table in your estimation house.</p></div><button className="button button-primary" onClick={() => router.push("/")}><Plus size={16} /> Open a new table</button></div><div className="admin-stats"><div><span className="stat-icon stat-gold"><LayoutGrid size={17} /></span><span><small>TOTAL TABLES</small><b>{tables.length}</b></span><i>ALL ROOMS</i></div><div><span className="stat-icon stat-mint"><Eye size={17} /></span><span><small>ACTIVE ROOMS</small><b>{liveCount}</b></span><i>LAST 30 MIN</i></div><div><span className="stat-icon stat-coral"><Users size={17} /></span><span><small>SEATS IN PLAY</small><b>{tables.reduce((total, table) => total + table.members, 0)}</b></span><i>KNOWN PLAYERS</i></div><div><span className="stat-icon stat-blue"><Clock3 size={17} /></span><span><small>THE DECK</small><b>FIB</b></span><i>1 — 21</i></div></div><section className="admin-table-card"><div className="admin-card-header"><div><div className="eyebrow">ROOM DIRECTORY</div><h2>All tables <span>{tables.length}</span></h2></div><button className="refresh-tables" onClick={() => void loadTables()}><span>Refresh</span><ChevronRight size={15} /></button></div>{tables.length === 0 ? <div className="admin-empty"><span className="admin-empty-mark"><Spade size={22} fill="currentColor" /></span><h3>No tables on the floor.</h3><p>Open your first room and it will appear here.</p><button className="button button-ghost" onClick={() => router.push("/")}>Deal a new table <ArrowRight size={15} /></button></div> : <div className="admin-directory"><div className="directory-head"><span>TABLE</span><span>SEATS</span><span>ROUND</span><span>LAST ACTIVITY</span><span>ACTION</span></div>{tables.map((table) => <div className="directory-row" key={table.slug}><span className="directory-name"><span className="directory-icon"><Spade size={14} fill="currentColor" /></span>{editing === table.slug ? <span className="directory-edit"><input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveName(table); if (event.key === "Escape") setEditing(null); }} /><button onClick={() => saveName(table)}><Check size={14} /></button></span> : <span><b>{table.name}</b><small>{table.slug}</small></span>}</span><span className="directory-value"><Users size={14} /> {table.members}</span><span className="directory-value">{String(table.round).padStart(2, "0")}</span><span className="directory-time"><i /> {relativeTime(table.updatedAt)}</span><span className="directory-actions"><button onClick={() => router.push(`/table/${table.slug}`)} title="Open table"><ExternalLink size={15} /></button><button onClick={() => startEdit(table)} title="Rename table"><Pencil size={15} /></button><button className="danger-action" onClick={() => setDeleteTarget(table)} title="Delete table"><Trash2 size={15} /></button></span></div>)}</div>}</section><div className="admin-footnote"><ShieldCheck size={14} /> Admin changes apply to the hosted database when Supabase is configured. Local demo rooms remain available on this device.</div></section>{deleteTarget && <div className="modal-backdrop" role="presentation"><section className="delete-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setDeleteTarget(null)} aria-label="Close"><X size={18} /></button><div className="delete-icon"><Trash2 size={20} /></div><div className="eyebrow">REMOVE ROOM</div><h2>Close {deleteTarget.name}?</h2><p>This removes the table and its session history. Players with the link will no longer be able to deal here.</p><div className="delete-actions"><button className="button button-ghost" onClick={() => setDeleteTarget(null)}>Keep table</button><button className="button button-danger" onClick={deleteTable}>Delete room <Trash2 size={15} /></button></div></section></div>}</main>;
}
