"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { normalizeSourceFiles } from "@/lib/mock-quiz";
import { getLabPreset, type LabPreset } from "@/lib/lab-presets";
import { SAMPLE_PROGRAM } from "@/lib/sample-program";
import { CONCEPT_LABELS } from "@/lib/understanding-map";

const ACCEPT =
  ".py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.txt,.h";

type Screen = "upload" | "interview" | "report";

type Question = {
  id: string;
  level: string;
  concept: string;
  prompt: string;
  lineStart: number;
  lineEnd: number;
  fileName: string;
  snippet: string;
};

type Progress = {
  coreIndex: number;
  coreTotal: number;
  followUpsUsed: number;
  maxFollowUps: number;
};

type Report = {
  scorePct: number | null;
  sufficient: boolean;
  threshold: number;
  status: string;
  breakdown: { key: string; label: string; pct: number }[] | null;
  concepts: {
    concept: string;
    label?: string;
    status: string;
    bestScore: number;
  }[];
  clearanceCode?: string | null;
  weakConcepts: string[];
  turns: {
    questionId: string;
    level: string;
    prompt: string;
    isFollowUp: boolean;
    response: string;
    score01: number;
    demonstrated: boolean;
    feedback: string;
    evidence: string[];
  }[];
};

type MapPreview = {
  concepts: string[];
  files: { name: string; lineCount: number }[];
  roots: {
    label: string;
    children: {
      label: string;
      lineStart: number;
      lineEnd: number;
      children: string[];
    }[];
  }[];
};

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

const LEVEL_LABEL: Record<string, string> = {
  explain: "Explain",
  reason: "Reason",
  predict: "Predict",
  modify: "Modify",
  defend: "Defend",
};

export function UnderstandingGate() {
  const search = useSearchParams();
  const [screen, setScreen] = useState<Screen>("upload");
  const [lab, setLab] = useState<LabPreset | null>(null);
  const [files, setFiles] = useState<
    { name: string; size: number; content: string }[]
  >([]);
  const [assignmentSpec, setAssignmentSpec] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mapPreview, setMapPreview] = useState<MapPreview | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [answer, setAnswer] = useState("");
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [copied, setCopied] = useState(false);
  const [course, setCourse] = useState<{
    userName: string;
    courseTitle: string;
    assignmentTitle: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = search.get("lab");
    if (id) setLab(getLabPreset(id));
    void (async () => {
      try {
        const res = await fetch("/api/lti/session");
        const data = await res.json();
        if (data.session) {
          setCourse({
            userName: data.session.userName,
            courseTitle: data.session.courseTitle,
            assignmentTitle: data.session.assignmentTitle,
          });
          if (data.session.labId) {
            setLab(getLabPreset(data.session.labId));
          }
        }
      } catch {
        /* ok */
      }
    })();
  }, [search]);

  useEffect(() => {
    if (lab && !assignmentSpec) {
      setAssignmentSpec(
        `${lab.title}\n\nGoals:\n${lab.goals.map((g) => `• ${g}`).join("\n")}`,
      );
    }
  }, [lab, assignmentSpec]);

  const setFilesReady = (
    next: { name: string; size: number; content: string }[],
  ) => {
    const normalized = normalizeSourceFiles(
      next.map((f) => ({ name: f.name, content: f.content })),
    ).map((f, i) => ({
      name: f.name,
      content: f.content,
      size: next[i]?.size ?? new TextEncoder().encode(f.content).length,
    }));
    setFiles(normalized);
    setError(null);
  };

  const readFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    const next = [...files];
    for (const f of arr) {
      if (next.some((x) => x.name === f.name)) continue;
      const content = await f.text();
      next.push({ name: f.name, size: f.size, content });
    }
    setFilesReady(next);
  };

  const loadSample = () => {
    const content = SAMPLE_PROGRAM.content;
    setFilesReady([
      {
        name: SAMPLE_PROGRAM.name,
        size: new TextEncoder().encode(content).length,
        content,
      },
    ]);
  };

  const startInterview = async () => {
    if (files.length === 0) {
      setError("Upload your assignment code first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({ name: f.name, content: f.content })),
          assignmentSpec,
          labId: lab?.id || search.get("lab") || null,
          userName: course?.userName || "Student",
          courseTitle: course?.courseTitle || lab?.courseHint || "CSC course",
          assignmentTitle:
            course?.assignmentTitle || lab?.title || "Programming Assignment",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start check");
      setSessionId(data.sessionId);
      setMapPreview(data.map);
      setQuestion(data.question);
      setProgress(data.progress);
      setAnswer("");
      setLastFeedback(null);
      setIsFollowUp(false);
      setReport(null);
      setScreen("interview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = async () => {
    if (!sessionId) return;
    if (!answer.trim()) {
      setError("Type your answer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not score answer");
      setLastFeedback(data.evaluation?.feedback || null);
      if (data.done) {
        setReport(data.report as Report);
        setScreen("report");
      } else {
        setQuestion(data.question);
        setProgress(data.progress);
        setIsFollowUp(Boolean(data.followUp));
        setAnswer("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const requestReview = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/interview/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          answer: "(instructor review requested)",
          requestInstructorReview: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      if (data.report) setReport(data.report);
      setScreen("report");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setScreen("upload");
    setSessionId(null);
    setQuestion(null);
    setProgress(null);
    setReport(null);
    setAnswer("");
    setLastFeedback(null);
    setMapPreview(null);
    setError(null);
  };

  const copyCode = async () => {
    if (!report?.clearanceCode) return;
    try {
      await navigator.clipboard.writeText(report.clearanceCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed");
    }
  };

  const displayTitle =
    course?.assignmentTitle || lab?.title || "Programming Assignment";
  const displayCourse =
    course?.courseTitle || lab?.courseHint || "CSC course";

  const qNum = useMemo(() => {
    if (!progress) return 1;
    return Math.min(progress.coreIndex + 1, progress.coreTotal);
  }, [progress]);

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-28 pt-10 sm:pt-14">
      <header className="pf-hero mb-8">
        <p className="pf-kicker">Understanding before grading</p>
        <h1 className="pf-brand mt-2">Preflight</h1>
        <p className="mt-5 max-w-[28rem] text-[1.05rem] font-medium leading-[1.55] text-[var(--ink-2)]">
          Submit your code. Clear a short oral-style interview about{" "}
          <em className="not-italic text-[var(--ink)]">your</em> program. Then —
          and only then — you’re allowed to turn it in for grading.
        </p>

        <div className="mt-5 border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5">
          <p className="text-[13px] font-semibold tracking-tight">
            {displayTitle}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--ink-3)]">
            {displayCourse}
            {course?.userName ? ` · ${course.userName}` : ""}
          </p>
        </div>

        <div className="mt-7 space-y-2">
          <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            <span>
              {screen === "upload"
                ? "1 · Submit code"
                : screen === "interview"
                  ? "2 · Understanding check"
                  : "3 · Understanding report"}
            </span>
            <span>not a grade yet</span>
          </div>
          <div className="pf-runway" aria-hidden>
            {(["upload", "interview", "report"] as Screen[]).map((s, i) => (
              <div
                key={s}
                className={cn(
                  "pf-runway-light",
                  screen === s && (s === "report" ? "hot" : "on"),
                  (screen === "interview" && i === 0) ||
                    (screen === "report" && i < 2)
                    ? "on"
                    : "",
                )}
              />
            ))}
          </div>
        </div>
      </header>

      {screen === "upload" && (
        <section className="space-y-4">
          <div className="pf-panel space-y-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Assignment files
            </p>
            <div
              role="button"
              tabIndex={0}
              onClick={() => !busy && fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (!busy && (e.key === "Enter" || e.key === " "))
                  fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!busy) void readFiles(e.dataTransfer.files);
              }}
              className={cn("pf-drop", dragOver && "over")}
            >
              <p className="mb-2 text-[1.25rem] font-bold tracking-tight">
                Upload Code
              </p>
              <span className="text-sm text-[var(--ink-3)]">
                .c · .java · .py — the files you wrote for this assignment
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void readFiles(e.target.files);
              }}
            />

            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center gap-2 font-mono text-[13px] text-[var(--ink)]"
                  >
                    <span className="text-[var(--brand)]">✓</span>
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto text-[11px] text-[var(--ink-3)]">
                      {fmtBytes(f.size)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--ink-3)]">
                Assignment specification (optional)
              </label>
              <Textarea
                rows={4}
                value={assignmentSpec}
                onChange={(e) => setAssignmentSpec(e.target.value)}
                placeholder="Paste the assignment prompt — so questions stay about understanding your code, not whether it meets every requirement."
                className="rounded-sm text-sm"
              />
              <p className="mt-1.5 text-[12px] text-[var(--ink-3)]">
                Understanding ≠ correctness. Spec helps the interviewer stay
                fair.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                className="h-11 px-5"
                disabled={busy || files.length === 0}
                onClick={() => void startInterview()}
              >
                Continue
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={loadSample}
              >
                Use sample
              </Button>
            </div>
            {busy && (
              <p className="flex items-center gap-2 text-sm text-[var(--ink-3)]">
                <span className="pf-spin" /> Building understanding map…
              </p>
            )}
          </div>
          {error && <div className="pf-err">{error}</div>}
        </section>
      )}

      {screen === "interview" && question && (
        <section className="space-y-4">
          <div className="border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-2)]">
            Your code has been submitted for an{" "}
            <strong className="text-[var(--ink)]">Understanding Check</strong>.
            Not graded yet.
          </div>

          {mapPreview && (
            <div className="pf-panel">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">
                Understanding map
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mapPreview.concepts.map((c) => (
                  <span
                    key={c}
                    className="border border-[var(--line)] bg-white px-2 py-0.5 font-mono text-[11px]"
                  >
                    {CONCEPT_LABELS[c as keyof typeof CONCEPT_LABELS] || c}
                  </span>
                ))}
              </div>
              <ul className="mt-3 space-y-1 font-mono text-[11px] text-[var(--ink-2)]">
                {mapPreview.roots.map((r) => (
                  <li key={r.label}>
                    {r.label}
                    {r.children.length > 0 && (
                      <ul className="ml-3 mt-0.5 text-[var(--ink-3)]">
                        {r.children.map((c) => (
                          <li key={c.label}>
                            ├── {c.label}{" "}
                            <span className="text-[10px]">
                              L{c.lineStart}–{c.lineEnd}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pf-panel space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--signal)]">
                {isFollowUp
                  ? "Follow-up"
                  : LEVEL_LABEL[question.level] || question.level}
                {" · "}
                Question {qNum} of {progress?.coreTotal || 5}
              </p>
              <p className="font-mono text-[10px] text-[var(--ink-3)]">
                follow-ups {progress?.followUpsUsed || 0}/
                {progress?.maxFollowUps || 3}
              </p>
            </div>

            <p className="text-[1.12rem] font-semibold leading-snug tracking-tight whitespace-pre-wrap">
              {question.prompt}
            </p>

            <div className="pf-code-stage">
              <div className="relative z-[1] flex justify-between border-b border-[#24332d] px-3 py-2 font-mono text-[10px] text-[var(--code-mute)]">
                <span>
                  {question.fileName} · lines {question.lineStart}–
                  {question.lineEnd}
                </span>
                <span className="text-[var(--signal)]">your code</span>
              </div>
              <pre className="relative z-[1] max-h-40 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-[var(--code-fg)] whitespace-pre-wrap">
                {question.snippet}
              </pre>
            </div>

            {lastFeedback && (
              <p className="border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[13px] text-[var(--ink-2)]">
                {lastFeedback}
              </p>
            )}

            <Textarea
              rows={5}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer…"
              className="min-h-[120px] rounded-sm text-[15px]"
              disabled={busy}
            />

            <Button
              type="button"
              className="h-11 w-full sm:w-auto px-5"
              disabled={busy}
              onClick={() => void submitAnswer()}
            >
              Submit Answer
            </Button>
            {busy && (
              <p className="flex items-center gap-2 text-sm text-[var(--ink-3)]">
                <span className="pf-spin" /> Evaluating…
              </p>
            )}
          </div>
          {error && <div className="pf-err">{error}</div>}
        </section>
      )}

      {screen === "report" && report && (
        <section className="space-y-4">
          <div className="pf-panel text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-3)]">
              Understanding score
            </p>
            <p className="mt-2 text-[3rem] font-extrabold tracking-tight leading-none">
              {report.scorePct ?? "—"}%
            </p>
            {report.sufficient ? (
              <>
                <div className="pf-stamp" aria-hidden>
                  <strong>Cleared</strong>
                  <span>to submit</span>
                </div>
                <p className="mt-4 text-sm text-[var(--ink-2)]">
                  ✓ Sufficient understanding demonstrated
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-[var(--ink-2)]">
                You haven’t demonstrated sufficient understanding
                {report.weakConcepts?.length
                  ? ` of: ${report.weakConcepts.join(", ")}`
                  : "."}
              </p>
            )}

            {report.breakdown && (
              <ul className="mt-6 space-y-2 border-t border-[var(--line)] pt-4 text-left text-sm">
                {report.breakdown.map((b) => (
                  <li
                    key={b.key}
                    className="flex justify-between gap-3 text-[var(--ink-2)]"
                  >
                    <span>{b.label}</span>
                    <span className="font-mono text-[var(--ink)]">{b.pct}%</span>
                  </li>
                ))}
              </ul>
            )}

            {report.concepts?.length > 0 && (
              <div className="mt-5 border-t border-[var(--line)] pt-4 text-left">
                <p className="font-mono text-[11px] uppercase tracking-wide text-[var(--ink-3)]">
                  Concepts
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {report.concepts.map((c) => (
                    <li key={c.concept} className="flex justify-between gap-2">
                      <span>
                        {c.status === "demonstrated"
                          ? "✓"
                          : c.status === "weak"
                            ? "△"
                            : "·"}{" "}
                        {c.label || c.concept}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--ink-3)]">
                        {Math.round(c.bestScore * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.clearanceCode && (
              <div className="mt-6 border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-left">
                <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
                  Clearance · TA can verify
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="border border-[var(--line)] bg-white px-2 py-1 font-mono text-[13px]">
                    {report.clearanceCode}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => void copyCode()}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="pf-panel">
            <p className="font-mono text-[11px] uppercase tracking-wide text-[var(--ink-3)]">
              Audit trail
            </p>
            <ul className="mt-3 space-y-3">
              {report.turns.map((t, i) => (
                <li
                  key={`${t.questionId}-${i}`}
                  className="border-b border-[var(--line)] pb-3 text-sm last:border-0"
                >
                  <p className="font-mono text-[10px] uppercase text-[var(--ink-3)]">
                    {t.isFollowUp ? "Follow-up" : t.level}
                    {t.demonstrated ? " · ✓" : " · △"}
                  </p>
                  <p className="mt-1 font-medium leading-snug">{t.prompt}</p>
                  <p className="mt-1 text-[var(--ink-2)]">“{t.response}”</p>
                  <p className="mt-1 text-[12px] text-[var(--ink-3)]">
                    {t.feedback}
                    {t.evidence?.length
                      ? ` · ${t.evidence.slice(0, 2).join("; ")}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            {report.sufficient ? (
              <Button type="button" className="h-11 px-5" asChild>
                <a href="/ta">Submit assignment · TA verify</a>
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  className="h-11 px-5"
                  disabled={busy}
                  onClick={reset}
                >
                  Review & retry
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void requestReview()}
                >
                  Request instructor review
                </Button>
              </>
            )}
            <Button type="button" variant="outline" onClick={reset}>
              Start over
            </Button>
          </div>
          {error && <div className="pf-err">{error}</div>}
          {sessionId && (
            <p className="font-mono text-[10px] text-[var(--ink-3)]">
              Session {sessionId} ·{" "}
              <a className="underline" href={`/instructor/sessions?id=${sessionId}`}>
                instructor view
              </a>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
