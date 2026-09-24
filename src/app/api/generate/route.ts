import { NextResponse } from "next/server";
import { generateLocalQuiz, normalizeSourceFiles } from "@/lib/mock-quiz";
import { getLabPreset } from "@/lib/lab-presets";
import {
  buildGeneratePrompt,
  callOllama,
  coerceQuiz,
  getOllamaStatus,
  parseModelJson,
} from "@/lib/ollama";
import type { SourceFile } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  files: SourceFile[];
  mcCount: number;
  faCount: number;
  attempt?: number;
  mock?: boolean;
  offline?: boolean;
  model?: string;
  labId?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { mcCount, faCount } = body;
    const files = normalizeSourceFiles(
      Array.isArray(body.files) ? body.files : [],
    );
    const lab = getLabPreset(body.labId);
    const labOpts = lab
      ? { goals: lab.goals, focus: lab.focus, title: lab.title }
      : undefined;
    const labMeta = lab
      ? { id: lab.id, title: lab.title, goals: lab.goals }
      : null;

    if (files.length === 0) {
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

    const forceOffline = body.mock === true || body.offline === true;
    if (forceOffline) {
      const quiz = generateLocalQuiz(files, mcCount, faCount, attempt, labOpts);
      return NextResponse.json({
        quiz,
        mode: "local" as const,
        model: null,
        lab: labMeta,
      });
    }

    const status = await getOllamaStatus(body.model);
    if (status.ok && status.selected) {
      const filler = generateLocalQuiz(
        files,
        mcCount,
        faCount,
        attempt,
        labOpts,
      );
      let lastErr: unknown = null;
      for (let tryNo = 0; tryNo < 2; tryNo++) {
        try {
          const prompt = buildGeneratePrompt(
            files,
            mcCount,
            faCount,
            labOpts,
          );
          const raw = await callOllama({
            model: status.selected,
            prompt,
            numPredict: Math.max(1800, (mcCount + faCount) * 450),
          });
          const parsed = parseModelJson<unknown>(raw);
          const { quiz, partial, fromModel } = coerceQuiz(
            parsed,
            mcCount,
            faCount,
            filler,
            files,
          );
          if (
            fromModel === 0 ||
            (partial && fromModel < Math.ceil((mcCount + faCount) / 2))
          ) {
            return NextResponse.json({
              quiz: filler,
              mode: "local" as const,
              model: status.selected,
              lab: labMeta,
              notice:
                "Built a code-grounded quiz on-device (local model reply wasn’t solid enough).",
            });
          }
          return NextResponse.json({
            quiz,
            mode: "ollama" as const,
            model: status.selected,
            lab: labMeta,
            ...(partial
              ? {
                  notice:
                    "Local model returned a partial quiz; topped up with code-grounded items.",
                }
              : {}),
          });
        } catch (err) {
          lastErr = err;
        }
      }
      const message =
        lastErr instanceof Error ? lastErr.message : "Ollama failed";
      return NextResponse.json({
        quiz: filler,
        mode: "local" as const,
        model: status.selected,
        lab: labMeta,
        notice: `On-device quiz (local model hiccup: ${message}).`,
      });
    }

    const quiz = generateLocalQuiz(files, mcCount, faCount, attempt, labOpts);
    return NextResponse.json({
      quiz,
      mode: "local" as const,
      model: null,
      lab: labMeta,
      ollama: status,
      notice: status.message,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate quiz";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
