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
  ".py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.txt,.html,.css,.php,.swift,.kt,.r,.m,.sh,.json,.xml,.yaml,.yml,.sql,.lua,.scala,.h";

const DEFAULT_MC = 4;
const DEFAULT_FA = 2;

const COMPLETION_KEY = "cqg_completions";

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "1 · Upload",
  2: "2 · Answer",
  3: "3 · Score",
  4: "4 · Cleared",
};

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

  const ollamaLine = ollama
    ? ollama.ok && ollama.selected
      ? ollama.selected
      : "on-device fallback"
    : null;

  return (
    <div className="mx-auto max-w-[540px] px-5 pb-24 pt-12 sm:pt-16">
      <header className="pf-hero mb-9">
        <p className="pf-brand">Preflight</p>

        <p className="mt-5 max-w-[26rem] text-[1.08rem] leading-[1.55] text-[var(--ink-2)]">
          Show you understand the code you wrote. Pass once at 100% — then
          submit your lab.
        </p>

        {course && (
          <div className="mt-5 rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-2.5">
            <p className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
              {course.assignmentTitle.replace(/\s*·\s*/g, " · ")}
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">
              {course.courseTitle}
              {course.userName ? ` · ${course.userName}` : ""}
              {course.isDevSim ? " · demo" : ""}
            </p>
          </div>
        )}

        <div className="mt-7 flex items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <span className="pf-step">
            <span className="pf-step-dot" aria-hidden />
            {STEP_LABELS[step]}
          </span>
          {ollamaLine && (
            <span className="hidden text-[11px] text-[var(--ink-3)] sm:inline">
              {ollamaLine}
            </span>
          )}
        </div>
      </header>

      {step === 1 && (
        <section className="pf-panel">
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
              "pf-drop",
              dragOver && "over",
              busy && "pointer-events-none opacity-70",
            )}
          >
            <div
              className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[var(--brand)] shadow-sm ring-1 ring-[var(--line)]"
              aria-hidden
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 13.5V3.5M10 3.5L6.5 7M10 3.5L13.5 7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3.5 12.5V14.5C3.5 15.6046 4.39543 16.5 5.5 16.5H14.5C15.6046 16.5 16.5 15.6046 16.5 14.5V12.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="mb-1.5 text-[1.08rem] font-semibold tracking-tight text-[var(--ink)]">
              Upload your lab files
            </p>
            <span className="text-sm text-[var(--ink-3)]">
              Drag & drop, or click to browse
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
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={loadSample}
            >
              Use sample instead
            </Button>
            {busy && (
              <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                <span className="pf-spin" />
                {busyLabel}
              </span>
            )}
          </div>
          {files.length > 0 && !busy && (
            <ul className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-4">
              {files.map((f) => (
                <li
                  key={f.name}
                  className="flex justify-between gap-2 font-mono text-[12px] text-[var(--ink-2)]"
                >
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-[var(--ink-3)]">
                    {fmtBytes(f.size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && <div className="pf-err mt-4">{error}</div>}
        </section>
      )}

      {step === 2 && (
        <section>
          <div className="pf-panel">
            {notice && (
              <div className="mb-4 rounded-lg border border-[var(--line)] bg-[#fafafa] px-3 py-2 text-[13px] text-[var(--ink-2)]">
                {notice}
              </div>
            )}
            {attempt > 0 && (
              <p className="mb-4 text-xs text-[var(--ink-3)]">
                Attempt {attempt + 1} — retries are free
                {quizMode === "ollama" && modelUsed
                  ? ` · via ${modelUsed}`
                  : quizMode === "local"
                    ? " · on-device"
                    : ""}
              </p>
            )}
            {(quizData.mc?.length ?? 0) > 0 && (
              <>
                <div className="mb-3 text-sm font-medium text-[var(--ink-3)]">
                  Multiple-choice
                </div>
                {quizData.mc.map((q, i) => (
                  <div key={q.id} className="mb-6 last:mb-0">
                    <div className="mb-2 text-[15px] leading-relaxed">
                      {q.question}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {(["A", "B", "C", "D"] as const).map((k) => {
                        const chosen = mcChosen[i] === k;
                        return (
                          <label
                            key={k}
                            className={cn(
                              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-2.5 transition-colors",
                              chosen
                                ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                                : "border-[var(--line)] hover:border-[var(--line-2)]",
                            )}
                          >
                            <input
                              type="radio"
                              name={`mc-${i}`}
                              checked={chosen}
                              onChange={() =>
                                setMcChosen((prev) => ({ ...prev, [i]: k }))
                              }
                              className="mt-0.5 accent-[var(--brand)]"
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
                <div className="mb-3 mt-6 text-sm font-medium text-[var(--ink-3)]">
                  Free-answer
                </div>
                {quizData.fa.map((q, i) => (
                  <div key={q.id} className="mb-6 last:mb-0">
                    <div className="mb-2 text-[15px] leading-relaxed">
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
                      className="min-h-[96px] text-sm"
                    />
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
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
                <span className="pf-spin" />
                {busyLabel}
              </span>
            )}
          </div>
          {error && <div className="pf-err mt-3">{error}</div>}
        </section>
      )}

      {step === 3 && (
        <section>
          <div className="pf-panel">
            <p className="mb-4 text-sm leading-relaxed text-[var(--ink-2)]">
              {perfect
                ? "Nice — you got everything right. Mark this complete, then turn in the real lab."
                : "You need a perfect score to continue. Retries don’t cost anything."}
            </p>
            <div className="mb-5 rounded-xl border border-[var(--line)] bg-[#f8f9fc] px-4 py-4">
              <div className="text-[2.1rem] font-semibold tracking-tight leading-none text-[var(--ink)]">
                {grand} / {grandMax}
              </div>
              <div
                className={cn(
                  "mt-2 text-sm font-medium",
                  perfect ? "text-[var(--green)]" : "text-[var(--ink-2)]",
                )}
              >
                {perfect ? "Ready to clear" : "Need 100% to continue"}
              </div>
            </div>

            {mcResults.map((a) => (
              <div
                key={a.id}
                className="border-b border-[var(--line)] py-3 text-sm last:border-0"
              >
                <div className="font-medium">{a.question}</div>
                <div
                  className={cn(
                    "mt-1 text-xs",
                    a.score === 1 ? "text-[var(--ink-2)]" : "text-red-600",
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
                className="border-b border-[var(--line)] py-3 text-sm last:border-0"
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
          <div className="mt-4 flex flex-wrap gap-3">
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
                <span className="pf-spin" />
                {busyLabel}
              </span>
            )}
          </div>
          {error && <div className="pf-err mt-3">{error}</div>}
        </section>
      )}

      {step === 4 && submitResult && (
        <section>
          <div className="pf-panel">
            <h2 className="text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">
              Cleared to submit
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-2)]">
              {submitResult.message}
            </p>
            <p className="mt-4 font-mono text-xs text-[var(--ink-3)]">
              {submitResult.completionId}
              <br />
              {new Date(submitResult.submittedAt).toLocaleString()}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {course?.returnUrl ? (
              <Button type="button" className="h-10 px-4" asChild>
                <a href={course.returnUrl}>Return to course</a>
              </Button>
            ) : null}
            <Button
              type="button"
              variant={course?.returnUrl ? "outline" : "default"}
              onClick={resetAll}
              className="h-10 px-4"
            >
              {course?.returnUrl ? "Practice again" : "Start another check"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
