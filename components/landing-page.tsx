"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Crown,
  Link2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Spade,
  Users,
  X,
  Zap,
} from "lucide-react";
import { createRemoteTable } from "@/lib/api";
import { createTableRecord, getTables } from "@/lib/store";
import { TableMode, TableRecord } from "@/lib/types";

const featureCards = [
  {
    icon: Users,
    eyebrow: "THE WHOLE CREW",
    title: "Everyone sees the table.",
    text: "Live presence shows who is in, who has dealt, and who is still thinking.",
    color: "gold",
  },
  {
    icon: Zap,
    eyebrow: "NO PEEKING",
    title: "Cards stay face down.",
    text: "Votes land in private. The dealer reveals only when the room is ready.",
    color: "mint",
  },
  {
    icon: ShieldCheck,
    eyebrow: "READ THE ROOM",
    title: "Alignment, at a glance.",
    text: "Power bars turn a spread of numbers into a conversation your team can use.",
    color: "coral",
  },
];

function getJoinSlug(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/table\/([^/]+)/);
    return match?.[1] ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return trimmed
      .replace(/^.*\/table\//, "")
      .split(/[?#/]/)[0]
      .trim();
  }
}

export default function LandingPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinLink, setJoinLink] = useState("");
  const [recentTables, setRecentTables] = useState<TableRecord[]>([]);
  const [form, setForm] = useState({ tableName: "", creatorName: "", mode: "participant" as TableMode });
  const [error, setError] = useState("");

  useEffect(() => {
    setRecentTables(getTables().slice(0, 3));
  }, []);

  function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = getJoinSlug(joinLink);
    if (!slug) return;
    router.push(`/table/${encodeURIComponent(slug)}`);
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.tableName.trim() || !form.creatorName.trim()) {
      setError("Give your table and your seat a name first.");
      return;
    }

    const table = createTableRecord(form);
    void createRemoteTable(table);
    router.push(`/table/${table.slug}`);
  }

  return (
    <main className="landing-page">
      <div className="noise" aria-hidden="true" />
      <nav className="landing-nav page-width">
        <button className="brand-lockup" onClick={() => router.push("/")} aria-label="Dealer's Choice home">
          <span className="brand-mark"><Spade size={19} fill="currentColor" /></span>
          <span>
            <strong>DEALER&apos;S CHOICE</strong>
            <small>PLANNING POKER</small>
          </span>
        </button>
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#your-tables">Your tables</a>
          <a className="admin-link" href="/admin"><LockKeyhole size={14} /> Admin console</a>
        </div>
        <button className="button button-dark button-small nav-create" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> New table
        </button>
      </nav>

      <section className="hero page-width">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> REAL-TIME ESTIMATION / TABLE 01</div>
          <h1>Deal the right<br /><em>estimate.</em></h1>
          <p className="hero-lede">
            Planning poker with the energy of a late-night Vegas table. Bring your team in, keep every card close, and turn the reveal into alignment.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => setCreateOpen(true)}>
              Start a new table <ArrowRight size={17} />
            </button>
            <form className="join-form" onSubmit={submitJoin}>
              <Link2 size={16} />
              <input
                aria-label="Paste a table link"
                value={joinLink}
                onChange={(event) => setJoinLink(event.target.value)}
                placeholder="Paste a table link"
              />
              <button aria-label="Join table" type="submit"><ChevronRight size={17} /></button>
            </form>
          </div>
          <div className="hero-proof"><span className="proof-avatars"><i>J</i><i>M</i><i>R</i><i>+</i></span> <span>Made for teams that ship.</span></div>
        </div>

        <div className="hero-visual" aria-label="A preview of the planning poker table">
          <div className="visual-glow visual-glow-one" />
          <div className="visual-glow visual-glow-two" />
          <div className="preview-topline"><span>LIVE ROOM</span><b><i /> 4 in table</b></div>
          <div className="preview-table">
            <div className="preview-rim" />
            <div className="preview-seat preview-seat-one"><span className="seat-avatar avatar-coral">J</span><b>Jules</b><small>Product</small></div>
            <div className="preview-seat preview-seat-two"><span className="seat-avatar avatar-blue">M</span><b>Marco</b><small>Platform</small></div>
            <div className="preview-seat preview-seat-three"><span className="seat-avatar avatar-gold">R</span><b>Riley</b><small>Growth</small></div>
            <div className="preview-task"><small>NOW DEALING</small><strong>Refactor payment flow</strong><span>ROUND 04</span></div>
            <div className="preview-metric preview-metric-left"><small>ALIGNMENT</small><strong>75%</strong><span><i style={{ width: "75%" }} /></span></div>
            <div className="preview-metric preview-metric-right"><small>COHERENCE</small><strong>82%</strong><span><i style={{ width: "82%" }} /></span></div>
            <div className="preview-cards">
              <div className="preview-card preview-card-back"><span>♠</span></div>
              <div className="preview-card preview-card-back"><span>♣</span></div>
              <div className="preview-card preview-card-face"><small>ESTIMATE</small><strong>8</strong><span>♦</span></div>
            </div>
            <div className="preview-deal"><span className="deal-dot" /> WAITING ON 1 VOTE</div>
          </div>
          <div className="preview-caption"><span><CircleHelp size={14} /> Private by default</span><span>FIBONACCI / 1—21</span></div>
        </div>
      </section>

      <section className="signal-strip page-width">
        <div><span className="signal-number">01</span><span>CREATE A TABLE</span><strong>Name the room. Choose your seat.</strong></div>
        <ArrowRight size={18} />
        <div><span className="signal-number">02</span><span>SHARE THE LINK</span><strong>Everyone joins from any device.</strong></div>
        <ArrowRight size={18} />
        <div><span className="signal-number">03</span><span>REVEAL THE HAND</span><strong>Find the signal in the noise.</strong></div>
      </section>

      <section className="feature-section page-width" id="how-it-works">
        <div className="section-heading"><div><div className="eyebrow">THE HOUSE RULES</div><h2>Make the reveal <em>mean something.</em></h2></div><p>Less admin. More thoughtful estimates. Dealer&apos;s Choice keeps the ritual, removes the friction.</p></div>
        <div className="feature-grid">
          {featureCards.map(({ icon: Icon, eyebrow, title, text, color }) => (
            <article className={`feature-card feature-${color}`} key={title}>
              <div className="feature-icon"><Icon size={18} /></div><div className="eyebrow">{eyebrow}</div><h3>{title}</h3><p>{text}</p><span className="feature-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="recent-section page-width" id="your-tables">
        <div className="section-heading compact"><div><div className="eyebrow">YOUR TABLES</div><h2>Back to the <em>felt.</em></h2></div><button className="text-button" onClick={() => setCreateOpen(true)}>Create another <Plus size={15} /></button></div>
        {recentTables.length > 0 ? <div className="recent-list">{recentTables.map((table) => <button key={table.slug} onClick={() => router.push(`/table/${table.slug}`)}><span className="recent-icon"><Spade size={17} fill="currentColor" /></span><span><b>{table.name}</b><small>{table.members.length} {table.members.length === 1 ? "seat" : "seats"} · Round {String(table.currentRound.number).padStart(2, "0")}</small></span><ChevronRight size={17} /></button>)}</div> : <div className="empty-tables"><Clipboard size={18} /><span>Your tables will appear here after you deal your first hand.</span><button onClick={() => setCreateOpen(true)}>Open a table <ArrowRight size={15} /></button></div>}
      </section>

      <footer className="landing-footer page-width"><span><span className="brand-mark small"><Spade size={13} fill="currentColor" /></span> DEALER&apos;S CHOICE</span><span>ESTIMATE WITH INTENT <i /> © 2025</span></footer>

      {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
        <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Close"><X size={18} /></button>
          <div className="modal-kicker"><span className="brand-mark"><Spade size={18} fill="currentColor" /></span> DEAL THE ROOM</div>
          <h2 id="create-title">Set the table.</h2>
          <p>Give your team a room and choose how you want to deal this hand.</p>
          <form onSubmit={submitCreate}>
            <label>Table name<input autoFocus value={form.tableName} onChange={(event) => setForm({ ...form, tableName: event.target.value })} placeholder="e.g. Friday Poker Club" /></label>
            <label>Your name<input value={form.creatorName} onChange={(event) => setForm({ ...form, creatorName: event.target.value })} placeholder="e.g. Alex Morgan" /></label>
            <div className="mode-label">YOUR SEAT</div>
            <div className="mode-options">
              <button type="button" className={form.mode === "participant" ? "mode-option selected" : "mode-option"} onClick={() => setForm({ ...form, mode: "participant" })}><span className="mode-radio">{form.mode === "participant" && <i />}</span><span><b>Play the hand</b><small>Vote with the table</small></span><Users size={17} /></button>
              <button type="button" className={form.mode === "dealer" ? "mode-option selected" : "mode-option"} onClick={() => setForm({ ...form, mode: "dealer" })}><span className="mode-radio">{form.mode === "dealer" && <i />}</span><span><b>Deal only</b><small>Run the reveal</small></span><Crown size={17} /></button>
            </div>
            {error && <div className="form-error">{error}</div>}
            <button className="button button-primary modal-submit" type="submit">Open the table <ArrowRight size={17} /></button>
          </form>
          <div className="modal-note"><LockKeyhole size={13} /> Anyone with your private link can join.</div>
        </section>
      </div>}
    </main>
  );
}
