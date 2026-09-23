"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SAMPLE_PROGRAM } from "@/lib/sample-program";
import type {
  FaAnswer,
  FaScored,
  McQuestion,
  McScored,
  QuizData,
  SourceFile,
} from "@/lib/types";

const ACCEPT =
  ".py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.txt,.html,.css,.php,.swift,.kt,.r,.m,.sh,.json,.xml,.yaml,.yml,.sql,.lua,.scala";

const DEFAULT_THRESHOLD = 82;
const THRESHOLD_KEY = "cqg_threshold";
const COMPLETION_KEY = "cqg_completions";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type CourseSession = {
  sessionId: string;
  isDevSim: boolean;
  userName: string;
  courseTitle: string;
  assignmentTitle: string;
  returnUrl?: string;
};

type SubmitResult = {
  ok: boolean;
  mode: "ags" | "stub";
  message: string;
  completionId: string;
  submittedAt: string;
  gradePassback: {
    scoreGiven: number;
    scoreMaximum: number;
  };
};

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function ProgressTrack({ step }: { step: Step }) {
  const labels = [
    "Upload",
    "How many",
    "Mix",
    "Quiz",
    "Results",
    "Turn in",
  ] as const;
  return (
    <div className="mb-8 hidden items-center lg:flex">
      {labels.map((label, idx) => {
        const n = (idx + 1) as Step;
        const done = n < step;
        const active = n === step;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold",
                active && "text-[var(--ink)]",
                done && "text-[var(--green)]",
                !active && !done && "text-[var(--ink-3)]",
              )}
            >
              <span
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                  active &&
                    "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]",
                  done && "border-[var(--green)] bg-[var(--green)] text-white",
                  !active &&
                    !done &&
                    "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-3)]",
                )}
              >
                {done ? "✓" : n}
              </span>
              {label}
            </div>
            {idx < labels.length - 1 && (
              <div className="mx-1.5 h-px flex-1 bg-[var(--line)]" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CodeQuizGrader() {
  const [step, setStep] = useState<Step>(1);
  const [course, setCourse] = useState<CourseSession | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [attempt, setAttempt] = useState(0);
  const [files, setFiles] = useState<
    { name: string; size: number; content: string }[]
  >([]);
  const [totalQ, setTotalQ] = useState(0);
  const [customTotal, setCustomTotal] = useState("");
  const [mcCount, setMcCount] = useState<number | null>(null);
  const [quizData, setQuizData] = useState<QuizData>({ mc: [], fa: [] });
  const [mcChosen, setMcChosen] = useState<Record<number, McQuestion["answer"]>>(
    {},
  );
  const [faAnswers, setFaAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mcResults, setMcResults] = useState<McScored[]>([]);
  const [faResults, setFaResults] = useState<FaScored[]>([]);
  const [faAnswerRows, setFaAnswerRows] = useState<FaAnswer[]>([]);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(THRESHOLD_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= 50 && n <= 100) setThreshold(n);
    }
    void (async () => {
      try {
        const res = await fetch("/api/lti/session");
        const data = await res.json();
        if (data.session) {
          setCourse({
            sessionId: data.session.sessionId,
            isDevSim: Boolean(data.session.isDevSim),
            userName: data.session.userName,
            courseTitle: data.session.courseTitle,
            assignmentTitle: data.session.assignmentTitle,
            returnUrl: data.session.returnUrl,
          });
        }
      } catch {
        /* open without launch is ok for local file checks */
      }
    })();
  }, []);

  const faCount = useMemo(() => {
    if (mcCount === null || totalQ === 0) return null;
    return totalQ - mcCount;
  }, [mcCount, totalQ]);

  const sourceFiles: SourceFile[] = useMemo(
    () => files.map((f) => ({ name: f.name, content: f.content })),
    [files],
  );

  const go = useCallback((n: Step) => {
    setError(null);
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const loadSample = () => {
    const content = SAMPLE_PROGRAM.content;
    setFiles([
      {
        name: SAMPLE_PROGRAM.name,
        size: new TextEncoder().encode(content).length,
        content,
      },
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const readFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    const next = [...files];
    for (const f of arr) {
      if (next.some((x) => x.name === f.name)) continue;
      const content = await f.text();
      next.push({ name: f.name, size: f.size, content });
    }
    setFiles(next);
  };

  const pickTotal = (n: number) => {
    setTotalQ(n);
    setCustomTotal("");
  };

  const onCustomTotal = (v: string) => {
    setCustomTotal(v);
    const n = parseInt(v, 10);
    if (n >= 2 && n <= 30) setTotalQ(n);
    else setTotalQ(0);
  };

  const onThreshold = (v: string) => {
    const n = parseInt(v, 10);
    if (n >= 50 && n <= 100) {
      setThreshold(n);
      localStorage.setItem(THRESHOLD_KEY, String(n));
    }
  };

  const generateQuiz = async (nextAttempt = attempt) => {
    if (mcCount === null || faCount === null) return;
    setBusy(true);
    setBusyLabel(`Building ${totalQ} questions from your code…`);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: sourceFiles,
          mcCount,
          faCount,
          attempt: nextAttempt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setQuizData(data.quiz as QuizData);
      setAttempt(nextAttempt);
      setMcChosen({});
      setFaAnswers({});
      setSubmitResult(null);
      go(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  };

  const submitAnswers = async () => {
    const mcList = quizData.mc || [];
    const faList = quizData.fa || [];
    const missingMC = mcList.filter((_, i) => !mcChosen[i]).length;
    const missingFA = faList.filter((_, i) => !(faAnswers[i] || "").trim()).length;
    if (missingMC || missingFA) {
      setError(
        `Please answer every question. Missing: ${missingMC} multiple-choice, ${missingFA} free-answer.`,
      );
      return;
    }

    setBusy(true);
    setBusyLabel("Scoring your answers on this device…");
    setError(null);
    try {
      const mcScored: McScored[] = mcList.map((q, i) => {
        const chosen = mcChosen[i]!;
        return {
          id: q.id,
          question: q.question,
          options: q.options,
          correct: q.answer,
          chosen,
          score: chosen === q.answer ? 1 : 0,
        };
      });

      const faPayload: FaAnswer[] = faList.map((q, i) => ({
        id: q.id,
        question: q.question,
        answer: (faAnswers[i] || "").trim(),
      }));

      let faScored: FaScored[] = [];
      if (faPayload.length > 0) {
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: sourceFiles,
            faAnswers: faPayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Grade failed");
        faScored = data.fa_scores as FaScored[];
      }

      setMcResults(mcScored);
      setFaResults(faScored);
      setFaAnswerRows(faPayload);
      go(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grade failed");
    } finally {
      setBusy(false);
    }
  };

  const mcTotal = mcResults.reduce((s, a) => s + a.score, 0);
  const mcMax = mcResults.length;
  const faTotal = faResults.reduce((s, a) => s + a.score, 0);
  const faMax = faResults.length * 10;
  const grand = mcTotal + faTotal;
  const grandMax = mcMax + faMax;
  const understandingPct =
    grandMax > 0 ? Math.round((grand / grandMax) * 100) : 0;
  const passed = understandingPct >= threshold;

  const turnIn = async () => {
    if (!passed) return;
    setBusy(true);
    setBusyLabel("Submitting to your course…");
    setError(null);
    try {
      if (!course) {
        // Local completion without LTI session still records success for UX
        const completionId = `local_${Date.now().toString(36)}`;
        const submittedAt = new Date().toISOString();
        const local: SubmitResult = {
          ok: true,
          mode: "stub",
          message:
            "Marked complete on this device. Open from iCollege (or /pilot) to attach a course session for grade passback.",
          completionId,
          submittedAt,
          gradePassback: {
            scoreGiven: understandingPct,
            scoreMaximum: 100,
          },
        };
        const prev = JSON.parse(localStorage.getItem(COMPLETION_KEY) || "[]");
        prev.unshift({
          ...local,
          courseTitle: "Local practice",
          assignmentTitle: "Understanding check",
          files: files.map((f) => f.name),
        });
        localStorage.setItem(COMPLETION_KEY, JSON.stringify(prev.slice(0, 20)));
        setSubmitResult(local);
        go(6);
        return;
      }

      const res = await fetch("/api/lti/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: course.sessionId,
          understandingPct,
          threshold,
          pointsEarned: grand,
          pointsPossible: grandMax || 100,
          fileNames: files.map((f) => f.name),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      const result = data.result as SubmitResult;
      const prev = JSON.parse(localStorage.getItem(COMPLETION_KEY) || "[]");
      prev.unshift({
        ...result,
        courseTitle: course.courseTitle,
        assignmentTitle: course.assignmentTitle,
        userName: course.userName,
        files: files.map((f) => f.name),
      });
      localStorage.setItem(COMPLETION_KEY, JSON.stringify(prev.slice(0, 20)));
      setSubmitResult(result);
      go(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setFiles([]);
    setTotalQ(0);
    setCustomTotal("");
    setMcCount(null);
    setQuizData({ mc: [], fa: [] });
    setMcChosen({});
    setFaAnswers({});
    setMcResults([]);
    setFaResults([]);
    setFaAnswerRows([]);
    setSubmitResult(null);
    setAttempt(0);
    setError(null);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    go(1);
  };

  const retryQuiz = () => {
    setMcChosen({});
    setFaAnswers({});
    setMcResults([]);
    setFaResults([]);
    setFaAnswerRows([]);
    setSubmitResult(null);
    setError(null);
    go(3);
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-24 pt-10 sm:pt-14">
      <header className="cqg-hero-mark mb-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="cqg-trust">Course assignment · runs on your laptop</span>
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-3)]">
            No cloud AI · no extra installs
          </span>
        </div>

        {course ? (
          <div className="mb-5 rounded-2xl border border-[color-mix(in_srgb,var(--green)_28%,var(--line))] bg-[var(--green-soft)] px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--green)]">
              Opened from your class
              {course.isDevSim ? " · pilot simulator" : ""}
            </div>
            <div
              className="mt-1 text-lg font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display), serif" }}
            >
              {course.assignmentTitle}
            </div>
            <div className="text-sm text-[var(--ink-2)]">
              {course.courseTitle}
              {course.userName ? ` · ${course.userName}` : ""}
            </div>
          </div>
        ) : (
          <div className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--sky-soft)]/70 px-4 py-3 text-sm text-[var(--ink-2)]">
            This is a <strong>course tool</strong>, not a public website. For the
            real pilot, students open it from iCollege. To try tonight:{" "}
            <a className="font-semibold text-[var(--sky)] underline" href="/pilot">
              /pilot
            </a>{" "}
            launch simulator.
          </div>
        )}

        <h1
          className="mb-2 text-[2.05rem] leading-[1.1] font-semibold tracking-tight text-[var(--ink)] sm:text-[2.4rem]"
          style={{ fontFamily: "var(--font-display), serif" }}
        >
          Code understanding check
        </h1>
        <p className="max-w-xl text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Upload the program you wrote for this assignment, answer questions
          about <em>your</em> code, clear the understanding threshold, then turn
          it in to your course. Unlimited retries — no penalty.
        </p>
      </header>

      <div className="cqg-card mb-6">
        <div className="cqg-card-title">Understanding threshold</div>
        <p className="cqg-card-sub">
          Aim for about 80–85%. Questions are built from symbols in your upload
          on this device — nothing is sent to a cloud LLM.
        </p>
        <label className="mb-2 block text-[13px] font-semibold text-[var(--ink-2)]">
          Pass at {threshold}%
        </label>
        <input
          type="range"
          min={50}
          max={100}
          step={1}
          value={threshold}
          onChange={(e) => onThreshold(e.target.value)}
          className="h-2 w-full max-w-xs accent-[var(--green)]"
          aria-label="Understanding threshold percent"
        />
      </div>

      <ProgressTrack step={step} />

      {step === 1 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Upload your assignment code</div>
            <p className="cqg-card-sub">
              Drop the files for this lab — or load the sample to walk the full
              course flow.
            </p>
            <div
              role="button"
              tabIndex={0}
              aria-label="Click to upload files"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
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
                void readFiles(e.dataTransfer.files);
              }}
              className={cn(
                "cursor-pointer rounded-2xl border-2 border-dashed border-[var(--line-2)] px-6 py-10 text-center transition-all",
                dragOver &&
                  "border-[var(--green)] bg-[var(--green-soft)] scale-[1.01]",
                "hover:border-[var(--green)] hover:bg-[var(--green-soft)]/50",
              )}
            >
              <p className="mb-1 text-base font-semibold text-[var(--ink)]">
                Drop files here, or click to browse
              </p>
              <span className="text-sm text-[var(--ink-3)]">
                .py .js .ts .java .c .cpp .go .rs .swift and more
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
            <div className="mt-3">
              <Button type="button" variant="outline" onClick={loadSample}>
                Load sample program ({SAMPLE_PROGRAM.name})
              </Button>
            </div>
            {files.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                {files.map((f, i) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper)]/80 px-3 py-2 font-mono text-[13px]"
                  >
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="ml-auto mr-1.5 font-sans text-[11px] text-[var(--ink-3)]">
                      {fmtBytes(f.size)}
                    </span>
                    <button
                      type="button"
                      className="text-[15px] leading-none text-[var(--ink-3)] hover:text-red-600"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            disabled={files.length === 0}
            className="mt-1 h-10 px-4"
            onClick={() => go(2)}
          >
            Continue
          </Button>
        </section>
      )}

      {step === 2 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">How many questions?</div>
            <p className="cqg-card-sub">
              Short is fine. You can retry with a fresh set anytime.
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {[5, 8, 10, 15].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => pickTotal(n)}
                  className={cn(
                    "h-14 w-14 rounded-xl border text-lg font-semibold transition-colors",
                    totalQ === n && !customTotal
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--green)] hover:bg-[var(--green-soft)]",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={2}
                max={30}
                placeholder="Custom…"
                value={customTotal}
                onChange={(e) => onCustomTotal(e.target.value)}
                className="h-9 w-24 bg-[var(--surface)]"
              />
              <span className="text-[13px] text-[var(--ink-3)]">2 – 30</span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={totalQ < 2}
              className="h-10 px-4"
              onClick={() => {
                setMcCount(null);
                go(3);
              }}
            >
              Continue
            </Button>
            <Button type="button" variant="outline" onClick={() => go(1)}>
              Back
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Choose your mix</div>
            <p className="cqg-card-sub">
              <strong>{totalQ}</strong> questions total — how many multiple-choice?
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-[13px] font-semibold text-[var(--ink-2)]">
                  Multiple-choice
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: totalQ + 1 }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setMcCount(i)}
                      className={cn(
                        "rounded-full border px-3.5 py-1 text-[13px] font-semibold",
                        mcCount === i
                          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]",
                      )}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-[13px] font-semibold text-[var(--ink-2)]">
                  Free-answer
                </label>
                <div
                  className="text-[28px] font-semibold text-[var(--green)]"
                  style={{ fontFamily: "var(--font-display), serif" }}
                >
                  {faCount === null ? "—" : faCount}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="h-10 px-4"
              disabled={
                mcCount === null ||
                (mcCount === 0 && (faCount ?? 0) === 0) ||
                busy
              }
              onClick={() => void generateQuiz(attempt)}
            >
              Generate quiz
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => go(2)}>
              Back
            </Button>
            {busy && (
              <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                <span className="cqg-spin" />
                {busyLabel}
              </span>
            )}
          </div>
          {error && <div className="cqg-err mt-2.5">{error}</div>}
        </section>
      )}

      {step === 4 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">
              Show what you know
              <span className="ml-2 text-base font-normal text-[var(--ink-3)]">
                · on-device
                {attempt > 0 ? ` · attempt ${attempt + 1}` : ""}
              </span>
            </div>
            <p className="cqg-card-sub">
              Questions reference symbols from your upload.
            </p>
            {(quizData.mc?.length ?? 0) > 0 && (
              <>
                <div className="cqg-section-head">Multiple-choice</div>
                {quizData.mc.map((q, i) => (
                  <div key={q.id} className="mb-5">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--sky)]">
                      MC · {i + 1} of {quizData.mc.length}
                    </div>
                    <div className="mb-2.5 text-[15px] leading-relaxed">
                      {q.question}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {(["A", "B", "C", "D"] as const).map((k) => {
                        const chosen = mcChosen[i] === k;
                        return (
                          <label
                            key={k}
                            className={cn(
                              "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5",
                              chosen
                                ? "border-[var(--green)] bg-[var(--green-soft)]"
                                : "border-[var(--line)] hover:border-[var(--green)]",
                            )}
                          >
                            <input
                              type="radio"
                              name={`mc-${i}`}
                              checked={chosen}
                              onChange={() =>
                                setMcChosen((prev) => ({ ...prev, [i]: k }))
                              }
                              className="mt-0.5 accent-[var(--green)]"
                            />
                            <span className="text-sm">
                              <strong>{k}.</strong> {q.options[k]}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
            {(quizData.fa?.length ?? 0) > 0 && (
              <>
                <div className="cqg-section-head">Free-answer</div>
                {quizData.fa.map((q, i) => (
                  <div key={q.id} className="mb-5">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--green)]">
                      FA · {i + 1} of {quizData.fa.length}
                    </div>
                    <div className="mb-2.5 text-[15px] leading-relaxed">
                      {q.question}
                    </div>
                    <Textarea
                      rows={3}
                      placeholder="Name functions and variables from your code…"
                      value={faAnswers[i] || ""}
                      onChange={(e) =>
                        setFaAnswers((prev) => ({ ...prev, [i]: e.target.value }))
                      }
                      className="min-h-[96px] bg-[var(--surface)] text-sm"
                    />
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="h-10 px-4"
              disabled={busy}
              onClick={() => void submitAnswers()}
            >
              Check understanding
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => go(3)}>
              Back
            </Button>
            {busy && (
              <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                <span className="cqg-spin" />
                {busyLabel}
              </span>
            )}
          </div>
          {error && <div className="cqg-err mt-2.5">{error}</div>}
        </section>
      )}

      {step === 5 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Your understanding score</div>
            <p className="cqg-card-sub">
              {passed
                ? "You cleared the threshold — you can turn this in to your course."
                : "Not there yet — try a new quiz anytime. No penalty."}
            </p>
            <div className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 px-4 py-4">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-[12px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
                    Understanding
                  </div>
                  <div
                    className="text-[2.4rem] font-semibold leading-none"
                    style={{ fontFamily: "var(--font-display), serif" }}
                  >
                    {understandingPct}%
                  </div>
                </div>
                <div className="text-right text-sm text-[var(--ink-2)]">
                  Threshold {threshold}%
                  <div
                    className={cn(
                      "mt-1 font-semibold",
                      passed ? "text-[var(--green)]" : "text-[var(--amber)]",
                    )}
                  >
                    {passed ? "Ready to turn in" : "Keep practicing"}
                  </div>
                </div>
              </div>
              <div className="cqg-meter-track">
                <div
                  className="cqg-meter-fill"
                  style={{ width: `${Math.min(100, understandingPct)}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {mcMax > 0 && (
                  <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 font-medium text-[var(--sky)]">
                    MC {mcTotal}/{mcMax}
                  </span>
                )}
                {faMax > 0 && (
                  <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 font-medium text-[var(--green)]">
                    FA {faTotal}/{faMax}
                  </span>
                )}
              </div>
            </div>

            {mcResults.map((a) => (
              <div key={a.id} className="border-b border-[var(--line)] py-3 text-sm">
                <div className="font-medium">{a.question}</div>
                <div className="mt-1 text-xs text-[var(--ink-3)]">
                  {a.score === 1 ? "Correct" : `Not quite · answer ${a.correct}`}
                </div>
              </div>
            ))}
            {faResults.map((s, i) => (
              <div key={s.id} className="border-b border-[var(--line)] py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <div className="font-medium">{faAnswerRows[i]?.question}</div>
                  <div className="font-semibold">{s.score}/10</div>
                </div>
                <div className="mt-1 text-[13px] text-[var(--ink-2)]">{s.feedback}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            {passed ? (
              <Button
                type="button"
                className="h-10 px-4"
                disabled={busy}
                onClick={() => void turnIn()}
              >
                I&apos;m ready to turn in
              </Button>
            ) : (
              <Button
                type="button"
                className="h-10 px-4"
                disabled={busy}
                onClick={() => {
                  retryQuiz();
                  void generateQuiz(attempt + 1);
                }}
              >
                Try a new quiz
              </Button>
            )}
            <Button type="button" variant="outline" onClick={resetAll}>
              Start over
            </Button>
            {busy && (
              <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                <span className="cqg-spin" />
                {busyLabel}
              </span>
            )}
          </div>
          {error && <div className="cqg-err mt-2.5">{error}</div>}
        </section>
      )}

      {step === 6 && submitResult && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Submitted to course</div>
            <p className="cqg-card-sub">{submitResult.message}</p>
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--green)_30%,var(--line))] bg-[var(--green-soft)] px-4 py-4">
              <div
                className="text-2xl font-semibold"
                style={{ fontFamily: "var(--font-display), serif" }}
              >
                {submitResult.gradePassback.scoreGiven}% understanding
              </div>
              <div className="mt-2 text-sm text-[var(--ink-2)]">
                Completion ID{" "}
                <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[12px]">
                  {submitResult.completionId}
                </code>
              </div>
              <div className="mt-1 text-sm text-[var(--ink-2)]">
                {new Date(submitResult.submittedAt).toLocaleString()} · mode{" "}
                {submitResult.mode}
              </div>
              {course && (
                <div className="mt-3 text-sm text-[var(--ink-2)]">
                  {course.assignmentTitle}
                  <br />
                  {course.courseTitle}
                </div>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            {course?.returnUrl ? (
              <Button type="button" className="h-10 px-4" asChild>
                <a href={course.returnUrl}>Return to course</a>
              </Button>
            ) : (
              <Button type="button" className="h-10 px-4" asChild>
                <a href="/pilot">Back to pilot simulator</a>
              </Button>
            )}
            <Button type="button" variant="outline" onClick={resetAll}>
              Practice again
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
