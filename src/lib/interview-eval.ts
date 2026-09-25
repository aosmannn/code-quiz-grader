import type { InterviewQuestion, UnderstandingWeights } from "@/lib/interview-ladder";
import { DEFAULT_WEIGHTS } from "@/lib/interview-ladder";
import type { DetectedConcept } from "@/lib/understanding-map";
import {
  callOllama,
  getOllamaStatus,
  parseModelJson,
} from "@/lib/ollama";

export type EvalResult = {
  score01: number;
  demonstrated: boolean;
  needsFollowUp: boolean;
  feedback: string;
  evidence: string[];
  conceptsHit: string[];
  mode?: "heuristic" | "ollama" | "blend";
  model?: string | null;
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "your",
  "code",
  "line",
  "lines",
  "when",
  "then",
  "just",
  "into",
  "also",
  "have",
  "will",
  "would",
  "could",
  "should",
]);

export function evaluateAnswer(
  question: InterviewQuestion,
  answer: string,
): EvalResult {
  const text = answer.trim();
  const lower = text.toLowerCase();
  const evidence: string[] = [];
  const conceptsHit: string[] = [];

  if (text.length < 12) {
    return {
      score01: 0.05,
      demonstrated: false,
      needsFollowUp: true,
      feedback:
        "Too short — explain what that part of *your* program is doing, naming something concrete.",
      evidence: [],
      conceptsHit: [],
      mode: "heuristic",
    };
  }

  let score = 0.15;
  if (text.length >= 40) score += 0.1;
  if (text.length >= 90) score += 0.1;
  if (text.length >= 160) score += 0.05;

  const tokens = lower.split(/\W+/).filter((t) => t.length > 2 && !STOP.has(t));
  const signalHits = question.expectedSignals.filter((s) =>
    lower.includes(s.toLowerCase()),
  );
  for (const s of signalHits.slice(0, 6)) {
    evidence.push(`mentions “${s}”`);
    score += 0.08;
  }
  if (signalHits.length >= 2) score += 0.08;

  const conceptWords: Record<string, RegExp> = {
    loops: /\b(loop|iterate|until|while|for each|counter)\b/i,
    arrays: /\b(array|index|element|list)\b/i,
    functions: /\b(function|method|return|call|parameter|argument)\b/i,
    conditionals: /\b(if|else|condition|branch|check)\b/i,
    pointers: /\b(pointer|address|dereference|null|malloc|memory)\b/i,
    inheritance: /\b(extends|inherit|subclass|parent|super)\b/i,
    overrides: /\b(override|replace|same signature)\b/i,
    edge: /\b(zero|empty|null|invalid|edge|fail|error)\b/i,
  };
  for (const [k, re] of Object.entries(conceptWords)) {
    if (re.test(text)) {
      conceptsHit.push(k);
      score += 0.04;
      evidence.push(`uses ${k} language`);
    }
  }

  if (question.level === "predict" || question.level === "modify") {
    if (/\b(if|when|would|then|change|add|check)\b/i.test(text)) {
      score += 0.08;
      evidence.push("discusses contingency / change");
    }
  }
  if (question.level === "defend" || question.level === "reason") {
    if (/\b(because|so that|instead|rather|tradeoff|prefer)\b/i.test(text)) {
      score += 0.1;
      evidence.push("gives a reason / tradeoff");
    }
  }

  if (
    /^(it works|idk|i don't know|because it does|to make it work)\b/i.test(
      text,
    ) ||
    tokens.length < 6
  ) {
    score -= 0.15;
    evidence.push("answer is vague or thin");
  }

  score = Math.max(0, Math.min(1, score));
  const demonstrated = score >= 0.62;
  const needsFollowUp = !demonstrated && score >= 0.25 && text.length >= 20;

  let feedback: string;
  if (demonstrated) {
    feedback =
      evidence.length > 0
        ? `Solid — I can see you connecting the answer to your code (${evidence.slice(0, 2).join("; ")}).`
        : "Solid — enough specificity to count as demonstrated.";
  } else if (needsFollowUp) {
    feedback = `Partial. Look at lines ${question.lineStart}–${question.lineEnd} again and name a concrete symbol or step.`;
  } else {
    feedback = `Not demonstrated yet. Your answer doesn’t clearly engage lines ${question.lineStart}–${question.lineEnd} of \`${question.fileName}\`.`;
  }

  return {
    score01: score,
    demonstrated,
    needsFollowUp,
    feedback,
    evidence,
    conceptsHit,
    mode: "heuristic",
  };
}

/** Prefer host Ollama when available; blend with heuristic so flaky small models can’t fully override. */
export async function evaluateAnswerSmart(
  question: InterviewQuestion,
  answer: string,
  assignmentSpec?: string,
): Promise<EvalResult> {
  const base = evaluateAnswer(question, answer);
  if (answer.trim().length < 12) return base;

  try {
    const status = await getOllamaStatus();
    if (!status.ok || !status.selected) return base;

    const prompt = `You are an oral-exam grader for a programming course.
Decide if the student UNDERSTANDS the cited code (not whether the program is correct for the assignment).

Return ONLY JSON:
{"score01":0.0-1.0,"demonstrated":bool,"needsFollowUp":bool,"feedback":"1-2 sentences pointing at their code","evidence":["short quotes or reasons"]}

Rules:
- demonstrated if they show real understanding of THIS snippet (≥0.62).
- needsFollowUp if partial (0.25–0.61) and a probing follow-up would help.
- feedback must reference their symbols/lines when possible — never a generic lecture.
- Be fair to imperfect English.

Assignment context (may be empty):
${(assignmentSpec || "").slice(0, 500)}

Level: ${question.level}
Concept: ${question.concept}
File: ${question.fileName} lines ${question.lineStart}-${question.lineEnd}
Code:
\`\`\`
${question.snippet.slice(0, 900)}
\`\`\`

Question:
${question.prompt}

Student answer:
${answer.trim().slice(0, 1200)}
`;

    const raw = await callOllama({
      model: status.selected,
      prompt,
      numPredict: 400,
      timeoutMs: 45_000,
    });
    const parsed = parseModelJson<{
      score01?: number;
      demonstrated?: boolean;
      needsFollowUp?: boolean;
      feedback?: string;
      evidence?: string[];
    }>(raw);

    const modelScore =
      typeof parsed.score01 === "number" && Number.isFinite(parsed.score01)
        ? Math.max(0, Math.min(1, parsed.score01))
        : base.score01;

    const score01 = Math.max(
      0,
      Math.min(1, modelScore * 0.65 + base.score01 * 0.35),
    );
    const demonstrated =
      typeof parsed.demonstrated === "boolean"
        ? score01 >= 0.62 && (parsed.demonstrated || base.demonstrated)
        : score01 >= 0.62;
    const needsFollowUp =
      !demonstrated &&
      (parsed.needsFollowUp ?? base.needsFollowUp) &&
      score01 >= 0.22;

    return {
      score01,
      demonstrated,
      needsFollowUp,
      feedback:
        (parsed.feedback && String(parsed.feedback).trim()) || base.feedback,
      evidence: [
        ...((Array.isArray(parsed.evidence)
          ? parsed.evidence
          : []) as string[]).slice(0, 4),
        ...base.evidence.slice(0, 2),
      ].slice(0, 6),
      conceptsHit: base.conceptsHit,
      mode: "blend",
      model: status.selected,
    };
  } catch {
    return base;
  }
}

export type ConceptStatus = {
  concept: DetectedConcept | string;
  status: "demonstrated" | "weak" | "missing";
  bestScore: number;
};

export function aggregateUnderstanding(params: {
  weights?: UnderstandingWeights;
  byWeight: Partial<Record<keyof UnderstandingWeights, number[]>>;
  conceptScores: Record<string, number>;
  allConcepts: string[];
}): {
  scorePct: number;
  sufficient: boolean;
  threshold: number;
  breakdown: { key: keyof UnderstandingWeights; label: string; pct: number }[];
  concepts: ConceptStatus[];
} {
  const w = params.weights || DEFAULT_WEIGHTS;
  const labels: Record<keyof UnderstandingWeights, string> = {
    concept_explanation: "Concept explanation",
    code_tracing: "Code tracing",
    reasoning: "Reasoning",
    edge_cases: "Edge cases",
    modification: "Modification",
  };

  let total = 0;
  const breakdown: {
    key: keyof UnderstandingWeights;
    label: string;
    pct: number;
  }[] = [];

  (Object.keys(w) as (keyof UnderstandingWeights)[]).forEach((key) => {
    const scores = params.byWeight[key] || [];
    const avg =
      scores.length === 0
        ? 0
        : scores.reduce((a, b) => a + b, 0) / scores.length;
    const pct = Math.round(avg * 100);
    breakdown.push({ key, label: labels[key], pct });
    total += avg * w[key];
  });

  const explain = params.byWeight.concept_explanation || [];
  if (explain.length && !(params.byWeight.code_tracing || []).length) {
    const avg = explain.reduce((a, b) => a + b, 0) / explain.length;
    total = total - w.code_tracing * 0 + avg * w.code_tracing;
    const row = breakdown.find((b) => b.key === "code_tracing");
    if (row) row.pct = Math.round(avg * 100);
  }

  const scorePct = Math.round(Math.max(0, Math.min(100, total * 100)));
  const threshold = 75;
  const concepts: ConceptStatus[] = params.allConcepts.map((c) => {
    const best = params.conceptScores[c] ?? 0;
    return {
      concept: c,
      bestScore: best,
      status:
        best >= 0.62 ? "demonstrated" : best >= 0.3 ? "weak" : "missing",
    };
  });

  return {
    scorePct,
    sufficient: scorePct >= threshold,
    threshold,
    breakdown,
    concepts,
  };
}
