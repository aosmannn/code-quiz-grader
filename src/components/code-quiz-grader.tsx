"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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

/** Sensible default under the hood — students never configure this. */
const DEFAULT_MC = 4;
const DEFAULT_FA = 2;

const COMPLETION_KEY = "cqg_completions";

type Step = 1 | 2 | 3 | 4;

type CourseSession = {
  sessionId: string;
  isDevSim: boolean;
  userName: string;
  courseTitle: string;
  assignmentTitle: string;
  returnUrl?: string;
};

type OllamaStatus = {
  ok: boolean;
  models: string[];
  selected: string | null;
  message: string;
  pullHint: string;
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
  const labels = ["Upload", "Quiz", "Results", "Clear submit"] as const;
  return (
    <div className="mb-8 hidden items-center sm:flex">
      {labels.map((label, idx) => {
        const n = (idx + 1) as Step;
        const done = n < step;
        const active = n === step;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold",
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
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [quizMode, setQuizMode] = useState<"ollama" | "local" | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [files, setFiles] = useState<
    { name: string; size: number; content: string }[]
  >([]);
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
  const autoGenLock = useRef(false);

  const refreshOllama = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/status");
      const data = (await res.json()) as OllamaStatus;
      setOllama(data);
    } catch {
      setOllama({
        ok: false,
        models: [],
        selected: null,
        message: "Ollama isn’t reachable (is `ollama serve` running?).",
        pullHint: "ollama pull llama3.2:1b",
      });
    }
  }, []);

  useEffect(() => {
    void refreshOllama();
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
        /* ok without launch */
      }
    })();
  }, [refreshOllama]);

  const sourceFiles: SourceFile[] = useMemo(
    () => files.map((f) => ({ name: f.name, content: f.content })),
    [files],
  );

  const go = useCallback((n: Step) => {
    setError(null);
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const generateQuiz = useCallback(
    async (fileList: SourceFile[], nextAttempt: number) => {
      if (fileList.length === 0 || autoGenLock.current) return;
      autoGenLock.current = true;
      setBusy(true);
      setBusyLabel(
        ollama?.ok
          ? `Asking ${ollama.selected} about your code…`
          : "Building your quiz from the uploaded code…",
      );
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: fileList,
            mcCount: DEFAULT_MC,
            faCount: DEFAULT_FA,
            attempt: nextAttempt,
            model: ollama?.selected || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Generate failed");
        setQuizData(data.quiz as QuizData);
        setQuizMode(data.mode === "ollama" ? "ollama" : "local");
        setModelUsed(data.model || null);
        if (data.notice) setNotice(data.notice);
        setAttempt(nextAttempt);
        setMcChosen({});
        setFaAnswers({});
        setMcResults([]);
        setFaResults([]);
        setFaAnswerRows([]);
        setSubmitResult(null);
        void refreshOllama();
        go(2);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generate failed");
        go(1);
      } finally {
        setBusy(false);
        autoGenLock.current = false;
      }
    },
    [go, ollama?.ok, ollama?.selected, refreshOllama],
  );

  const setFilesAndQuiz = async (
    next: { name: string; size: number; content: string }[],
  ) => {
    setFiles(next);
    if (next.length === 0) return;
    await generateQuiz(
      next.map((f) => ({ name: f.name, content: f.content })),
      0,
    );
  };

  const loadSample = () => {
    const content = SAMPLE_PROGRAM.content;
    void setFilesAndQuiz([
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
    await setFilesAndQuiz(next);
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
    setBusyLabel("Checking your answers…");
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
        if (data.mode) setQuizMode(data.mode === "ollama" ? "ollama" : "local");
        if (data.model) setModelUsed(data.model);
        if (data.notice) setNotice(data.notice);
      }

      setMcResults(mcScored);
      setFaResults(faScored);
      setFaAnswerRows(faPayload);
      go(3);
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
  const allMcCorrect = mcMax === 0 || mcTotal === mcMax;
  const allFaPerfect = faMax === 0 || faResults.every((s) => s.score >= 10);
  const perfect = grandMax > 0 && allMcCorrect && allFaPerfect;

  const retryFreshQuiz = () => {
    setMcChosen({});
    setFaAnswers({});
    setMcResults([]);
    setFaResults([]);
    setFaAnswerRows([]);
    setSubmitResult(null);
    setError(null);
    void generateQuiz(sourceFiles, attempt + 1);
  };

  const turnIn = async () => {
    if (!perfect) return;
    setBusy(true);
    setBusyLabel("Submitting to your course…");
    setError(null);
    try {
      if (!course) {
        const completionId = `local_${Date.now().toString(36)}`;
        const submittedAt = new Date().toISOString();
        const local: SubmitResult = {
          ok: true,
          mode: "stub",
          message:
            "Check marked complete on this device. Open from the assignment link (iCollege or /try) so the course can record that you’re cleared to submit.",
          completionId,
          submittedAt,
          gradePassback: { scoreGiven: 100, scoreMaximum: 100 },
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
        go(4);
        return;
      }

      const res = await fetch("/api/lti/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: course.sessionId,
          understandingPct: 100,
          threshold: 100,
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
      go(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setFiles([]);
    setQuizData({ mc: [], fa: [] });
    setMcChosen({});
    setFaAnswers({});
    setMcResults([]);
    setFaResults([]);
    setFaAnswerRows([]);
    setSubmitResult(null);
    setQuizMode(null);
    setModelUsed(null);
    setNotice(null);
    setAttempt(0);
    setError(null);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    go(1);
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-24 pt-10 sm:pt-14">
      <header className="cqg-hero-mark mb-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="cqg-trust">
            Pre-submit check · click from your assignment
          </span>
          {ollama?.ok && ollama.selected ? (
            <span className="rounded-full border border-[var(--line)] bg-[var(--sky-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sky)]">
              Using local model: {ollama.selected}
            </span>
          ) : (
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-3)]">
              On-device fallback ready
            </span>
          )}
        </div>

        {ollama && !ollama.ok && (
          <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--paper)]/80 px-4 py-3 text-sm text-[var(--ink-2)]">
            <span className="font-semibold text-[var(--ink)]">{ollama.message}</span>
            {" · "}
            Pull a small model:{" "}
            <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[12px]">
              {ollama.pullHint}
            </code>
            <button
              type="button"
              className="ml-2 font-semibold text-[var(--sky)] underline"
              onClick={() => void refreshOllama()}
            >
              Refresh
            </button>
          </div>
        )}

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
            This is a <strong>course tool</strong>, not a public website. Open it
            from iCollege — or try the{" "}
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
          Before you submit
        </h1>
        <p className="max-w-xl text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Upload the program for this assignment. We’ll build a short quiz from{" "}
          <em>your</em> code. Pass at 100% to unlock turn-in — then go submit
          the real lab. Miss any question and you can try a fresh quiz, no
          penalty.
        </p>
      </header>

      <ProgressTrack step={step} />

      {step === 1 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Upload your assignment code</div>
            <p className="cqg-card-sub">
              Drop your files (or load the sample). Your quiz appears
              automatically from the symbols in the upload.
            </p>
            <div
              role="button"
              tabIndex={0}
              aria-label="Click to upload files"
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
              className={cn(
                "cursor-pointer rounded-2xl border-2 border-dashed border-[var(--line-2)] px-6 py-10 text-center transition-all",
                dragOver &&
                  "border-[var(--green)] bg-[var(--green-soft)] scale-[1.01]",
                "hover:border-[var(--green)] hover:bg-[var(--green-soft)]/50",
                busy && "pointer-events-none opacity-70",
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={loadSample}
              >
                Load sample program ({SAMPLE_PROGRAM.name})
              </Button>
              {busy && (
                <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                  <span className="cqg-spin" />
                  {busyLabel}
                </span>
              )}
            </div>
            {files.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                {files.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper)]/80 px-3 py-2 font-mono text-[13px]"
                  >
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="ml-auto font-sans text-[11px] text-[var(--ink-3)]">
                      {fmtBytes(f.size)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <div className="cqg-err mt-2.5">{error}</div>}
        </section>
      )}

      {step === 2 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">
              Show what you know
              <span className="ml-2 text-base font-normal text-[var(--ink-3)]">
                ·{" "}
                {quizMode === "ollama"
                  ? `local model ${modelUsed}`
                  : "on-device quiz"}
                {attempt > 0 ? ` · attempt ${attempt + 1}` : ""}
              </span>
            </div>
            <p className="cqg-card-sub">
              Answer every question. You need a perfect score to turn this in.
            </p>
            {notice && (
              <div className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[13px] text-[var(--ink-2)]">
                {notice}
              </div>
            )}
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
                      placeholder="Explain in your own words — name functions and variables from your code…"
                      value={faAnswers[i] || ""}
                      onChange={(e) =>
                        setFaAnswers((prev) => ({
                          ...prev,
                          [i]: e.target.value,
                        }))
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
              Check answers
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={resetAll}
            >
              Different files
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

      {step === 3 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">
              {perfect
                ? "Perfect — you’re cleared to submit"
                : "Not quite yet"}
            </div>
            <p className="cqg-card-sub">
              {perfect
                ? "You got every question right. Mark this check complete, then submit your real assignment in iCollege."
                : "You need every answer correct before you can submit the lab. Try a fresh quiz — no penalty."}
            </p>
            <div className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 px-4 py-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-[12px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
                    Score
                  </div>
                  <div
                    className="text-[2.2rem] font-semibold leading-none"
                    style={{ fontFamily: "var(--font-display), serif" }}
                  >
                    {grand} / {grandMax}
                  </div>
                </div>
                <div
                  className={cn(
                    "font-semibold",
                    perfect ? "text-[var(--green)]" : "text-[var(--amber)]",
                  )}
                >
                  {perfect ? "100% · pass" : "Need 100% to turn in"}
                </div>
              </div>
            </div>

            {mcResults.map((a) => (
              <div
                key={a.id}
                className="border-b border-[var(--line)] py-3 text-sm"
              >
                <div className="font-medium">{a.question}</div>
                <div
                  className={cn(
                    "mt-1 text-xs font-semibold",
                    a.score === 1 ? "text-[var(--green)]" : "text-red-700",
                  )}
                >
                  {a.score === 1
                    ? "Correct"
                    : `Not quite · correct is ${a.correct}`}
                </div>
              </div>
            ))}
            {faResults.map((s, i) => (
              <div
                key={s.id}
                className="border-b border-[var(--line)] py-3 text-sm"
              >
                <div className="flex justify-between gap-3">
                  <div className="font-medium">
                    {faAnswerRows[i]?.question}
                  </div>
                  <div className="font-semibold">{s.score}/10</div>
                </div>
                <div className="mt-1 text-[13px] text-[var(--ink-2)]">
                  {s.feedback}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            {perfect ? (
              <Button
                type="button"
                className="h-10 px-4"
                disabled={busy}
                onClick={() => void turnIn()}
              >
                Mark check complete
              </Button>
            ) : (
              <Button
                type="button"
                className="h-10 px-4"
                disabled={busy}
                onClick={retryFreshQuiz}
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

      {step === 4 && submitResult && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Check complete</div>
            <p className="cqg-card-sub">{submitResult.message}</p>
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--green)_30%,var(--line))] bg-[var(--green-soft)] px-4 py-4">
              <div
                className="text-2xl font-semibold"
                style={{ fontFamily: "var(--font-display), serif" }}
              >
                Cleared to submit your assignment
              </div>
              <div className="mt-2 text-sm text-[var(--ink-2)]">
                Completion ID{" "}
                <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[12px]">
                  {submitResult.completionId}
                </code>
              </div>
              <div className="mt-1 text-sm text-[var(--ink-2)]">
                {new Date(submitResult.submittedAt).toLocaleString()}
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
