#!/usr/bin/env node
/**
 * Smoke: local heuristic path always + Ollama when a model is present.
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:43127";
const fs = await import("node:fs");

const samplePath =
  process.env.SAMPLE_PATH ||
  "/Users/adam/Downloads/sample_grade_book.py";

let sampleContent = `class GradeBook:
    def add_score(self, student, score):
        if score < 0 or score > 100:
            raise ValueError("bad")
        self._scores.setdefault(student, []).append(score)
    def average(self, student):
        scores = self._scores[student]
        return sum(scores) / len(scores)
`;
try {
  if (fs.existsSync(samplePath)) sampleContent = fs.readFileSync(samplePath, "utf8");
} catch {
  /* use embedded */
}

const sample = { name: "sample_grade_book.py", content: sampleContent };

async function main() {
  const home = await fetch(BASE);
  if (!home.ok) throw new Error(`GET / => ${home.status}`);
  const html = await home.text();
  if (/Understanding threshold|Aim for about 80/i.test(html)) {
    throw new Error("page still shows threshold UI");
  }
  if (/Install Ollama from https/i.test(html)) {
    throw new Error("page shows long Ollama install essay");
  }

  const status = await fetch(`${BASE}/api/ollama/status`);
  const statusBody = await status.json();
  if (!status.ok) throw new Error(`ollama status: ${JSON.stringify(statusBody)}`);

  // Forced heuristic path (always works)
  const genLocal = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [sample],
      mcCount: 3,
      faCount: 2,
      mock: true,
      attempt: 0,
    }),
  });
  const localBody = await genLocal.json();
  if (!genLocal.ok) throw new Error(`local generate: ${JSON.stringify(localBody)}`);
  if (localBody.mode !== "local") throw new Error(`expected local, got ${localBody.mode}`);

  let ollamaResult = null;
  if (statusBody.ok && statusBody.selected) {
    let body = null;
    let last = null;
    for (let i = 0; i < 3; i++) {
      const gen = await fetch(`${BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [sample],
          mcCount: 2,
          faCount: 1,
          attempt: i,
          model: statusBody.selected,
        }),
      });
      last = await gen.json();
      if (gen.ok && last.mode === "ollama") {
        body = last;
        break;
      }
    }
    if (!body) {
      throw new Error(
        `expected ollama mode after retries, last=${JSON.stringify(last)}`,
      );
    }
    const text = [
      ...body.quiz.mc.map((q) => q.question + JSON.stringify(q.options)),
      ...body.quiz.fa.map((q) => q.question),
    ].join(" ");
    if (!/GradeBook|add_score|average|score|course|letter_grade|__init__/i.test(text)) {
      throw new Error(`ollama questions not grounded: ${text.slice(0, 400)}`);
    }
    if (/blockchain|GPU shader|southern hemisphere|glossy paper/i.test(text)) {
      throw new Error(`joke distractors leaked: ${text.slice(0, 400)}`);
    }
    ollamaResult = {
      model: body.model,
      sampleQ: body.quiz.mc[0]?.question,
      notice: body.notice || null,
    };
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        base: BASE,
        ollamaOk: statusBody.ok,
        ollamaModel: statusBody.selected,
        localMode: localBody.mode,
        ollama: ollamaResult,
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
