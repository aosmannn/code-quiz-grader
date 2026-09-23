import { NextResponse } from "next/server";
import { getLtiConfig } from "@/lib/lti/config";

export const runtime = "nodejs";

/**
 * Tool JWKS endpoint for LTI 1.3.
 * When LTI_TOOL_PRIVATE_KEY_PEM is set, export the matching public JWK.
 * Until then, return an empty set with registration hints.
 */
export async function GET() {
  const cfg = getLtiConfig();

  // Without a configured key, advertise empty JWKS so D2L can still hit the URL.
  // Operators generate a keypair and set LTI_TOOL_PRIVATE_KEY_PEM + LTI_TOOL_KEY_ID.
  const keys: unknown[] = [];

  if (cfg.toolPrivateKeyPem) {
    // PEM → JWK conversion would go here (node:crypto createPublicKey / export jwk).
    // Kept explicit so we don't ship a half-parsed key.
    keys.push({
      kty: "RSA",
      kid: cfg.toolKeyId,
      use: "sig",
      alg: "RS256",
      note: "Replace with exported public JWK from LTI_TOOL_PRIVATE_KEY_PEM",
    });
  }

  return NextResponse.json(
    {
      keys,
      meta: {
        keyId: cfg.toolKeyId,
        configured: Boolean(cfg.toolPrivateKeyPem),
        hint: "Generate an RSA keypair; set LTI_TOOL_PRIVATE_KEY_PEM and publish the public JWK here for D2L.",
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    },
  );
}
