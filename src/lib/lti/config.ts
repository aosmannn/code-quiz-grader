/**
 * LTI / iCollege env config.
 * Secrets stay server-side. Public tool URLs are derived from LTI_TOOL_BASE_URL.
 */
export function getLtiConfig() {
  const base =
    process.env.LTI_TOOL_BASE_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:43127";

  return {
    toolBaseUrl: base,
    issuer: process.env.LTI_ISSUER || "",
    clientId: process.env.LTI_CLIENT_ID || "",
    deploymentId: process.env.LTI_DEPLOYMENT_ID || "",
    /** Platform JWKS URL (D2L) — used to verify id_token when wired */
    platformJwksUrl: process.env.LTI_PLATFORM_JWKS_URL || "",
    /** Our private key PEM for signing client assertions (AGS) — optional until wired */
    toolPrivateKeyPem: process.env.LTI_TOOL_PRIVATE_KEY_PEM || "",
    toolKeyId: process.env.LTI_TOOL_KEY_ID || "cqg-lti-key-1",
    /** Allow unsigned/dev launches on localhost */
    allowDevLaunch:
      process.env.LTI_ALLOW_DEV_LAUNCH === "true" ||
      process.env.NODE_ENV !== "production" ||
      base.includes("127.0.0.1") ||
      base.includes("localhost"),
    urls: {
      launch: `${base}/lti/launch`,
      login: `${base}/lti/login`,
      jwks: `${base}/lti/jwks`,
      redirect: `${base}/lti/launch`,
      pilot: `${base}/pilot`,
    },
  };
}

export function getPublicToolRegistration() {
  const c = getLtiConfig();
  return {
    toolName: "Code Understanding Quiz",
    description:
      "Course assignment tool — students prove they understand their own code before turn-in.",
    domain: new URL(c.toolBaseUrl).host,
    targetLinkUri: c.urls.launch,
    openIdConnectLoginUrl: c.urls.login,
    redirectUris: [c.urls.redirect],
    jwksUrl: c.urls.jwks,
    clientId: c.clientId || "(set LTI_CLIENT_ID after D2L registers the tool)",
    deploymentId:
      c.deploymentId || "(set LTI_DEPLOYMENT_ID after D2L deployment)",
  };
}
