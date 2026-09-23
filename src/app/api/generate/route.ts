import { NextResponse } from "next/server";
import { generateMockQuiz } from "@/lib/mock-quiz";
import {
  buildGeneratePrompt,
  callOllama,
  getOllamaStatus,
  normalizeQuiz,
  parseModelJson,
} from "@/lib/ollama";
import type { QuizData, SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  mcCount: number;
  faCount: number;
  /** Force offline heuristic (smoke tests / no LLM). */
  mock?: boolean;
  offline?: boolean;
  model?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { files, mcCount, faCount } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one file." },
        { status: 400 },
      );
    }
    if (
      typeof mcCount !== "number" ||
      typeof faCount !== "number" ||
      mcCount < 0 ||
      faCount < 0 ||
      mcCount + faCount < 1 ||
      mcCount + faCount > 30
    ) {
      return NextResponse.json(
        { error: "Invalid question counts." },
        { status: 400 },
      );
    }

    const forceOffline = body.mock === true || body.offline === true;
    if (forceOffline) {
      const quiz = generateMockQuiz(files, mcCount, faCount);
      return NextResponse.json({
        quiz,
        mode: "offline" as const,
        model: null,
      });
    }

    const status = await getOllamaStatus(body.model);
    if (!status.ok || !status.selected) {
      const quiz = generateMockQuiz(files, mcCount, faCount);
      return NextResponse.json({
        quiz,
        mode: "offline" as const,
        model: null,
        ollama: status,
        notice:
          status.message +
          " Using the offline local question generator so you can keep practicing.",
      });
    }

    try {
      const prompt = buildGeneratePrompt(files, mcCount, faCount);
      const raw = await callOllama({
        model: status.selected,
        prompt,
        numPredict: Math.max(1200, (mcCount + faCount) * 280),
      });
      const parsed = parseModelJson<QuizData>(raw);
      const quiz = normalizeQuiz(parsed, mcCount, faCount);
      return NextResponse.json({
        quiz,
        mode: "ollama" as const,
        model: status.selected,
      });
    } catch (ollamaErr) {
      const quiz = generateMockQuiz(files, mcCount, faCount);
      const message =
        ollamaErr instanceof Error ? ollamaErr.message : "Ollama failed";
      return NextResponse.json({
        quiz,
        mode: "offline" as const,
        model: null,
        notice: `Local model hiccup (${message}). Fell back to offline questions.`,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate quiz";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
