"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
  concepts: {
    label?: string;
    concept: string;
    status: string;
    bestScore: number;
  }[];
  breakdown: { label: string; pct: number }[] | null;
  map: {
    concepts: string[];
    roots: {
      label: string;
      children: { label: string; lineStart: number; lineEnd: number }[];
    }[];
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
      mode?: string;
      model?: string | null;
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

  const assignmentTitle = useMemo(() => {
    if (detail?.assignmentTitle) return detail.assignmentTitle;
    const titles = [...new Set(list.map((s) => s.assignmentTitle))];
    return titles[0] || "Assignment";
  }, [list, detail]);

  const stats = {
    total: list.length,
    passed: list.filter((s) => s.status === "passed" || s.sufficient).length,
    retry: list.filter((s) => s.status === "needs_retry").length,
    review: list.filter((s) => s.status === "instructor_review").length,
    inProgress: list.filter((s) => s.status === "in_progress").length,
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

  const downloadCsv = () => {
    const header = [
      "id",
      "userName",
      "assignmentTitle",
      "courseTitle",
      "status",
      "scorePct",
      "sufficient",
      "clearanceCode",
      "files",
      "updatedAt",
    ];
    const rows = list.map((s) =>
      [
        s.id,
        s.userName,
        s.assignmentTitle,
        s.courseTitle,
        s.status,
        s.scorePct ?? "",
        s.sufficient,
        s.clearanceCode ?? "",
        s.fileNames.join("|"),
        s.updatedAt,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `understanding-sessions-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="pf-shell">
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <h1 className="mt-2 text-[2rem] font-semibold tracking-tight">
          {assignmentTitle}
        </h1>
        <p className="mt-2 text-[1.02rem] text-[var(--ink-2)]">
          See who finished the understanding check, and open any student for the
          full question history.
        </p>

        <div className="pf-panel mt-8 space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--ink-2)]">Students</span>
            <span className="font-semibold">{stats.total}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--ink-2)]">Understanding demonstrated</span>
            <span className="font-semibold">{stats.passed}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--ink-2)]">Needs another attempt</span>
            <span className="font-semibold">{stats.retry}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--ink-2)]">Instructor review</span>
            <span className="font-semibold">{stats.review}</span>
          </div>
          {stats.inProgress > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-2)]">In progress</span>
              <span className="font-semibold">{stats.inProgress}</span>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-[var(--line)] pt-3">
            <span className="text-[var(--ink-2)]">Average understanding</span>
            <span className="font-semibold">
              {stats.avg != null ? `${stats.avg}%` : "—"}
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={loadList}>
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={list.length === 0}
            onClick={downloadCsv}
          >
            Export CSV
          </Button>
        </div>

        <div className="mt-8 space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-[var(--ink-3)]">
              No sessions yet — students start from the home page.
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
                  {s.status}
                  {s.scorePct != null ? ` · ${s.scorePct}%` : ""}
                  {s.clearanceCode ? ` · ${s.clearanceCode}` : ""}
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
              <p className="mt-1 font-mono text-[12px] text-[var(--ink-3)]">
                Understanding: {detail.scorePct ?? "—"}%
                <br />
                {detail.assignmentTitle} · {detail.courseTitle}
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

            {detail.breakdown && (
              <ul className="space-y-1 border-t border-[var(--line)] pt-3 text-sm text-[var(--ink-2)]">
                {detail.breakdown.map((b) => (
                  <li key={b.label} className="flex justify-between gap-2">
                    <span>{b.label}</span>
                    <span className="font-mono">{b.pct}%</span>
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
                  <li
                    key={i}
                    className="border-t border-[var(--line)] pt-3 text-sm"
                  >
                    <p className="font-mono text-[10px] uppercase text-[var(--ink-3)]">
                      {t.isFollowUp ? "Follow-up" : t.level}
                      {t.evaluation.demonstrated
                        ? " · ✓ Demonstrated"
                        : " · △ Weak"}
                      {" · "}
                      {t.fileName} L{t.lineStart}–{t.lineEnd}
                      {t.evaluation.mode
                        ? ` · ${t.evaluation.mode}${t.evaluation.model ? `/${t.evaluation.model}` : ""}`
                        : ""}
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
          <Link
            className="font-semibold text-[var(--brand)] underline"
            href="/instructor"
          >
            ← Lab presets
          </Link>
          <Link className="text-[var(--ink-3)] underline" href="/ta">
            TA verify
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
