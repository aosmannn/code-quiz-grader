import type { SourceFile } from "@/lib/types";

export type SubmissionKind = "code" | "document";

export type MapNode = {
  id: string;
  label: string;
  kind: "file" | "fn" | "block" | "section";
  lineStart: number;
  lineEnd: number;
  children: MapNode[];
  snippet: string;
};

/** CS concepts (code) or free-form topic labels (documents). */
export type DetectedConcept =
  | "loops"
  | "arrays"
  | "functions"
  | "conditionals"
  | "input_validation"
  | "arithmetic"
  | "pointers"
  | "inheritance"
  | "overrides"
  | "constructors"
  | "recursion"
  | "io"
  | string;

export type UnderstandingMap = {
  kind: SubmissionKind;
  files: { name: string; lineCount: number }[];
  roots: MapNode[];
  /** Topics / concepts shown in the UI — never CS defaults for documents */
  concepts: string[];
  primaryFile: string;
  fingerprint: string;
};

const CS_CONCEPT_PATTERNS: { concept: string; re: RegExp }[] = [
  { concept: "loops", re: /\b(for|while|do)\s*\(/ },
  { concept: "arrays", re: /\[[^\]]*\]|\b(ArrayList|vector)<|\blist\s*</i },
  {
    concept: "functions",
    re: /\b(def|function|fn|void|int|public|private|static)\s+\w+\s*\(/,
  },
  { concept: "conditionals", re: /\b(if|else if|switch)\s*\(/ },
  {
    concept: "input_validation",
    re: /\b(scanf|cin\s*>>|input\(|readline|Integer\.parse|atoi)\b/,
  },
  { concept: "pointers", re: /\w+\s*\*|->|malloc\s*\(/ },
  { concept: "inheritance", re: /\bextends\b|\binherits\b|:\s*public\s+\w+/ },
  { concept: "overrides", re: /@Override|\boverride\b/i },
  { concept: "constructors", re: /\bsuper\s*\(/ },
  { concept: "io", re: /\b(printf|println|cout\s*<<|fopen)\b/ },
];

const CODE_EXT =
  /\.(py|js|ts|jsx|tsx|java|c|cpp|cc|h|hpp|cs|go|rb|rs|php|swift|kt|scala|lua|m|sh)$/i;
const DOC_EXT = /\.(pdf|docx|doc|md|rtf)$/i;

const STOP_TOPICS = new Set(
  [
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "from",
    "have",
    "been",
    "were",
    "was",
    "are",
    "is",
    "its",
    "their",
    "they",
    "them",
    "into",
    "about",
    "which",
    "when",
    "where",
    "what",
    "than",
    "then",
    "also",
    "such",
    "only",
    "other",
    "more",
    "most",
    "some",
    "these",
    "those",
    "through",
    "after",
    "before",
    "between",
    "under",
    "over",
    "while",
    "because",
    "however",
    "therefore",
    "thus",
    "paper",
    "essay",
    "section",
    "chapter",
    "figure",
    "table",
    "page",
    "pages",
  ].map((s) => s.toLowerCase()),
);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function lineOf(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

function extractSnippet(lines: string[], start: number, end: number) {
  return lines.slice(Math.max(0, start - 1), end).join("\n");
}

export function detectSubmissionKind(files: SourceFile[]): SubmissionKind {
  const names = files.map((f) => f.name.toLowerCase());
  const blob = files.map((f) => f.content).join("\n");
  const hasDocExt = names.some((n) => DOC_EXT.test(n));
  const hasCodeExt = names.some((n) => CODE_EXT.test(n));

  // Strong code signals
  const codeHits =
    (/\b(public\s+class|def\s+\w+\s*\(|#include\s*[<"]|function\s+\w+\s*\(|@Override|console\.log|printf\s*\()/i.test(
      blob,
    )
      ? 2
      : 0) +
    (/\b(extends|implements|import\s+java|using\s+System)\b/.test(blob) ? 1 : 0) +
    (hasCodeExt ? 2 : 0);

  // Prose / essay signals
  const sentences = (blob.match(/[.!?]["']?\s+[A-Z]/g) || []).length;
  const avgWordLen =
    blob
      .split(/\s+/)
      .filter(Boolean)
      .reduce((a, w) => a + w.length, 0) /
    Math.max(1, blob.split(/\s+/).filter(Boolean).length);
  const proseHits =
    (hasDocExt ? 3 : 0) +
    (sentences >= 4 ? 2 : sentences >= 2 ? 1 : 0) +
    (avgWordLen >= 4.2 && !hasCodeExt ? 1 : 0) +
    (/\b(thesis|argument|histori|film|cinema|according to|in this (paper|essay)|Metropolis|Blade Runner)\b/i.test(
      blob,
    )
      ? 2
      : 0);

  if (proseHits >= codeHits && (hasDocExt || proseHits >= 3)) return "document";
  if (codeHits >= 2) return "code";
  if (hasDocExt) return "document";
  if (hasCodeExt) return "code";
  // Short extracted PDF with few code tokens → document
  return proseHits >= codeHits ? "document" : "code";
}

const LEAD_SKIP =
  /^(The|This|That|These|Those|When|Where|While|However|Therefore|Thus|Also|After|Before|In|On|At|For|And|But|According|Evidence|Reading|A|An)$/i;

/** Proper nouns + repeated content words from the paper. */
export function extractDocumentTopics(blob: string, limit = 8): string[] {
  // Flatten so proper-noun spans never jump paragraph breaks
  const flat = blob.replace(/\s+/g, " ");
  const proper = new Map<string, number>();
  // Walk capitalized runs but stop before sentence-glue words ("This", "While", …)
  for (const m of flat.matchAll(/\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)*)\b/g)) {
    const rawParts = m[1].trim().split(/\s+/);
    const parts: string[] = [];
    for (const w of rawParts) {
      if (LEAD_SKIP.test(w) && parts.length > 0) break;
      if (LEAD_SKIP.test(w) && parts.length === 0) continue;
      parts.push(w);
      if (parts.length >= 4) break;
    }
    const phrase = parts.join(" ");
    if (phrase.length < 3) continue;
    const lower = phrase.toLowerCase();
    if (STOP_TOPICS.has(lower)) continue;
    if (LEAD_SKIP.test(phrase)) continue;
    proper.set(phrase, (proper.get(phrase) || 0) + 1);
  }

  // Boost multi-word and repeated names
  const ranked = [...proper.entries()]
    .map(([term, count]) => {
      const words = term.split(/\s+/).length;
      return { term, score: count * (words > 1 ? 3 : 1) + (words > 1 ? 2 : 0) };
    })
    .sort((a, b) => b.score - a.score);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { term } of ranked) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    // Avoid substring dupes of longer phrases already kept
    if ([...seen].some((s) => s.includes(key) || key.includes(s))) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= limit) break;
  }

  // Fallback content words if few proper nouns
  if (out.length < 3) {
    const freq = new Map<string, number>();
    for (const w of flat.toLowerCase().match(/[a-z]{5,}/g) || []) {
      if (STOP_TOPICS.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    for (const [w, c] of [...freq.entries()].sort((a, b) => b[1] - a[1])) {
      if (c < 2) continue;
      const label = w.charAt(0).toUpperCase() + w.slice(1);
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(label);
      if (out.length >= limit) break;
    }
  }

  return out.slice(0, limit);
}

function findDocumentSections(content: string, fileName: string): MapNode[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const paras: { start: number; end: number; text: string }[] = [];
  let buf: string[] = [];
  let start = 1;

  const flush = (endLine: number) => {
    const text = buf.join("\n").trim();
    if (text.length >= 40) {
      paras.push({ start, end: endLine, text });
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      if (buf.length) flush(i);
      start = i + 2;
      continue;
    }
    if (buf.length === 0) start = i + 1;
    buf.push(line);
    // Cap long sections
    if (buf.join("\n").length > 900) flush(i + 1);
  }
  if (buf.length) flush(lines.length);

  if (paras.length === 0) {
    return [
      {
        id: `${fileName}:body`,
        label: "Opening section",
        kind: "section",
        lineStart: 1,
        lineEnd: Math.min(lines.length, 20),
        children: [],
        snippet: extractSnippet(lines, 1, Math.min(20, lines.length)),
      },
    ];
  }

  // Pick up to 6 meaty sections spread through the doc
  const picks: typeof paras = [];
  const step = Math.max(1, Math.floor(paras.length / 6));
  for (let i = 0; i < paras.length && picks.length < 6; i += step) {
    picks.push(paras[i]);
  }
  if (picks.length < 3) {
    for (const p of paras) {
      if (!picks.includes(p)) picks.push(p);
      if (picks.length >= 4) break;
    }
  }

  return picks.map((p, idx) => {
    const first = p.text.replace(/\s+/g, " ").trim().slice(0, 72);
    return {
      id: `${fileName}:sec${idx + 1}`,
      label: first + (p.text.length > 72 ? "…" : ""),
      kind: "section" as const,
      lineStart: p.start,
      lineEnd: p.end,
      children: [],
      snippet: p.text.slice(0, 700),
    };
  });
}

function findFunctions(content: string, fileName: string): MapNode[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const nodes: MapNode[] = [];
  const sigRe =
    /(?:^|\n)\s*(?:public|private|protected|static|final|unsigned|signed|inline|virtual)?\s*(?:public|private|protected|static|final|unsigned|signed)?\s*(?:void|int|char|float|double|long|bool|boolean|String|size_t|[\w:<>,\s*]+)\s+([A-Za-z_][\w]*)\s*\([^;{}]*\)\s*\{/g;
  const defRe = /(?:^|\n)\s*def\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*:/g;

  const candidates: { name: string; index: number }[] = [];
  for (const m of content.matchAll(sigRe)) {
    const name = m[1];
    if (!name || ["if", "for", "while", "switch"].includes(name)) continue;
    candidates.push({ name, index: m.index ?? 0 });
  }
  for (const m of content.matchAll(defRe)) {
    candidates.push({ name: m[1], index: m.index ?? 0 });
  }

  const seen = new Set<string>();
  for (const c of candidates) {
    const startLine = lineOf(content, c.index);
    const key = `${c.name}:${startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let endLine = Math.min(lines.length, startLine + 24);
    const from = content.indexOf("{", c.index);
    if (from >= 0) {
      let depth = 0;
      for (let i = from; i < content.length; i++) {
        if (content[i] === "{") depth++;
        if (content[i] === "}") {
          depth--;
          if (depth === 0) {
            endLine = lineOf(content, i);
            break;
          }
        }
      }
    }

    const children: MapNode[] = [];
    const body = extractSnippet(lines, startLine, endLine);
    if (/\b(for|while)\b/.test(body)) {
      const lm = body.search(/\b(for|while)\b/);
      const rel = lm >= 0 ? lineOf(body, lm) : 1;
      children.push({
        id: `${fileName}:${c.name}:loop`,
        label: "loop",
        kind: "block",
        lineStart: startLine + rel - 1,
        lineEnd: Math.min(endLine, startLine + rel + 4),
        children: [],
        snippet: extractSnippet(
          lines,
          startLine + rel - 1,
          Math.min(endLine, startLine + rel + 4),
        ),
      });
    }

    nodes.push({
      id: `${fileName}:${c.name}`,
      label: `${c.name}()`,
      kind: "fn",
      lineStart: startLine,
      lineEnd: endLine,
      children,
      snippet: extractSnippet(lines, startLine, Math.min(endLine, startLine + 12)),
    });
  }

  if (nodes.length === 0) {
    nodes.push({
      id: `${fileName}:body`,
      label: fileName,
      kind: "fn",
      lineStart: 1,
      lineEnd: lines.length,
      children: [],
      snippet: extractSnippet(lines, 1, Math.min(20, lines.length)),
    });
  }
  return nodes;
}

function detectCodeConcepts(blob: string, fnNames: string[]): string[] {
  const found = new Set<string>();
  for (const { concept, re } of CS_CONCEPT_PATTERNS) {
    if (re.test(blob)) found.add(concept);
  }
  for (const name of fnNames) {
    if (name === "main") continue;
    const re = new RegExp(`\\b${name}\\s*\\(`, "g");
    if ([...blob.matchAll(re)].length >= 2) found.add("recursion");
  }
  if (fnNames.length > 0) found.add("functions");
  return [...found];
}

export function buildUnderstandingMap(files: SourceFile[]): UnderstandingMap {
  const normalized = files.filter((f) => f.content?.trim());
  const kind = detectSubmissionKind(normalized);
  const roots: MapNode[] = [];
  const allFn: string[] = [];
  let blob = "";

  for (const f of normalized) {
    blob += `\n${f.content}`;
    const lines = f.content.replace(/\r\n/g, "\n").split("\n");
    if (kind === "document") {
      const sections = findDocumentSections(f.content, f.name);
      roots.push({
        id: f.name,
        label: f.name,
        kind: "file",
        lineStart: 1,
        lineEnd: lines.length,
        children: sections,
        snippet: "",
      });
    } else {
      const fns = findFunctions(f.content, f.name);
      for (const n of fns) {
        if (n.kind === "fn") allFn.push(n.label.replace("()", ""));
      }
      roots.push({
        id: f.name,
        label: f.name,
        kind: "file",
        lineStart: 1,
        lineEnd: lines.length,
        children: fns,
        snippet: "",
      });
    }
  }

  const primary = normalized[0]?.name || (kind === "document" ? "paper" : "code");
  const concepts =
    kind === "document"
      ? extractDocumentTopics(blob)
      : detectCodeConcepts(blob, allFn);

  return {
    kind,
    files: normalized.map((f) => ({
      name: f.name,
      lineCount: f.content.replace(/\r\n/g, "\n").split("\n").length,
    })),
    roots,
    concepts,
    primaryFile: primary,
    fingerprint: hash(normalized.map((f) => f.name + f.content).join("\0")),
  };
}

export function flattenFocusNodes(map: UnderstandingMap): MapNode[] {
  const out: MapNode[] = [];
  const walk = (n: MapNode) => {
    if (n.kind === "fn" || n.kind === "block" || n.kind === "section") out.push(n);
    n.children.forEach(walk);
  };
  map.roots.forEach(walk);
  return out;
}

const CS_LABELS: Record<string, string> = {
  loops: "Loops",
  arrays: "Arrays",
  functions: "Functions",
  conditionals: "Conditionals",
  input_validation: "Input validation",
  arithmetic: "Arithmetic",
  pointers: "Pointers",
  inheritance: "Inheritance",
  overrides: "Method overriding",
  constructors: "Constructors",
  recursion: "Recursion",
  io: "Input / output",
};

/** Display label for a concept/topic — works for CS keys and free-form paper topics. */
export function conceptLabel(concept: string): string {
  if (CS_LABELS[concept]) return CS_LABELS[concept];
  return concept;
}

/** @deprecated use conceptLabel — kept for older imports */
export const CONCEPT_LABELS = CS_LABELS as Record<DetectedConcept, string>;
