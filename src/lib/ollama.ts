import type { QuizData, SourceFile, FaAnswer, FaScored } from "./types";

export const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:11434";

/** Preferred models, first match wins. */
export const PREFERRED_MODELS = [
  "llama3.2:1b",
  "llama3.2:3b",
  "llama3.2",
  "qwen2.5:1.5b",
  "qwen2.5:3b",
  "qwen2.5",
  "phi3:mini",
  "phi3",
  "gemma2:2b",
  "mistral",
];

export type OllamaStatus = {
  ok: boolean;
  base: string;
  models: string[];
  selected: string | null;
  message: string;
  installHint: string;
  pullHint: string;
};

export function parseModelJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  // Prefer outermost JSON object if model added chatter
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice =
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(slice) as T;
}

export async function listOllamaModels(
  base = OLLAMA_BASE,
): Promise<string[]> {
  const resp = await fetch(`${base}/api/tags`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!resp.ok) throw new Error(`Ollama tags failed (${resp.status})`);
  const data = (await resp.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };
  return (data.models || [])
    .map((m) => m.name || m.model || "")
    .filter(Boolean);
}

export function pickDefaultModel(models: string[]): string | null {
  if (models.length === 0) return null;
  const lower = models.map((m) => m.toLowerCase());
  for (const pref of PREFERRED_MODELS) {
    const i = lower.findIndex(
      (m) => m === pref || m.startsWith(`${pref}:`) || m.startsWith(pref),
    );
    if (i >= 0) return models[i];
  }
  return models[0];
}

export async function getOllamaStatus(
  preferred?: string | null,
): Promise<OllamaStatus> {
  const installHint =
    "Install Ollama from https://ollama.com , then run: ollama serve";
  const pullHint =
    "Pull a small model: ollama pull llama3.2:1b   (or qwen2.5:1.5b / phi3:mini)";
  try {
    const models = await listOllamaModels();
    const selected =
      (preferred && models.includes(preferred) ? preferred : null) ||
      pickDefaultModel(models);
    if (!selected) {
      return {
        ok: false,
        base: OLLAMA_BASE,
        models,
        selected: null,
        message: "Ollama is running, but no models are installed yet.",
        installHint,
        pullHint,
      };
    }
    return {
      ok: true,
      base: OLLAMA_BASE,
      models,
      selected,
      message: `Local model ready: ${selected}`,
      installHint,
      pullHint,
    };
  } catch {
    return {
      ok: false,
      base: OLLAMA_BASE,
      models: [],
      selected: null,
      message: "Ollama isn’t reachable on this laptop yet.",
      installHint,
      pullHint,
    };
  }
}

export async function callOllama(params: {
  model: string;
  prompt: string;
  /** Soft cap; small models may ignore. */
  numPredict?: number;
}): Promise<string> {
  const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.3,
        num_predict: params.numPredict ?? 2048,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `Ollama generate failed (${resp.status})${errText ? `: ${errText.slice(0, 200)}` : ""}`,
    );
  }

  const data = (await resp.json()) as { response?: string };
  if (!data.response?.trim()) {
    throw new Error("Ollama returned an empty response");
  }
  return data.response;
}

export function buildGeneratePrompt(
  files: SourceFile[],
  mcCount: number,
  faCount: number,
): string {
  const code = files
    .map((f) => `=== ${f.name} ===\n${f.content.slice(0, 3500)}`)
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

  return (
    `You are a supportive computer science instructor helping a student prove they understand THEIR OWN code.\n\n` +
    `Student source files:\n\n${code}\n\n` +
    `Generate a quiz with EXACTLY ${mcCount} multiple-choice question(s) and EXACTLY ${faCount} free-answer question(s).\n\n` +
    `Rules:\n` +
    `- Questions must be grounded in the uploaded identifiers, functions, and logic — not generic CS trivia.\n` +
    `- Multiple-choice: exactly 4 options A–D and one correct answer key.\n` +
    `- Free-answer: open-ended, no answer key.\n` +
    `- Cover purpose, control flow, data, edge cases, and design where possible.\n` +
    `- Encouraging tone; never accuse the student of cheating.\n\n` +
    `Return ONLY valid JSON (no markdown):\n` +
    `{"mc":[${mcEx || ""}],"fa":[${faEx || ""}]}`
  );
}

export function buildGradePrompt(
  files: SourceFile[],
  faAnswers: FaAnswer[],
): string {
  const code = files
    .map((f) => `=== ${f.name} ===\n${f.content.slice(0, 2800)}`)
    .join("\n\n");
  const qaPairs = faAnswers
    .map((a) => `Q: ${a.question}\nStudent answer: ${a.answer}`)
    .join("\n\n");
  const template = faAnswers
    .map((a) => `{"id":${a.id},"score":0,"feedback":"..."}`)
    .join(",");

  return (
    `You are grading a student's free-answer quiz about THEIR uploaded code. Be fair and encouraging.\n\n` +
    `Code:\n\n${code}\n\n` +
    `Questions and answers:\n\n${qaPairs}\n\n` +
    `Score each answer 0–10 for accuracy, completeness, and understanding of the submitted code. ` +
    `Give concise constructive feedback. Prefer referencing real identifiers from the code.\n` +
    `Return ONLY valid JSON:\n{"fa_scores":[${template}]}`
  );
}

export function normalizeQuiz(raw: QuizData, mcCount: number, faCount: number): QuizData {
  const mc = (raw.mc || []).slice(0, mcCount).map((q, i) => ({
    id: typeof q.id === "number" ? q.id : i + 1,
    question: String(q.question || `Question ${i + 1}`),
    options: {
      A: String(q.options?.A ?? ""),
      B: String(q.options?.B ?? ""),
      C: String(q.options?.C ?? ""),
      D: String(q.options?.D ?? ""),
    },
    answer: (["A", "B", "C", "D"].includes(q.answer) ? q.answer : "A") as
      | "A"
      | "B"
      | "C"
      | "D",
  }));
  const fa = (raw.fa || []).slice(0, faCount).map((q, i) => ({
    id: typeof q.id === "number" ? q.id : mcCount + i + 1,
    question: String(q.question || `Explain part ${i + 1} of your program.`),
  }));
  if (mc.length !== mcCount || fa.length !== faCount) {
    throw new Error(
      `Model returned ${mc.length} MC / ${fa.length} FA; expected ${mcCount}/${faCount}`,
    );
  }
  return { mc, fa };
}

export function normalizeFaScores(
  raw: FaScored[],
  faAnswers: FaAnswer[],
): FaScored[] {
  const byId = new Map(raw.map((s) => [s.id, s]));
  return faAnswers.map((a) => {
    const hit = byId.get(a.id);
    const score = Math.max(
      0,
      Math.min(10, Math.round(Number(hit?.score ?? 0))),
    );
    return {
      id: a.id,
      score,
      feedback:
        String(hit?.feedback || "").trim() ||
        "Thanks for answering — try tying your explanation more tightly to the code next time.",
    };
  });
}
