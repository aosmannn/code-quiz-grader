import type { FaAnswer, FaScored, QuizData, SourceFile } from "./types";

function summarizeCode(files: SourceFile[]) {
  const names = files.map((f) => f.name).join(", ");
  const primary = files[0];
  const snippet = primary?.content.slice(0, 800) ?? "";
  const blob = files.map((f) => f.content).join("\n");
  const hasFn =
    /\b(function|def|fn|func|public\s+static|=>)\b/.test(snippet) ||
    /\bclass\b/.test(snippet);
  const hasLoop = /\b(for|while|forEach|map)\b/.test(snippet);
  const hasCond = /\b(if|else|switch|case|\?)\b/.test(snippet);
  const lang = primary?.name.split(".").pop()?.toLowerCase() ?? "code";
  const classMatch = blob.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/);
  const defMatches = [...blob.matchAll(/\b(?:def|function|fn)\s+([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((m) => m[1])
    .filter((n) => n !== "main")
    .slice(0, 4);
  const primarySymbol = classMatch?.[1] || defMatches[0] || primary?.name || "the program";
  return {
    names,
    primaryName: primary?.name ?? "your program",
    snippet,
    hasFn,
    hasLoop,
    hasCond,
    lang,
    primarySymbol,
    defNames: defMatches,
  };
}

const MC_TEMPLATES = [
  (s: ReturnType<typeof summarizeCode>) => ({
    question: `What is the primary purpose of ${s.primarySymbol} in ${s.primaryName}?`,
    options: {
      A: `Implement core logic for ${s.primarySymbol} used by the submitted program`,
      B: "Configure a production database migration",
      C: "Render a 3D graphics scene",
      D: "Encrypt network traffic end-to-end",
    },
    answer: "A" as const,
  }),
  (s: ReturnType<typeof summarizeCode>) => ({
    question: `Which statement best describes control flow in ${s.primaryName}?`,
    options: {
      A: s.hasCond
        ? "It uses conditional branches to choose behavior based on inputs or state"
        : "It runs a single straight-line path with no branching",
      B: "It only throws exceptions and never returns",
      C: "It blocks forever waiting on network I/O",
      D: "It requires a GPU shader compiler",
    },
    answer: "A" as const,
  }),
  (s: ReturnType<typeof summarizeCode>) => ({
    question: `How does ${s.primaryName} likely process repeated work?`,
    options: {
      A: s.hasLoop
        ? "It iterates over data or repeats steps using loops or collection helpers"
        : "It performs work once without iterating collections",
      B: "It spawns a new process for every character",
      C: "It relies on browser cookies for computation",
      D: "It never executes user-defined logic",
    },
    answer: "A" as const,
  }),
  (s: ReturnType<typeof summarizeCode>) => ({
    question: `Which edge case should a careful reader consider for this ${s.lang} program?`,
    options: {
      A: "Empty, null, or unexpected inputs that the happy path does not cover",
      B: "Whether the sun is rising in the southern hemisphere",
      C: "Whether the file is printed on glossy paper",
      D: "Whether the CPU supports 8-bit audio",
    },
    answer: "A" as const,
  }),
  (s: ReturnType<typeof summarizeCode>) => ({
    question: `What would improve maintainability of the submitted files (${s.names})?`,
    options: {
      A: "Clear naming, focused functions, and comments that explain non-obvious intent",
      B: "Removing all whitespace and identifiers",
      C: "Hard-coding secrets into every function",
      D: "Duplicating the entire file for each feature",
    },
    answer: "A" as const,
  }),
  (s: ReturnType<typeof summarizeCode>) => ({
    question: `Which claim about ${s.primaryName} is most accurate?`,
    options: {
      A: s.hasFn
        ? "Logic is organized into functions, methods, or classes that can be reasoned about separately"
        : "The file is mostly top-level statements rather than deep class hierarchies"
      ,
      B: "It is guaranteed lock-free and wait-free on every platform",
      C: "It cannot be read by humans",
      D: "It replaces the operating system kernel",
    },
    answer: "A" as const,
  }),
];

const FA_TEMPLATES = [
  (s: ReturnType<typeof summarizeCode>) =>
    `In your own words, explain what ${s.primarySymbol} in ${s.primaryName} is trying to accomplish and why that matters.`,
  (s: ReturnType<typeof summarizeCode>) =>
    `Walk through the main algorithm or logic path in ${s.primaryName}. What happens step by step when the program runs?`,
  (s: ReturnType<typeof summarizeCode>) =>
    s.defNames.length
      ? `Pick one of these symbols (${s.defNames.join(", ")}) and explain how it is used.`
      : `Identify one data structure or important variable in ${s.primaryName} and explain how it is used.`,
  (s: ReturnType<typeof summarizeCode>) =>
    `Describe an edge case or failure mode for ${s.primarySymbol} and how the code handles (or fails to handle) it.`,
  (s: ReturnType<typeof summarizeCode>) =>
    `If you were reviewing this submission, what one design or clarity improvement would you suggest for ${s.primaryName} and why?`,
  (s: ReturnType<typeof summarizeCode>) =>
    `How do the uploaded files (${s.names}) work together, or what role does each play?`,
];

export function generateMockQuiz(
  files: SourceFile[],
  mcCount: number,
  faCount: number,
): QuizData {
  const s = summarizeCode(files);
  const mc = Array.from({ length: mcCount }, (_, i) => {
    const t = MC_TEMPLATES[i % MC_TEMPLATES.length](s);
    return { id: i + 1, ...t };
  });
  const fa = Array.from({ length: faCount }, (_, i) => ({
    id: mcCount + i + 1,
    question: FA_TEMPLATES[i % FA_TEMPLATES.length](s),
  }));
  return { mc, fa };
}

function scoreOneFa(answer: string, question: string, files: SourceFile[]): FaScored {
  const text = answer.trim();
  const lower = text.toLowerCase();
  const tokens = lower.split(/\W+/).filter((t) => t.length > 2);
  const codeBlob = files.map((f) => f.content).join("\n").toLowerCase();
  const nameHits = files.filter((f) =>
    lower.includes(f.name.toLowerCase().replace(/\.[^.]+$/, "")),
  ).length;

  let score = 2;
  if (text.length >= 40) score += 2;
  if (text.length >= 120) score += 2;
  if (tokens.length >= 20) score += 1;
  if (nameHits > 0) score += 1;

  const codeWords = new Set(
    codeBlob
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 200),
  );
  const overlap = tokens.filter((t) => codeWords.has(t)).length;
  if (overlap >= 2) score += 1;
  if (overlap >= 5) score += 1;

  score = Math.max(0, Math.min(10, score));

  let feedback: string;
  if (score >= 8) {
    feedback =
      "Demo grading: strong answer — specific, grounded in the submitted code, and shows solid understanding.";
  } else if (score >= 4) {
    feedback = `Demo grading: partial credit. You addressed "${question.slice(0, 60)}…" but could tie claims more tightly to identifiers or control flow in the upload.`;
  } else {
    feedback =
      "Demo grading: limited evidence of understanding. Add concrete references to functions, variables, or steps from the uploaded files.";
  }

  return { id: 0, score, feedback };
}

export function gradeMockFa(
  faAnswers: FaAnswer[],
  files: SourceFile[],
): FaScored[] {
  return faAnswers.map((a) => {
    const scored = scoreOneFa(a.answer, a.question, files);
    return { ...scored, id: a.id };
  });
}
