import {
  Participant,
  Round,
  TableIdentity,
  TableMode,
  TableRecord,
} from "@/lib/types";

const TABLES_KEY = "dealers-choice.tables.v1";
const TABLE_EVENT_KEY = "dealers-choice.table-event.v1";
const COOKIE_PREFIX = "dealers-choice-seat-";

function now() {
  return new Date().toISOString();
}

export function randomId(prefix: string) {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) {
    return `${prefix}_${cryptoObject.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36).slice(-4)}`;
}

function readTables(): TableRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(TABLES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as TableRecord[]) : [];
  } catch {
    return [];
  }
}

function writeTables(tables: TableRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TABLES_KEY, JSON.stringify(tables));
}

function slugify(value: string) {
  const cleaned = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 25);

  return `${cleaned || "private-table"}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createTableRecord({
  tableName,
  creatorName,
  mode,
}: {
  tableName: string;
  creatorName: string;
  mode: TableMode;
}) {
  const createdAt = now();
  const creatorId = randomId("member");
  const creator: Participant = {
    id: creatorId,
    name: creatorName.trim(),
    team: "",
    isCreator: true,
    isDealer: mode === "dealer",
    joinedAt: createdAt,
    lastSeenAt: createdAt,
  };
  const round: Round = {
    id: randomId("round"),
    number: 1,
    task: "",
    votes: {},
    revealed: false,
    createdAt,
  };
  const table: TableRecord = {
    id: randomId("table"),
    slug: slugify(tableName),
    name: tableName.trim(),
    creatorId,
    createdAt,
    updatedAt: createdAt,
    currentRound: round,
    members: [creator],
    history: [],
  };

  saveTable(table);
  writeIdentity(table.slug, {
    tableSlug: table.slug,
    participantId: creatorId,
    name: creator.name,
    team: creator.team,
    isCreator: true,
    isDealer: creator.isDealer,
  });

  return table;
}

export function getTables() {
  return readTables().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getTable(slug: string) {
  return readTables().find((table) => table.slug === slug) ?? null;
}

export function saveTable(table: TableRecord, options: { announce?: boolean; touch?: boolean } = {}) {
  const nextTable = { ...table, updatedAt: options.touch === false ? table.updatedAt : now() };
  const tables = readTables();
  const existingIndex = tables.findIndex((entry) => entry.slug === table.slug);

  if (existingIndex >= 0) {
    tables[existingIndex] = nextTable;
  } else {
    tables.push(nextTable);
  }

  writeTables(tables);
  if (options.announce !== false) announceTableChange(table.slug);
  return nextTable;
}

export function removeTable(slug: string) {
  writeTables(readTables().filter((table) => table.slug !== slug));
  announceTableChange(slug);
}

export function readIdentity(slug: string): TableIdentity | null {
  if (typeof document === "undefined") return null;

  const cookieName = `${COOKIE_PREFIX}${encodeURIComponent(slug)}`;
  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`));

  if (!cookie) return null;

  try {
    return JSON.parse(decodeURIComponent(cookie.slice(cookieName.length + 1))) as TableIdentity;
  } catch {
    return null;
  }
}

export function writeIdentity(slug: string, identity: TableIdentity) {
  if (typeof document === "undefined") return;
  const cookieName = `${COOKIE_PREFIX}${encodeURIComponent(slug)}`;
  document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(identity))}; path=/; max-age=31536000; samesite=lax`;
}

export function clearIdentity(slug: string) {
  if (typeof document === "undefined") return;
  const cookieName = `${COOKIE_PREFIX}${encodeURIComponent(slug)}`;
  document.cookie = `${cookieName}=; path=/; max-age=0; samesite=lax`;
}

export function announceTableChange(slug: string) {
  if (typeof window === "undefined") return;
  const detail = { slug, stamp: Date.now() };
  window.localStorage.setItem(TABLE_EVENT_KEY, JSON.stringify(detail));
  window.dispatchEvent(new CustomEvent(TABLE_EVENT_KEY, { detail }));
}

export function tableEventKey() {
  return TABLE_EVENT_KEY;
}
