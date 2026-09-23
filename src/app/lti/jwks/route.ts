import { NextResponse } from "next/server";
import { getLtiConfig } from "@/lib/lti/config";
import { exportToolPublicJwk } from "@/lib/lti/ags";

export const runtime = "nodejs";

/**
 * Tool JWKS endpoint for LTI 1.3.
 * When LTI_TOOL_PRIVATE_KEY_PEM is set, export the matching public JWK.
 */
export async function GET() {
  const cfg = getLtiConfig();
  const keys: unknown[] = [];

  if (cfg.toolPrivateKeyPem) {
    const jwk = exportToolPublicJwk(cfg.toolPrivateKeyPem, cfg.toolKeyId);
    if (jwk) keys.push(jwk);
  }

  return NextResponse.json(
    {
      keys,
      meta: {
        keyId: cfg.toolKeyId,
        configured: keys.length > 0,
        hint:
          keys.length > 0
            ? "Public JWK published for D2L."
            : "Generate an RSA keypair; set LTI_TOOL_PRIVATE_KEY_PEM to publish the public JWK.",
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    },
  );
}
