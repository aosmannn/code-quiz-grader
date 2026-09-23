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
  extendsName: string | null;
  hasOverride: boolean;
  hasSuper: boolean;
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

/** Collapse `Foo.java.txt` → `Foo.java` so quizzes don't cite silly names. */
export function normalizeSourceFiles(files: SourceFile[]): SourceFile[] {
  return files.map((f) => {
    let name = f.name.trim();
    name = name.replace(/\.(java|py|c|cpp|js|ts|tsx|jsx)\.txt$/i, ".$1");
    name = name.replace(/\.txt$/i, (m, _o, s) =>
      /\.(java|py|c|cpp|js|ts)$/i.test(String(s).slice(0, -4)) ? "" : m,
    );
    if (/\.java\.txt$/i.test(f.name)) name = f.name.replace(/\.txt$/i, "");
    return { ...f, name };
  });
}

export function summarizeCode(files: SourceFile[]): CodeSummary {
  const normalized = normalizeSourceFiles(files);
  const fileList = normalized.map((f) => f.name);
  const names = fileList.join(", ");
  const primary = normalized[0];
  const blob = normalized.map((f) => f.content).join("\n");
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

  const extendsMatch = blob.match(
    /\bclass\s+[A-Za-z_][\w]*\s+extends\s+([A-Za-z_][\w]*)/,
  );
  const extendsName = extendsMatch?.[1] ?? null;
  const hasOverride = /@Override\b/.test(blob);
  const hasSuper = /\bsuper\s*\(/.test(blob);

  const defNames = unique(
    [
      ...blob.matchAll(/\b(?:def|function|fn)\s+([A-Za-z_][A-Za-z0-9_]*)/g),
      ...blob.matchAll(
        /\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:void|int|String|string|bool|boolean|float|double|long)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
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
    [
      ...blob.matchAll(
        /\b((?:u?int|float|double|char|size_t|int8_t|uint8_t|int16_t|uint16_t|int32_t|uint32_t)\w*)\b/g,
      ),
    ].map((m) => m[1]),
  ).slice(0, 8);

  const formatHints = unique(
    [...blob.matchAll(/%(?:0?\d*)?[diouxXeEfFgGcs%]/g)].map((m) => m[0]),
  ).slice(0, 6);

  const stringHints = unique(
    [...blob.matchAll(/"([^"\\]{2,60})"/g)].map((m) => m[1]),
  ).slice(0, 6);

  const methodHints = unique(
    [...blob.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
      .map((m) => m[1])
      .filter((n) => n.length > 2 && !["push", "pop", "log", "print"].includes(n)),
  ).slice(0, 6);

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
            "super",
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
    methodHints: unique([...methodHints, ...callHints, ...defNames]).slice(
      0,
      10,
    ),
    raiseHints,
    imports,
    typeHints,
    formatHints,
    stringHints,
    extendsName,
    hasOverride,
    hasSuper,
    fingerprint: `${names}|${blob.slice(0, 4000)}`,
  };
}

type McBuilder = (s: CodeSummary) => {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: "A" | "B" | "C" | "D";
};

function javaOopBuilders(s: CodeSummary): McBuilder[] {
  if (!s.extendsName && !s.hasOverride && !s.hasSuper) return [];
  const child = s.classNames[0] || s.primarySymbol;
  const parent = s.extendsName || "the parent class";
  const ret = s.stringHints[0];
  const method =
    s.defNames.find((d) => /getStudent|getClass|toString|getName/i.test(d)) ||
    s.defNames[0] ||
    "getStudentClass";

  const builders: McBuilder[] = [
    () => ({
      question: `Why does \`${child}\` use \`extends ${parent}\`?`,
      options: {
        A: `So \`${child}\` inherits ${parent}'s fields/behavior and specializes it`,
        B: `So the file compiles as Python instead of Java`,
        C: `So every method in ${parent} is deleted`,
        D: `So the JVM ignores constructors`,
      },
      answer: "A",
    }),
  ];

  if (s.hasSuper) {
    builders.push(() => ({
      question: `In the \`${child}\` constructor, what does \`super(...)\` do?`,
      options: {
        A: `It calls the \`${parent}\` constructor to initialize inherited state`,
        B: `It prints the class name to the console`,
        C: `It creates a brand-new unrelated class at runtime`,
        D: `It disables \`@Override\` checks`,
      },
      answer: "A",
    }));
  }

  if (s.hasOverride) {
    builders.push(() => ({
      question: `What is the point of \`@Override\` on \`${method}\` in \`${child}\`?`,
      options: {
        A: `It marks a method that replaces \`${parent}\`'s version with subclass-specific behavior`,
        B: `It means the method is private to the operating system`,
        C: `It turns the class into an interface`,
        D: `It forces the method to run twice`,
      },
      answer: "A",
    }));
  }

  if (ret) {
    builders.push(() => ({
      question: `What does \`${method}\` return in \`${child}\`?`,
      options: {
        A: `"${ret}"`,
        B: `"Graduate"`,
        C: `null`,
        D: `the student ID as an int`,
      },
      answer: "A",
    }));
  }

  builders.push(() => ({
    question: `Which statement about polymorphism fits \`${child}\`?`,
    options: {
      A: `A \`${parent}\` reference can hold a \`${child}\` and call the overridden \`${method}\``,
      B: `\`${child}\` cannot be used anywhere \`${parent}\` is expected`,
      C: `Overriding is illegal in Java`,
      D: `\`${child}\` erases all methods from \`${parent}\``,
    },
    answer: "A",
  }));

  return builders;
}

const MC_BUILDERS: McBuilder[] = [
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
        answer: "A",
      };
    }
    if (s.extendsName) {
      return javaOopBuilders(s)[0](s);
    }
    return {
      question: `What is \`${s.primaryName}\` mainly responsible for?`,
      options: {
        A: `Defining the behavior in this uploaded ${s.lang} source`,
        B: "Configuring a cloud billing account",
        C: "Training a neural network offline",
        D: "Formatting a spreadsheet for Excel",
      },
      answer: "A",
    };
  },
  (s) => {
    const oop = javaOopBuilders(s);
    if (oop[1]) return oop[1](s);
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
        answer: "A",
      };
    }
    const sym = s.defNames[0] || s.methodHints[0] || s.primarySymbol;
    return {
      question: `What does \`${sym}\` contribute in \`${s.primaryName}\`?`,
      options: {
        A: `\`${sym}\` is part of this file's real behavior`,
        B: `\`${sym}\` is comment-only and never compiled`,
        C: `\`${sym}\` replaces the operating system kernel`,
        D: `\`${sym}\` only runs on a GPU`,
      },
      answer: "A",
    };
  },
  (s) => {
    const oop = javaOopBuilders(s);
    if (oop[2]) return oop[2](s);
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
        answer: "A",
      };
    }
    if (s.hasCond) {
      return {
        question: `How do decisions appear in \`${s.primaryName}\`?`,
        options: {
          A: "Conditionals choose different paths from inputs or state",
          B: "The program only runs when a GPU is attached",
          C: "Every statement is skipped at runtime",
          D: "It waits forever for keyboard input in an infinite loop",
        },
        answer: "A",
      };
    }
    return {
      question: `Which claim about \`${s.primarySymbol}\` is most accurate?`,
      options: {
        A: `It is a central identifier in this upload's design`,
        B: "It is unused dead code the compiler must delete",
        C: "It only exists inside a markdown README",
        D: "It encrypts the entire hard drive",
      },
      answer: "A",
    };
  },
  (s) => {
    const oop = javaOopBuilders(s);
    if (oop[3]) return oop[3](s);
    if (s.hasLoop) {
      return {
        question: `How does \`${s.primaryName}\` handle repeated work?`,
        options: {
          A: "It iterates with loops or repeated helper calls",
          B: "It spawns a new process for every character",
          C: "It stores all results only in browser cookies",
          D: "It never executes any uploaded statements",
        },
        answer: "A",
      };
    }
    if (s.stringHints[0] && s.defNames[0]) {
      return {
        question: `Where does the text \`${s.stringHints[0]}\` come from in \`${s.primaryName}\`?`,
        options: {
          A: `It is returned (or used) by \`${s.defNames[0]}\``,
          B: "It is read from a random website each run",
          C: "It is the compiler version string",
          D: "It is never present in the source",
        },
        answer: "A",
      };
    }
    return {
      question: `Which statement best describes \`${s.primaryName}\`?`,
      options: {
        A: `It is the submitted ${s.lang} source this quiz is about`,
        B: "It is an encrypted disk image",
        C: "It is only a markdown README",
        D: "It contains no meaningful statements",
      },
      answer: "A",
    };
  },
  (s) => {
    const oop = javaOopBuilders(s);
    if (oop[4]) return oop[4](s);
    const call = s.methodHints[0] || s.defNames[0] || s.primarySymbol;
    return {
      question: `What is the role of \`${call}\` in \`${s.primaryName}\`?`,
      options: {
        A:
          call === "printf"
            ? "It prints formatted output so you can observe values / bit patterns"
            : `\`${call}\` participates in the program's observable behavior`,
        B: `\`${call}\` deletes the source file after running`,
        C: `\`${call}\` opens a GUI window toolkit`,
        D: `\`${call}\` is never reached`,
      },
      answer: "A",
    };
  },
  (s) => ({
    question: s.hasImport
      ? `Why does \`${s.primaryName}\` include headers/imports such as \`${s.imports[0] || "its libraries"}\`?`
      : `What would improve clarity in \`${s.primaryName}\`?`,
    options: {
      A: s.hasImport
        ? "They provide declarations the code relies on"
        : "Clear naming and comments for non-obvious inheritance or casts",
      B: "They remove the need for any constructor",
      C: "They hard-code secrets into every line",
      D: "They duplicate the entire file for each method",
    },
    answer: "A",
  }),
];

type FaBuilder = (s: CodeSummary) => string;

const FA_BUILDERS: FaBuilder[] = [
  (s) => {
    if (s.extendsName) {
      const child = s.classNames[0] || s.primarySymbol;
      return `In your own words: why does \`${child}\` extend \`${s.extendsName}\`, and what specialized behavior does the subclass add?`;
    }
    if (
      s.typeHints.some((t) => /int8|uint8/.test(t)) ||
      /complement/i.test(s.primaryName)
    ) {
      return `In \`${s.primaryName}\`, explain what happens when the signed value is printed with \`%d\` versus when its bits are shown in hex. Why are both useful?`;
    }
    return `In your own words, explain what \`${s.primaryName}\` is trying to accomplish. Name the main class or function.`;
  },
  (s) => {
    if (s.hasSuper || s.hasOverride) {
      const method =
        s.defNames[0] || s.methodHints[0] || "the overridden method";
      return `Explain how \`super\` and/or \`@Override\` work in \`${s.primaryName}\`. What would break if \`${method}\` were removed?`;
    }
    if (s.methodHints.includes("printf")) {
      return `Explain why the code uses the printf formats it does (e.g. ${
        s.formatHints.map((f) => `\`${f}\``).join(", ") || "`%d` / hex"
      }). What would go wrong with a careless format?`;
    }
    if (s.defNames.length) {
      return `Pick one of these symbols (\`${s.defNames.slice(0, 3).join("`, `")}\`) and explain how it is used.`;
    }
    return `Identify one important method or field in \`${s.primaryName}\` and explain how it is used.`;
  },
  (s) => {
    if (s.stringHints[0] && s.extendsName) {
      return `When would a program see the string \`${s.stringHints[0]}\` from \`${s.primaryName}\`? Tie your answer to inheritance / overriding.`;
    }
    if (s.typeHints.includes("int8_t")) {
      return `What is special about values like \`-128\` for \`int8_t\`? How does that relate to what this program is exploring?`;
    }
    return `If a classmate only skimmed \`${s.primaryName}\`, what one idea must they understand to explain this code correctly?`;
  },
  (s) =>
    s.stringHints[0] && !s.extendsName
      ? `The program uses text like "${s.stringHints[0]}". What value is being shown, and how is it produced?`
      : `Point to one concrete line in \`${s.primaryName}\` (constructor, override, cast, or call) and explain why it is necessary.`,
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

  // Prefer OOP-specific builders when this is an inheritance lab
  const oop = javaOopBuilders(s);
  const mcPool = shuffle(
    oop.length >= 2 ? [...oop, ...MC_BUILDERS] : MC_BUILDERS,
    rand,
  );
  const faPool = shuffle(FA_BUILDERS, rand);

  const seenQ = new Set<string>();
  const mc: QuizData["mc"] = [];
  for (let i = 0; mc.length < mcCount && i < mcPool.length * 3; i++) {
    const t = mcPool[i % mcPool.length](s);
    const key = t.question.toLowerCase();
    if (seenQ.has(key)) continue;
    seenQ.add(key);
    mc.push({ id: mc.length + 1, ...t });
  }
  while (mc.length < mcCount) {
    const t = MC_BUILDERS[mc.length % MC_BUILDERS.length](s);
    mc.push({ id: mc.length + 1, ...t });
  }

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
    summary.extendsName || "",
    ...summary.classNames,
    ...summary.defNames,
    ...summary.fileList.map((n) => n.replace(/\.[^.]+$/, "")),
    "extends",
    "override",
    "super",
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

  if (symbolHits >= 1 && text.length >= 60 && overlap >= 2) score = 10;

  score = Math.max(0, Math.min(10, score));

  let feedback: string;
  if (score >= 10) {
    feedback = `Full credit — you named symbols from \`${summary.primaryName}\` and explained the idea clearly.`;
  } else if (score >= 4) {
    feedback = `Not full credit yet on “${question.slice(0, 52)}…”. Name \`${summary.primarySymbol}\`${
      summary.extendsName ? ` / \`${summary.extendsName}\`` : ""
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
