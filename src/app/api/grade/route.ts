import { NextResponse } from "next/server";
import { gradeLocalFa } from "@/lib/mock-quiz";
import type { FaAnswer, FaScored, SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  faAnswers: FaAnswer[];
  /** Accepted for backward-compatible smoke scripts; always local. */
  mock?: boolean;
  offline?: boolean;
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

    const fa_scores = gradeLocalFa(faAnswers, files);
    return NextResponse.json({
      fa_scores,
      mode: "local" as const,
      model: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to grade answers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
