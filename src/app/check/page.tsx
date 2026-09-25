import { Suspense } from "react";
import { CodeQuizGrader } from "@/components/code-quiz-grader";

/** Legacy quiz-style UI (kept for comparison with Mikler HTML). */
export default function CheckPage() {
  return (
    <main className="pf-shell">
      <Suspense
        fallback={
          <div className="mx-auto max-w-[540px] px-5 py-16 text-[var(--ink-2)]">
            Loading…
          </div>
        }
      >
        <CodeQuizGrader />
      </Suspense>
    </main>
  );
}
