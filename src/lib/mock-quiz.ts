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
  typeHints: string[];
  formatHints: string[];
  stringHints: string[];
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

  const typeHints = unique(
    [...blob.matchAll(/\b((?:u?int|float|double|char|size_t|int8_t|uint8_t|int16_t|uint16_t|int32_t|uint32_t)\w*)\b/g)].map(
      (m) => m[1],
    ),
  ).slice(0, 8);

  const formatHints = unique(
    [...blob.matchAll(/%(?:0?\d*)?[diouxXeEfFgGcs%]/g)].map((m) => m[0]),
  ).slice(0, 6);

  const stringHints = unique(
    [...blob.matchAll(/"([^"\\]{3,60})"/g)].map((m) => m[1]),
  ).slice(0, 4);

  const methodHints = unique(
    [...blob.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
      .map((m) => m[1])
      .filter((n) => n.length > 2 && !["push", "pop", "log", "print"].includes(n)),
  ).slice(0, 6);

  // C library calls like printf(
  const callHints = unique(
    [...blob.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
      .map((m) => m[1])
      .filter(
        (n) =>
          ![
            "if",
            "for",
            "while",
            "switch",
            "return",
            "sizeof",
            "main",
          ].includes(n),
      ),
  ).slice(0, 8);

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
      ...blob.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g),
    ].map((m) => m[1]),
  ).slice(0, 6);

  const primarySymbol =
    classNames[0] ||
    defNames[0] ||
    callHints[0] ||
    typeHints[0] ||
    primary?.name.replace(/\.[^.]+$/, "") ||
    "the program";

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
    methodHints: unique([...methodHints, ...callHints]).slice(0, 8),
    raiseHints,
    imports,
    typeHints,
    formatHints,
    stringHints,
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
    question: `What is \`${s.primaryName}\` mainly demonstrating or computing?`,
    options: {
      A:
        s.typeHints.some((t) => /int8|uint8/i.test(t)) ||
        /complement/i.test(s.primaryName)
          ? "How a signed integer value is stored/shown (including bit pattern / two's complement ideas)"
          : `The core logic defined in the uploaded ${s.lang} source`,
      B: "Setting up a production database schema",
      C: "Training a neural network offline",
      D: "Parsing HTML for a web browser",
    },
    answer: "A",
  }),
  (s) => {
    const typ = s.typeHints.find((t) => /int8_t|uint8_t|int16|uint16/.test(t));
    if (typ) {
      return {
        question: `Why does \`${s.primaryName}\` use \`${typ}\`?`,
        options: {
          A: `\`${typ}\` fixes the width/signedness of the value so the bit pattern is well-defined`,
          B: `\`${typ}\` is required by every C program's linker`,
          C: `\`${typ}\` disables printf entirely`,
          D: `\`${typ}\` converts the file into Python`,
        },
        answer: "A" as const,
      };
    }
    const sym = s.defNames[0] || s.methodHints[0] || s.primarySymbol;
    return {
      question: `Which claim about \`${sym}\` in \`${s.primaryName}\` is most accurate?`,
      options: {
        A: `\`${sym}\` appears in your upload and participates in the program's behavior`,
        B: `\`${sym}\` is ignored by the compiler and never runs`,
        C: `\`${sym}\` only exists in comments`,
        D: `\`${sym}\` replaces the operating system`,
      },
      answer: "A" as const,
    };
  },
  (s) => {
    const fmt =
      s.formatHints.find((f) => /X|x/.test(f)) || s.formatHints[0];
    if (fmt && s.methodHints.includes("printf")) {
      return {
        question: `In \`${s.primaryName}\`, what does the printf format \`${fmt}\` help show?`,
        options: {
          A: /X|x/.test(fmt)
            ? "A hexadecimal view of the byte/bit pattern"
            : "A formatted value printed to the console",
          B: "A network packet checksum only",
          C: "A random password",
          D: "The name of the source file on disk",
        },
        answer: "A" as const,
      };
    }
    return {
      question: `How does control flow work in \`${s.primaryName}\`?`,
      options: {
        A: s.hasCond
          ? "It uses conditionals to choose behavior from inputs or state"
          : "It mostly runs top-to-bottom with little branching",
        B: "It waits forever for keyboard input inside an infinite loop",
        C: "It never reaches return / exit",
        D: "It only runs when a GPU is attached",
      },
      answer: "A" as const,
    };
  },
  (s) => {
    if (
      s.methodHints.includes("printf") &&
      /uint8_t|int8_t/.test(s.typeHints.join(","))
    ) {
      return {
        question: `Why cast through \`uint8_t\` (or similar) before printing hex in \`${s.primaryName}\`?`,
        options: {
          A: "So the printed hex shows the raw 8-bit pattern, not a sign-extended wider int",
          B: "Because printf cannot print decimal values otherwise",
          C: "Because `#include <stdio.h>` requires it for every program",
          D: "To convert the program into assembly automatically",
        },
        answer: "A" as const,
      };
    }
    return {
      question: `How does \`${s.primaryName}\` handle repeated work?`,
      options: {
        A: s.hasLoop
          ? "It iterates over data or repeats steps with loops/helpers"
          : "It tends to do its work once without looping over a collection",
        B: "It spawns a new process for every character printed",
        C: "It stores all results only in browser cookies",
        D: "It never executes any of the uploaded statements",
      },
      answer: "A" as const,
    };
  },
  (s) => ({
    question: s.hasRaise
      ? `What does error handling look like around \`${s.primarySymbol}\`?`
      : `Which edge case should a careful reader consider for \`${s.primaryName}\`?`,
    options: {
      A: s.hasRaise
        ? "Invalid inputs can raise/throw and abort the happy path"
        : s.typeHints.some((t) => /int8/.test(t))
          ? "Extreme values (e.g. most-negative `int8_t`) and how they print as signed vs bits"
          : "Unexpected inputs or values the happy path may not cover",
      B: "Whether the source file is saved as a PDF",
      C: "Whether the CPU brand logo is visible",
      D: "Whether the room lights are on",
    },
    answer: "A",
  }),
  (s) => ({
    question: `Which statement best describes \`${s.primaryName}\`?`,
    options: {
      A: `It is the submitted ${s.lang} source the quiz is about`,
      B: "It is an encrypted disk image",
      C: "It is only a markdown README",
      D: "It contains no runnable statements",
    },
    answer: "A",
  }),
  (s) => {
    const call = s.methodHints[0] || s.primarySymbol;
    return {
      question: `What is the role of \`${call}\` in \`${s.primaryName}\`?`,
      options: {
        A:
          call === "printf"
            ? "It prints formatted output so you can observe the value / bit pattern"
            : `\`${call}\` participates in the program's observable behavior`,
        B: `\`${call}\` deletes the source file after running`,
        C: `\`${call}\` opens a GUI window toolkit`,
        D: `\`${call}\` is never reached`,
      },
      answer: "A" as const,
    };
  },
  (s) => ({
    question: s.hasImport
      ? `Why does \`${s.primaryName}\` include headers/imports such as \`${s.imports[0] || "its libraries"}\`?`
      : `What would improve clarity in \`${s.primaryName}\`?`,
    options: {
      A: s.hasImport
        ? "They provide declarations (e.g. printf / fixed-width types) the code calls"
        : "Clear naming and comments for non-obvious casts or formats",
      B: "They remove the need for a `main` function",
      C: "They hard-code secrets into every line",
      D: "They duplicate the entire file for each print",
    },
    answer: "A",
  }),
];

type FaBuilder = (s: CodeSummary) => string;

const FA_BUILDERS: FaBuilder[] = [
  (s) =>
    s.typeHints.some((t) => /int8|uint8/.test(t)) ||
    /complement/i.test(s.primaryName)
      ? `In \`${s.primaryName}\`, explain what happens when the signed value is printed with \`%d\` versus when its bits are shown in hex. Why are both useful?`
      : `In your own words, explain what \`${s.primaryName}\` is trying to accomplish.`,
  (s) =>
    `Walk through \`${s.primaryName}\` line by line. What is stored in the important variable(s), and what gets printed?`,
  (s) =>
    s.methodHints.includes("printf")
      ? `Explain why the code uses the printf formats it does (e.g. ${
          s.formatHints.map((f) => `\`${f}\``).join(", ") || "`%d` / hex"
        }). What would go wrong with a careless format?`
      : s.defNames.length
        ? `Pick one of these symbols (\`${s.defNames.slice(0, 3).join("`, `")}\`) and explain how it is used.`
        : `Identify one important variable in \`${s.primaryName}\` and explain how it is used.`,
  (s) =>
    s.typeHints.includes("int8_t")
      ? `What is special about values like \`-128\` for \`int8_t\`? How does that relate to what this program is exploring?`
      : `Describe an edge case for \`${s.primarySymbol}\` and how the code handles (or fails to handle) it.`,
  (s) =>
    `If a classmate only skimmed \`${s.primaryName}\`, what one idea must they understand to explain its output correctly?`,
  (s) =>
    s.stringHints[0]
      ? `The program prints text like "${s.stringHints[0]}…". What value is being shown there, and how is it computed/cast?`
      : `Point to one concrete cast or conversion in \`${s.primaryName}\` and explain why it is necessary.`,
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
