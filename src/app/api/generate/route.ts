import { NextResponse } from "next/server";
import { generateLocalQuiz } from "@/lib/mock-quiz";
import type { SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  mcCount: number;
  faCount: number;
  /** Optional attempt seed so retries shuffle question order. */
  attempt?: number;
  /** Accepted for backward-compatible smoke scripts; always local. */
  mock?: boolean;
  offline?: boolean;
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

    const attempt =
      typeof body.attempt === "number" && body.attempt >= 0
        ? Math.floor(body.attempt)
        : 0;

    const quiz = generateLocalQuiz(files, mcCount, faCount, attempt);
    return NextResponse.json({
      quiz,
      mode: "local" as const,
      model: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate quiz";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
