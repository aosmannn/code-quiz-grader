import { NextResponse } from "next/server";
import { followUpPrompt } from "@/lib/interview-ladder";
import {
  aggregateUnderstanding,
  evaluateAnswerSmart,
} from "@/lib/interview-eval";
import {
  getInterview,
  saveInterview,
  type AuditTurn,
} from "@/lib/interview-store";
import { saveClearance } from "@/lib/clearance-store";
import { CONCEPT_LABELS } from "@/lib/understanding-map";

export const runtime = "nodejs";

type Body = {
  sessionId: string;
  answer: string;
  requestInstructorReview?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.sessionId) {
      return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
    }
    const session = await getInterview(body.sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    if (body.requestInstructorReview) {
      if (
        session.status !== "in_progress" &&
        session.status !== "needs_retry"
      ) {
        return NextResponse.json({
          done: true,
          session: summarize(session),
          report: publicReport(session),
        });
      }
      session.status = "instructor_review";
      await saveInterview(session);
      return NextResponse.json({
        done: true,
        session: summarize(session),
        report: publicReport(session),
        message: "Flagged for instructor review.",
      });
    }

    if (session.status !== "in_progress") {
      return NextResponse.json({
        done: true,
        session,
        report: publicReport(session),
      });
    }

    const answer = (body.answer || "").trim();
    if (!answer) {
      return NextResponse.json({ error: "Type an answer first." }, { status: 400 });
    }

    const current =
      session.pendingFollowUp ||
      session.coreQuestions[session.coreIndex];
    if (!current) {
      return NextResponse.json({ error: "No active question." }, { status: 400 });
    }

    const isFollowUp = Boolean(session.pendingFollowUp);
    const evaluation = await evaluateAnswerSmart(
      current,
      answer,
      session.assignmentSpec,
    );

    const turn: AuditTurn = {
      questionId: current.id,
      isFollowUp,
      question: current,
      studentResponse: answer,
      evaluation,
      answeredAt: new Date().toISOString(),
    };
    session.turns.push(turn);

    const coreId = current.id.replace(/-fu$/, "");
    const prevBest = session.bestByQuestion[coreId] ?? 0;
    session.bestByQuestion[coreId] = Math.max(prevBest, evaluation.score01);

    const wKey = current.weightKey;
    const arr = session.byWeight[wKey] || [];
    arr.push(evaluation.score01);
    session.byWeight[wKey] = arr;

    const conceptKey =
      current.concept === "structure" ? "functions" : String(current.concept);
    session.conceptScores[conceptKey] = Math.max(
      session.conceptScores[conceptKey] ?? 0,
      evaluation.score01,
    );

    // Follow-up path
    if (
      evaluation.needsFollowUp &&
      !evaluation.demonstrated &&
      !isFollowUp &&
      session.followUpsUsed < session.maxFollowUps
    ) {
      session.followUpsUsed += 1;
      session.pendingFollowUp = followUpPrompt(current, answer);
      await saveInterview(session);
      return NextResponse.json({
        done: false,
        evaluation: {
          score01: evaluation.score01,
          demonstrated: evaluation.demonstrated,
          feedback: evaluation.feedback,
          evidence: evaluation.evidence,
          mode: evaluation.mode,
          model: evaluation.model,
        },
        question: session.pendingFollowUp,
        progress: progress(session),
        followUp: true,
      });
    }

    // Advance to next core question
    session.pendingFollowUp = null;
    session.coreIndex += 1;

    if (session.coreIndex >= session.coreQuestions.length) {
      finalize(session);
      if (session.sufficient) {
        const code = `cmp_${session.id.slice(3, 14)}`;
        session.clearanceCode = code;
        await saveClearance({
          code,
          submittedAt: new Date().toISOString(),
          userName: session.userName,
          courseTitle: session.courseTitle,
          assignmentTitle: session.assignmentTitle,
          labId: session.labId,
          fileNames: session.fileNames,
          fileFingerprint: session.map.fingerprint,
          understandingPct: session.scorePct || 0,
          mode: "stub",
        });
      }
      await saveInterview(session);
      return NextResponse.json({
        done: true,
        evaluation: {
          score01: evaluation.score01,
          demonstrated: evaluation.demonstrated,
          feedback: evaluation.feedback,
          evidence: evaluation.evidence,
          mode: evaluation.mode,
          model: evaluation.model,
        },
        report: publicReport(session),
        session: summarize(session),
      });
    }

    await saveInterview(session);
    const next = session.coreQuestions[session.coreIndex];
    return NextResponse.json({
      done: false,
      evaluation: {
        score01: evaluation.score01,
        demonstrated: evaluation.demonstrated,
        feedback: evaluation.feedback,
        evidence: evaluation.evidence,
        mode: evaluation.mode,
        model: evaluation.model,
      },
      question: next,
      progress: progress(session),
      followUp: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Answer failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function progress(session: {
  coreIndex: number;
  coreQuestions: unknown[];
  followUpsUsed: number;
  maxFollowUps: number;
}) {
  return {
    coreIndex: session.coreIndex,
    coreTotal: session.coreQuestions.length,
    followUpsUsed: session.followUpsUsed,
    maxFollowUps: session.maxFollowUps,
  };
}

function finalize(
  session: Awaited<ReturnType<typeof getInterview>> & object,
) {
  if (!session) return;
  const agg = aggregateUnderstanding({
    byWeight: session.byWeight,
    conceptScores: session.conceptScores,
    allConcepts: session.map.concepts.map(String),
  });
  session.scorePct = agg.scorePct;
  session.sufficient = agg.sufficient;
  session.threshold = agg.threshold;
  session.breakdown = agg.breakdown;
  session.concepts = agg.concepts;
  session.status = agg.sufficient ? "passed" : "needs_retry";
}

function publicReport(session: NonNullable<Awaited<ReturnType<typeof getInterview>>>) {
  return {
    scorePct: session.scorePct,
    sufficient: session.sufficient,
    threshold: session.threshold,
    status: session.status,
    breakdown: session.breakdown,
    concepts: (session.concepts || []).map((c) => ({
      ...c,
      label:
        CONCEPT_LABELS[c.concept as keyof typeof CONCEPT_LABELS] || c.concept,
    })),
    clearanceCode: session.clearanceCode,
    weakConcepts: (session.concepts || [])
      .filter((c) => c.status !== "demonstrated")
      .map(
        (c) =>
          CONCEPT_LABELS[c.concept as keyof typeof CONCEPT_LABELS] || c.concept,
      ),
    turns: session.turns.map((t) => ({
      questionId: t.questionId,
      level: t.question.level,
      prompt: t.question.prompt,
      isFollowUp: t.isFollowUp,
      response: t.studentResponse,
      score01: t.evaluation.score01,
      demonstrated: t.evaluation.demonstrated,
      feedback: t.evaluation.feedback,
      evidence: t.evaluation.evidence,
    })),
  };
}

function summarize(session: NonNullable<Awaited<ReturnType<typeof getInterview>>>) {
  return {
    id: session.id,
    status: session.status,
    scorePct: session.scorePct,
    sufficient: session.sufficient,
    userName: session.userName,
    assignmentTitle: session.assignmentTitle,
    clearanceCode: session.clearanceCode,
  };
}
