import {
  buildUnderstandingMap,
  flattenFocusNodes,
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
  concept: string;
  prompt: string;
  lineStart: number;
  lineEnd: number;
  fileName: string;
  snippet: string;
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
    .slice(0, 10);
  return [...new Set([...extra, ...toks, node.label.replace("()", "")])];
}

function fileOf(node: MapNode, map: UnderstandingMap): string {
  const id = node.id;
  const hit = map.files.find((f) => id.startsWith(f.name));
  return hit?.name || map.primaryFile;
}

function documentPrompts(
  level: LadderLevel,
  fileName: string,
  lines: string,
  topic: string,
  node: MapNode,
  specHint: string,
): { prompt: string; expected: string[] } {
  const topicHint = topic ? ` (topic: ${topic})` : "";
  switch (level) {
    case "explain":
      return {
        prompt: `Look at ${lines} of \`${fileName}\`${topicHint}. In your own words, what claim or point is this section of your paper making?`,
        expected: signalsFrom(node, [topic, "claim", "argument", "shows"]),
      };
    case "reason":
      return {
        prompt: `Look at ${lines} of \`${fileName}\`. Why did you include this evidence or example${topic ? ` about ${topic}` : ""} — what does it do for your argument?`,
        expected: signalsFrom(node, [topic, "because", "evidence", "support"]),
      };
    case "predict":
      return {
        prompt: `Look at ${lines} of \`${fileName}\`. How would a skeptical reader push back on this point? What would weaken or complicate the claim?`,
        expected: signalsFrom(node, [
          topic,
          "however",
          "counter",
          "limit",
          "unless",
        ]),
      };
    case "modify":
      return {
        prompt: `Look at ${lines} of \`${fileName}\`. What would you add or change in this section to strengthen the argument (another source, clearer link to the thesis, a concession)?`,
        expected: signalsFrom(node, [topic, "add", "source", "clarify", "thesis"]),
      };
    case "defend":
      return {
        prompt: specHint
          ? `Given the assignment goals and ${lines} of \`${fileName}\`, why is this framing of ${topic || "your thesis"} a reasonable approach for the paper?`
          : `Looking at ${lines} of \`${fileName}\`, why is your treatment of ${topic || "this idea"} preferable to an obvious alternative reading? Defend the choice.`,
        expected: signalsFrom(node, [
          topic,
          "because",
          "rather",
          "thesis",
          "argument",
        ]),
      };
  }
}

function codePrompts(
  level: LadderLevel,
  fileName: string,
  lines: string,
  concept: string,
  fn: string,
  node: MapNode,
  specHint: string,
): { prompt: string; expected: string[] } {
  let expected = signalsFrom(node, [fn, concept]);
  let prompt = "";
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
        ? `Given the assignment goals and ${lines} of \`${fileName}\`, why is your approach a reasonable way to solve this — versus a clearly different design?`
        : `Looking at ${lines} of \`${fileName}\`, why is your approach preferable to an obvious alternative for this problem? Defend the tradeoff.`;
      break;
  }
  return { prompt, expected };
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
  const isDoc = map.kind === "document";

  // Never fall back to CS concepts for documents
  const topics = map.concepts.length
    ? map.concepts
    : isDoc
      ? ["Thesis", "Evidence", "Structure"]
      : ["functions", "conditionals"];

  const specHint = (params.assignmentSpec || "").trim().slice(0, 400);
  const coreCount = Math.min(5, Math.max(3, params.coreCount ?? 5));

  const levels: LadderLevel[] = (
    ["explain", "reason", "predict", "modify", "defend"] as LadderLevel[]
  ).slice(0, coreCount);

  const questions: InterviewQuestion[] = levels.map((level, i) => {
    const node = pickNode(focus, i);
    const topic = topics[i % topics.length];
    const fileName = fileOf(node, map);
    const fn = node.label.replace("()", "");
    const lines = `lines ${node.lineStart}–${node.lineEnd}`;

    const built = isDoc
      ? documentPrompts(level, fileName, lines, topic, node, specHint)
      : codePrompts(level, fileName, lines, topic, fn, node, specHint);

    return {
      id: `q${i + 1}-${level}`,
      level,
      concept: topic,
      prompt: built.prompt,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      fileName,
      snippet: node.snippet.slice(0, 600),
      expectedSignals: built.expected.filter(Boolean).slice(0, 12),
      weightKey: LEVEL_WEIGHT[level],
    };
  });

  return { map, questions };
}

export function followUpPrompt(
  q: InterviewQuestion,
  studentAnswer: string,
  kind: "code" | "document" = "code",
): InterviewQuestion {
  const short = studentAnswer.trim().slice(0, 120);
  const tip =
    kind === "document"
      ? `Point to one concrete claim, name, or sentence in that section and explain how it supports your argument — more specifically than before.`
      : `Point to one concrete line or symbol and explain what happens there — more specifically than before.`;
  return {
    ...q,
    id: `${q.id}-fu`,
    prompt: `Not quite enough yet. Look again at lines ${q.lineStart}–${q.lineEnd} of \`${q.fileName}\`.\n\nYou said: “${short}${studentAnswer.trim().length > 120 ? "…" : ""}”\n\n${tip}`,
  };
}
