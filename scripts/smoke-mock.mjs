#!/usr/bin/env node
/**
 * Offline-mode smoke test against the running production server.
 * Forces offline generate + grade (no Ollama required).
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:43127";

const sample = {
  name: "grade_book.py",
  content: `class GradeBook:
    def add_score(self, student, score):
        if score < 0 or score > 100:
            raise ValueError("bad")
        self._scores.setdefault(student, []).append(score)
    def average(self, student):
        scores = self._scores[student]
        return sum(scores) / len(scores)
`,
};

async function main() {
  const home = await fetch(BASE);
  if (!home.ok) throw new Error(`GET / => ${home.status}`);
  const html = await home.text();
  if (!/Runs on your laptop|Code Quiz Grader/i.test(html)) {
    throw new Error("home HTML missing local-first trust copy");
  }

  const status = await fetch(`${BASE}/api/ollama/status`);
  const statusBody = await status.json();
  if (!status.ok) throw new Error(`ollama status: ${JSON.stringify(statusBody)}`);
  if (typeof statusBody.ok !== "boolean" || !statusBody.base) {
    throw new Error(`bad status shape: ${JSON.stringify(statusBody)}`);
  }

  const gen = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [sample],
      mcCount: 3,
      faCount: 2,
      mock: true,
      offline: true,
    }),
  });
  const genBody = await gen.json();
  if (!gen.ok) throw new Error(`generate: ${JSON.stringify(genBody)}`);
  if (genBody.mode !== "offline" && genBody.mode !== "mock") {
    throw new Error(`expected offline mode, got ${genBody.mode}`);
  }
  if (genBody.quiz.mc.length !== 3 || genBody.quiz.fa.length !== 2) {
    throw new Error(`bad counts: ${JSON.stringify(genBody.quiz)}`);
  }
  const mentions = genBody.quiz.mc[0].question + genBody.quiz.fa[0].question;
  if (!/GradeBook|grade_book/i.test(mentions)) {
    throw new Error(`questions not grounded: ${mentions}`);
  }

  const faAnswers = genBody.quiz.fa.map((q) => ({
    id: q.id,
    question: q.question,
    answer:
      "GradeBook stores student scores in a dict of lists. add_score validates 0–100 and average divides the sum by length.",
  }));

  const grade = await fetch(`${BASE}/api/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [sample],
      faAnswers,
      mock: true,
      offline: true,
    }),
  });
  const gradeBody = await grade.json();
  if (!grade.ok) throw new Error(`grade: ${JSON.stringify(gradeBody)}`);
  if (gradeBody.mode !== "offline" && gradeBody.mode !== "mock") {
    throw new Error(`grade mode ${gradeBody.mode}`);
  }
  if (gradeBody.fa_scores.length !== 2) throw new Error("missing FA scores");
  for (const s of gradeBody.fa_scores) {
    if (
      typeof s.score !== "number" ||
      s.score < 0 ||
      s.score > 10 ||
      !s.feedback
    ) {
      throw new Error(`bad score row ${JSON.stringify(s)}`);
    }
  }

  const mc = genBody.quiz.mc[0];
  if (mc.answer !== "A") throw new Error("expected sample MC answer A");

  console.log(
    JSON.stringify(
      {
        ok: true,
        base: BASE,
        mode: genBody.mode,
        ollamaOk: statusBody.ok,
        ollamaModel: statusBody.selected,
        mc: genBody.quiz.mc.length,
        fa: genBody.quiz.fa.length,
        faScores: gradeBody.fa_scores.map((s) => s.score),
        sampleQ: genBody.quiz.mc[0].question,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
