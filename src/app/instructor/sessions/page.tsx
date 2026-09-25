"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

type SessionRow = {
  id: string;
  userName: string;
  assignmentTitle: string;
  courseTitle: string;
  status: string;
  scorePct: number | null;
  sufficient: boolean;
  fileNames: string[];
  updatedAt: string;
  clearanceCode?: string | null;
};

type SessionDetail = {
  id: string;
  userName: string;
  assignmentTitle: string;
  courseTitle: string;
  status: string;
  scorePct: number | null;
  sufficient: boolean;
  threshold: number;
  fileNames: string[];
  clearanceCode?: string | null;
  concepts: { label?: string; concept: string; status: string; bestScore: number }[];
  breakdown: { label: string; pct: number }[] | null;
  map: {
    concepts: string[];
    roots: { label: string; children: { label: string; lineStart: number; lineEnd: number }[] }[];
  };
  turns: {
    level: string;
    prompt: string;
    isFollowUp: boolean;
    response: string;
    evaluation: {
      score01: number;
      demonstrated: boolean;
      feedback: string;
      evidence: string[];
    };
    answeredAt: string;
    fileName: string;
    lineStart: number;
    lineEnd: number;
  }[];
};

function SessionsInner() {
  const search = useSearchParams();
  const focusId = search.get("id");
  const [list, setList] = useState<SessionRow[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = () => {
    void fetch("/api/interview")
      .then((r) => r.json())
      .then((d) => setList(d.sessions || []))
      .catch(() => setList([]));
  };

  const loadOne = (id: string) => {
    setError(null);
    void fetch(`/api/interview?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Not found");
        setDetail(d.session);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  };

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (focusId) loadOne(focusId);
  }, [focusId]);

  const stats = {
    total: list.length,
    passed: list.filter((s) => s.status === "passed").length,
    retry: list.filter((s) => s.status === "needs_retry").length,
    review: list.filter((s) => s.status === "instructor_review").length,
    avg:
      list.filter((s) => typeof s.scorePct === "number").length === 0
        ? null
        : Math.round(
            list
              .filter((s) => typeof s.scorePct === "number")
              .reduce((a, s) => a + (s.scorePct || 0), 0) /
              list.filter((s) => typeof s.scorePct === "number").length,
          ),
  };

  return (
    <main className="pf-shell">
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="pf-kicker">Instructor</p>
        <h1 className="mt-2 text-[2.2rem] font-extrabold tracking-tight">
          Understanding sessions
        </h1>
        <p className="mt-3 text-[1.02rem] text-[var(--ink-2)]">
          Auditable evidence — questions, responses, AI evaluation — not just a
          score.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Students", stats.total],
            ["Demonstrated", stats.passed],
            ["Retry", stats.retry],
            ["Review", stats.review],
          ].map(([label, n]) => (
            <div key={String(label)} className="pf-panel py-3 text-center">
              <p className="text-[1.5rem] font-bold">{n}</p>
              <p className="font-mono text-[10px] uppercase text-[var(--ink-3)]">
                {label}
              </p>
            </div>
          ))}
        </div>
        {stats.avg != null && (
          <p className="mt-3 font-mono text-[12px] text-[var(--ink-3)]">
            Average understanding {stats.avg}%
          </p>
        )}

        <div className="mt-8 space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-[var(--ink-3)]">
              No sessions yet — run a student check from the home page.
            </p>
          )}
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => loadOne(s.id)}
              className="flex w-full items-center justify-between gap-3 border border-[var(--line)] bg-white px-3 py-2.5 text-left text-sm hover:border-[var(--brand)]"
            >
              <span>
                <span className="font-semibold">{s.userName}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-[var(--ink-3)]">
                  {s.assignmentTitle} · {s.status}
                  {s.scorePct != null ? ` · ${s.scorePct}%` : ""}
                </span>
              </span>
              <span className="font-mono text-[10px] text-[var(--ink-3)]">
                {s.fileNames[0]}
              </span>
            </button>
          ))}
        </div>

        {error && <div className="pf-err mt-4">{error}</div>}

        {detail && (
          <div className="pf-panel mt-8 space-y-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                {detail.userName}
              </h2>
              <p className="font-mono text-[12px] text-[var(--ink-3)]">
                {detail.assignmentTitle} · {detail.courseTitle}
                <br />
                Understanding: {detail.scorePct ?? "—"}% · {detail.status}
                {detail.clearanceCode ? ` · ${detail.clearanceCode}` : ""}
              </p>
            </div>

            {detail.concepts?.length > 0 && (
              <ul className="space-y-1 text-sm">
                {detail.concepts.map((c) => (
                  <li key={c.concept}>
                    {c.status === "demonstrated"
                      ? "✓"
                      : c.status === "weak"
                        ? "△"
                        : "·"}{" "}
                    {c.label || c.concept}
                  </li>
                ))}
              </ul>
            )}

            <div>
              <p className="font-mono text-[11px] uppercase text-[var(--ink-3)]">
                Questions
              </p>
              <ul className="mt-2 space-y-4">
                {detail.turns.map((t, i) => (
                  <li key={i} className="border-t border-[var(--line)] pt-3 text-sm">
                    <p className="font-mono text-[10px] uppercase text-[var(--ink-3)]">
                      {t.isFollowUp ? "Follow-up" : t.level}
                      {t.evaluation.demonstrated
                        ? " · ✓ Demonstrated"
                        : " · △ Weak"}
                      {" · "}
                      {t.fileName} L{t.lineStart}–{t.lineEnd}
                    </p>
                    <p className="mt-1 font-medium">{t.prompt}</p>
                    <p className="mt-1 text-[var(--ink-2)]">“{t.response}”</p>
                    <p className="mt-1 text-[12px] text-[var(--ink-3)]">
                      {t.evaluation.feedback}
                      {t.evaluation.evidence?.length
                        ? ` · Evidence: ${t.evaluation.evidence.join("; ")}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <Button type="button" variant="outline" onClick={loadList}>
            Refresh
          </Button>
          <Link className="font-semibold text-[var(--brand)] underline" href="/instructor">
            ← Lab presets
          </Link>
          <Link className="text-[var(--ink-3)] underline" href="/">
            Student home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function InstructorSessionsPage() {
  return (
    <Suspense
      fallback={
        <main className="pf-shell">
          <div className="mx-auto max-w-md px-5 py-20 text-[var(--ink-2)]">
            Loading sessions…
          </div>
        </main>
      }
    >
      <SessionsInner />
    </Suspense>
  );
}
