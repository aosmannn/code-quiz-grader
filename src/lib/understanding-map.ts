import type { SourceFile } from "@/lib/types";

export type MapNode = {
  id: string;
  label: string;
  kind: "file" | "fn" | "block";
  lineStart: number;
  lineEnd: number;
  children: MapNode[];
  snippet: string;
};

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
  | "io";

export type UnderstandingMap = {
  files: { name: string; lineCount: number }[];
  roots: MapNode[];
  concepts: DetectedConcept[];
  primaryFile: string;
  fingerprint: string;
};

const CONCEPT_PATTERNS: { concept: DetectedConcept; re: RegExp }[] = [
  { concept: "loops", re: /\b(for|while|do)\b/ },
  { concept: "arrays", re: /\[[^\]]*\]|\b(ArrayList|vector|list)\b/i },
  { concept: "functions", re: /\b(def|function|fn|void|int|public|private|static)\s+\w+\s*\(/ },
  { concept: "conditionals", re: /\b(if|else|switch|case)\b/ },
  { concept: "input_validation", re: /\b(scanf|cin|input\(|readline|Integer\.parse|atoi|isdigit)\b/ },
  { concept: "arithmetic", re: /[+\-*/%]=|[+\-*/%]/ },
  { concept: "pointers", re: /\*\w+|\w+\s*\*|->|&\w+/ },
  { concept: "inheritance", re: /\bextends\b|\binherits\b|:\s*public\s+\w+/ },
  { concept: "overrides", re: /@Override|\boverride\b/i },
  { concept: "constructors", re: /\bsuper\s*\(|new\s+\w+\s*\(/ },
  { concept: "io", re: /\b(printf|print|println|cout|scanf|fopen|read|write)\b/ },
];

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

/** Find function-ish blocks with brace matching. */
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

  // Dedup by name+approx line
  const seen = new Set<string>();
  for (const c of candidates) {
    const startLine = lineOf(content, c.index);
    const key = `${c.name}:${startLine}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Brace / indent end heuristic
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
    if (/\bif\b/.test(body)) {
      children.push({
        id: `${fileName}:${c.name}:cond`,
        label: "conditional",
        kind: "block",
        lineStart: startLine,
        lineEnd: Math.min(endLine, startLine + 8),
        children: [],
        snippet: extractSnippet(lines, startLine, Math.min(endLine, startLine + 8)),
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

  // Fallback: whole file as one node
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

function detectConcepts(blob: string, fnNames: string[]): DetectedConcept[] {
  const found = new Set<DetectedConcept>();
  for (const { concept, re } of CONCEPT_PATTERNS) {
    if (concept === "recursion") continue;
    if (re && re.test(blob)) found.add(concept);
  }
  // Recursion: function name appears inside its own body roughly
  for (const name of fnNames) {
    if (name === "main") continue;
    const re = new RegExp(`\\b${name}\\s*\\(`, "g");
    const hits = [...blob.matchAll(re)];
    if (hits.length >= 2) found.add("recursion");
  }
  // Ensure functions if we found named defs
  if (fnNames.length > 0) found.add("functions");
  return [...found];
}

export function buildUnderstandingMap(files: SourceFile[]): UnderstandingMap {
  const normalized = files.filter((f) => f.content?.trim());
  const roots: MapNode[] = [];
  const allFn: string[] = [];
  let blob = "";

  for (const f of normalized) {
    blob += `\n${f.content}`;
    const fns = findFunctions(f.content, f.name);
    for (const n of fns) {
      if (n.kind === "fn") allFn.push(n.label.replace("()", ""));
    }
    const lines = f.content.replace(/\r\n/g, "\n").split("\n");
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

  const primary = normalized[0]?.name || "code";
  return {
    files: normalized.map((f) => ({
      name: f.name,
      lineCount: f.content.replace(/\r\n/g, "\n").split("\n").length,
    })),
    roots,
    concepts: detectConcepts(blob, allFn),
    primaryFile: primary,
    fingerprint: hash(normalized.map((f) => f.name + f.content).join("\0")),
  };
}

export function flattenFocusNodes(map: UnderstandingMap): MapNode[] {
  const out: MapNode[] = [];
  const walk = (n: MapNode) => {
    if (n.kind === "fn" || n.kind === "block") out.push(n);
    n.children.forEach(walk);
  };
  map.roots.forEach(walk);
  return out;
}

export const CONCEPT_LABELS: Record<DetectedConcept, string> = {
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
