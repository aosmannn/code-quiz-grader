import type { FaAnswer, FaScored, QuizData, SourceFile } from "./types";
import { summarizeCode } from "./mock-quiz";

export const OLLAMA_BASE =
  process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:11434";

/** Preferred models — first installed match wins. */
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
  pullHint: string;
};

export function parseModelJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json|```/g, "").trim();
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
  const pullHint = "ollama pull llama3.2:1b";
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
        message: "Ollama is running, but no model is installed yet.",
        pullHint,
      };
    }
    return {
      ok: true,
      base: OLLAMA_BASE,
      models,
      selected,
      message: `Using local model: ${selected}`,
      pullHint,
    };
  } catch {
    return {
      ok: false,
      base: OLLAMA_BASE,
      models: [],
      selected: null,
      message: "Ollama isn’t reachable (is `ollama serve` running?).",
      pullHint,
    };
  }
}

export async function callOllama(params: {
  model: string;
  prompt: string;
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
        temperature: 0.35,
        num_predict: params.numPredict ?? 2048,
      },
    }),
    signal: AbortSignal.timeout(180_000),
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

function truncateFiles(files: SourceFile[], perFile = 4500): string {
  return files
    .map((f) => `=== FILE: ${f.name} ===\n${f.content.slice(0, perFile)}`)
    .join("\n\n");
}

const STOP = new Set(
  [
    "the",
    "and",
    "for",
    "int",
    "void",
    "main",
    "return",
    "this",
    "that",
    "with",
    "from",
    "what",
    "when",
    "how",
    "does",
    "do",
    "is",
    "are",
    "class",
    "function",
    "method",
    "code",
    "file",
    "program",
    "true",
    "false",
    "null",
    "include",
    "stdio",
  ].map((s) => s.toLowerCase()),
);

/** Tokens that questions must honestly reference from THIS upload. */
export function uploadGroundTokens(files: SourceFile[]): Set<string> {
  const s = summarizeCode(files);
  const tokens = new Set<string>();
  for (const name of s.fileList) {
    tokens.add(name.toLowerCase());
    tokens.add(name.replace(/\.[^.]+$/, "").toLowerCase());
  }
  for (const x of [
    s.primarySymbol,
    ...s.classNames,
    ...s.defNames,
    ...s.methodHints,
    ...s.raiseHints,
  ]) {
    if (x && x.length > 1) tokens.add(x.toLowerCase());
  }
  // Pull more identifiers from source
  const blob = files.map((f) => f.content).join("\n");
  for (const m of blob.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g)) {
    const t = m[1].toLowerCase();
    if (!STOP.has(t)) tokens.add(t);
  }
  return tokens;
}

export function textGroundedInUpload(
  text: string,
  ground: Set<string>,
): boolean {
  const lower = text.toLowerCase();
  // Must hit at least one upload token
  let hit = false;
  for (const t of ground) {
    if (t.length < 2) continue;
    if (lower.includes(t)) {
      hit = true;
      break;
    }
  }
  return hit;
}

export function buildGeneratePrompt(
  files: SourceFile[],
  mcCount: number,
  faCount: number,
): string {
  const code = truncateFiles(files);
  const s = summarizeCode(files);
  const fileNames = files.map((f) => f.name).join(", ");
  const symbols = [
    s.primarySymbol,
    ...s.classNames,
    ...s.defNames,
    ...s.methodHints,
  ]
    .filter(Boolean)
    .slice(0, 8);
  const symbolList =
    symbols.length > 0 ? symbols.map((x) => `\`${x}\``).join(", ") : fileNames;

  // Example derived from THIS upload only — never GradeBook unless it's their file
  const exSym = symbols[0] || s.primaryName;
  const exFile = s.primaryName;

  return (
    `You write a quiz ONLY about the student's uploaded source below.\n` +
    `Uploaded files: ${fileNames}\n` +
    `Important symbols in THIS upload: ${symbolList}\n\n` +
    `${code}\n\n` +
    `Return JSON with EXACTLY ${mcCount} objects in "mc" and EXACTLY ${faCount} objects in "fa".\n` +
    `Each mc object: id, question, options {A,B,C,D} (four full sentences), answer (A|B|C|D).\n` +
    `Each fa object: id, question.\n` +
    `CRITICAL:\n` +
    `- Ask ONLY about symbols/files from THIS upload (${fileNames}).\n` +
    `- Do NOT mention GradeBook, add_score, letter_grade, or any other program not in the upload.\n` +
    `- Do NOT copy sample questions from elsewhere — invent questions from the code above.\n` +
    `- Wrong options must be plausible mistakes about THIS code (no jokes/blockchain/GPU).\n` +
    `Shape reminder (replace with content about ${exSym} / ${exFile}):\n` +
    `{"mc":[{"id":1,"question":"What is the role of ${exSym} in ${exFile}?","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A"}],"fa":[{"id":2,"question":"Explain how ${exSym} works in ${exFile}."}]}\n` +
    `Output ONLY the JSON object.`
  );
}

export function buildGradePrompt(
  files: SourceFile[],
  faAnswers: FaAnswer[],
): string {
  const code = truncateFiles(files, 3200);
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
    `Score each answer 0–10 for accuracy, completeness, and understanding of THIS code. ` +
    `Full credit (10) when they correctly explain real identifiers/behavior. ` +
    `Give concise constructive feedback that names symbols from the upload.\n` +
    `Return ONLY valid JSON:\n{"fa_scores":[${template}]}`
  );
}

export function normalizeQuiz(
  raw: QuizData | Record<string, unknown>,
  mcCount: number,
  faCount: number,
): QuizData {
  const root = raw as Record<string, unknown>;
  const mcRaw = (root.mc || root.multiple_choice || root.questions || []) as Array<
    Record<string, unknown>
  >;
  const faRaw = (root.fa ||
    root.free_answer ||
    root.free_answers ||
    root.open_ended ||
    []) as Array<Record<string, unknown>>;

  const mc = mcRaw.slice(0, mcCount).map((q, i) => {
    const opts = (q.options || {}) as Record<string, unknown>;
    // Some small models return options as an array
    let A = String(opts.A ?? opts.a ?? "");
    let B = String(opts.B ?? opts.b ?? "");
    let C = String(opts.C ?? opts.c ?? "");
    let D = String(opts.D ?? opts.d ?? "");
    if (Array.isArray(q.options)) {
      const arr = q.options as unknown[];
      A = String(arr[0] ?? A);
      B = String(arr[1] ?? B);
      C = String(arr[2] ?? C);
      D = String(arr[3] ?? D);
    }
    // Pad missing distractors rather than failing the whole quiz
    if (!D) D = "None of the above accurately describes this code";
    if (!C) C = "This behavior is not present in the uploaded files";
    if (!B) B = "Unrelated side effect not shown in the submission";
    if (!A) A = "Core behavior described in the uploaded source";

    const ansRaw = String(q.answer || q.correct || "A")
      .trim()
      .toUpperCase()
      .replace(/[^ABCD]/g, "");
    const answer = (["A", "B", "C", "D"].includes(ansRaw[0])
      ? ansRaw[0]
      : "A") as "A" | "B" | "C" | "D";

    return {
      id: typeof q.id === "number" ? q.id : i + 1,
      question: String(q.question || q.prompt || `Question ${i + 1}`),
      options: { A, B, C, D },
      answer,
    };
  });

  const fa = faRaw.slice(0, faCount).map((q, i) => ({
    id: typeof q.id === "number" ? q.id : mcCount + i + 1,
    question: String(
      q.question || q.prompt || `Explain part ${i + 1} of your program.`,
    ),
  }));

  if (mcCount === 0 && faCount === 0) {
    return { mc: [], fa: [] };
  }
  if (mc.length === 0 && fa.length === 0) {
    throw new Error("Model returned no usable questions");
  }
  if (mc.length !== mcCount || fa.length !== faCount) {
    throw new Error(
      `Model returned ${mc.length} MC / ${fa.length} FA; expected ${mcCount}/${faCount}`,
    );
  }
  return { mc, fa };
}

/** Always returns exact counts; pads from `filler` when the model under-delivers. */
export function coerceQuiz(
  raw: unknown,
  mcCount: number,
  faCount: number,
  filler: QuizData,
  files: SourceFile[],
): { quiz: QuizData; partial: boolean; fromModel: number } {
  const root = (raw || {}) as Record<string, unknown>;
  const mcIn = (root.mc || root.multiple_choice || []) as unknown[];
  const faIn = (root.fa ||
    root.free_answer ||
    root.free_answers ||
    []) as unknown[];

  const ground = uploadGroundTokens(files);
  const blob = files.map((f) => f.content).join("\n").toLowerCase();

  const keepText = (text: string) => {
    const lower = text.toLowerCase();
    // Reject classic prompt-leak names when they aren't in the upload
    for (const leak of [
      "gradebook",
      "add_score",
      "letter_grade",
      "class_average",
    ]) {
      if (lower.includes(leak) && !blob.includes(leak)) return false;
    }
    return textGroundedInUpload(text, ground);
  };

  let fromModelMc: QuizData["mc"] = [];
  let fromModelFa: QuizData["fa"] = [];
  try {
    if (mcIn.length > 0) {
      fromModelMc = normalizeQuiz(
        { mc: mcIn as QuizData["mc"], fa: [] },
        Math.min(mcCount, mcIn.length),
        0,
      ).mc.filter((q) =>
        keepText(
          `${q.question} ${q.options.A} ${q.options.B} ${q.options.C} ${q.options.D}`,
        ),
      );
    }
  } catch {
    fromModelMc = [];
  }
  try {
    if (faIn.length > 0) {
      fromModelFa = normalizeQuiz(
        { mc: [], fa: faIn as QuizData["fa"] },
        0,
        Math.min(faCount, faIn.length),
      ).fa.filter((q) => keepText(q.question));
    }
  } catch {
    fromModelFa = [];
  }

  const mc = [...fromModelMc, ...filler.mc]
    .slice(0, mcCount)
    .map((q, i) => ({ ...q, id: i + 1 }));
  const fa = [...fromModelFa, ...filler.fa]
    .slice(0, faCount)
    .map((q, i) => ({ ...q, id: mcCount + i + 1 }));

  if (mc.length < mcCount || fa.length < faCount) {
    throw new Error(
      `Could not assemble quiz (${mc.length}/${mcCount} MC, ${fa.length}/${faCount} FA)`,
    );
  }

  return {
    quiz: { mc, fa },
    partial: fromModelMc.length < mcCount || fromModelFa.length < faCount,
    fromModel: fromModelMc.length + fromModelFa.length,
  };
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
