import { CodeQuizGrader } from "@/components/code-quiz-grader";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <CodeQuizGrader />
    </main>
  );
}
