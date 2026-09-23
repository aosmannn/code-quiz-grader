import type { FaAnswer, FaScored, QuizData, SourceFile } from "./types";

export type CodeSummary = {
  names: string;
  fileList: string[];
  primaryName: string;
  snippet: string;
  hasFn: boolean;
  hasLoop: boolean;
  hasCond: boolean;
  hasRaise: boolean;
  hasImport: boolean;
  lang: string;
  primarySymbol: string;
  classNames: string[];
  defNames: string[];
  methodHints: string[];
  raiseHints: string[];
  imports: string[];
  fingerprint: string;
};

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function summarizeCode(files: SourceFile[]): CodeSummary {
  const fileList = files.map((f) => f.name);
  const names = fileList.join(", ");
  const primary = files[0];
  const blob = files.map((f) => f.content).join("\n");
  const snippet = primary?.content.slice(0, 1200) ?? "";
  const hasFn =
    /\b(function|def|fn|func|public\s+static|=>)\b/.test(blob) ||
    /\bclass\b/.test(blob);
  const hasLoop = /\b(for|while|forEach|\.map\s*\()\b/.test(blob);
  const hasCond = /\b(if|else|elif|switch|case|\?)\b/.test(blob);
  const hasRaise = /\b(raise|throw|throws)\b/.test(blob);
  const hasImport = /\b(import|from|require\s*\(|#include)\b/.test(blob);
  const lang = primary?.name.split(".").pop()?.toLowerCase() ?? "code";

  const classNames = unique(
    [...blob.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  ).slice(0, 6);

  const defNames = unique(
    [
      ...blob.matchAll(/\b(?:def|function|fn)\s+([A-Za-z_][A-Za-z0-9_]*)/g),
      ...blob.matchAll(
        /\b(?:public|private|protected|static|async)?\s*(?:void|int|string|bool|boolean|float|double|long|auto|fun)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
      ),
    ]
      .map((m) => m[1])
      .filter(
        (n) =>
          n &&
          ![
            "if",
            "for",
            "while",
            "switch",
            "catch",
            "return",
            "main",
            "new",
            "class",
          ].includes(n),
      ),
  ).slice(0, 8);

  const methodHints = unique(
    [...blob.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
      .map((m) => m[1])
      .filter((n) => n.length > 2 && !["push", "pop", "log", "print"].includes(n)),
  ).slice(0, 6);

  const raiseHints = unique(
    [...blob.matchAll(/\b(?:raise|throw)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(
      (m) => m[1],
    ),
  ).slice(0, 4);

  const imports = unique(
    [
      ...blob.matchAll(/^\s*import\s+([A-Za-z0-9_./*-]+)/gm),
      ...blob.matchAll(/^\s*from\s+([A-Za-z0-9_.]+)\s+import/gm),
      ...blob.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]),
  ).slice(0, 6);

  const primarySymbol =
    classNames[0] || defNames[0] || primary?.name.replace(/\.[^.]+$/, "") || "the program";

  return {
    names,
    fileList,
    primaryName: primary?.name ?? "your program",
    snippet,
    hasFn,
    hasLoop,
    hasCond,
    hasRaise,
    hasImport,
    lang,
    primarySymbol,
    classNames,
    defNames,
    methodHints,
    raiseHints,
    imports,
    fingerprint: `${names}|${blob.slice(0, 4000)}`,
  };
}

type McBuilder = (s: CodeSummary) => {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: "A" | "B" | "C" | "D";
};

const MC_BUILDERS: McBuilder[] = [
  (s) => ({
    question: `In \`${s.primaryName}\`, what is \`${s.primarySymbol}\` mainly responsible for?`,
    options: {
      A: `Core behavior for \`${s.primarySymbol}\` as defined in your uploaded ${s.lang} code`,
      B: "Launching a separate GUI window toolkit",
      C: "Compiling the operating system kernel",
      D: "Encrypting TLS certificates for a CDN",
    },
    answer: "A",
  }),
  (s) => {
    const sym = s.defNames[0] || s.methodHints[0] || s.primarySymbol;
    return {
      question: `Which claim about \`${sym}\` in \`${s.primaryName}\` is most accurate?`,
      options: {
        A: s.defNames.includes(sym) || s.methodHints.includes(sym)
          ? `\`${sym}\` is a function/method your program defines or calls as part of its logic`
          : `\`${sym}\` is a central symbol in the uploaded submission`,
        B: `\`${sym}\` is a built-in CPU instruction that cannot appear in source`,
        C: `\`${sym}\` only exists in binary firmware blobs`,
        D: `\`${sym}\` is reserved for database migration tools`,
      },
      answer: "A",
    };
  },
  (s) => ({
    question: `How does control flow work in \`${s.primaryName}\`?`,
    options: {
      A: s.hasCond
        ? "It uses conditionals (`if` / branches) to choose behavior from inputs or state"
        : "It mostly follows a straight-line path with little branching",
      B: "It only spins forever waiting on a GPU shader",
      C: "It never returns from any function",
      D: "It requires a blockchain consensus round each line",
    },
    answer: "A",
  }),
  (s) => ({
    question: `How does \`${s.primaryName}\` handle repeated work?`,
    options: {
      A: s.hasLoop
        ? "It iterates (loops / collection helpers) over data or repeated steps"
        : "It tends to do work once rather than iterating collections",
      B: "It forks a new OS process for every character",
      C: "It stores results only in browser cookies",
      D: "It never executes user-defined logic",
    },
    answer: "A",
  }),
  (s) => {
    const err = s.raiseHints[0];
    return {
      question: s.hasRaise
        ? `What does error handling look like around \`${s.primarySymbol}\`?`
        : `Which edge case should a careful reader consider for \`${s.primaryName}\`?`,
      options: {
        A: s.hasRaise
          ? err
            ? `It can raise/throw \`${err}\` (or similar) when inputs are invalid`
            : "It raises/throws on invalid or unexpected conditions"
          : "Empty, null, or unexpected inputs that the happy path may not cover",
        B: "Whether the sun is rising in the southern hemisphere",
        C: "Whether the file is printed on glossy paper",
        D: "Whether the CPU supports 8-bit audio codecs",
      },
      answer: "A",
    };
  },
  (s) => ({
    question: `Which statement best describes the uploaded files (${s.names})?`,
    options: {
      A:
        s.fileList.length > 1
          ? `Together they form the submitted ${s.lang} program the quiz is about`
          : `\`${s.primaryName}\` is the submitted ${s.lang} source under review`
      ,
      B: "They are encrypted disk images for a hypervisor",
      C: "They are unrelated markdown style guides",
      D: "They only contain binary machine code",
    },
    answer: "A",
  }),
  (s) => {
    const other =
      s.defNames.find((d) => d !== s.primarySymbol) ||
      s.classNames.find((c) => c !== s.primarySymbol) ||
      null;
    return {
      question: other
        ? `How do \`${s.primarySymbol}\` and \`${other}\` relate in this submission?`
        : `How is logic organized in \`${s.primaryName}\`?`,
      options: {
        A: other
          ? `Both appear in your upload; understanding one helps explain how \`${other}\` fits the overall design`
          : s.hasFn
            ? "Logic is organized into functions, methods, or classes you can reason about separately"
            : "Most logic sits at top level rather than deep class hierarchies",
        B: "They are guaranteed lock-free on every platform",
        C: "They cannot be read by humans",
        D: "They replace the operating system kernel",
      },
      answer: "A",
    };
  },
  (s) => ({
    question: s.hasImport
      ? `What role do imports play near the top of \`${s.primaryName}\`?`
      : `What would improve maintainability of \`${s.primaryName}\`?`,
    options: {
      A: s.hasImport
        ? s.imports[0]
          ? `They bring in helpers such as \`${s.imports[0]}\` (and similar) that the program relies on`
          : "They pull in libraries/modules the program depends on"
        : "Clear naming, focused functions, and comments for non-obvious intent",
      B: "They delete all identifiers at runtime",
      C: "They hard-code secrets into every function",
      D: "They duplicate the entire file for each feature",
    },
    answer: "A",
  }),
];

type FaBuilder = (s: CodeSummary) => string;

const FA_BUILDERS: FaBuilder[] = [
  (s) =>
    `In your own words, explain what \`${s.primarySymbol}\` in \`${s.primaryName}\` is trying to accomplish and why that matters.`,
  (s) =>
    `Walk through the main path in \`${s.primaryName}\`. What happens step by step when this ${s.lang} program runs?`,
  (s) =>
    s.defNames.length
      ? `Pick one of these symbols from your upload (\`${s.defNames.slice(0, 3).join("`, `")}\`) and explain how it is used.`
      : `Identify one important variable or data structure in \`${s.primaryName}\` and explain how it is used.`,
  (s) =>
    s.hasRaise
      ? `Describe when \`${s.primarySymbol}\` fails or raises, and how the code signals that to the caller.`
      : `Describe an edge case for \`${s.primarySymbol}\` and how the code handles (or fails to handle) it.`,
  (s) =>
    `If you were reviewing this submission, what one clarity or design improvement would you suggest for \`${s.primaryName}\` and why?`,
  (s) =>
    s.fileList.length > 1
      ? `How do these files work together: ${s.fileList.map((n) => `\`${n}\``).join(", ")}?`
      : `What would a classmate need to know about \`${s.primaryName}\` to use \`${s.primarySymbol}\` correctly?`,
  (s) =>
    s.methodHints.length
      ? `Explain how a call like \`.${s.methodHints[0]}(...)\` fits into the behavior of \`${s.primarySymbol}\`.`
      : `Point to one concrete line of logic in \`${s.primaryName}\` and explain why it is necessary.`,
];

/** Local on-device quiz generation — no cloud, no Ollama, no API keys. */
export function generateLocalQuiz(
  files: SourceFile[],
  mcCount: number,
  faCount: number,
  attempt = 0,
): QuizData {
  const s = summarizeCode(files);
  const rand = mulberry32(hashSeed(s.fingerprint) ^ (attempt * 0x9e3779b9));
  const mcPool = shuffle(MC_BUILDERS, rand);
  const faPool = shuffle(FA_BUILDERS, rand);

  const mc = Array.from({ length: mcCount }, (_, i) => {
    const t = mcPool[i % mcPool.length](s);
    return { id: i + 1, ...t };
  });
  const fa = Array.from({ length: faCount }, (_, i) => ({
    id: mcCount + i + 1,
    question: faPool[i % faPool.length](s),
  }));
  return { mc, fa };
}

/** @deprecated alias — keep smoke scripts working */
export const generateMockQuiz = generateLocalQuiz;

function scoreOneFa(answer: string, question: string, files: SourceFile[]): FaScored {
  const text = answer.trim();
  const lower = text.toLowerCase();
  const tokens = lower.split(/\W+/).filter((t) => t.length > 2);
  const summary = summarizeCode(files);
  const codeBlob = files.map((f) => f.content).join("\n").toLowerCase();

  const symbolHits = [
    summary.primarySymbol,
    ...summary.classNames,
    ...summary.defNames,
    ...summary.fileList.map((n) => n.replace(/\.[^.]+$/, "")),
  ].filter((sym) => sym && lower.includes(sym.toLowerCase())).length;

  let score = 1;
  if (text.length >= 30) score += 2;
  if (text.length >= 80) score += 2;
  if (tokens.length >= 12) score += 1;
  if (symbolHits > 0) score += 3;
  if (symbolHits > 1) score += 2;

  const codeWords = new Set(
    codeBlob
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 240),
  );
  const overlap = tokens.filter((t) => codeWords.has(t)).length;
  if (overlap >= 2) score += 1;
  if (overlap >= 4) score += 1;

  // Perfect when the student clearly names their symbols and explains
  if (symbolHits >= 1 && text.length >= 60 && overlap >= 2) score = 10;

  score = Math.max(0, Math.min(10, score));

  let feedback: string;
  if (score >= 10) {
    feedback = `Full credit — you named symbols from \`${summary.primaryName}\` and explained the idea clearly.`;
  } else if (score >= 4) {
    feedback = `Not full credit yet on “${question.slice(0, 52)}…”. Name \`${summary.primarySymbol}\`${
      summary.defNames[0] ? ` or \`${summary.defNames[0]}\`` : ""
    } and explain the steps in a few sentences, then retry.`;
  } else {
    feedback = `Keep going. Mention identifiers from your upload (e.g. \`${summary.primarySymbol}\`) and describe what they do — you can try a fresh quiz anytime.`;
  }

  return { id: 0, score, feedback };
}

export function gradeLocalFa(faAnswers: FaAnswer[], files: SourceFile[]): FaScored[] {
  return faAnswers.map((a) => {
    const scored = scoreOneFa(a.answer, a.question, files);
    return { ...scored, id: a.id };
  });
}

/** @deprecated alias */
export const gradeMockFa = gradeLocalFa;
