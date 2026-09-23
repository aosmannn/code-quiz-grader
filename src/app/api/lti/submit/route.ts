import { NextResponse } from "next/server";
import { readLtiSession } from "@/lib/lti/session";
import { submitScoreToCourse } from "@/lib/lti/ags";
import type { LtiSubmitPayload } from "@/lib/lti/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await readLtiSession();
    if (!session) {
      return NextResponse.json(
        {
          error:
            "No course launch session. Open this tool from iCollege (or /pilot) first.",
        },
        { status: 401 },
      );
    }

    const body = (await req.json()) as LtiSubmitPayload;
    if (
      typeof body.understandingPct !== "number" ||
      typeof body.threshold !== "number"
    ) {
      return NextResponse.json({ error: "Invalid score payload." }, { status: 400 });
    }
    if (body.understandingPct < body.threshold) {
      return NextResponse.json(
        {
          error: `Understanding ${body.understandingPct}% is below the ${body.threshold}% threshold.`,
        },
        { status: 400 },
      );
    }

    const result = await submitScoreToCourse(session, {
      sessionId: session.sessionId,
      understandingPct: body.understandingPct,
      threshold: body.threshold,
      pointsEarned: body.pointsEarned ?? 0,
      pointsPossible: body.pointsPossible ?? 100,
      fileNames: Array.isArray(body.fileNames) ? body.fileNames : [],
    });

    return NextResponse.json({ result, session });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Submit failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
