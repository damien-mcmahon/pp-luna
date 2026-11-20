import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookieName, readCookie, secureCookie } from "@/lib/http-security";
import { TableRecord } from "@/lib/types";

export function seatCookieName(slug: string) {
  return cookieName(`vegas-seat-${encodeURIComponent(slug)}`);
}

export function seatToken(request: Request, slug: string) {
  const token = readCookie(request, seatCookieName(slug));
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function newSeatToken() {
  return randomBytes(32).toString("hex");
}

export function hashSeatToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function setSeatCookie(response: NextResponse, slug: string, token: string) {
  response.cookies.set(seatCookieName(slug), token, { ...secureCookie, maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export function tableForViewer(table: TableRecord, viewerId: string | null): TableRecord {
  return {
    ...table,
    viewerId,
    currentRound: {
      ...table.currentRound,
      votes: Object.fromEntries(Object.entries(table.currentRound.votes).map(([id, value]) => [
        id, table.currentRound.revealed || id === viewerId ? value : null,
      ])),
    },
    // Defense in depth if a future loader includes incomplete rounds here.
    history: table.history.filter((round) => Boolean(round.revealedAt)),
  };
}
