"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { scanSymbols } from "@/lib/symbol-scan";
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

const RUNWAY_LABELS = ["Upload", "Quiz", "Results", "Clear submit"] as const;

function ProgressRunway({ step }: { step: Step }) {
  return (
    <nav className="pf-runway" aria-label="Preflight phases">
      {RUNWAY_LABELS.map((label, idx) => {
        const n = (idx + 1) as Step;
        const done = n < step;
        const active = n === step;
        return (
          <div
            key={label}
            className={cn(
              "pf-runway-step",
              active && "active",
              done && "done",
            )}
          >
            <span
              className="font-mono text-[10px] tabular-nums opacity-80"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {done ? "✓" : `0${n}`}
            </span>
            <span>{label}</span>
          </div>
        );
      })}
    </nav>
  );
}

function chipClassForKind(kind: ReturnType<typeof scanSymbols>[0]["kind"]) {
  if (kind === "fn") return "pf-chip pf-chip-fn";
  if (kind === "type") return "pf-chip pf-chip-type";
  if (kind === "format") return "pf-chip pf-chip-format";
  return "pf-chip";
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

  const radarHits = useMemo(() => scanSymbols(files), [files]);

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

  const attemptLabel =
    attempt > 0
      ? `attempt ${attempt + 1} · no penalty`
      : "first pass · no penalty on retries";

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:pt-10">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:sticky lg:top-6 lg:w-[300px]">
          <div>
            <Link
              href="/"
              className="mb-1 inline-block text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[var(--signal)] hover:opacity-90"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              Preflight
            </Link>
            <h1
              className="text-[1.85rem] font-extrabold leading-[1.05] tracking-tight text-[var(--ink)]"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              Lab bench
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="cqg-trust">
              <span className="pf-live-dot" />
              Pre-submit check
            </span>
            {ollama?.ok && ollama.selected ? (
              <span className="pf-chip pf-chip-fn">
                {ollama.selected}
              </span>
            ) : (
              <span className="pf-chip">on-device fallback</span>
            )}
          </div>

          {ollama && !ollama.ok && (
            <div className="pf-panel py-3 text-sm text-[var(--ink-2)]">
              <span className="font-semibold text-[var(--ink)]">
                {ollama.message}
              </span>
              <div className="mt-2 font-mono text-[11px] text-[var(--ink-3)]">
                {ollama.pullHint}
              </div>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-[var(--signal)] underline"
                onClick={() => void refreshOllama()}
              >
                Refresh host model
              </button>
            </div>
          )}

          {course ? (
            <div className="pf-panel border-[color-mix(in_srgb,var(--signal)_25%,var(--line))] bg-[var(--green-soft)]/40">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--signal)]">
                From your class
                {course.isDevSim ? " · pilot" : ""}
              </div>
              <div
                className="mt-1 text-base font-bold text-[var(--ink)]"
                style={{ fontFamily: "var(--font-display), sans-serif" }}
              >
                {course.assignmentTitle}
              </div>
              <div className="text-xs text-[var(--ink-2)]">
                {course.courseTitle}
                {course.userName ? ` · ${course.userName}` : ""}
              </div>
            </div>
          ) : (
            <div className="pf-panel text-sm text-[var(--ink-2)]">
              Open from iCollege or{" "}
              <Link className="font-semibold text-[var(--signal)] underline" href="/pilot">
                /pilot
              </Link>{" "}
              so your course can record clearance.
            </div>
          )}

          <div className="pf-panel">
            <div className="pf-panel-title text-sm">Phase runway</div>
            <ProgressRunway step={step} />
          </div>

          <div className="pf-panel">
            <div className="pf-panel-title text-sm">Payload files</div>
            <p className="pf-panel-sub mb-2 text-xs">
              {files.length
                ? `${files.length} file${files.length > 1 ? "s" : ""} in this check`
                : "Nothing loaded yet"}
            </p>
            {files.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[#101820] px-2.5 py-1.5 font-mono text-[11px]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    <span className="truncate text-[var(--ink)]">{f.name}</span>
                    <span className="ml-auto shrink-0 text-[var(--ink-3)]">
                      {fmtBytes(f.size)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--ink-3)]">
                Upload on the stage → quiz builds automatically.
              </p>
            )}
          </div>

          <div className="pf-panel">
            <div className="pf-panel-title text-sm">Symbol radar</div>
            <p className="pf-panel-sub mb-2 text-xs">
              Symbols we’ll likely probe in your quiz.
            </p>
            {radarHits.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {radarHits.map((h) => (
                  <span
                    key={`${h.kind}:${h.label}`}
                    className={chipClassForKind(h.kind)}
                    title={h.kind}
                  >
                    {h.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--ink-3)]">
                Radar activates after upload.
              </p>
            )}
          </div>

          {(step >= 2 || attempt > 0) && (
            <div className="rounded-lg border border-dashed border-[var(--line-2)] bg-[#101820]/80 px-3 py-2 text-center text-xs font-semibold text-[var(--ink-2)]">
              {attemptLabel}
              {quizMode && step === 2 && (
                <span className="mt-1 block font-normal text-[var(--ink-3)]">
                  {quizMode === "ollama"
                    ? `via ${modelUsed ?? "local model"}`
                    : "on-device quiz engine"}
                </span>
              )}
            </div>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          {step === 1 && (
            <section className="pf-panel">
              <div className="pf-panel-title">Load your assignment code</div>
              <p className="pf-panel-sub">
                Drop lab files or load the sample. Your quiz generates from the
                symbols in your upload — watch the radar on the left.
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
                  "pf-drop",
                  dragOver && "over",
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
                  className="border-[var(--line-2)] bg-transparent"
                >
                  Load sample ({SAMPLE_PROGRAM.name})
                </Button>
                {busy && (
                  <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                    <span className="pf-spin" />
                    {busyLabel}
                  </span>
                )}
              </div>
              {error && <div className="pf-err mt-4">{error}</div>}
            </section>
          )}

          {step === 2 && (
            <section>
              <div className="pf-panel">
                <div className="pf-panel-title">Prove it on the stage</div>
                <p className="pf-panel-sub">
                  Answer every question. You need a perfect score to earn your
                  clearance stamp.
                </p>
                {notice && (
                  <div className="mb-4 rounded-lg border border-[var(--line)] bg-[#101820] px-3 py-2 text-[13px] text-[var(--ink-2)]">
                    {notice}
                  </div>
                )}
                {(quizData.mc?.length ?? 0) > 0 && (
                  <>
                    <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[var(--sky)]">
                      Multiple-choice
                    </div>
                    {quizData.mc.map((q, i) => (
                      <div key={q.id} className="mb-6 last:mb-0">
                        <div className="mb-1 font-mono text-[10px] text-[var(--ink-3)]">
                          MC {i + 1}/{quizData.mc.length}
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
                                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-2.5 transition-colors",
                                  chosen
                                    ? "border-[var(--signal)] bg-[var(--green-soft)]"
                                    : "border-[var(--line)] hover:border-[color-mix(in_srgb,var(--signal)_45%,var(--line))]",
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`mc-${i}`}
                                  checked={chosen}
                                  onChange={() =>
                                    setMcChosen((prev) => ({ ...prev, [i]: k }))
                                  }
                                  className="mt-0.5 accent-[var(--signal)]"
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
                    <div className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-wider text-[var(--signal)]">
                      Free-answer
                    </div>
                    {quizData.fa.map((q, i) => (
                      <div key={q.id} className="mb-6 last:mb-0">
                        <div className="mb-1 font-mono text-[10px] text-[var(--ink-3)]">
                          FA {i + 1}/{quizData.fa.length}
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
                          className="min-h-[96px] border-[var(--line-2)] bg-[#101820] text-sm"
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
                  className="border-[var(--line-2)] bg-transparent"
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
                <div className="pf-panel-title">
                  {perfect
                    ? "Runway clear — stamp ready"
                    : "Hold short — not 100% yet"}
                </div>
                <p className="pf-panel-sub">
                  {perfect
                    ? "Every answer correct. Mark complete, then submit the real lab in iCollege."
                    : "You need every answer correct. Request a fresh quiz — no penalty."}
                </p>
                <div className="mb-5 rounded-lg border border-[var(--line)] bg-[#101820] px-4 py-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
                        Score
                      </div>
                      <div
                        className="text-[2.4rem] font-extrabold leading-none text-[var(--ink)]"
                        style={{ fontFamily: "var(--font-display), sans-serif" }}
                      >
                        {grand} / {grandMax}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        perfect ? "text-[var(--signal)]" : "text-[var(--amber)]",
                      )}
                    >
                      {perfect ? "100% · clearance eligible" : "Need 100% to turn in"}
                    </div>
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
                        "mt-1 text-xs font-semibold",
                        a.score === 1 ? "text-[var(--signal)]" : "text-red-400",
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetAll}
                  className="border-[var(--line-2)] bg-transparent"
                >
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
                <div className="pf-panel-title">Clearance passport</div>
                <p className="pf-panel-sub">{submitResult.message}</p>
                <div className="pf-stamp">
                  <div
                    className="text-xl font-extrabold text-[var(--ink)]"
                    style={{ fontFamily: "var(--font-display), sans-serif" }}
                  >
                    Cleared to submit your assignment
                  </div>
                  <div
                    className="mt-3 font-mono text-xs text-[var(--ink-2)]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    ID {submitResult.completionId}
                    <br />
                    {new Date(submitResult.submittedAt).toLocaleString()}
                  </div>
                  {files.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {files.map((f) => (
                        <span key={f.name} className="pf-chip">
                          {f.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {course && (
                    <div className="mt-3 text-sm text-[var(--ink-2)]">
                      {course.assignmentTitle}
                      <br />
                      {course.courseTitle}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {course?.returnUrl ? (
                  <Button type="button" className="h-10 px-4" asChild>
                    <a href={course.returnUrl}>Return to course</a>
                  </Button>
                ) : (
                  <Button type="button" className="h-10 px-4" asChild>
                    <Link href="/">Back to student desk</Link>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetAll}
                  className="border-[var(--line-2)] bg-transparent"
                >
                  Practice again
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
