import { getSupabaseAdmin } from "@/lib/supabase-server";
import { ACCESS_COOKIE, getAuthClient, REFRESH_COOKIE, setAdminCookies, withAdmin } from "@/lib/admin-auth";
import { privateJson, readCookie, sameOrigin } from "@/lib/http-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdmin(request, async () => privateJson({ authenticated: true }));
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return privateJson({ error: "Invalid origin." }, 403);
  let token = readCookie(request, ACCESS_COOKIE);
  const client = getSupabaseAdmin();
  const refreshToken = readCookie(request, REFRESH_COOKIE);
  if (!token && refreshToken) {
    const auth = getAuthClient();
    token = (await auth?.auth.refreshSession({ refresh_token: refreshToken }))?.data.session?.access_token;
  }
  if (client && token) await client.auth.admin.signOut(token, "local");
  return setAdminCookies(privateJson({ authenticated: false }), null);
}
