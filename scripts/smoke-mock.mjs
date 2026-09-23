#!/usr/bin/env node
/**
 * Local on-device + LTI pilot smoke — no Ollama, no cloud APIs.
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
  if (!/Course assignment|Opened from your class|course tool|Code understanding/i.test(html)) {
    throw new Error("home HTML missing course-tool framing");
  }
  if (/ollama serve|ollama pull|Install Ollama/i.test(html)) {
    throw new Error("page still mentions Ollama install UX");
  }

  const stale = await fetch(`${BASE}/api/ollama/status`);
  if (stale.status !== 404) {
    throw new Error(`expected /api/ollama/status 404, got ${stale.status}`);
  }

  const pilot = await fetch(`${BASE}/pilot`);
  if (!pilot.ok) throw new Error(`GET /pilot => ${pilot.status}`);

  const jwks = await fetch(`${BASE}/lti/jwks`);
  if (!jwks.ok) throw new Error(`GET /lti/jwks => ${jwks.status}`);

  // Dev launch → session cookie
  const launch = await fetch(`${BASE}/lti/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      isDevSim: "true",
      sub: "smoke-user",
      name: "Smoke Tester",
      roles: "Learner",
      context_title: "CSc Smoke Course",
      resource_link_title: "Lab understanding check",
    }),
    redirect: "manual",
  });
  if (launch.status !== 303 && launch.status !== 302) {
    throw new Error(`launch expected redirect, got ${launch.status}`);
  }
  const setCookie = launch.headers.getSetCookie?.() || [];
  const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader.includes("cqg_lti")) {
    // Node fetch may expose as get('set-cookie')
    const raw = launch.headers.get("set-cookie") || "";
    if (!/cqg_lti/.test(raw) && setCookie.length === 0) {
      console.warn("warn: could not capture set-cookie in this runtime; continuing");
    }
  }

  const gen = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [sample],
      mcCount: 3,
      faCount: 2,
      attempt: 0,
    }),
  });
  const genBody = await gen.json();
  if (!gen.ok) throw new Error(`generate: ${JSON.stringify(genBody)}`);
  if (genBody.mode !== "local") {
    throw new Error(`expected local mode, got ${genBody.mode}`);
  }
  const mentions = [
    ...genBody.quiz.mc.map((q) => q.question),
    ...genBody.quiz.fa.map((q) => q.question),
  ].join(" ");
  if (!/GradeBook|grade_book|add_score|average/i.test(mentions)) {
    throw new Error(`questions not grounded: ${mentions}`);
  }

  const faAnswers = genBody.quiz.fa.map((q) => ({
    id: q.id,
    question: q.question,
    answer:
      "GradeBook stores student scores. add_score validates 0–100; average divides sum by length.",
  }));
  const grade = await fetch(`${BASE}/api/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: [sample], faAnswers }),
  });
  const gradeBody = await grade.json();
  if (!grade.ok) throw new Error(`grade: ${JSON.stringify(gradeBody)}`);
  if (gradeBody.mode !== "local") throw new Error(`grade mode ${gradeBody.mode}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        base: BASE,
        mode: genBody.mode,
        launchStatus: launch.status,
        pilot: true,
        jwks: true,
        sampleQ: genBody.quiz.mc[0].question,
        faScores: gradeBody.fa_scores.map((s) => s.score),
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
