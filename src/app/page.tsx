"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Completion = {
  completionId: string;
  submittedAt: string;
  courseTitle?: string;
  assignmentTitle?: string;
  files?: string[];
};

const COMPLETION_KEY = "cqg_completions";

export default function StudentDesk() {
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMPLETION_KEY);
      const list = raw ? (JSON.parse(raw) as Completion[]) : [];
      setCompletions(Array.isArray(list) ? list.slice(0, 8) : []);
    } catch {
      setCompletions([]);
    }
    void fetch("/api/ollama/status")
      .then((r) => r.json())
      .then((d: { ok?: boolean; selected?: string | null }) => {
        setOllamaOk(Boolean(d.ok));
        setModel(d.selected ?? null);
      })
      .catch(() => setOllamaOk(false));
  }, []);

  const latest = completions[0];

  return (
    <main className="pf-shell">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:py-14">
        <section className="flex flex-col justify-center">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="cqg-trust">
              <span className="pf-live-dot" /> Student desk
            </span>
            {ollamaOk === true && (
              <span className="pf-chip pf-chip-fn">
                host model · {model ?? "ready"}
              </span>
            )}
            {ollamaOk === false && (
              <span className="pf-chip">on-device fallback ready</span>
            )}
          </div>

          <p
            className="mb-2 text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[var(--signal)]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            Preflight
          </p>
          <h1
            className="mb-4 max-w-xl text-[2.6rem] leading-[1.05] font-extrabold tracking-tight text-[var(--ink)] sm:text-[3.2rem]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            Prove you get your own code — then submit.
          </h1>
          <p className="mb-8 max-w-lg text-[1.05rem] leading-relaxed text-[var(--ink-2)]">
            Not another quiz grader. A{" "}
            <strong className="text-[var(--ink)]">pre-submit clearance</strong>{" "}
            for your lab: upload what you wrote, answer questions built from{" "}
            <em>your</em> symbols, stamp 100%, then turn in the real assignment.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button asChild className="h-11 px-5 text-base font-semibold">
              <Link href="/try">Start preflight</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 border-[var(--line-2)] bg-transparent px-5 text-[var(--ink)] hover:bg-[var(--surface)]"
            >
              <Link href="/check">Open lab bench</Link>
            </Button>
          </div>

          <ol className="mt-10 space-y-3 text-sm text-[var(--ink-2)]">
            {[
              "Click the assignment link (or Start preflight)",
              "Upload your lab files — Symbol Radar shows what we’ll probe",
              "Pass at 100% → clearance stamp → submit the real lab",
            ].map((line, i) => (
              <li key={line} className="flex gap-3">
                <span
                  className="font-mono text-[var(--signal)]"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  0{i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </section>

        <aside className="space-y-4">
          <div className="pf-panel">
            <div className="pf-panel-title">Clearance board</div>
            <p className="pf-panel-sub">
              Stamps stay on this device so you (and a TA) can confirm you
              cleared the check.
            </p>
            {latest ? (
              <div className="pf-stamp mb-4">
                <div
                  className="text-lg font-bold text-[var(--ink)]"
                  style={{ fontFamily: "var(--font-display), sans-serif" }}
                >
                  {latest.assignmentTitle || "Understanding check"}
                </div>
                <div className="mt-1 text-sm text-[var(--ink-2)]">
                  {latest.courseTitle || "Local practice"}
                </div>
                <div
                  className="mt-3 font-mono text-xs text-[var(--ink-3)]"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {latest.completionId}
                  <br />
                  {new Date(latest.submittedAt).toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-dashed border-[var(--line-2)] px-4 py-8 text-center text-sm text-[var(--ink-3)]">
                No clearances yet — run a preflight to earn your first stamp.
              </div>
            )}

            {completions.length > 1 && (
              <ul className="space-y-2">
                {completions.slice(1).map((c) => (
                  <li
                    key={c.completionId}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[#101820] px-3 py-2 text-xs"
                  >
                    <span className="truncate text-[var(--ink-2)]">
                      {c.assignmentTitle || "Check"}
                    </span>
                    <span
                      className="shrink-0 font-mono text-[var(--ink-3)]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      {new Date(c.submittedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pf-panel">
            <div className="pf-panel-title">Why this isn’t Mikler’s tool</div>
            <ul className="space-y-2 text-sm text-[var(--ink-2)]">
              <li>· Built as a <strong className="text-[var(--ink)]">submit gate</strong>, not a generic grader</li>
              <li>· Symbol Radar + clearance passport (screenshot-ready)</li>
              <li>· Host Ollama / on-device fallback — no student API keys</li>
              <li>· Student desk + lab-bench layout, not a card stack</li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
