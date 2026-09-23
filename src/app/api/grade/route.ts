import { NextResponse } from "next/server";
import { gradeLocalFa } from "@/lib/mock-quiz";
import {
  buildGradePrompt,
  callOllama,
  getOllamaStatus,
  normalizeFaScores,
  parseModelJson,
} from "@/lib/ollama";
import type { FaAnswer, FaScored, SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  faAnswers: FaAnswer[];
  mock?: boolean;
  offline?: boolean;
  model?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { files, faAnswers } = body;

    if (!Array.isArray(faAnswers)) {
      return NextResponse.json({ error: "Invalid answers." }, { status: 400 });
    }

    if (faAnswers.length === 0) {
      return NextResponse.json({
        fa_scores: [] as FaScored[],
        mode: "local" as const,
        model: null,
      });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { error: "Missing source files." },
        { status: 400 },
      );
    }

    const forceOffline = body.mock === true || body.offline === true;
    if (forceOffline) {
      const fa_scores = gradeLocalFa(faAnswers, files);
      return NextResponse.json({
        fa_scores,
        mode: "local" as const,
        model: null,
      });
    }

    const status = await getOllamaStatus(body.model);
    if (status.ok && status.selected) {
      try {
        const prompt = buildGradePrompt(files, faAnswers);
        const raw = await callOllama({
          model: status.selected,
          prompt,
          numPredict: Math.max(900, faAnswers.length * 240),
        });
        const parsed = parseModelJson<{ fa_scores: FaScored[] }>(raw);
        const fa_scores = normalizeFaScores(parsed.fa_scores || [], faAnswers);
        return NextResponse.json({
          fa_scores,
          mode: "ollama" as const,
          model: status.selected,
        });
      } catch (ollamaErr) {
        const fa_scores = gradeLocalFa(faAnswers, files);
        const message =
          ollamaErr instanceof Error ? ollamaErr.message : "Ollama failed";
        return NextResponse.json({
          fa_scores,
          mode: "local" as const,
          model: null,
          notice: `Local model hiccup (${message}). Used on-device grading.`,
        });
      }
    }

    const fa_scores = gradeLocalFa(faAnswers, files);
    return NextResponse.json({
      fa_scores,
      mode: "local" as const,
      model: null,
      notice: status.message,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to grade answers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
