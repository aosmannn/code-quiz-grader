import { NextResponse } from "next/server";
import { callClaude, parseModelJson, resolveApiKey } from "@/lib/claude";
import { gradeMockFa } from "@/lib/mock-quiz";
import type { FaAnswer, FaScored, SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  faAnswers: FaAnswer[];
  mock?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { files, faAnswers } = body;

    if (!Array.isArray(faAnswers)) {
      return NextResponse.json({ error: "Invalid answers." }, { status: 400 });
    }

    if (faAnswers.length === 0) {
      return NextResponse.json({ fa_scores: [] as FaScored[], mode: "local" as const });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "Missing source files." }, { status: 400 });
    }

    // Explicit mock / demo always wins — never call Claude on that path.
    if (body.mock === true) {
      const fa_scores = gradeMockFa(faAnswers, files);
      return NextResponse.json({ fa_scores, mode: "mock" as const });
    }

    const headerKey = req.headers.get("x-api-key");
    const apiKey = resolveApiKey(headerKey);
    if (!apiKey) {
      const fa_scores = gradeMockFa(faAnswers, files);
      return NextResponse.json({ fa_scores, mode: "mock" as const });
    }

    const code = files
      .map((f) => `=== ${f.name} ===\n${f.content.slice(0, 3000)}`)
      .join("\n\n");
    const qaPairs = faAnswers
      .map((a) => `Q: ${a.question}\nAnswer: ${a.answer}`)
      .join("\n\n");
    const template = faAnswers
      .map((a) => `{"id":${a.id},"score":0,"feedback":"..."}`)
      .join(",");

    const prompt =
      `You are grading a student's free-answer quiz about this code:\n\n${code}\n\n` +
      `Questions and student answers:\n\n${qaPairs}\n\n` +
      `Score each answer 0–10 based on accuracy, completeness, and understanding. ` +
      `Provide concise, constructive feedback for each. ` +
      `Return ONLY valid JSON, no markdown fences:\n{"fa_scores":[${template}]}`;

    const raw = await callClaude({
      apiKey: apiKey!,
      prompt,
      maxTokens: Math.max(1000, faAnswers.length * 250),
    });
    const parsed = parseModelJson<{ fa_scores: FaScored[] }>(raw);
    return NextResponse.json({ fa_scores: parsed.fa_scores, mode: "claude" as const });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to grade answers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
