import { createPrivateKey, createPublicKey, createSign, randomUUID } from "node:crypto";
import type { LtiLaunchContext, LtiSubmitPayload, LtiSubmitResult } from "./types";
import { getLtiConfig } from "./config";

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signClientAssertion(params: {
  privateKeyPem: string;
  clientId: string;
  tokenUrl: string;
  keyId: string;
}): string {
  const header = { alg: "RS256", typ: "JWT", kid: params.keyId };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: params.clientId,
    sub: params.clientId,
    aud: params.tokenUrl,
    iat: now,
    exp: now + 300,
    jti: randomUUID(),
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(params.privateKeyPem);
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(key);
  return `${data}.${b64url(sig)}`;
}

async function fetchAgsAccessToken(cfg: ReturnType<typeof getLtiConfig>): Promise<string | null> {
  if (!cfg.tokenUrl || !cfg.toolPrivateKeyPem || !cfg.clientId) return null;
  const assertion = signClientAssertion({
    privateKeyPem: cfg.toolPrivateKeyPem,
    clientId: cfg.clientId,
    tokenUrl: cfg.tokenUrl,
    keyId: cfg.toolKeyId,
  });
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope:
      "https://purl.imsglobal.org/spec/lti-ags/scope/score https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
  });
  const resp = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `AGS token request failed (${resp.status})${text ? `: ${text.slice(0, 180)}` : ""}`,
    );
  }
  const data = (await resp.json()) as { access_token?: string };
  return data.access_token || null;
}

async function postAgsScore(params: {
  lineItemUrl: string;
  accessToken: string;
  userId: string;
  scoreGiven: number;
  scoreMaximum: number;
}): Promise<void> {
  const scoresUrl = params.lineItemUrl.replace(/\/?$/, "") + "/scores";
  const resp = await fetch(scoresUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/vnd.ims.lis.v1.score+json",
    },
    body: JSON.stringify({
      userId: params.userId,
      scoreGiven: params.scoreGiven,
      scoreMaximum: params.scoreMaximum,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      timestamp: new Date().toISOString(),
    }),
  });
  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `AGS score POST failed (${resp.status})${text ? `: ${text.slice(0, 180)}` : ""}`,
    );
  }
}

export function exportToolPublicJwk(
  privateKeyPem: string,
  keyId: string,
): Record<string, unknown> | null {
  try {
    const pub = createPublicKey(privateKeyPem);
    const jwk = pub.export({ format: "jwk" }) as Record<string, unknown>;
    return {
      ...jwk,
      kid: keyId,
      use: "sig",
      alg: "RS256",
    };
  } catch {
    return null;
  }
}

/**
 * Assignment and Grade Services (AGS) passback.
 * Posts a real score when line item + token URL + tool private key are set.
 * Otherwise stubs successfully so the student UX still clears.
 */
export async function submitScoreToCourse(
  session: LtiLaunchContext,
  payload: LtiSubmitPayload,
): Promise<LtiSubmitResult> {
  const cfg = getLtiConfig();
  const scoreMaximum = 100;
  const scoreGiven = Math.max(
    0,
    Math.min(100, Math.round(payload.understandingPct)),
  );
  const completionId = `cmp_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const submittedAt = new Date().toISOString();

  const gradePassback = {
    scoreGiven,
    scoreMaximum,
    activityProgress: "Completed" as const,
    gradingProgress: "FullyGraded" as const,
    userId: session.userId,
    lineItemUrl: session.lineItemUrl || null,
  };

  const canAttemptAgs =
    Boolean(session.lineItemUrl) &&
    Boolean(cfg.toolPrivateKeyPem) &&
    Boolean(cfg.clientId) &&
    Boolean(cfg.tokenUrl) &&
    !session.isDevSim;

  if (canAttemptAgs && session.lineItemUrl) {
    try {
      const accessToken = await fetchAgsAccessToken(cfg);
      if (!accessToken) {
        throw new Error("No access_token returned from platform token endpoint.");
      }
      await postAgsScore({
        lineItemUrl: session.lineItemUrl,
        accessToken,
        userId: session.userId,
        scoreGiven,
        scoreMaximum,
      });
      return {
        ok: true,
        mode: "ags",
        message:
          "Score posted to iCollege. You’re cleared to submit the real assignment.",
        completionId,
        submittedAt,
        gradePassback,
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : "AGS error";
      console.error("[lti/ags] passback failed", detail);
      return {
        ok: true,
        mode: "stub",
        message: `Clearance saved locally, but iCollege grade passback failed (${detail}). Share your clearance code with your instructor.`,
        completionId,
        submittedAt,
        gradePassback: {
          ...gradePassback,
          gradingProgress: "Pending",
        },
      };
    }
  }

  console.info("[lti/ags] Stub completion", {
    course: session.courseTitle,
    assignment: session.assignmentTitle,
    user: session.userName,
    gradePassback,
    files: payload.fileNames,
    isDevSim: session.isDevSim,
  });

  return {
    ok: true,
    mode: "stub",
    message: session.isDevSim
      ? "Cleared (demo). Copy your clearance code for a TA, or wire LTI AGS for live iCollege unlock."
      : "Cleared on this tool. Set LTI_TOKEN_URL + key + line item to post the score into iCollege automatically.",
    completionId,
    submittedAt,
    gradePassback,
  };
}
