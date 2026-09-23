import { NextResponse } from "next/server";
import { getLtiConfig } from "@/lib/lti/config";

export const runtime = "nodejs";

/**
 * OIDC login initiation (LTI 1.3).
 * D2L redirects here first; we bounce to the platform auth endpoint.
 * Full auth request signing ships with production D2L registration.
 */
export async function GET(req: Request) {
  const cfg = getLtiConfig();
  const url = new URL(req.url);
  const iss = url.searchParams.get("iss") || cfg.issuer;
  const loginHint = url.searchParams.get("login_hint") || "";
  const targetLinkUri =
    url.searchParams.get("target_link_uri") || cfg.urls.launch;
  const clientId =
    url.searchParams.get("client_id") || cfg.clientId || "pending-client-id";
  const ltiMessageHint = url.searchParams.get("lti_message_hint") || "";

  if (!iss || !cfg.issuer) {
    // Dev-friendly response when platform not configured
    return NextResponse.json({
      ok: false,
      message:
        "LTI login initiation ready. Set LTI_ISSUER and platform auth URL after D2L registration.",
      received: {
        iss,
        loginHint,
        targetLinkUri,
        clientId,
        ltiMessageHint,
      },
      next: "For local testing use /pilot instead of real OIDC.",
      launch: cfg.urls.launch,
      pilot: cfg.urls.pilot,
    });
  }

  // Placeholder: real implementation redirects to D2L authorize URL with
  // response_type=id_token, scope=openid, nonce, state, etc.
  const authorize = new URL(iss);
  // Many LMS expose a separate auth endpoint via discovery; document in README.
  return NextResponse.json({
    ok: false,
    message:
      "OIDC redirect not fully wired — use /pilot tonight; register tool URLs in D2L, then complete authorize redirect.",
    wouldSend: {
      client_id: clientId,
      login_hint: loginHint,
      lti_message_hint: ltiMessageHint,
      redirect_uri: cfg.urls.redirect,
      response_mode: "form_post",
      response_type: "id_token",
      scope: "openid",
      prompt: "none",
    },
  });
}

export async function POST(req: Request) {
  return GET(req);
}
