import { cookies } from "next/headers";
import type { LtiLaunchContext } from "./types";

export const LTI_COOKIE = "cqg_lti_session";
const STORE_COOKIE = "cqg_lti_payload";

/** In-memory fallback for local single-process next start. */
const mem = new Map<string, LtiLaunchContext>();

function randomId() {
  return `lti_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveLtiSession(
  ctx: Omit<LtiLaunchContext, "sessionId" | "launchedAt"> & {
    sessionId?: string;
  },
): Promise<LtiLaunchContext> {
  const full: LtiLaunchContext = {
    ...ctx,
    sessionId: ctx.sessionId || randomId(),
    launchedAt: new Date().toISOString(),
  };
  mem.set(full.sessionId, full);

  const jar = await cookies();
  jar.set(LTI_COOKIE, full.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  // Compact payload cookie so session survives serverless cold starts in pilot
  jar.set(STORE_COOKIE, Buffer.from(JSON.stringify(full)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return full;
}

export async function readLtiSession(): Promise<LtiLaunchContext | null> {
  const jar = await cookies();
  const id = jar.get(LTI_COOKIE)?.value;
  if (id && mem.has(id)) return mem.get(id)!;

  const raw = jar.get(STORE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as LtiLaunchContext;
    if (parsed?.sessionId) {
      mem.set(parsed.sessionId, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function clearLtiSession() {
  const jar = await cookies();
  const id = jar.get(LTI_COOKIE)?.value;
  if (id) mem.delete(id);
  jar.delete(LTI_COOKIE);
  jar.delete(STORE_COOKIE);
}

export function parseLaunchClaims(
  input: Record<string, string | undefined>,
): Omit<LtiLaunchContext, "sessionId" | "launchedAt"> {
  const rolesRaw = (input["https://purl.imsglobal.org/spec/lti/claim/roles"] ||
    input.roles ||
    "Learner") as string;
  const roles = rolesRaw
    .split(",")
    .map((r) => r.trim())
    .map((r) => {
      if (/Instructor/i.test(r)) return "Instructor" as const;
      if (/TeachingAssistant|TA/i.test(r)) return "TeachingAssistant" as const;
      if (/Learner|Student/i.test(r)) return "Learner" as const;
      return "Other" as const;
    });

  const courseTitle =
    input["https://purl.imsglobal.org/spec/lti/claim/context"] ||
    input.context_title ||
    input.courseTitle ||
    "Your course";
  const assignmentTitle =
    input["https://purl.imsglobal.org/spec/lti/claim/resource_link"] ||
    input.resource_link_title ||
    input.assignmentTitle ||
    "Code understanding check";

  return {
    isDevSim: input.isDevSim === "true" || input.dev === "1",
    iss: input.iss,
    clientId: input.aud || input.client_id,
    deploymentId:
      input["https://purl.imsglobal.org/spec/lti/claim/deployment_id"] ||
      input.deployment_id,
    userId: input.sub || input.user_id || "anonymous",
    userName: input.name || input.userName || "Student",
    userEmail: input.email,
    roles: roles.length ? roles : ["Learner"],
    courseId: input.context_id || input.courseId,
    courseTitle: String(courseTitle),
    resourceLinkId: input.resource_link_id || input.resourceLinkId,
    assignmentTitle: String(assignmentTitle),
    lineItemUrl: input.lineitem || input.lineItemUrl,
    returnUrl: input["https://purl.imsglobal.org/spec/lti/claim/launch_presentation"]
      ? undefined
      : input.launch_presentation_return_url || input.returnUrl,
  };
}
