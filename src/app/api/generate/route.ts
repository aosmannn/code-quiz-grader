import { NextResponse } from "next/server";
import { callClaude, parseModelJson, resolveApiKey } from "@/lib/claude";
import { generateMockQuiz } from "@/lib/mock-quiz";
import type { QuizData, SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  mcCount: number;
  faCount: number;
  mock?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { files, mcCount, faCount } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "Upload at least one file." }, { status: 400 });
    }
    if (
      typeof mcCount !== "number" ||
      typeof faCount !== "number" ||
      mcCount < 0 ||
      faCount < 0 ||
      mcCount + faCount < 1 ||
      mcCount + faCount > 30
    ) {
      return NextResponse.json({ error: "Invalid question counts." }, { status: 400 });
    }

    // Explicit mock / demo always wins — never call Claude on that path.
    if (body.mock === true) {
      const quiz = generateMockQuiz(files, mcCount, faCount);
      return NextResponse.json({ quiz, mode: "mock" as const });
    }

    const headerKey = req.headers.get("x-api-key");
    const apiKey = resolveApiKey(headerKey);
    if (!apiKey) {
      const quiz = generateMockQuiz(files, mcCount, faCount);
      return NextResponse.json({ quiz, mode: "mock" as const });
    }

    const code = files
      .map((f) => `=== ${f.name} ===\n${f.content.slice(0, 4000)}`)
      .join("\n\n");

    const mcEx = Array.from({ length: Math.min(mcCount, 2) }, (_, i) =>
      JSON.stringify({
        id: i + 1,
        question: "...",
        options: { A: "...", B: "...", C: "...", D: "..." },
        answer: "A",
      }),
    ).join(",");
    const faEx = Array.from({ length: Math.min(faCount, 2) }, (_, i) =>
      JSON.stringify({ id: mcCount + i + 1, question: "..." }),
    ).join(",");

    const prompt =
      `You are a computer science instructor. A student submitted these source files:\n\n${code}\n\n` +
      `Generate a quiz with EXACTLY ${mcCount} multiple-choice question(s) and EXACTLY ${faCount} free-answer question(s).\n\n` +
      `Rules:\n` +
      `- Multiple-choice: provide exactly 4 options (A B C D) and a single correct answer key.\n` +
      `- Free-answer: open-ended questions testing understanding, no answer key needed.\n` +
      `- Questions should span: purpose, logic/algorithms, data structures, edge cases, design/best practices.\n\n` +
      `Return ONLY valid JSON, no markdown fences:\n` +
      `{"mc":[${mcEx || ""}],"fa":[${faEx || ""}]}`;

    const raw = await callClaude({
      apiKey: apiKey!,
      prompt,
      maxTokens: Math.max(1500, (mcCount + faCount) * 300),
    });
    const quiz = parseModelJson<QuizData>(raw);
    return NextResponse.json({ quiz, mode: "claude" as const });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate quiz";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
