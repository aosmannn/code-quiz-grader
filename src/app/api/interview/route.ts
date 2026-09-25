import { NextResponse } from "next/server";
import { getInterview, listInterviews } from "@/lib/interview-store";
import { CONCEPT_LABELS } from "@/lib/understanding-map";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const session = await getInterview(id);
    if (!session) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({
      session: {
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        userName: session.userName,
        courseTitle: session.courseTitle,
        assignmentTitle: session.assignmentTitle,
        assignmentSpec: session.assignmentSpec,
        labId: session.labId,
        fileNames: session.fileNames,
        map: session.map,
        status: session.status,
        scorePct: session.scorePct,
        sufficient: session.sufficient,
        threshold: session.threshold,
        breakdown: session.breakdown,
        concepts: (session.concepts || []).map((c) => ({
          ...c,
          label:
            CONCEPT_LABELS[c.concept as keyof typeof CONCEPT_LABELS] ||
            c.concept,
        })),
        clearanceCode: session.clearanceCode,
        followUpsUsed: session.followUpsUsed,
        turns: session.turns.map((t) => ({
          questionId: t.questionId,
          level: t.question.level,
          concept: t.question.concept,
          prompt: t.question.prompt,
          fileName: t.question.fileName,
          lineStart: t.question.lineStart,
          lineEnd: t.question.lineEnd,
          isFollowUp: t.isFollowUp,
          response: t.studentResponse,
          evaluation: t.evaluation,
          answeredAt: t.answeredAt,
        })),
      },
    });
  }

  const list = await listInterviews(50);
  return NextResponse.json({
    sessions: list.map((s) => ({
      id: s.id,
      userName: s.userName,
      assignmentTitle: s.assignmentTitle,
      courseTitle: s.courseTitle,
      status: s.status,
      scorePct: s.scorePct,
      sufficient: s.sufficient,
      fileNames: s.fileNames,
      updatedAt: s.updatedAt,
      clearanceCode: s.clearanceCode,
    })),
  });
}
