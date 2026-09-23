import type { LtiLaunchContext, LtiSubmitPayload, LtiSubmitResult } from "./types";
import { getLtiConfig } from "./config";

/**
 * Assignment and Grade Services (AGS) passback.
 * When D2L line item + tool private key are configured, this is where real
 * HTTP score posts go. Until then we stub successfully so the student UX works.
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
  const completionId = `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    !session.isDevSim;

  if (canAttemptAgs && session.lineItemUrl) {
    // Real AGS wire-up placeholder: POST score to lineitem/scores with client assertion.
    // Kept as an explicit stub so D2L registration can proceed without half-broken OIDC.
    console.info("[lti/ags] Would POST score", {
      lineItemUrl: session.lineItemUrl,
      gradePassback,
      clientId: cfg.clientId,
    });
    return {
      ok: true,
      mode: "stub",
      message:
        "Submitted to course (AGS credentials present — score logged; full signed AGS POST ships next).",
      completionId,
      submittedAt,
      gradePassback,
    };
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
      ? "Submitted to course (pilot simulator). When registered in iCollege, this posts the score via LTI AGS."
      : "Submitted to course. Grade passback is stubbed until AGS credentials are configured.",
    completionId,
    submittedAt,
    gradePassback,
  };
}
