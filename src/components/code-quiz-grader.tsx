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

type BriefItem =
  | { kind: "mc"; index: number; q: McQuestion }
  | { kind: "fa"; index: number; id: number; question: string };

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
  const [briefIndex, setBriefIndex] = useState(0);
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
    const shown = lines.slice(0, 18);
    const more = lines.length > 18 ? lines.length - 18 : 0;
    return { name: first.name, lines: shown, more };
  }, [files]);

  const briefing: BriefItem[] = useMemo(() => {
    const items: BriefItem[] = [];
    (quizData.mc || []).forEach((q, index) =>
      items.push({ kind: "mc", index, q }),
    );
    (quizData.fa || []).forEach((q, index) =>
      items.push({ kind: "fa", index, id: q.id, question: q.question }),
    );
    return items;
  }, [quizData]);

  const currentBrief = briefing[briefIndex] || null;

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
      setBusyLabel("Building a briefing from your code…");
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
        setBriefIndex(0);
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
    [go, ollama?.selected, refreshOllama, lab?.id, course?.labId, search],
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
        `Answer every check before finishing. Missing: ${missingMC} choice, ${missingFA} write-in.`,
      );
      return;
    }

    setBusy(true);
    setBusyLabel("Checking your briefing…");
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

  const advanceBrief = () => {
    if (!currentBrief) return;
    if (currentBrief.kind === "mc" && !mcChosen[currentBrief.index]) {
      setError("Pick an option to continue.");
      return;
    }
    if (
      currentBrief.kind === "fa" &&
      !(faAnswers[currentBrief.index] || "").trim()
    ) {
      setError("Write a short answer — name something from your code.");
      return;
    }
    setError(null);
    if (briefIndex >= briefing.length - 1) {
      void submitAnswers();
      return;
    }
    setBriefIndex((i) => i + 1);
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
    setBriefIndex(0);
    setError(null);
    void generateQuiz(sourceFiles, attempt + 1);
  };

  const turnIn = async () => {
    if (!perfect) return;
    setBusy(true);
    setBusyLabel("Stamping your clearance…");
    setError(null);
    try {
      if (!course) {
        const completionId = `local_${Date.now().toString(36)}`;
        const submittedAt = new Date().toISOString();
        const local: SubmitResult = {
          ok: true,
          mode: "stub",
          message:
            "You’re cleared on this device. Open from the assignment link so iCollege can unlock Submit.",
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
    setBriefIndex(0);
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

  const phaseLabel =
    step === 1
      ? files.length
        ? "Your code"
        : "Drop your lab"
      : step === 2
        ? "Briefing"
        : step === 3
          ? perfect
            ? "All clear"
            : "Debrief"
          : "Cleared";

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-28 pt-10 sm:pt-14">
      <header className="pf-hero mb-8">
        <p className="pf-kicker">Before you submit</p>
        <h1 className="pf-brand mt-2">Preflight</h1>
        <p className="mt-5 max-w-[28rem] text-[1.05rem] font-medium leading-[1.55] text-[var(--ink-2)]">
          Not a quiz playground. Drop the code you just wrote — we build a short
          briefing from <em className="not-italic text-[var(--ink)]">your</em>{" "}
          symbols. Pass once. Get stamped. Then submit.
        </p>

        {(course || lab) && (
          <div className="mt-5 border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5">
            <p className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
              {course?.assignmentTitle || lab?.title}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--ink-3)]">
              {course?.courseTitle || lab?.courseHint || ""}
              {course?.userName ? ` · ${course.userName}` : ""}
              {course?.isDevSim ? " · demo" : ""}
            </p>
          </div>
        )}

        <div className="mt-7 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">
              {phaseLabel}
              {step === 2 && briefing.length > 0
                ? ` · ${briefIndex + 1}/${briefing.length}`
                : ""}
              {attempt > 0 && step === 2 ? ` · retry ${attempt + 1}` : ""}
            </span>
            <span className="font-mono text-[10px] text-[var(--ink-3)]">
              {ollama?.ok ? "host model" : "on-device"} · no API key
            </span>
          </div>
          <div className="pf-runway" aria-hidden>
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className={cn(
                  "pf-runway-light",
                  step > n && "on",
                  step === n && (n === 4 ? "hot" : "on"),
                )}
              />
            ))}
          </div>
        </div>
      </header>

      {step === 1 && (
        <section className="space-y-4">
          {files.length === 0 && (
            <div className="pf-panel">
              <div className="mb-4 flex gap-1 border border-[var(--line)] bg-[var(--paper)] p-1">
                {(
                  [
                    ["upload", "Upload"],
                    ["paste", "Paste"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setIntakeMode(id)}
                    className={cn(
                      "flex-1 px-3 py-2 text-sm font-semibold transition-colors",
                      intakeMode === id
                        ? "bg-[var(--ink)] text-[var(--surface)]"
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
                    <p className="mb-2 text-[1.35rem] font-bold tracking-tight text-[var(--ink)]">
                      Drop your lab here
                    </p>
                    <span className="text-sm text-[var(--ink-3)]">
                      .java · .c · .py · whatever you just finished
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
                      Try with a sample
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--ink-3)]">
                      Filename
                    </label>
                    <input
                      value={pasteName}
                      onChange={(e) => setPasteName(e.target.value)}
                      className="h-10 w-full border border-[var(--line)] bg-white px-3 font-mono text-sm outline-none focus:border-[var(--brand)]"
                      placeholder="UndergraduateStudent.java"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--ink-3)]">
                      Paste code
                    </label>
                    <Textarea
                      rows={10}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="Paste the file you wrote for this lab…"
                      className="min-h-[180px] rounded-sm font-mono text-[12px] leading-relaxed"
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={applyPaste}
                    className="h-10 px-4"
                  >
                    Put it on the stage
                  </Button>
                </div>
              )}
            </div>
          )}

          {files.length > 0 && codePreview && (
            <div className="space-y-4">
              <div className="pf-code-stage">
                <div className="relative z-[1] flex items-center justify-between border-b border-[#24332d] px-3.5 py-2.5">
                  <span className="font-mono text-[11px] text-[var(--code-mute)]">
                    {codePreview.name}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--signal)]">
                    live on stage
                  </span>
                </div>
                <pre className="relative z-[1] max-h-[320px] overflow-auto p-0 font-mono text-[11.5px] leading-[1.55] text-[var(--code-fg)]">
                  {codePreview.lines.map((line, i) => (
                    <div key={i} className="flex gap-3 px-3.5 hover:bg-white/5">
                      <span className="w-6 shrink-0 select-none text-right text-[var(--code-mute)]">
                        {i + 1}
                      </span>
                      <span className="whitespace-pre-wrap break-all">
                        {line || " "}
                      </span>
                    </div>
                  ))}
                  {codePreview.more > 0 && (
                    <div className="px-3.5 py-2 font-mono text-[10px] text-[var(--code-mute)]">
                      … {codePreview.more} more lines stay with the briefing
                    </div>
                  )}
                </pre>
              </div>

              <div className="pf-panel space-y-3">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">
                  We’ll ask about
                </p>
                {radarHits.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {radarHits.map((h, i) => (
                      <span
                        key={`${h.kind}:${h.label}`}
                        className="pf-target"
                        style={{ animationDelay: `${i * 0.12}s` }}
                      >
                        {h.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--ink-3)]">
                    Structure of your file — constructors, overrides, calls.
                  </p>
                )}

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

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button
                    type="button"
                    className="h-11 px-5 text-[15px]"
                    disabled={busy}
                    onClick={startQuiz}
                  >
                    Begin briefing
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
                    Swap files
                  </Button>
                  {busy && (
                    <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                      <span className="pf-spin" />
                      {busyLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && <div className="pf-err">{error}</div>}
        </section>
      )}

      {step === 2 && currentBrief && (
        <section className="space-y-4">
          {files[0] && (
            <div className="flex items-center gap-2 overflow-hidden border border-[var(--line)] bg-[var(--code-bg)] px-3 py-2 font-mono text-[11px] text-[var(--code-mute)]">
              <span className="text-[var(--signal)]">●</span>
              <span className="truncate text-[var(--code-fg)]">
                {files[0].name}
              </span>
              <span className="ml-auto shrink-0">check {briefIndex + 1}</span>
            </div>
          )}

          <div key={briefIndex} className="pf-panel pf-slide space-y-4">
            {notice && briefIndex === 0 && (
              <p className="border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[13px] text-[var(--ink-2)]">
                {notice}
              </p>
            )}

            <p className="text-[1.15rem] font-semibold leading-snug tracking-tight text-[var(--ink)]">
              {currentBrief.kind === "mc"
                ? currentBrief.q.question
                : currentBrief.question}
            </p>

            {currentBrief.kind === "mc" ? (
              <div className="flex flex-col gap-2">
                {(["A", "B", "C", "D"] as const).map((k) => {
                  const chosen = mcChosen[currentBrief.index] === k;
                  return (
                    <label
                      key={k}
                      className={cn("pf-brief-opt", chosen && "sel")}
                    >
                      <input
                        type="radio"
                        name={`mc-${currentBrief.index}`}
                        checked={chosen}
                        onChange={() => {
                          setError(null);
                          setMcChosen((prev) => ({
                            ...prev,
                            [currentBrief.index]: k,
                          }));
                        }}
                        className="mt-0.5 accent-[var(--brand)]"
                      />
                      <span className="text-[15px] leading-snug">
                        <span className="mr-1.5 font-mono text-[12px] font-medium text-[var(--ink-3)]">
                          {k}
                        </span>
                        {currentBrief.q.options[k]}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <Textarea
                rows={4}
                placeholder="Say it in your words — name a method or line from your file…"
                value={faAnswers[currentBrief.index] || ""}
                onChange={(e) => {
                  setError(null);
                  setFaAnswers((prev) => ({
                    ...prev,
                    [currentBrief.index]: e.target.value,
                  }));
                }}
                className="min-h-[110px] rounded-sm text-[15px]"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="h-11 px-5"
              disabled={busy}
              onClick={advanceBrief}
            >
              {briefIndex >= briefing.length - 1
                ? "Finish briefing"
                : "Next check"}
            </Button>
            {briefIndex > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setBriefIndex((i) => Math.max(0, i - 1));
                }}
              >
                Back
              </Button>
            )}
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
          {error && <div className="pf-err">{error}</div>}
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <div className="pf-panel">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Debrief
            </p>
            <h2 className="mt-2 text-[1.75rem] font-bold tracking-tight">
              {perfect ? "You’re cleared to stamp." : "Not yet — look closer."}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">
              {perfect
                ? "Every check matched your code. Stamp the clearance, then turn in the real lab."
                : "Misses point at your symbols — not a textbook lecture. Retries are free."}
            </p>
            <div className="mt-4 font-mono text-[12px] text-[var(--ink-3)]">
              {grand} / {grandMax} · need 100%
            </div>

            <div className="mt-5 space-y-0 border-t border-[var(--line)]">
              {mcResults.map((a) => (
                <div
                  key={a.id}
                  className="border-b border-[var(--line)] py-3.5 text-sm last:border-0"
                >
                  <div className="font-medium leading-snug">{a.question}</div>
                  <div
                    className={cn(
                      "mt-1 font-mono text-[11px] font-medium uppercase tracking-wide",
                      a.score === 1
                        ? "text-[var(--brand)]"
                        : "text-[var(--signal)]",
                    )}
                  >
                    {a.score === 1 ? "Clear" : `Miss · ${a.correct}`}
                  </div>
                  {a.score === 0 && (
                    <p className="mt-2 text-[13px] leading-snug text-[var(--ink-2)]">
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
                  className="border-b border-[var(--line)] py-3.5 text-sm last:border-0"
                >
                  <div className="flex justify-between gap-3">
                    <div className="font-medium">{faAnswerRows[i]?.question}</div>
                    <div className="shrink-0 font-mono text-[12px]">
                      {s.score}/10
                    </div>
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--ink-2)]">
                    {s.feedback}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {perfect ? (
              <Button
                type="button"
                className="h-11 px-5"
                disabled={busy}
                onClick={() => void turnIn()}
              >
                Stamp clearance
              </Button>
            ) : (
              <Button
                type="button"
                className="h-11 px-5"
                disabled={busy}
                onClick={retryFreshQuiz}
              >
                Fresh briefing
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={resetAll}>
              Start over
            </Button>
            {busy && (
              <span className="flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                <span className="pf-spin" />
                {busyLabel}
              </span>
            )}
          </div>
          {error && <div className="pf-err">{error}</div>}
        </section>
      )}

      {step === 4 && submitResult && (
        <section className="space-y-5">
          <div className="pf-panel text-center">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">
              Gate open
            </p>
            <div className="pf-stamp" aria-hidden>
              <strong>Cleared</strong>
              <span>to submit</span>
            </div>
            <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed text-[var(--ink-2)]">
              {submitResult.message}
            </p>
            <div className="mt-6 border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-left">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">
                Clearance code · show a TA
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="border border-[var(--line)] bg-white px-2.5 py-1.5 font-mono text-[13px] text-[var(--ink)]">
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
              <p className="mt-2 font-mono text-[10px] text-[var(--ink-3)]">
                {new Date(submitResult.submittedAt).toLocaleString()}
                {submitResult.mode === "ags" ? " · iCollege unlock" : ""}
                {" · "}
                <a
                  href="/ta"
                  className="font-semibold text-[var(--brand)] underline"
                >
                  TA verify
                </a>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {course?.returnUrl ? (
              <Button type="button" className="h-11 px-5" asChild>
                <a href={course.returnUrl}>Back to course · submit</a>
              </Button>
            ) : null}
            <Button
              type="button"
              variant={course?.returnUrl ? "outline" : "default"}
              onClick={resetAll}
              className="h-11 px-5"
            >
              {course?.returnUrl ? "Practice again" : "Another check"}
            </Button>
          </div>
          {error && <div className="pf-err">{error}</div>}
        </section>
      )}
    </div>
  );
}
