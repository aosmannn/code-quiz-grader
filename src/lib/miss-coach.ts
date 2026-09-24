/** One-line coach when a student misses an MC — points at their code, not a lecture. */
export function missCoach(params: {
  question: string;
  correct: "A" | "B" | "C" | "D";
  options: { A: string; B: string; C: string; D: string };
  fileNames: string[];
  symbols: string[];
}): string {
  const correctText = params.options[params.correct] || "";
  const q = params.question;
  const sym =
    params.symbols.find((s) =>
      new RegExp(`\\b${escapeRe(s)}\\b`, "i").test(`${q} ${correctText}`),
    ) ||
    params.symbols[0] ||
    null;
  const file = params.fileNames[0] || "your file";

  if (/extends/i.test(q) || /extends/i.test(correctText)) {
    return sym
      ? `Look at how \`${sym}\` is declared in \`${file}\` — the \`extends\` line is the key.`
      : `Re-read the \`extends\` line in \`${file}\` — that’s what this question is about.`;
  }
  if (/super\s*\(/i.test(q) || /super/i.test(correctText)) {
    return `Check the constructor: \`super(...)\` is calling the parent initializer.`;
  }
  if (/@?override/i.test(q) || /override/i.test(correctText)) {
    return sym
      ? `Find \`@Override\` on \`${sym}\` in \`${file}\` — what parent method is being replaced?`
      : `Find the \`@Override\` method in \`${file}\` and compare it to the parent version.`;
  }
  if (/return/i.test(q) || /returns?/i.test(correctText)) {
    return sym
      ? `Open \`${sym}\` and look at the exact \`return\` value.`
      : `Open the method named in the question and read the \`return\` line carefully.`;
  }
  if (/%0?2?[xX]|hex|int8|uint8|printf/i.test(`${q} ${correctText}`)) {
    return `Compare the format / cast in \`${file}\` to what the correct option describes.`;
  }
  if (sym) {
    return `Wrong option. Correct is ${params.correct}. Look at \`${sym}\` in \`${file}\` and try again.`;
  }
  return `Wrong option. Correct is ${params.correct}: ${correctText.slice(0, 120)}${
    correctText.length > 120 ? "…" : ""
  }`;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
