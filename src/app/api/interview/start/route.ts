import { NextResponse } from "next/server";
import { generateLadder } from "@/lib/interview-ladder";
import {
  newSessionId,
  saveInterview,
  type InterviewSession,
} from "@/lib/interview-store";
import { normalizeSourceFiles } from "@/lib/mock-quiz";
import { getLabPreset } from "@/lib/lab-presets";
import type { SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  assignmentSpec?: string;
  labId?: string | null;
  userName?: string;
  courseTitle?: string;
  assignmentTitle?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const files = normalizeSourceFiles(
      Array.isArray(body.files) ? body.files : [],
    );
    if (files.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one file." },
        { status: 400 },
      );
    }

    const lab = getLabPreset(body.labId);
    const assignmentSpec =
      (body.assignmentSpec || "").trim() ||
      (lab
        ? `${lab.title}\nGoals:\n${lab.goals.map((g) => `- ${g}`).join("\n")}\nFocus: ${lab.focus.join(", ")}`
        : "");

    const { map, questions } = generateLadder({
      files,
      assignmentSpec,
      coreCount: 5,
    });

    const session: InterviewSession = {
      id: newSessionId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userName: body.userName?.trim() || "Student",
      courseTitle: body.courseTitle?.trim() || lab?.courseHint || "Course",
      assignmentTitle:
        body.assignmentTitle?.trim() || lab?.title || "Programming assignment",
      assignmentSpec,
      labId: body.labId ?? lab?.id ?? null,
      fileNames: files.map((f) => f.name),
      map,
      coreQuestions: questions,
      coreIndex: 0,
      followUpsUsed: 0,
      maxFollowUps: 3,
      pendingFollowUp: null,
      turns: [],
      bestByQuestion: {},
      byWeight: {},
      conceptScores: Object.fromEntries(map.concepts.map((c) => [c, 0])),
      status: "in_progress",
      scorePct: null,
      sufficient: false,
      threshold: 75,
      breakdown: null,
      concepts: null,
      clearanceCode: null,
    };

    await saveInterview(session);

    const current = session.pendingFollowUp || session.coreQuestions[0];

    return NextResponse.json({
      sessionId: session.id,
      map: {
        concepts: map.concepts,
        files: map.files,
        roots: map.roots.map((r) => ({
          label: r.label,
          children: r.children.map((c) => ({
            label: c.label,
            lineStart: c.lineStart,
            lineEnd: c.lineEnd,
            children: c.children.map((x) => x.label),
          })),
        })),
      },
      question: current,
      progress: {
        coreIndex: 0,
        coreTotal: questions.length,
        followUpsUsed: 0,
        maxFollowUps: 3,
      },
      message:
        "Your code has been submitted for an Understanding Check. Not graded yet.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Start failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
