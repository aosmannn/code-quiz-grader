import { NextResponse } from "next/server";
import { getLtiConfig } from "@/lib/lti/config";
import { parseLaunchClaims, saveLtiSession } from "@/lib/lti/session";

export const runtime = "nodejs";

/**
 * LTI launch target.
 * - Production: D2L posts id_token (OIDC) here after /lti/login — JWT verify TBD.
 * - Pilot: accepts form fields or JSON claims (dev simulator + LTI 1.1-style).
 */
async function handleLaunch(req: Request) {
  const cfg = getLtiConfig();
  const contentType = req.headers.get("content-type") || "";

  let fields: Record<string, string | undefined> = {};

  if (contentType.includes("application/json")) {
    fields = (await req.json()) as Record<string, string | undefined>;
  } else {
    const form = await req.formData();
    form.forEach((v, k) => {
      fields[k] = typeof v === "string" ? v : String(v);
    });
  }

  // If id_token present, decode payload without verify for scaffolding
  // (production must verify against platform JWKS).
  if (fields.id_token && typeof fields.id_token === "string") {
    try {
      const parts = fields.id_token.split(".");
      if (parts.length >= 2) {
        const payload = JSON.parse(
          Buffer.from(parts[1], "base64url").toString("utf8"),
        ) as Record<string, unknown>;
        const flat: Record<string, string | undefined> = { ...fields };
        for (const [k, v] of Object.entries(payload)) {
          if (typeof v === "string" || typeof v === "number") {
            flat[k] = String(v);
          } else if (v && typeof v === "object") {
            // nested LTI claims — pull common titles
            const obj = v as Record<string, unknown>;
            if (k.includes("context") && obj.title) {
              flat.context_title = String(obj.title);
              flat.context_id = obj.id ? String(obj.id) : flat.context_id;
            }
            if (k.includes("resource_link") && obj.title) {
              flat.resource_link_title = String(obj.title);
              flat.resource_link_id = obj.id
                ? String(obj.id)
                : flat.resource_link_id;
            }
            if (k.includes("launch_presentation") && obj.return_url) {
              flat.returnUrl = String(obj.return_url);
            }
            if (k.includes("endpoint") || k.includes("ags")) {
              const li = obj.lineitem || obj.lineItem;
              if (typeof li === "string") flat.lineItemUrl = li;
            }
          }
        }
        fields = flat;
      }
    } catch {
      /* fall through with raw fields */
    }
  }

  const isDev =
    fields.isDevSim === "true" ||
    fields.dev === "1" ||
    Boolean(fields["cqg_dev"]);

  if (!cfg.allowDevLaunch && isDev) {
    return NextResponse.json(
      { error: "Dev launches are disabled on this host." },
      { status: 403 },
    );
  }

  // Production path without verified JWT yet: require at least a user id OR allowDevLaunch
  if (!fields.sub && !fields.user_id && !fields.name && !cfg.allowDevLaunch) {
    return NextResponse.json(
      {
        error:
          "LTI launch missing identity claims. Complete OIDC/JWKS verification wiring for production.",
      },
      { status: 400 },
    );
  }

  const claims = parseLaunchClaims({
    ...fields,
    isDevSim: isDev ? "true" : fields.isDevSim,
  });

  await saveLtiSession(claims);

  const dest = new URL("/", cfg.toolBaseUrl);
  dest.searchParams.set("launched", "1");
  if (isDev) dest.searchParams.set("pilot", "1");

  return NextResponse.redirect(dest, 303);
}

export async function POST(req: Request) {
  try {
    return await handleLaunch(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Launch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const cfg = getLtiConfig();
  return NextResponse.json({
    tool: "Code Understanding Quiz",
    launch: "POST form or JSON claims to this URL",
    login: cfg.urls.login,
    jwks: cfg.urls.jwks,
    pilot: cfg.urls.pilot,
  });
}
