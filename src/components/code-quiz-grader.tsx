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

type Step = 1 | 2 | 3 | 4 | 5;
type Mode = "ollama" | "offline" | null;

type OllamaStatus = {
  ok: boolean;
  base: string;
  models: string[];
  selected: string | null;
  message: string;
  installHint: string;
  pullHint: string;
};

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function ProgressTrack({ step }: { step: Step }) {
  const labels = ["Upload", "How many", "Mix", "Quiz", "Results"] as const;
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
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-colors",
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
  const [forceOffline, setForceOffline] = useState(false);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [ollamaChecking, setOllamaChecking] = useState(true);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
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
  const [mode, setMode] = useState<Mode>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mcResults, setMcResults] = useState<McScored[]>([]);
  const [faResults, setFaResults] = useState<FaScored[]>([]);
  const [faAnswerRows, setFaAnswerRows] = useState<FaAnswer[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshOllama = useCallback(async () => {
    setOllamaChecking(true);
    try {
      const res = await fetch("/api/ollama/status");
      const data = (await res.json()) as OllamaStatus;
      setOllama(data);
    } catch {
      setOllama({
        ok: false,
        base: "http://127.0.0.1:11434",
        models: [],
        selected: null,
        message: "Couldn’t reach the local status check.",
        installHint: "Install Ollama from https://ollama.com , then run: ollama serve",
        pullHint: "Pull a small model: ollama pull llama3.2:1b",
      });
    } finally {
      setOllamaChecking(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(THRESHOLD_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= 50 && n <= 100) setThreshold(n);
    }
    void refreshOllama();
  }, [refreshOllama]);

  const ollamaReady = Boolean(ollama?.ok && ollama.selected) && !forceOffline;
  const usingOffline = forceOffline || !ollamaReady;

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

  const enterSplit = () => {
    setMcCount(null);
    go(3);
  };

  const onThreshold = (v: string) => {
    const n = parseInt(v, 10);
    if (n >= 50 && n <= 100) {
      setThreshold(n);
      localStorage.setItem(THRESHOLD_KEY, String(n));
    }
  };

  const generateQuiz = async () => {
    if (mcCount === null || faCount === null) return;
    setBusy(true);
    setBusyLabel(
      usingOffline
        ? `Building ${totalQ} offline questions…`
        : `Asking your local model for ${totalQ} questions…`,
    );
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: sourceFiles,
          mcCount,
          faCount,
          offline: usingOffline,
          model: ollama?.selected || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setQuizData(data.quiz as QuizData);
      setMode(data.mode === "ollama" ? "ollama" : "offline");
      setModelUsed(data.model || null);
      if (data.notice) setNotice(data.notice);
      setMcChosen({});
      setFaAnswers({});
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
    setBusyLabel(
      usingOffline || mode === "offline"
        ? "Scoring with local heuristics…"
        : "Local model is reading your answers…",
    );
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
            offline: usingOffline || mode === "offline",
            model: ollama?.selected || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Grade failed");
        faScored = data.fa_scores as FaScored[];
        if (data.mode) setMode(data.mode === "ollama" ? "ollama" : "offline");
        if (data.model) setModelUsed(data.model);
        if (data.notice) setNotice(data.notice);
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
    setMode(null);
    setModelUsed(null);
    setNotice(null);
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
    setNotice(null);
    setError(null);
    go(3);
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

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-24 pt-10 sm:pt-14">
      <header className="cqg-hero-mark mb-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="cqg-trust">Runs on your laptop · no cloud</span>
          {ollamaReady ? (
            <span className="rounded-full border border-[var(--line)] bg-[var(--sky-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sky)]">
              Ollama · {ollama?.selected}
            </span>
          ) : (
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-3)]">
              Offline practice mode
            </span>
          )}
        </div>
        <h1
          className="mb-2 text-[2.15rem] leading-[1.1] font-semibold tracking-tight text-[var(--ink)] sm:text-[2.55rem]"
          style={{ fontFamily: "var(--font-display), serif" }}
        >
          Code Quiz Grader
        </h1>
        <p className="max-w-xl text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Upload the program you wrote, answer questions about{" "}
          <em>your</em> code, and reach the understanding threshold before your
          work is ready to hand in. Unlimited retries — no penalty.
        </p>
      </header>

      {/* Local runtime panel */}
      <div className="cqg-card mb-6">
        <div className="cqg-card-title">Your local setup</div>
        <p className="cqg-card-sub">
          Questions and free-answer grading stay on this Mac. Nothing is sent to
          Anthropic, OpenAI, or other cloud APIs.
        </p>

        {ollamaChecking ? (
          <p className="flex items-center gap-2 text-sm text-[var(--ink-3)]">
            <span className="cqg-spin" /> Checking Ollama…
          </p>
        ) : ollamaReady ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--green)_30%,var(--line))] bg-[var(--green-soft)] px-4 py-3 text-sm text-[var(--ink)]">
            <strong className="font-semibold">{ollama?.message}</strong>
            <p className="mt-1 text-[13px] text-[var(--ink-2)]">
              Available models: {(ollama?.models || []).join(", ") || "—"}
            </p>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--sky-soft)]/60 px-4 py-3 text-sm">
            <p className="font-medium text-[var(--ink)]">
              {ollama?.message || "Ollama isn’t ready yet."}
            </p>
            <p className="text-[13px] text-[var(--ink-2)]">
              You can still use the full flow with the offline question
              generator. For smarter, code-aware quizzes, install a local model:
            </p>
            <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-[var(--ink-2)]">
              <li>{ollama?.installHint}</li>
              <li>
                <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[12px]">
                  {ollama?.pullHint?.replace(/^Pull a small model:\s*/i, "") ||
                    "ollama pull llama3.2:1b"}
                </code>
              </li>
              <li>Click Refresh below — then generate again.</li>
            </ol>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void refreshOllama()}
          >
            Refresh Ollama status
          </Button>
          <Button
            type="button"
            variant={forceOffline ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setForceOffline((v) => !v)}
          >
            {forceOffline ? "Using offline generator" : "Force offline generator"}
          </Button>
        </div>

        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <label className="mb-2 block text-[13px] font-semibold text-[var(--ink-2)]">
            Understanding threshold · {threshold}%
          </label>
          <div className="flex flex-wrap items-center gap-3">
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
            <span className="text-[13px] text-[var(--ink-3)]">
              Suggested 80–85%. You can retry until you clear it.
            </span>
          </div>
        </div>
      </div>

      <ProgressTrack step={step} />

      {/* Step 1 — Upload */}
      {step === 1 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Start with your code</div>
            <p className="cqg-card-sub">
              Drop the files you want to demonstrate understanding of — or load
              the sample grade book to try the loop in under a minute.
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
          <div className="mt-1 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={files.length === 0}
              className="h-10 px-4"
              onClick={() => go(2)}
            >
              Continue
            </Button>
          </div>
        </section>
      )}

      {/* Step 2 — Total */}
      {step === 2 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">How many questions?</div>
            <p className="cqg-card-sub">
              A short quiz is enough for most labs. You can always retry with a
              fresh set.
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
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={2}
                max={30}
                placeholder="Custom…"
                value={customTotal}
                onChange={(e) => onCustomTotal(e.target.value)}
                className="h-9 w-24 bg-[var(--surface)]"
              />
              <span className="text-[13px] text-[var(--ink-3)]">
                questions (2 – 30)
              </span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={totalQ < 2}
              className="h-10 px-4"
              onClick={enterSplit}
            >
              Continue
            </Button>
            <Button type="button" variant="outline" onClick={() => go(1)}>
              Back
            </Button>
          </div>
        </section>
      )}

      {/* Step 3 — Split */}
      {step === 3 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Choose your mix</div>
            <p className="cqg-card-sub">
              You&apos;ve chosen <strong>{totalQ}</strong> questions. Pick how
              many should be multiple-choice — the rest are free-answer.
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
                        "rounded-full border px-3.5 py-1 text-[13px] font-semibold transition-colors",
                        mcCount === i
                          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--green)]",
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
              <div
                className={cn(
                  "text-xs sm:col-span-2",
                  mcCount !== null && mcCount === 0 && faCount === 0
                    ? "text-red-600"
                    : "text-[var(--ink-3)]",
                )}
              >
                {mcCount === null
                  ? ""
                  : mcCount === 0 && faCount === 0
                    ? "Select at least 1 question."
                    : [
                        mcCount > 0
                          ? `${mcCount} multiple-choice (1 pt each)`
                          : null,
                        (faCount ?? 0) > 0
                          ? `${faCount} free-answer (0–10 pts each)`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
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
              onClick={() => void generateQuiz()}
            >
              {usingOffline ? "Generate offline quiz" : "Generate local quiz"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => go(2)}
            >
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

      {/* Step 4 — Quiz */}
      {step === 4 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">
              Show what you know
              <span className="ml-2 text-base font-normal text-[var(--ink-3)]">
                · {mode === "ollama" ? `local · ${modelUsed}` : "offline quiz"}
              </span>
            </div>
            <p className="cqg-card-sub">
              Take your time. This is about understanding your code — not speed.
            </p>
            {notice && (
              <div className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[13px] text-[var(--ink-2)]">
                {notice}
              </div>
            )}
            <div>
              {(quizData.mc?.length ?? 0) > 0 && (
                <>
                  <div className="cqg-section-head">
                    Multiple-choice — 1 point each
                  </div>
                  {quizData.mc.map((q, i) => (
                    <div key={q.id} className="mb-5 last:mb-0">
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
                                "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 transition-colors",
                                chosen
                                  ? "border-[var(--green)] bg-[var(--green-soft)]"
                                  : "border-[var(--line)] hover:border-[var(--green)] hover:bg-[var(--green-soft)]/40",
                              )}
                            >
                              <input
                                type="radio"
                                name={`mc-${i}`}
                                value={k}
                                checked={chosen}
                                onChange={() =>
                                  setMcChosen((prev) => ({ ...prev, [i]: k }))
                                }
                                className="mt-0.5 accent-[var(--green)]"
                              />
                              <span className="text-sm leading-snug">
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
                  <div className="cqg-section-head">
                    Free-answer — scored 0–10 each
                  </div>
                  {quizData.fa.map((q, i) => (
                    <div key={q.id} className="mb-5 last:mb-0">
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
                        className="min-h-[96px] resize-y bg-[var(--surface)] text-sm leading-relaxed"
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="h-10 px-4"
              disabled={busy}
              onClick={() => void submitAnswers()}
            >
              Submit answers
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => go(3)}
            >
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

      {/* Step 5 — Results */}
      {step === 5 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Your understanding score</div>
            <p className="cqg-card-sub">
              {passed
                ? "You cleared the threshold — nice work. You’re ready to hand this in when your course asks."
                : "Not quite there yet — that’s okay. Retry with a fresh quiz anytime. No penalty."}
            </p>

            <div className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/70 px-4 py-4">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-[12px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
                    Understanding
                  </div>
                  <div
                    className="text-[2.4rem] font-semibold leading-none tracking-tight"
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
                    {passed ? "Threshold met" : "Keep practicing"}
                  </div>
                </div>
              </div>
              <div className="cqg-meter-track">
                <div
                  className="cqg-meter-fill"
                  style={{ width: `${Math.min(100, understandingPct)}%` }}
                />
              </div>
              <div className="relative mt-1 h-3">
                <div
                  className="absolute top-0 h-3 w-px bg-[var(--ink)]"
                  style={{ left: `${threshold}%` }}
                  title={`Threshold ${threshold}%`}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
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
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 font-medium text-[var(--ink-3)]">
                  {mode === "ollama"
                    ? `Graded by ${modelUsed}`
                    : "Offline local grading"}
                </span>
              </div>
            </div>

            {notice && (
              <div className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[13px] text-[var(--ink-2)]">
                {notice}
              </div>
            )}

            {mcMax > 0 && (
              <div className="mb-6">
                <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--ink-3)]">
                  Multiple-choice — {mcTotal} / {mcMax}
                </div>
                {mcResults.map((a) => {
                  const ok = a.score === 1;
                  return (
                    <div
                      key={a.id}
                      className="border-b border-[var(--line)] py-3.5 last:border-b-0"
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-3">
                        <div className="flex-1 text-sm font-medium leading-snug">
                          {a.question}
                        </div>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold",
                            ok
                              ? "bg-[var(--green-soft)] text-[var(--green)]"
                              : "bg-red-50 text-red-700",
                          )}
                        >
                          {ok ? "Correct" : "Not quite"}
                        </span>
                      </div>
                      <div className="mb-1 text-xs text-[var(--ink-3)]">
                        Your answer:{" "}
                        <span className="text-[var(--ink-2)]">
                          {a.chosen} — {a.options[a.chosen]}
                        </span>
                      </div>
                      {!ok && (
                        <div className="text-xs text-[var(--ink-3)]">
                          Correct:{" "}
                          <span className="text-[var(--ink-2)]">
                            {a.correct} — {a.options[a.correct]}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {faMax > 0 && (
              <div className="mb-6">
                <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--ink-3)]">
                  Free-answer — {faTotal} / {faMax}
                </div>
                {faResults.map((s, i) => {
                  const cls =
                    s.score >= 8 ? "full" : s.score >= 4 ? "mid" : "zero";
                  const pct = (s.score / 10) * 100;
                  const color =
                    cls === "full"
                      ? "text-[var(--green)]"
                      : cls === "mid"
                        ? "text-[var(--amber)]"
                        : "text-red-700";
                  const bar =
                    cls === "full"
                      ? "bg-[var(--green)]"
                      : cls === "mid"
                        ? "bg-[var(--amber)]"
                        : "bg-red-600";
                  return (
                    <div
                      key={s.id}
                      className="border-b border-[var(--line)] py-3.5 last:border-b-0"
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-3">
                        <div className="flex-1 text-sm font-medium leading-snug">
                          {faAnswerRows[i]?.question}
                        </div>
                        <div
                          className={cn(
                            "text-base font-semibold whitespace-nowrap",
                            color,
                          )}
                        >
                          {s.score}/10
                        </div>
                      </div>
                      <div className="mb-1.5 h-[3px] overflow-hidden rounded-sm bg-[var(--line)]">
                        <div
                          className={cn("h-full rounded-sm", bar)}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mb-1 text-xs text-[var(--ink-3)]">
                        Your answer:{" "}
                        <span className="text-[var(--ink-2)]">
                          {faAnswerRows[i]?.answer}
                        </span>
                      </div>
                      <div className="text-[13px] leading-relaxed text-[var(--ink-2)]">
                        {s.feedback}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-[var(--ink)]/20 pt-4">
              <span className="text-[15px] font-semibold">Points</span>
              <span
                className="text-[28px] font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display), serif" }}
              >
                {grand} / {grandMax}
              </span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            <Button type="button" className="h-10 px-4" onClick={retryQuiz}>
              Try a new quiz
            </Button>
            <Button type="button" variant="outline" onClick={resetAll}>
              Start over
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
