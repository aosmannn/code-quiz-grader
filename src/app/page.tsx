import { Suspense } from "react";
import { CodeQuizGrader } from "@/components/code-quiz-grader";

export default function HomePage() {
  return (
    <main className="pf-shell">
      <Suspense
        fallback={
          <div className="mx-auto max-w-[540px] px-5 py-16 text-[var(--ink-2)]">
            Loading Preflight…
          </div>
        }
      >
        <CodeQuizGrader />
      </Suspense>
    </main>
  );
}
