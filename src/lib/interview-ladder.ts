import {
  buildUnderstandingMap,
  flattenFocusNodes,
  type DetectedConcept,
  type MapNode,
  type UnderstandingMap,
} from "@/lib/understanding-map";
import type { SourceFile } from "@/lib/types";

export type LadderLevel =
  | "explain"
  | "reason"
  | "predict"
  | "modify"
  | "defend";

export type InterviewQuestion = {
  id: string;
  level: LadderLevel;
  concept: DetectedConcept | "structure";
  prompt: string;
  /** Lines cited in the student UI */
  lineStart: number;
  lineEnd: number;
  fileName: string;
  snippet: string;
  /** Keywords / symbols we hope to see in a strong answer */
  expectedSignals: string[];
  weightKey: keyof UnderstandingWeights;
};

export type UnderstandingWeights = {
  concept_explanation: number;
  code_tracing: number;
  reasoning: number;
  edge_cases: number;
  modification: number;
};

export const DEFAULT_WEIGHTS: UnderstandingWeights = {
  concept_explanation: 0.2,
  code_tracing: 0.2,
  reasoning: 0.25,
  edge_cases: 0.2,
  modification: 0.15,
};

const LEVEL_WEIGHT: Record<LadderLevel, keyof UnderstandingWeights> = {
  explain: "concept_explanation",
  reason: "reasoning",
  predict: "edge_cases",
  modify: "modification",
  defend: "reasoning",
};

function pickNode(nodes: MapNode[], i: number): MapNode {
  return nodes[i % Math.max(nodes.length, 1)] || nodes[0];
}

function signalsFrom(node: MapNode, extra: string[]): string[] {
  const toks = node.snippet
    .split(/\W+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t))
    .slice(0, 8);
  return [...new Set([...extra, ...toks, node.label.replace("()", "")])];
}

function fileOf(node: MapNode, map: UnderstandingMap): string {
  const id = node.id;
  const hit = map.files.find((f) => id.startsWith(f.name));
  return hit?.name || map.primaryFile;
}

export function generateLadder(params: {
  files: SourceFile[];
  assignmentSpec?: string;
  map?: UnderstandingMap;
  coreCount?: number;
}): { map: UnderstandingMap; questions: InterviewQuestion[] } {
  const map = params.map || buildUnderstandingMap(params.files);
  const nodes = flattenFocusNodes(map);
  const focus = nodes.length ? nodes : flattenFocusNodes(map);
  const concepts = map.concepts.length
    ? map.concepts
    : (["functions", "conditionals"] as DetectedConcept[]);
  const specHint = (params.assignmentSpec || "").trim().slice(0, 400);
  const coreCount = Math.min(5, Math.max(3, params.coreCount ?? 5));

  const levels: LadderLevel[] = [
    "explain",
    "reason",
    "predict",
    "modify",
    "defend",
  ].slice(0, coreCount) as LadderLevel[];

  const questions: InterviewQuestion[] = levels.map((level, i) => {
    const node = pickNode(focus, i);
    const concept = concepts[i % concepts.length];
    const fileName = fileOf(node, map);
    const fn = node.label.replace("()", "");
    const lines = `lines ${node.lineStart}–${node.lineEnd}`;
    let prompt = "";
    let expected: string[] = signalsFrom(node, [fn, concept]);

    switch (level) {
      case "explain":
        prompt = `Look at ${lines} of \`${fileName}\` (${node.label}). In your own words, what does this part of your program do?`;
        break;
      case "reason":
        prompt =
          concept === "loops"
            ? `Look at ${lines} of \`${fileName}\`. Why did you use this loop structure here instead of another approach?`
            : concept === "inheritance" || concept === "overrides"
              ? `Look at ${lines} of \`${fileName}\`. Why is this inheritance / override shaped the way it is?`
              : `Look at ${lines} of \`${fileName}\`. Why did you structure \`${fn}\` this way — what problem does that choice solve?`;
        break;
      case "predict":
        prompt = `Look at ${lines} of \`${fileName}\`. What would happen if a key input or size were 0 (or otherwise empty/invalid)? Walk through what your code actually does.`;
        expected = [...expected, "0", "empty", "null", "return", "error", "skip"];
        break;
      case "modify":
        prompt = `Look at ${lines} of \`${fileName}\`. What would you need to change to handle a related edge case (e.g. negatives, larger input, or a missing value)? Be specific about which lines or symbols.`;
        expected = [...expected, "change", "add", "if", "check"];
        break;
      case "defend":
        prompt = specHint
          ? `Given the assignment goals and ${lines} of \`${fileName}\`, why is your approach a reasonable way to solve this — versus a clearly different design (e.g. recursion vs loops, or a flatter structure)?`
          : `Looking at ${lines} of \`${fileName}\`, why is your approach preferable to an obvious alternative for this problem? Defend the tradeoff.`;
        break;
    }

    return {
      id: `q${i + 1}-${level}`,
      level,
      concept,
      prompt,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      fileName,
      snippet: node.snippet.slice(0, 600),
      expectedSignals: expected.filter(Boolean).slice(0, 12),
      weightKey: LEVEL_WEIGHT[level],
    };
  });

  return { map, questions };
}

export function followUpPrompt(
  q: InterviewQuestion,
  studentAnswer: string,
): InterviewQuestion {
  const short = studentAnswer.trim().slice(0, 120);
  return {
    ...q,
    id: `${q.id}-fu`,
    prompt: `Not quite enough yet. Look again at lines ${q.lineStart}–${q.lineEnd} of \`${q.fileName}\`.\n\nYou said: “${short}${studentAnswer.trim().length > 120 ? "…" : ""}”\n\nPoint to one concrete line or symbol and explain what happens there — more specifically than before.`,
  };
}
