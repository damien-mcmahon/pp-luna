"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock3,
  Copy,
  Crown,
  Edit3,
  Eye,
  ExternalLink,
  Flame,
  Info,
  Link2,
  LogOut,
  Menu,
  MoreHorizontal,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Spade,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { fetchRemoteTable, persistRemoteTable } from "@/lib/api";
import { subscribeToTable, broadcastTableChange } from "@/lib/realtime";
import {
  clearIdentity,
  getTable,
  randomId,
  readIdentity,
  saveTable,
  writeIdentity,
} from "@/lib/store";
import {
  FIBONACCI_VALUES,
  Participant,
  RoundSummary,
  TableIdentity,
  TableMutation,
  TableRecord,
  TeamMetric,
} from "@/lib/types";

const MAX_TABLE_MEMBERS = 20;
const DENSE_SEAT_THRESHOLD = 8;

function alignmentForVotes(votes: Record<string, number>) {
  const values = Object.values(votes);
  if (!values.length) return 0;
  const counts = values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
  return Math.round((Math.max(...Object.values(counts)) / values.length) * 100);
}

function averageForVotes(votes: Record<string, number>) {
  const values = Object.values(votes);
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function summaryForRound(round: TableRecord["currentRound"]): RoundSummary {
  return {
    id: round.id,
    number: round.number,
    task: round.task,
    votes: round.votes,
    alignment: alignmentForVotes(round.votes),
    average: averageForVotes(round.votes),
    createdAt: round.createdAt,
    revealedAt: round.revealedAt ?? new Date().toISOString(),
  };
}

function teamMetricsForTable(table: TableRecord): TeamMetric[] {
  const grouped = table.members.reduce<Record<string, { members: number; votes: Record<string, number> }>>(
    (result, member) => {
      if (member.isDealer) return result;
      const team = member.team || "No team";
      const group = result[team] ?? { members: 0, votes: {} };
      group.members += 1;
      const vote = table.currentRound.votes[member.id];
      if (vote !== undefined) group.votes[member.id] = vote;
      result[team] = group;
      return result;
    },
    {},
  );

  return Object.entries(grouped).map(([team, group]) => ({
    team,
    members: group.members,
    votes: Object.keys(group.votes).length,
    alignment: table.currentRound.revealed ? alignmentForVotes(group.votes) : 0,
  }));
}

function coherenceForTable(table: TableRecord) {
  const completed = table.history
    .filter((round) => round.id !== table.currentRound.id)
    .map((round) => round.alignment);
  if (table.currentRound.revealed) {
    const recorded = table.history.find((round) => round.id === table.currentRound.id);
    completed.push(recorded?.alignment ?? alignmentForVotes(table.currentRound.votes));
  }
  if (!completed.length) return 0;
  return Math.round(completed.reduce((total, score) => total + score, 0) / completed.length);
}

function displayAverage(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function tablesMatch(left: TableRecord, right: TableRecord) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function remoteTableIsNewer(local: TableRecord, remote: TableRecord) {
  if (tablesMatch(local, remote)) return false;
  const localTime = Date.parse(local.updatedAt);
  const remoteTime = Date.parse(remote.updatedAt);
  if (!Number.isFinite(remoteTime)) return false;
  if (!Number.isFinite(localTime)) return true;
  return remoteTime > localTime;
}

function identityCanViewTable(table: TableRecord, identity: TableIdentity | null) {
  if (!identity) return false;
  if (identity.role === "spectator") return true;
  return table.members.some((member) => member.id === identity.participantId);
}

function mergeConcurrentTable(local: TableRecord, remote: TableRecord) {
  if (tablesMatch(local, remote)) return local;

  // Joins and votes are independent while a round is open, so merge those
  // additive changes instead of replacing one with an older snapshot.
  const remoteIsNewer = remoteTableIsNewer(local, remote);
  const sameOpenRound = local.currentRound.id === remote.currentRound.id
    && !local.currentRound.revealed
    && !remote.currentRound.revealed;

  if (!sameOpenRound) return remoteIsNewer ? remote : local;

  const base = remoteIsNewer ? remote : local;
  const incoming = remoteIsNewer ? local : remote;
  const baseMembers = new Map(base.members.map((member) => [member.id, member]));
  const incomingMembers = new Map(incoming.members.map((member) => [member.id, member]));
  const members = [
    ...base.members,
    ...incoming.members.filter((member) => !baseMembers.has(member.id)),
  ];
  const votes = { ...base.currentRound.votes };

  for (const [participantId, value] of Object.entries(incoming.currentRound.votes)) {
    const baseMember = baseMembers.get(participantId);
    const incomingMember = incomingMembers.get(participantId);
    const canPreserveVote = !remoteIsNewer
      ? Boolean(incomingMember && (!baseMember || baseMember.isDealer === incomingMember.isDealer))
      : Boolean(baseMember && incomingMember && baseMember.isDealer === incomingMember.isDealer);
    if (canPreserveVote && votes[participantId] === undefined) votes[participantId] = value;
  }

  return {
    ...base,
    members,
    currentRound: { ...base.currentRound, votes },
  };
}

function memberColor(index: number) {
  return ["coral", "blue", "gold", "lavender", "mint", "rose", "sky", "orange"][index % 8];
}

function denseSeatStyle(index: number, total: number) {
  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  return {
    "--seat-x": `${(50 + Math.cos(angle) * 43).toFixed(2)}%`,
    "--seat-y": `${(55 + Math.sin(angle) * 30).toFixed(2)}%`,
  } as React.CSSProperties;
}

function taskInputWidth(value: string) {
  return `${Math.max(18, Math.min(56, value.trim().length + 2))}ch`;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function MetricBar({ value, tone = "gold", compact = false }: { value: number; tone?: string; compact?: boolean }) {
  return <span className={`power-bar ${compact ? "power-bar-compact" : ""}`}><i className={`power-fill power-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /><b>{value}%</b></span>;
}

function SeatCard({ member, voted, revealed, vote, color, isYou, index, total }: { member: Participant; voted: boolean; revealed: boolean; vote?: number; color: string; isYou: boolean; index: number; total: number }) {
  const isDense = total > DENSE_SEAT_THRESHOLD;
  return <div className={`table-seat ${isDense ? "seat-dense" : `seat-position-${index % 8}`} ${isYou ? "seat-is-you" : ""}`} style={isDense ? denseSeatStyle(index, total) : undefined}>
    <div className={`seat-person ${member.isDealer ? "seat-dealer" : ""}`}>
      <span className={`seat-avatar avatar-${color}`}>{initials(member.name)}</span>
      <span className="seat-copy"><b>{member.name}{isYou && <em>YOU</em>}</b><small>{member.isDealer ? "Dealer" : member.team || "Solo seat"}</small></span>
      {member.isDealer ? <Crown className="dealer-crown" size={14} fill="currentColor" /> : <span className={`seat-presence ${voted ? "has-voted" : ""}`} />}
    </div>
    {!member.isDealer && <div className={`seat-card ${voted ? "card-dealt" : "card-empty"} ${revealed ? "card-turned" : ""}`}>
      {revealed && vote !== undefined ? <><small>VOTE</small><strong>{vote}</strong><span>{vote === 1 ? "♠" : "♦"}</span></> : voted ? <><span className="card-back-mark">♠</span><small>DEALT</small></> : <><Clock3 size={13} /><small>THINKING</small></>}
    </div>}
  </div>;
}

function PokerCard({ value, index, selected, disabled, onSelect }: { value: number; index: number; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return <button
    type="button"
    className={`poker-card-hit ${selected ? "poker-card-selected" : ""}`}
    style={{ "--card-index": index, "--card-total": FIBONACCI_VALUES.length, "--card-offset": `${(index - 3) * 78}px` } as React.CSSProperties}
    onClick={onSelect}
    disabled={disabled}
    aria-label={`Vote ${value} points`}
  >
    <span className={`poker-card ${selected ? "poker-card-selected" : ""}`} aria-hidden="true">
      <span className="card-corner card-corner-top"><b>{value}</b><i>{index % 2 === 0 ? "♠" : "♥"}</i></span>
      <strong>{value}</strong>
      <span className="card-suit">{index % 2 === 0 ? "♠" : "♥"}</span>
      <span className="card-corner card-corner-bottom"><b>{value}</b><i>{index % 2 === 0 ? "♠" : "♥"}</i></span>
    </span>
  </button>;
}

function RoundLedger({ history, current }: { history: RoundSummary[]; current: TableRecord["currentRound"] }) {
  const recordedCurrent = history.find((round) => round.id === current.id);
  const currentSummary = current.revealed ? recordedCurrent ?? summaryForRound(current) : null;
  const rounds = history.filter((round) => round.id !== current.id).reverse().slice(0, 4);
  const totalRounds = history.length + (current.revealed && !recordedCurrent ? 1 : 0);
  return <div className="round-ledger">
    <div className="panel-label"><span>RECENT HANDS</span><small>{totalRounds} TOTAL</small></div>
    {rounds.length === 0 && !current.revealed ? <div className="ledger-empty"><Clock3 size={15} /><span>Your completed rounds will land here.</span></div> : <>
      {currentSummary && <div className="ledger-row ledger-current"><span className="ledger-round">{String(currentSummary.number).padStart(2, "0")}</span><span className="ledger-task">{currentSummary.task || "Untitled hand"}</span><b>{displayAverage(currentSummary.average)}</b><MetricBar value={currentSummary.alignment} compact /></div>}
      {rounds.map((round) => <div className="ledger-row" key={round.id}><span className="ledger-round">{String(round.number).padStart(2, "0")}</span><span className="ledger-task">{round.task || "Untitled hand"}</span><b>{displayAverage(round.average)}</b><MetricBar value={round.alignment} compact /></div>)}
    </>}
  </div>;
}

export default function TableRoom({ slug }: { slug: string }) {
  const router = useRouter();
  const [table, setTable] = useState<TableRecord | null>(null);
  const [identity, setIdentity] = useState<TableIdentity | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joinForm, setJoinForm] = useState({ name: "", team: "" });
  const [taskValue, setTaskValue] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(true);
  const tableRef = useRef<TableRecord | null>(null);
  const identityRef = useRef<TableIdentity | null>(null);
  const taskEditingRef = useRef(false);
  const taskValueRef = useRef("");
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const applyRemoteTableRef = useRef<(remoteTable: TableRecord) => void>(() => undefined);

  const currentMember = table?.members.find((member) => member.id === identity?.participantId);
  const isSpectator = identity?.role === "spectator";
  const isCreator = Boolean(currentMember?.isCreator && table?.creatorId === currentMember.id);
  const isDealer = Boolean(currentMember?.isDealer);
  const tableName = table?.name;

  const activeParticipants = useMemo(() => table?.members.filter((member) => !member.isDealer) ?? [], [table]);
  const votedCount = table ? activeParticipants.filter((member) => table.currentRound.votes[member.id] !== undefined).length : 0;
  const allVoted = activeParticipants.length > 0 && votedCount === activeParticipants.length;
  const alignment = table && table.currentRound.revealed ? alignmentForVotes(table.currentRound.votes) : 0;
  const average = table && table.currentRound.revealed ? averageForVotes(table.currentRound.votes) : 0;
  const coherence = table ? coherenceForTable(table) : 0;
  const teamMetrics = table ? teamMetricsForTable(table) : [];

  function setTaskDraft(value: string) {
    taskValueRef.current = value;
    setTaskValue(value);
  }

  function commitTable(updater: (current: TableRecord) => TableRecord, mutation?: TableMutation) {
    const current = getTable(slug) ?? tableRef.current;
    if (!current) return;
    const next = saveTable(updater(current));
    tableRef.current = next;
    setTable(next);
    persistQueueRef.current = persistQueueRef.current
      .catch(() => undefined)
      .then(() => persistRemoteTable(next, mutation));
    broadcastTableChange(next.slug);
  }

  applyRemoteTableRef.current = (remoteTable) => {
    const localTable = tableRef.current;
    const nextTable = saveTable(
      localTable ? mergeConcurrentTable(localTable, remoteTable) : remoteTable,
      { announce: false, touch: false },
    );
    if (localTable && tablesMatch(localTable, nextTable)) return;
    tableRef.current = nextTable;
    setTable(nextTable);
    if (!taskEditingRef.current) setTaskDraft(nextTable.currentRound.task);

    const nextIdentity = identityRef.current;
    const nextJoinOpen = !identityCanViewTable(nextTable, nextIdentity);
    setJoinOpen((current) => current === nextJoinOpen ? current : nextJoinOpen);
  };

  useEffect(() => {
    let mounted = true;
    const localTable = getTable(slug);
    const localIdentity = readIdentity(slug);
    if (localTable) {
      tableRef.current = localTable;
      setTable(localTable);
      setTaskDraft(localTable.currentRound.task);
    }
    identityRef.current = localIdentity;
    setIdentity(localIdentity);
    setJoinOpen(Boolean(localTable && !identityCanViewTable(localTable, localIdentity)));

    void fetchRemoteTable(slug).then((remoteTable) => {
      if (!mounted || !remoteTable) return;
      applyRemoteTableRef.current(remoteTable);
      const nextIdentity = readIdentity(slug);
      identityRef.current = nextIdentity;
      setIdentity(nextIdentity);
      const currentTable = tableRef.current;
      setJoinOpen(Boolean(currentTable && !identityCanViewTable(currentTable, nextIdentity)));
    }).finally(() => {
      if (mounted) setRemoteLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [slug]);

  useEffect(() => subscribeToTable(slug, (remoteTable) => {
    const local = getTable(slug);
    if (local) applyRemoteTableRef.current(local);
    if (remoteTable) {
      applyRemoteTableRef.current(remoteTable);
      return;
    }
    void fetchRemoteTable(slug).then((nextRemoteTable) => {
      if (nextRemoteTable) applyRemoteTableRef.current(nextRemoteTable);
    });
  }), [slug]);

  useEffect(() => {
    if (tableName) setRenameValue(tableName);
  }, [tableName]);

  useEffect(() => {
    const revealStartedAt = table?.currentRound.revealStartedAt;
    if (!revealStartedAt || table.currentRound.revealed) {
      setCountdown(null);
      return;
    }

    const startTime = new Date(revealStartedAt).getTime();
    const revealAt = startTime + 2700;
    const updateCountdown = () => {
      const elapsed = Date.now() - startTime;
      setCountdown(elapsed >= 2700 ? null : Math.max(1, 3 - Math.floor(elapsed / 900)));
    };
    updateCountdown();
    const timer = window.setTimeout(() => {
      setCountdown(null);
      if (isCreator) {
        commitTable((current) => {
          if (current.currentRound.revealed || !current.currentRound.revealStartedAt) return current;
          const revealedAt = new Date().toISOString();
          return {
            ...current,
            currentRound: { ...current.currentRound, revealed: true, revealStartedAt: undefined, revealedAt },
            history: current.history.filter((round) => round.id !== current.currentRound.id),
          };
        });
      }
    }, Math.max(0, revealAt - Date.now()));

    return () => window.clearTimeout(timer);
    // The reveal timestamp is shared room state, so every connected client can show the countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.currentRound.revealStartedAt, table?.currentRound.revealed, isCreator]);

  function joinTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = joinForm.name.trim();
    if (!name || !table) {
      setJoinError("Your name is needed to take a seat.");
      return;
    }
    const latestTable = getTable(slug) ?? tableRef.current ?? table;
    const existingMember = identity
      ? latestTable.members.find((member) => member.id === identity.participantId)
      : undefined;
    if (!existingMember && latestTable.members.length >= MAX_TABLE_MEMBERS) {
      setJoinError(`This table is full. ${MAX_TABLE_MEMBERS} players maximum.`);
      return;
    }
    const existingIdentity = existingMember ? identity : null;
    const participantId = existingIdentity?.participantId ?? randomId("member");
    const joinedAt = new Date().toISOString();
    const participant: Participant = {
      id: participantId,
      name,
      team: joinForm.team.trim(),
      isCreator: existingMember?.isCreator ?? false,
      isDealer: existingMember?.isDealer ?? false,
      joinedAt: existingMember?.joinedAt ?? joinedAt,
      lastSeenAt: joinedAt,
    };
    const nextIdentity: TableIdentity = { tableSlug: slug, participantId, name, team: participant.team, isCreator: participant.isCreator, isDealer: participant.isDealer, role: "participant" };
    commitTable((current) => ({
      ...current,
      members: current.members.some((member) => member.id === participantId)
        ? current.members.map((member) => member.id === participantId ? { ...member, name, team: participant.team, lastSeenAt: joinedAt } : member)
        : [...current.members, participant],
    }), { type: "join", participant });
    writeIdentity(slug, nextIdentity);
    identityRef.current = nextIdentity;
    setIdentity(nextIdentity);
    setJoinOpen(false);
    setJoinError("");
  }

  function watchAsSpectator() {
    const nextIdentity: TableIdentity = {
      tableSlug: slug,
      participantId: randomId("spectator"),
      name: "Spectator",
      team: "",
      isCreator: false,
      isDealer: false,
      role: "spectator",
    };
    writeIdentity(slug, nextIdentity);
    identityRef.current = nextIdentity;
    setIdentity(nextIdentity);
    setJoinOpen(false);
    setJoinError("");
  }

  function joinAsParticipant() {
    clearIdentity(slug);
    identityRef.current = null;
    setIdentity(null);
    setJoinError("");
    setJoinOpen(true);
  }

  function selectVote(value: number) {
    if (!table || !currentMember || currentMember.isDealer || table.currentRound.revealed || countdown !== null) return;
    commitTable((current) => ({
      ...current,
      currentRound: {
        ...current.currentRound,
        votes: { ...current.currentRound.votes, [currentMember.id]: value },
      },
      members: current.members.map((member) => member.id === currentMember.id ? { ...member, lastSeenAt: new Date().toISOString() } : member),
    }));
  }

  function saveTask() {
    const current = tableRef.current;
    const nextTask = taskValueRef.current.trim();
    if (!current || !isCreator) return;
    if (nextTask !== current.currentRound.task) {
      commitTable((latest) => ({ ...latest, currentRound: { ...latest.currentRound, task: nextTask } }));
    }
    setTaskDraft(nextTask);
    taskEditingRef.current = false;
  }

  function onTaskKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function revealCards() {
    if (!table || !isCreator || !allVoted || table.currentRound.revealed || countdown !== null) return;
    commitTable((current) => ({
      ...current,
      currentRound: { ...current.currentRound, revealStartedAt: new Date().toISOString() },
    }));
  }

  function startNextRound(clearTask: boolean) {
    const current = tableRef.current;
    if (!current || !isCreator || !current.currentRound.revealed) return;
    const createdAt = new Date().toISOString();
    const nextTask = clearTask ? "" : current.currentRound.task;
    const previousSummary = summaryForRound(current.currentRound);
    const nextHistory = [...current.history.filter((round) => round.id !== previousSummary.id), previousSummary];
    commitTable((current) => ({
      ...current,
      currentRound: {
        id: randomId("round"),
        number: current.currentRound.number + 1,
        task: nextTask,
        votes: {},
        revealed: false,
        createdAt,
      },
      history: nextHistory,
    }));
    setTaskDraft(nextTask);
    taskEditingRef.current = false;
  }

  function removeMember(memberId: string) {
    if (!isCreator || memberId === identity?.participantId) return;
    commitTable((current) => ({
      ...current,
      members: current.members.filter((member) => member.id !== memberId),
      currentRound: { ...current.currentRound, votes: Object.fromEntries(Object.entries(current.currentRound.votes).filter(([id]) => id !== memberId)) },
    }));
  }

  function toggleOwnRole() {
    if (!table || !isCreator || !currentMember) return;
    const nextDealer = !currentMember.isDealer;
    commitTable((current) => ({
      ...current,
      members: current.members.map((member) => member.id === currentMember.id ? { ...member, isDealer: nextDealer } : member),
      currentRound: { ...current.currentRound, votes: Object.fromEntries(Object.entries(current.currentRound.votes).filter(([id]) => id !== currentMember.id)) },
    }));
    const nextIdentity = identity ? { ...identity, isDealer: nextDealer } : null;
    if (nextIdentity) {
      writeIdentity(slug, nextIdentity);
      identityRef.current = nextIdentity;
      setIdentity(nextIdentity);
    }
  }

  function saveTableName() {
    if (!table || !isCreator || !renameValue.trim()) return;
    commitTable((current) => ({ ...current, name: renameValue.trim() }));
  }

  async function copyTableLink() {
    const link = window.location.href;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function leaveTable() {
    clearIdentity(slug);
    router.push("/");
  }

  if (remoteLoading && !table) return <main className="room-loading"><div className="loading-mark"><Spade size={28} fill="currentColor" /></div><span>Finding your table...</span></main>;
  if (!table) return <main className="room-missing"><div className="missing-card"><span className="missing-icon"><Spade size={26} fill="currentColor" /></span><div className="eyebrow">TABLE NOT FOUND</div><h1>This hand has left the table.</h1><p>Check the invite link or ask the dealer to deal a new room.</p><button className="button button-primary" onClick={() => router.push("/")}><ArrowLeft size={16} /> Back to home</button></div></main>;

  return <main className="room-page">
    <div className="noise" aria-hidden="true" />
    <header className="room-nav page-width">
      <button className="brand-lockup" onClick={() => router.push("/")} aria-label="Back to home"><span className="brand-mark"><Spade size={18} fill="currentColor" /></span><span><strong>DEALER&apos;S CHOICE</strong><small>PLANNING POKER</small></span></button>
      <div className="room-breadcrumb"><span>TABLES</span><ChevronRight size={14} /><b>{table.name}</b></div>
      <div className="room-nav-actions"><span className="live-pill"><i /> {isSpectator ? "WATCHING" : "LIVE"} <b>ROUND {String(table.currentRound.number).padStart(2, "0")}</b></span><button className="icon-button" onClick={copyTableLink} aria-label="Copy table link" title="Copy invite link">{copied ? <Check size={17} /> : <Link2 size={17} />}</button><button className="icon-button mobile-menu-button" onClick={() => setManageOpen(true)} aria-label="Open table menu"><Menu size={19} /></button><span className={`nav-user-avatar ${isSpectator ? "nav-spectator" : currentMember ? `avatar-${memberColor(table.members.findIndex((member) => member.id === currentMember.id))}` : ""}`} aria-label={isSpectator ? "Spectator" : currentMember?.name ?? "Unassigned seat"}>{isSpectator ? <Eye size={14} /> : currentMember ? initials(currentMember.name) : "?"}</span></div>
    </header>

    <div className="room-layout page-width">
      <section className="room-main">
        <div className="room-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> TABLE {table.slug.toUpperCase()}</div><h1>{table.currentRound.revealed ? "The hand is on the table." : "Keep your cards close."}</h1><p>{table.currentRound.revealed ? "The room has spoken. Read the signal, then deal the next task." : isSpectator ? "Follow every card and reveal in real time. You are watching only." : "Choose your estimate in private. The dealer will call the reveal."}</p></div><button className="share-button" onClick={copyTableLink}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Link copied" : "Share invite"}</button></div>

        <section className={`felt-table ${table.members.length > DENSE_SEAT_THRESHOLD ? "felt-table-crowded" : ""}`} aria-label={`${table.name} planning poker table`}>
          <div className="felt-stitch" />
          <div className="felt-header"><span><span className="table-pip" /> DEALER&apos;S TABLE</span><span className="felt-header-right">FIBONACCI <i /> 1 — 21</span></div>
          <div className={`felt-task ${isCreator && !table.currentRound.revealed ? "felt-task-editable" : ""}`}>
            <span className="felt-task-kicker">ROUND {String(table.currentRound.number).padStart(2, "0")} / CURRENT TASK</span>
            {isCreator && !table.currentRound.revealed ? <input className="task-input-autosize" value={taskValue} style={{ width: taskInputWidth(taskValue) }} onFocus={() => { taskEditingRef.current = true; }} onChange={(event) => setTaskDraft(event.target.value)} onBlur={saveTask} onKeyDown={onTaskKeyDown} placeholder="Name the task you are estimating..." aria-label="Current task" /> : <strong>{table.currentRound.task || "Task name coming from the dealer"}</strong>}
            {isCreator && !table.currentRound.revealed && <span className="task-edit-hint"><Edit3 size={12} /> {taskValue ? "Edit task" : "Add task"}</span>}
          </div>

          <div className="seat-stage">
            {table.members.map((member, index) => <SeatCard key={member.id} member={member} voted={table.currentRound.votes[member.id] !== undefined} revealed={table.currentRound.revealed} vote={table.currentRound.votes[member.id]} color={memberColor(index)} isYou={member.id === identity?.participantId} index={index} total={table.members.length} />)}
          </div>

          <div className={`table-center ${table.currentRound.revealed ? "center-revealed" : ""}`}>
            {!table.currentRound.revealed ? <>
              <div className="center-emblem"><span><Spade size={23} fill="currentColor" /></span><small>THE HOUSE</small></div>
              <span className="center-status">{isSpectator ? "YOU ARE WATCHING" : isDealer ? "YOU ARE DEALING" : `${votedCount} OF ${activeParticipants.length} CARDS DEALT`}</span>
              <div className="center-action">
                {isCreator ? <button className="reveal-button" onClick={revealCards} disabled={!allVoted || countdown !== null}><span className="reveal-button-icon">{countdown !== null ? countdown : <Play size={15} fill="currentColor" />}</span><span><b>{countdown !== null ? "REVEALING..." : "SHOW ALL CARDS"}</b><small>{allVoted ? "The table is ready" : `Waiting on ${Math.max(0, activeParticipants.length - votedCount)} ${activeParticipants.length - votedCount === 1 ? "vote" : "votes"}`}</small></span><ArrowRight size={16} /></button> : <div className="waiting-dealer">{isSpectator ? <Eye size={15} /> : <Clock3 size={15} />}<span>{isSpectator ? "Watching the dealer reveal" : "Waiting for the dealer to reveal"}</span></div>}
              </div>
            </> : <>
              <div className="revealed-kicker"><span className="table-pip gold-pip" /> HAND REVEALED <span className="table-pip gold-pip" /></div>
              <div className={`revealed-cards ${activeParticipants.length > 7 ? "revealed-cards-many" : ""}`}>{activeParticipants.map((member, index) => <div className="revealed-card" key={member.id} style={{ "--reveal-index": index } as React.CSSProperties}><span>{table.currentRound.votes[member.id] ?? "—"}</span><small>{member.name.split(" ")[0]}</small></div>)}</div>
              <div className="center-results"><div><small>TABLE ALIGNMENT</small><strong>{alignment}%</strong><MetricBar value={alignment} /></div><div><small>AVERAGE SCORE</small><strong>{displayAverage(average)}</strong><span className="result-spark">{table.currentRound.votes && Object.keys(table.currentRound.votes).length} votes in</span></div></div>
              {isCreator && <div className="revealed-actions"><button className="button button-primary" onClick={() => startNextRound(false)}><RefreshCw size={15} /> Replay hand</button><button className="button button-ghost-light" onClick={() => startNextRound(true)}><Trash2 size={15} /> Clear table</button></div>}
              {!isCreator && <div className="waiting-dealer revealed-note">{isSpectator ? <><Eye size={15} /><span>You are watching the table</span></> : <><Check size={15} /><span>The dealer is choosing what&apos;s next</span></>}</div>}
            </>}
          </div>
          {countdown !== null && <div className="reveal-overlay"><div className="countdown-ring"><span>{countdown}</span></div><b>THE DEALER IS REVEALING</b><small>Hold your nerve.</small></div>}
        </section>

        {!isSpectator && !isDealer && !table.currentRound.revealed && <section className="hand-section"><div className="hand-heading"><div><div className="eyebrow">YOUR HAND <span className="hand-live-dot" /></div><h2>Pick your estimate.</h2></div><span>{currentMember && table.currentRound.votes[currentMember.id] !== undefined ? <><Check size={14} /> Card dealt face down</> : "Tap a card to deal it"}</span></div><div className="card-fan">{FIBONACCI_VALUES.map((value, index) => <PokerCard key={value} value={value} index={index} selected={currentMember ? table.currentRound.votes[currentMember.id] === value : false} disabled={!currentMember || table.currentRound.revealed || countdown !== null} onSelect={() => selectVote(value)} />)}</div><div className="hand-footer"><span><ShieldCheck size={14} /> Your vote stays private until the reveal.</span><span>FIBONACCI DECK <i /> 7 CARDS</span></div></section>}
        {!isSpectator && isDealer && !table.currentRound.revealed && <section className="dealer-hand"><div className="dealer-hand-icon"><Crown size={21} /></div><div><div className="eyebrow">DEALER MODE</div><h2>You run the reveal.</h2><p>Participants are choosing their cards. When the table is ready, reveal the hand above.</p></div><span className="dealer-hand-status"><i /> {votedCount}/{activeParticipants.length} ready</span></section>}
      </section>

      <aside className="room-sidebar">
        <section className="sidebar-panel roster-panel"><div className="panel-heading"><div><div className="eyebrow">AT THE TABLE</div><h2>{table.members.length} {table.members.length === 1 ? "player" : "players"}</h2></div><span className="online-count"><i /> LIVE</span></div><div className="roster-list">{table.members.map((member, index) => <div className={`roster-row ${member.id === identity?.participantId ? "roster-you" : ""}`} key={member.id}><span className={`roster-avatar avatar-${memberColor(index)}`}>{initials(member.name)}</span><span className="roster-copy"><b>{member.name}{member.id === identity?.participantId && <em>YOU</em>}</b><small>{member.isDealer ? "Dealer" : member.team || "No team"}</small></span>{member.isDealer ? <Crown size={14} className="roster-crown" fill="currentColor" /> : <span className={`roster-vote-dot ${table.currentRound.votes[member.id] !== undefined ? "ready" : ""}`} title={table.currentRound.votes[member.id] !== undefined ? "Card dealt" : "Thinking"} />}{isCreator && !member.isCreator && <button className="remove-player" onClick={() => removeMember(member.id)} aria-label={`Remove ${member.name}`}><X size={13} /></button>}</div>)}</div><button className="invite-button" onClick={copyTableLink}><UserPlus size={15} /> Invite a player <Copy size={13} /></button></section>

        <section className="sidebar-panel metrics-panel"><div className="panel-heading"><div><div className="eyebrow">THE READ</div><h2>Power bars</h2></div><Info size={15} /></div><div className="metric-item"><div><span>Table alignment</span><b>{table.currentRound.revealed ? `${alignment}%` : "—"}</b></div><MetricBar value={alignment} tone="gold" /></div><div className="metric-item"><div><span>Session coherence</span><b>{coherence ? `${coherence}%` : "—"}</b></div><MetricBar value={coherence} tone="mint" /></div><div className="metric-average"><span>Average score</span><strong>{table.currentRound.revealed ? displayAverage(average) : "—"}</strong><small>{table.currentRound.revealed ? "across the table" : "revealed after the hand"}</small></div>{table.currentRound.revealed && <div className="team-metrics"><div className="subpanel-label">BY TEAM</div>{teamMetrics.map((metric) => <div className="team-metric" key={metric.team}><span><i /> {metric.team}<small>{metric.votes}/{metric.members} voted</small></span><MetricBar value={metric.alignment} tone="coral" compact /></div>)}</div>}</section>

        <section className="sidebar-panel ledger-panel"><RoundLedger history={table.history} current={table.currentRound} /></section>

        <section className="sidebar-footer"><button onClick={() => setManageOpen(true)}><Settings2 size={15} /> {isCreator ? "Manage table" : "Table details"}<ChevronRight size={14} /></button>{isSpectator && <button onClick={joinAsParticipant}><UserPlus size={15} /> Join as player<ChevronRight size={14} /></button>}<button onClick={leaveTable}><LogOut size={15} /> Leave table</button></section>
      </aside>
    </div>

    {joinOpen && <div className="modal-backdrop join-backdrop"><section className="join-modal" role="dialog" aria-modal="true" aria-labelledby="join-title"><div className="join-card-suit"><Spade size={22} fill="currentColor" /></div><div className="eyebrow">YOU&apos;RE INVITED</div><h2 id="join-title">Take a seat at<br /><em>{table.name}</em></h2><p>Tell the table who just walked in. Your name is saved on this device for this room.</p><form onSubmit={joinTable}><label>Your name<input autoFocus value={joinForm.name} onChange={(event) => setJoinForm({ ...joinForm, name: event.target.value })} placeholder="e.g. Sam Lee" /></label><label>Team <small>OPTIONAL</small><input value={joinForm.team} onChange={(event) => setJoinForm({ ...joinForm, team: event.target.value })} placeholder="e.g. Design" /></label>{joinError && <div className="form-error">{joinError}</div>}<button className="button button-primary modal-submit" type="submit">Join the table <ArrowRight size={16} /></button></form><div className="spectator-option"><span>Just here to follow along?</span><button type="button" onClick={watchAsSpectator}><Eye size={15} /> Watch as spectator <ArrowRight size={15} /></button></div><div className="join-privacy"><ShieldCheck size={13} /> You can change your details from your seat.</div></section></div>}

    {manageOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOpen(false); }}><section className="manage-modal" role="dialog" aria-modal="true" aria-labelledby="manage-title"><div className="manage-header"><div><div className="eyebrow">{isCreator ? "HOUSE CONTROL" : "TABLE INFO"}</div><h2 id="manage-title">{isCreator ? "Manage the table." : "Table details."}</h2></div><button className="modal-close" onClick={() => setManageOpen(false)} aria-label="Close"><X size={18} /></button></div>{isCreator ? <><label>Table name<div className="inline-input"><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /><button onClick={() => { saveTableName(); setManageOpen(false); }}><Check size={15} /></button></div></label><div className="manage-option"><span className="manage-option-icon"><Crown size={16} /></span><span><b>Your role</b><small>{isDealer ? "Dealer only · You call the reveal" : "Participant · You vote with the room"}</small></span><button className="role-toggle" onClick={toggleOwnRole}>{isDealer ? "Play hand" : "Deal only"}</button></div><div className="manage-invite"><div><div className="eyebrow">PRIVATE INVITE LINK</div><p>Anyone with this link can take an open seat.</p></div><button className="button button-ghost" onClick={copyTableLink}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy link"}</button></div><div className="manage-members"><div className="subpanel-label">REMOVE PLAYERS</div>{table.members.filter((member) => !member.isCreator).map((member) => <div className="manage-member" key={member.id}><span className={`roster-avatar avatar-${memberColor(table.members.indexOf(member))}`}>{initials(member.name)}</span><span><b>{member.name}</b><small>{member.team || "No team"}</small></span><button onClick={() => removeMember(member.id)}><Trash2 size={14} /></button></div>)}{table.members.filter((member) => !member.isCreator).length === 0 && <p className="no-members">No invited players yet. Share the link to deal them in.</p>}</div></> : <><div className="table-info-grid"><div><small>TABLE</small><b>{table.name}</b></div><div><small>ROUND</small><b>{String(table.currentRound.number).padStart(2, "0")}</b></div><div><small>CREATED BY</small><b>{table.members.find((member) => member.isCreator)?.name ?? "Dealer"}</b></div><div><small>DECK</small><b>Fibonacci</b></div></div><div className="manage-invite"><div><div className="eyebrow">WANT TO BRING SOMEONE IN?</div><p>Ask the dealer for the invite link.</p></div><button className="button button-ghost" onClick={copyTableLink}><Copy size={15} /> Copy link</button></div></>}<button className="manage-close" onClick={() => setManageOpen(false)}>Close panel</button></section></div>}
  </main>;
}
