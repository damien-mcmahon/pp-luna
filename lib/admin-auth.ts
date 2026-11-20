import { createHash } from "node:crypto";
import { createClient, Session, SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { cookieName, privateJson, readCookie, sameOrigin, secureCookie } from "@/lib/http-security";

export const ACCESS_COOKIE = cookieName("vegas-admin-access");
export const REFRESH_COOKIE = cookieName("vegas-admin-refresh");

export function getAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  }) : null;
}

export function setAdminCookies(response: NextResponse, session: Session | null) {
  response.cookies.set(ACCESS_COOKIE, session?.access_token ?? "", {
    ...secureCookie, maxAge: session ? session.expires_in : 0,
  });
  response.cookies.set(REFRESH_COOKIE, session?.refresh_token ?? "", {
    ...secureCookie, maxAge: session ? 60 * 60 * 8 : 0,
  });
  response.cookies.set("dealers-choice-admin", "", { ...secureCookie, maxAge: 0 });
  return response;
}

export async function adminAllowed(client: SupabaseClient, userId: string) {
  const result = await client.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  if (result.error) throw new Error("Unable to verify administrator access.");
  return Boolean(result.data);
}

export function requiresMfa(user: User) {
  return process.env.ADMIN_REQUIRE_MFA !== "false" || Boolean(user.factors?.some((factor) => factor.status === "verified"));
}

export function hasRequiredAssurance(accessToken: string, required = true) {
  if (!required) return true;
  try {
    // Only call after Supabase has verified this token with getUser.
    return JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString()).aal === "aal2";
  } catch {
    return false;
  }
}

export async function withAdmin(
  request: Request,
  handler: (context: { client: SupabaseClient; userId: string; accessToken: string }) => Promise<NextResponse>,
) {
  if (request.method !== "GET" && !sameOrigin(request)) return privateJson({ error: "Invalid origin." }, 403);
  const client = getSupabaseAdmin();
  const auth = getAuthClient();
  if (!client || !auth) return privateJson({ error: "Admin authentication is not configured." }, 503);
  try {
    let accessToken = readCookie(request, ACCESS_COOKIE);
    let refreshed: Session | null = null;
    let user = accessToken ? (await auth.auth.getUser(accessToken)).data.user : null;
    if (!user) {
      const refreshToken = readCookie(request, REFRESH_COOKIE);
      if (refreshToken) {
        const result = await auth.auth.refreshSession({ refresh_token: refreshToken });
        refreshed = result.data.session;
        accessToken = refreshed?.access_token;
        user = accessToken ? (await auth.auth.getUser(accessToken)).data.user : null;
      }
    }
    if (!user || !accessToken) return setAdminCookies(privateJson({ error: "Please sign in." }, 401), null);
    if (!await adminAllowed(client, user.id)) {
      return setAdminCookies(privateJson({ error: "Administrator access required." }, 403), null);
    }
    if (!hasRequiredAssurance(accessToken, requiresMfa(user))) {
      return setAdminCookies(privateJson({ error: "MFA verification required.", mfaRequired: true }, 403), null);
    }
    const response = await handler({ client, userId: user.id, accessToken });
    return refreshed ? setAdminCookies(response, refreshed) : response;
  } catch {
    return privateJson({ error: "Unable to verify administrator access. Please try again." }, 503);
  }
}

export function loginRateKey(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
