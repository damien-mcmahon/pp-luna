import { adminAllowed, getAuthClient, hasRequiredAssurance, loginRateKey, requiresMfa, setAdminCookies } from "@/lib/admin-auth";
import { privateJson, readJson, sameOrigin } from "@/lib/http-security";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return privateJson({ error: "Invalid origin." }, 403);
  const auth = getAuthClient();
  const client = getSupabaseAdmin();
  if (!auth || !client) return privateJson({ error: "Admin authentication is not configured." }, 503);
  try {
    const body = await readJson(request);
    if (typeof body.email !== "string" || body.email.length > 254 ||
        typeof body.password !== "string" || !body.password || body.password.length > 1024) {
      return privateJson({ error: "Enter your email and password." }, 400);
    }
    const limit = await client.rpc("consume_admin_login_attempt", { p_key: loginRateKey(body.email) });
    if (limit.error) return privateJson({ error: "Unable to sign in. Please try again." }, 503);
    if (!limit.data) return privateJson({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    const { data, error } = await auth.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error || !data.session || !data.user) {
      return setAdminCookies(privateJson({ error: "Invalid credentials or administrator access unavailable." }, 401), null);
    }
    if (!await adminAllowed(client, data.user.id)) {
      await auth.auth.signOut({ scope: "local" });
      return setAdminCookies(privateJson({ error: "Invalid credentials or administrator access unavailable." }, 401), null);
    }
    if (!hasRequiredAssurance(data.session.access_token, requiresMfa(data.user))) {
      // First-time enrollment is available only after a valid password AND allowlist check.
      // No admin cookies are issued until a TOTP challenge is verified.
      const factors = await auth.auth.mfa.listFactors();
      if (factors.error) {
        await auth.auth.signOut({ scope: "local" });
        return privateJson({ error: "Unable to check MFA factors." }, 503);
      }
      const verifiedFactor = factors.data.totp.find((entry) => entry.status === "verified");
      const factor = verifiedFactor ?? factors.data.all.find((entry) =>
        entry.factor_type === "totp" && entry.id === body.factorId && entry.status === "unverified");
      if (!factor) {
        // Replace abandoned enrollment attempts, not verified factors.
        for (const pending of factors.data.all.filter((entry) => entry.factor_type === "totp" && entry.status === "unverified")) {
          await auth.auth.mfa.unenroll({ factorId: pending.id });
        }
        const enrolled = await auth.auth.mfa.enroll({ factorType: "totp", friendlyName: "Vegas admin" });
        if (enrolled.error || enrolled.data.type !== "totp") {
          await auth.auth.signOut({ scope: "local" });
          return privateJson({ error: "Unable to enroll MFA. Ask the project owner to enable TOTP in Supabase." }, 503);
        }
        await auth.auth.signOut({ scope: "local" });
        return privateJson({
          error: "Scan this QR code with your authenticator, then enter its six-digit code.",
          mfaRequired: true,
          enrollment: { factorId: enrolled.data.id, qrCode: enrolled.data.totp.qr_code },
        }, 403);
      }
      if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
        await auth.auth.signOut({ scope: "local" });
        return privateJson({ error: "Enter your six-digit authenticator code.", mfaRequired: true }, 403);
      }
      const challenge = await auth.auth.mfa.challenge({ factorId: factor.id });
      if (challenge.error) {
        await auth.auth.signOut({ scope: "local" });
        return privateJson({ error: "Unable to verify authenticator code." }, 401);
      }
      const verified = await auth.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code: body.code });
      const session = (await auth.auth.getSession()).data.session;
      if (verified.error || !session || !hasRequiredAssurance(session.access_token)) {
        await auth.auth.signOut({ scope: "local" });
        return privateJson({ error: "Invalid authenticator code.", mfaRequired: true }, 401);
      }
      return setAdminCookies(privateJson({ authenticated: true }), session);
    }
    return setAdminCookies(privateJson({ authenticated: true }), data.session);
  } catch {
    await auth.auth.signOut({ scope: "local" }).catch(() => undefined);
    return privateJson({ error: "Unable to sign in. Please try again." }, 503);
  }
}
