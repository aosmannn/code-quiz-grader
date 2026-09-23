/** LTI launch / AGS types for the iCollege pilot. */

export type LtiRoles = "Learner" | "Instructor" | "TeachingAssistant" | "Other";

export type LtiLaunchContext = {
  /** Opaque session id stored in cookie. */
  sessionId: string;
  /** true when launched from /pilot simulator */
  isDevSim: boolean;
  iss?: string;
  clientId?: string;
  deploymentId?: string;
  userId: string;
  userName: string;
  userEmail?: string;
  roles: LtiRoles[];
  courseId?: string;
  courseTitle: string;
  resourceLinkId?: string;
  assignmentTitle: string;
  /** AGS line item URL when platform provides it */
  lineItemUrl?: string;
  /** Platform return URL (optional) */
  returnUrl?: string;
  launchedAt: string;
};

export type LtiSubmitPayload = {
  sessionId: string;
  understandingPct: number;
  threshold: number;
  pointsEarned: number;
  pointsPossible: number;
  fileNames: string[];
};

export type LtiSubmitResult = {
  ok: boolean;
  mode: "ags" | "stub";
  message: string;
  completionId: string;
  submittedAt: string;
  /** What would be / was sent to the LMS */
  gradePassback: {
    scoreGiven: number;
    scoreMaximum: number;
    activityProgress: "Completed";
    gradingProgress: "FullyGraded" | "Pending";
    userId: string;
    lineItemUrl: string | null;
  };
};
