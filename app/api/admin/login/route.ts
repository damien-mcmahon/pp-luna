import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string; password?: string };
  if (body.username !== "admin" || body.password !== "admin") {
    return NextResponse.json({ error: "Invalid admin credentials." }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set("dealers-choice-admin", "admin", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
