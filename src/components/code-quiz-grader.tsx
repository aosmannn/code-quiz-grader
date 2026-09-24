"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { scanSymbols } from "@/lib/symbol-scan";
import { SAMPLE_PROGRAM } from "@/lib/sample-program";
import { normalizeSourceFiles } from "@/lib/mock-quiz";
import { missCoach } from "@/lib/miss-coach";
import { getLabPreset, type LabPreset } from "@/lib/lab-presets";
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
type IntakeMode = "upload" | "paste";

const STEP_LABELS: Record<Step, string> = {
  1: "1 · Code",
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
  labId?: string;
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
  const search = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [course, setCourse] = useState<CourseSession | null>(null);
  const [lab, setLab] = useState<LabPreset | null>(null);
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
  const [intakeMode, setIntakeMode] = useState<IntakeMode>("upload");
  const [pasteName, setPasteName] = useState("main.c");
  const [pasteText, setPasteText] = useState("");
  const [copied, setCopied] = useState(false);
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
        pullHint: "ollama pull llama3.2:3b",
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
            labId: data.session.labId,
          });
        }
      } catch {
        /* ok without launch */
      }
    })();
  }, [refreshOllama]);

  useEffect(() => {
    const fromUrl = search.get("lab");
    const id = fromUrl || course?.labId || null;
    if (!id) {
      setLab(null);
      return;
    }
    const local = getLabPreset(id);
    if (local) {
      setLab(local);
      return;
    }
    void fetch(`/api/labs?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d: { lab?: LabPreset }) => setLab(d.lab || null))
      .catch(() => setLab(null));
  }, [search, course?.labId]);

  const sourceFiles: SourceFile[] = useMemo(
    () => files.map((f) => ({ name: f.name, content: f.content })),
    [files],
  );

  const radarHits = useMemo(() => scanSymbols(files).slice(0, 8), [files]);

  const codePreview = useMemo(() => {
    const first = files[0];
    if (!first) return null;
    const lines = first.content.replace(/\r\n/g, "\n").split("\n");
    const shown = lines.slice(0, 14).join("\n");
    const more = lines.length > 14 ? `\n… ${lines.length - 14} more lines` : "";
    return { name: first.name, text: shown + more };
  }, [files]);

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
          ? "Building your quiz from your code…"
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
            labId: lab?.id || course?.labId || search.get("lab") || null,
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
    [go, ollama?.ok, ollama?.selected, refreshOllama, lab?.id, course?.labId, search],
  );

  const persistClearance = async (result: SubmitResult) => {
    try {
      await fetch("/api/clearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: result.completionId,
          submittedAt: result.submittedAt,
          userName: course?.userName || "Student",
          courseTitle: course?.courseTitle || "Local practice",
          assignmentTitle:
            course?.assignmentTitle || lab?.title || "Understanding check",
          labId: lab?.id || course?.labId || null,
          fileNames: files.map((f) => f.name),
          files: sourceFiles,
          understandingPct: 100,
          mode: result.mode,
          isDevSim: course?.isDevSim,
        }),
      });
    } catch {
      /* local verify still works from localStorage for this browser */
    }
  };

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

  const loadSample = () => {
    const content = SAMPLE_PROGRAM.content;
    setIntakeMode("upload");
    setFilesReady([
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
    setFilesReady(next);
  };

  const applyPaste = () => {
    const content = pasteText.trim();
    if (!content) {
      setError("Paste some code first.");
      return;
    }
    const name = (pasteName.trim() || "pasted.txt").replace(/[^\w.\-]+/g, "_");
    setFilesReady([
      {
        name,
        size: new TextEncoder().encode(content).length,
        content,
      },
    ]);
  };

  const startQuiz = () => {
    if (files.length === 0) {
      setError("Add a file or paste code first.");
      return;
    }
    void generateQuiz(sourceFiles, 0);
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
        await persistClearance(local);
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
      await persistClearance(result);
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
    setPasteText("");
    setCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    go(1);
  };

  const copyClearance = async () => {
    if (!submitResult?.completionId) return;
    try {
      await navigator.clipboard.writeText(submitResult.completionId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn’t copy — select the code and copy manually.");
    }
  };

  const kindClass = (kind: string) => {
    if (kind === "fn") return "border-[var(--brand)]/40 text-[var(--brand)]";
    if (kind === "format") return "border-amber-300 text-amber-800";
    if (kind === "type") return "border-sky-300 text-sky-800";
    return "border-[var(--line)] text-[var(--ink-2)]";
  };

  return (
    <div className="mx-auto max-w-[540px] px-5 pb-24 pt-12 sm:pt-16">
      <header className="pf-hero mb-9">
        <p className="pf-brand">Preflight</p>

        <p className="mt-5 max-w-[26rem] text-[1.08rem] leading-[1.55] text-[var(--ink-2)]">
          No API key. Upload the code for this lab, pass once at 100%, copy your
          clearance code — then you’re cleared to submit.
        </p>

        {(course || lab) && (
          <div className="mt-5 rounded-xl border border-[var(--line)] bg-white/80 px-3.5 py-2.5">
            <p className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
              {(course?.assignmentTitle || lab?.title || "").replace(
                /\s*·\s*/g,
                " · ",
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">
              {course?.courseTitle || lab?.courseHint || ""}
              {course?.userName ? ` · ${course.userName}` : ""}
              {course?.isDevSim ? " · demo" : ""}
            </p>
            {lab && lab.goals.length > 0 && (
              <p className="mt-2 text-[12px] text-[var(--ink-2)]">
                Focus: {lab.focus.slice(0, 4).join(", ") || lab.goals[0]}
              </p>
            )}
          </div>
        )}

        <div className="mt-7 flex items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <span className="pf-step">
            <span className="pf-step-dot" aria-hidden />
            {STEP_LABELS[step]}
          </span>
          <span className="text-[11px] text-[var(--ink-3)]">
            {ollama?.ok ? "Host quiz engine" : "On-device quiz"}
            {attempt > 0 ? ` · retry ${attempt + 1}` : ""}
          </span>
        </div>
      </header>

      {step === 1 && (
        <section className="space-y-4">
          <div className="pf-panel">
            <div className="mb-4 flex gap-1 rounded-xl bg-[#f1f3f8] p-1">
              {(
                [
                  ["upload", "Upload file"],
                  ["paste", "Paste code"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setIntakeMode(id)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                    intakeMode === id
                      ? "bg-white text-[var(--ink)] shadow-sm"
                      : "text-[var(--ink-3)] hover:text-[var(--ink-2)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {intakeMode === "upload" ? (
              <>
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
                <div className="mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={loadSample}
                  >
                    Use sample instead
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold text-[var(--ink-2)]">
                    Filename
                  </label>
                  <input
                    value={pasteName}
                    onChange={(e) => setPasteName(e.target.value)}
                    className="h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[rgba(47,91,255,0.12)]"
                    placeholder="main.c"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold text-[var(--ink-2)]">
                    Your code
                  </label>
                  <Textarea
                    rows={10}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Paste your program here…"
                    className="min-h-[180px] font-mono text-[12px] leading-relaxed"
                  />
                </div>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={applyPaste}
                  className="h-10 px-4"
                >
                  Use pasted code
                </Button>
              </div>
            )}
          </div>

          {files.length > 0 && (
            <div className="pf-panel space-y-4">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                  In-app code
                </p>
                {codePreview && (
                  <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--line)] bg-[#0c1222] p-3 font-mono text-[11px] leading-relaxed text-[#e8eef8]">
                    <span className="mb-2 block text-[10px] text-[#8b93a7]">
                      {codePreview.name}
                    </span>
                    {codePreview.text}
                  </pre>
                )}
              </div>

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                  What we’ll ask about
                </p>
                {radarHits.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {radarHits.map((h) => (
                      <span
                        key={`${h.kind}:${h.label}`}
                        className={cn(
                          "rounded-md border bg-white px-2 py-1 font-mono text-[11px] font-medium",
                          kindClass(h.kind),
                        )}
                      >
                        {h.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--ink-3)]">
                    We’ll pull questions from the structure of your file.
                  </p>
                )}
              </div>

              <ul className="space-y-1 border-t border-[var(--line)] pt-3">
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

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  className="h-10 px-4"
                  disabled={busy}
                  onClick={startQuiz}
                >
                  Build my quiz
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setFiles([]);
                    setPasteText("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  Clear
                </Button>
                {busy && (
                  <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                    <span className="pf-spin" />
                    {busyLabel}
                  </span>
                )}
              </div>
            </div>
          )}

          {error && <div className="pf-err">{error}</div>}
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
                {perfect ? "Cleared" : "Keep going"}
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
                    a.score === 1 ? "text-[var(--green)]" : "text-red-600",
                  )}
                >
                  {a.score === 1 ? "Correct" : `Missed · answer is ${a.correct}`}
                </div>
                {a.score === 0 && (
                  <p className="mt-1.5 text-[13px] leading-snug text-[var(--ink-2)]">
                    {missCoach({
                      question: a.question,
                      correct: a.correct,
                      options: a.options,
                      fileNames: files.map((f) => f.name),
                      symbols: radarHits.map((h) => h.label),
                    })}
                  </p>
                )}
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
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">
              {submitResult.message}
            </p>
            <div className="mt-5 rounded-xl border border-[var(--line)] bg-[#f8f9fc] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                Clearance code · show a TA if needed
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-white px-2.5 py-1.5 font-mono text-[13px] text-[var(--ink)] ring-1 ring-[var(--line)]">
                  {submitResult.completionId}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => void copyClearance()}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-[var(--ink-3)]">
                {new Date(submitResult.submittedAt).toLocaleString()}
                {submitResult.mode === "ags" ? " · posted to iCollege" : ""}
                {" · "}
                <a href="/ta" className="font-semibold text-[var(--brand)] underline">
                  TA can verify here
                </a>
              </p>
            </div>
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
          {error && <div className="pf-err mt-3">{error}</div>}
        </section>
      )}
    </div>
  );
}
