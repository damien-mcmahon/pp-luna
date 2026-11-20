"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Clock3, Eye, LayoutGrid, LockKeyhole, Pencil, Plus, Spade, Trash2, Users, X } from "lucide-react";
import { removeTable } from "@/lib/store";

interface AdminTableRow {
  slug: string;
  name: string;
  updatedAt: string;
  members: number;
  round: number;
}

function relativeTime(date: string) {
  const minutes = Math.floor(Math.max(0, Date.now() - Date.parse(date)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export default function AdminConsole() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "", code: "" });
  const [mfaRequired, setMfaRequired] = useState(false);
  const [enrollment, setEnrollment] = useState<{ factorId: string; qrCode: string } | null>(null);
  const [error, setError] = useState("");
  const [tables, setTables] = useState<AdminTableRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminTableRow | null>(null);

  const adminRequest = useCallback(async (url: string, options?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false);
      setTables([]);
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed.");
    return data;
  }, []);

  const loadTables = useCallback(async () => {
    try {
      const data = await adminRequest("/api/admin/tables");
      setTables(data.tables);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load tables.");
    }
  }, [adminRequest]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/session", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        setAuthenticated(response.ok);
        if (response.ok) await loadTables();
      })
      .catch(() => { if (active) setError("Unable to check your session."); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [loadTables]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...loginForm, factorId: enrollment?.factorId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.mfaRequired) setMfaRequired(true);
        if (data.enrollment) setEnrollment(data.enrollment);
        setError(data.error ?? "Unable to sign in.");
        return;
      }
      setLoginForm({ email: "", password: "", code: "" });
      setMfaRequired(false);
      setEnrollment(null);
      setAuthenticated(true);
      await loadTables();
    } catch {
      setError("Unable to reach the house console.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await adminRequest("/api/admin/session", { method: "DELETE" });
      setAuthenticated(false);
      setTables([]);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function saveName(table: AdminTableRow) {
    if (!editName.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await adminRequest(`/api/admin/tables/${encodeURIComponent(table.slug)}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      setEditing(null);
      await loadTables();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to rename table.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTable() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError("");
    try {
      await adminRequest(`/api/admin/tables/${encodeURIComponent(deleteTarget.slug)}`, { method: "DELETE" });
      removeTable(deleteTarget.slug);
      setDeleteTarget(null);
      await loadTables();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete table.");
    } finally {
      setBusy(false);
    }
  }

  const brand = <button className="brand-lockup" onClick={() => router.push("/")}><span className="brand-mark"><Spade size={18} fill="currentColor" /></span><span><strong>VEGAS</strong><small>HOUSE CONSOLE</small></span></button>;
  if (checking) return <main className="admin-page"><section className="admin-login" role="status">Checking your session...</section></main>;
  if (!authenticated) return <main className="admin-page">
    <div className="noise" />
    <nav className="admin-nav page-width">{brand}<a className="back-home" href="/"><ArrowLeft size={15} /> Back to site</a></nav>
    <section className="admin-login">
      <div className="admin-login-mark"><LockKeyhole size={24} /></div>
      <div className="eyebrow">INVITE-ONLY ADMIN ACCESS</div><h1>Welcome to<br /><em>the console.</em></h1>
      <p>Sign in with your authorized Supabase account.</p>
      <form onSubmit={login}>
        <label>Email<input autoFocus required type="email" autoComplete="username" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} /></label>
        <label>Password<input required type="password" autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} /></label>
        {enrollment && <Image unoptimized className="admin-mfa-qr" src={enrollment.qrCode.startsWith("data:image/svg+xml") ? enrollment.qrCode : `data:image/svg+xml,${encodeURIComponent(enrollment.qrCode)}`} width={200} height={200} alt="Scan to enroll your authenticator" />}
        {mfaRequired && <label>Authenticator code<input required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" value={loginForm.code} onChange={(event) => setLoginForm({ ...loginForm, code: event.target.value })} /></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button disabled={busy} className="button button-primary modal-submit" type="submit">{busy ? "Signing in..." : "Enter console"} <ArrowRight size={16} /></button>
      </form>
    </section>
  </main>;

  const liveCount = tables.filter((table) => Date.now() - Date.parse(table.updatedAt) < 1000 * 60 * 30).length;
  return <main className="admin-page">
    <div className="noise" />
    <nav className="admin-nav page-width">{brand}<div className="admin-nav-right"><span className="admin-secure"><i /> SECURE ADMIN</span><button disabled={busy} className="back-home" onClick={() => void logout()}><ArrowLeft size={15} /> Sign out</button></div></nav>
    <section className="admin-content page-width">
      <div className="admin-title-row"><div><div className="eyebrow">HOUSE OPERATIONS</div><h1>Keep the rooms <em>running.</em></h1><p>One view of every table in your estimation house.</p></div><button className="button button-primary" onClick={() => router.push("/")}><Plus size={16} /> Open a new table</button></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="admin-stats">
        <div><span className="stat-icon stat-gold"><LayoutGrid size={17} /></span><span><small>TOTAL TABLES</small><b>{tables.length}</b></span><i>ALL ROOMS</i></div>
        <div><span className="stat-icon stat-mint"><Eye size={17} /></span><span><small>ACTIVE ROOMS</small><b>{liveCount}</b></span><i>LAST 30 MIN</i></div>
        <div><span className="stat-icon stat-coral"><Users size={17} /></span><span><small>SEATS IN PLAY</small><b>{tables.reduce((total, table) => total + table.members, 0)}</b></span><i>KNOWN PLAYERS</i></div>
        <div><span className="stat-icon stat-blue"><Clock3 size={17} /></span><span><small>ACCESS</small><b>AUTH</b></span><i>INVITE ONLY</i></div>
      </div>
      <section className="admin-table-card">
        <div className="admin-card-header"><div><div className="eyebrow">ROOM DIRECTORY</div><h2>All tables <span>{tables.length}</span></h2></div><button className="refresh-tables" onClick={() => void loadTables()}>Refresh <ChevronRight size={15} /></button></div>
        {!tables.length ? <div className="admin-empty">No tables found.</div> : <>
          <div className="directory-head"><span>TABLE</span><span>SEATS</span><span>ROUND</span><span>UPDATED</span><span>ACTIONS</span></div>
          {tables.map((table) => <div className="directory-row" key={table.slug}>
            <div className="directory-name">{editing === table.slug ? <div className="inline-input"><input aria-label="Table name" maxLength={120} value={editName} onChange={(event) => setEditName(event.target.value)} /><button disabled={busy} onClick={() => void saveName(table)} aria-label="Save table name"><Check size={15} /></button><button onClick={() => setEditing(null)} aria-label="Cancel rename"><X size={15} /></button></div> : <><b>{table.name}</b><small>{table.slug}</small></>}</div>
            <span className="directory-value">{table.members}</span><span className="directory-value">{table.round}</span><span className="directory-time">{relativeTime(table.updatedAt)}</span>
            <div className="directory-actions"><button onClick={() => router.push(`/table/${table.slug}`)} aria-label={`Open ${table.name}`}><Eye size={15} /></button><button disabled={busy} onClick={() => { setEditing(table.slug); setEditName(table.name); }} aria-label={`Rename ${table.name}`}><Pencil size={15} /></button><button disabled={busy} onClick={() => setDeleteTarget(table)} aria-label={`Delete ${table.name}`}><Trash2 size={15} /></button></div>
          </div>)}
        </>}
      </section>
    </section>
    {deleteTarget && <div className="modal-backdrop"><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <h2 id="delete-title">Delete {deleteTarget.name}?</h2><p>This permanently removes the table, its participants, and all rounds.</p>
      <div className="delete-actions"><button disabled={busy} className="button button-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button><button disabled={busy} className="button button-primary" onClick={() => void deleteTable()}>Delete table</button></div>
    </section></div>}
  </main>;
}
