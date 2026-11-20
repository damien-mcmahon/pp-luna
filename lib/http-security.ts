import { NextResponse } from "next/server";

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin &&
    request.headers.get("sec-fetch-site") !== "cross-site";
}

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function readCookie(request: Request, name: string) {
  const entry = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

export function cookieName(name: string) {
  return process.env.NODE_ENV === "production" ? `__Host-${name}` : name;
}

export async function readJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new Error("Request body too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export const secureCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
