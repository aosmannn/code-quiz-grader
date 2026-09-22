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

const STORAGE_KEY = "cqg_key";
const ACCEPT =
  ".py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.txt,.html,.css,.php,.swift,.kt,.r,.m,.sh,.json,.xml,.yaml,.yml,.sql,.lua,.scala";

type Step = 1 | 2 | 3 | 4 | 5;
type Mode = "mock" | "claude" | null;

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function ProgressTrack({ step }: { step: Step }) {
  const labels = ["Upload", "Total Qs", "MC / FA split", "Quiz", "Results"] as const;
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
                "flex items-center gap-1.5 whitespace-nowrap text-xs font-medium",
                active && "text-[var(--ink)]",
                done && "text-[var(--green)]",
                !active && !done && "text-[var(--ink-3)]",
              )}
            >
              <span
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-bold",
                  active && "border-[var(--ink)] bg-[var(--ink)] text-white",
                  done && "border-[var(--green)] bg-[var(--green)] text-white",
                  !active && !done && "border-[var(--line-2)] bg-white text-[var(--ink-3)]",
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
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  /** Demo/mock is the default happy path — Claude only when user opts in with a key. */
  const [demoMode, setDemoMode] = useState(true);
  const [files, setFiles] = useState<{ name: string; size: number; content: string }[]>([]);
  const [totalQ, setTotalQ] = useState(0);
  const [customTotal, setCustomTotal] = useState("");
  const [mcCount, setMcCount] = useState<number | null>(null);
  const [quizData, setQuizData] = useState<QuizData>({ mc: [], fa: [] });
  const [mcChosen, setMcChosen] = useState<Record<number, McQuestion["answer"]>>({});
  const [faAnswers, setFaAnswers] = useState<Record<number, string>>({});
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mcResults, setMcResults] = useState<McScored[]>([]);
  const [faResults, setFaResults] = useState<FaScored[]>([]);
  const [faAnswerRows, setFaAnswerRows] = useState<FaAnswer[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Keep any saved key for optional Claude use, but stay in demo by default.
    const stored = localStorage.getItem(STORAGE_KEY) || "";
    if (stored) {
      setApiKey(stored);
      setKeyDraft(stored);
    }
  }, []);

  const usingMock = demoMode || !apiKey;

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

  const saveKey = () => {
    const v = keyDraft.trim();
    if (!v.startsWith("sk-")) {
      setError('Key should start with "sk-"');
      return;
    }
    setApiKey(v);
    localStorage.setItem(STORAGE_KEY, v);
    setDemoMode(false);
    setShowKeyEditor(false);
    setError(null);
  };

  const stayInDemo = () => {
    setDemoMode(true);
    setShowKeyEditor(false);
    setError(null);
  };

  const clearKey = () => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey("");
    setKeyDraft("");
    setDemoMode(true);
    setShowKeyEditor(false);
  };

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

  const generateQuiz = async () => {
    if (mcCount === null || faCount === null) return;
    setBusy(true);
    setBusyLabel(
      usingMock
        ? `Building ${totalQ} demo questions…`
        : `Generating ${totalQ} questions…`,
    );
    setError(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!usingMock && apiKey) headers["x-api-key"] = apiKey;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: sourceFiles,
          mcCount,
          faCount,
          mock: usingMock,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setQuizData(data.quiz as QuizData);
      setMode(data.mode);
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
      setError(`Please answer every question. Missing: ${missingMC} MC, ${missingFA} FA.`);
      return;
    }

    setBusy(true);
    setBusyLabel("Grading your answers…");
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
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (!usingMock && apiKey) headers["x-api-key"] = apiKey;
        const res = await fetch("/api/grade", {
          method: "POST",
          headers,
          body: JSON.stringify({
            files: sourceFiles,
            faAnswers: faPayload,
            mock: usingMock,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Grade failed");
        faScored = data.fa_scores as FaScored[];
        if (data.mode) setMode(data.mode);
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
    setError(null);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    go(1);
  };

  const mcTotal = mcResults.reduce((s, a) => s + a.score, 0);
  const mcMax = mcResults.length;
  const faTotal = faResults.reduce((s, a) => s + a.score, 0);
  const faMax = faResults.length * 10;
  const grand = mcTotal + faTotal;
  const grandMax = mcMax + faMax;

  return (
    <div className="mx-auto max-w-[660px] px-4 pb-20 pt-10">
      {/* Brand */}
      <div className="mb-9 flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[var(--ink)] text-lg">
          💻
        </div>
        <div>
          <div className="text-[17px] font-semibold tracking-tight">Code Quiz Grader</div>
          <div className="text-[13px] text-[var(--ink-3)]">
            Upload code · configure · quiz · results
          </div>
        </div>
      </div>

      {/* Demo / API mode banner */}
      {usingMock ? (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-[13px] text-emerald-900">
          <strong className="mb-1 block font-semibold">Demo mode — no API key needed</strong>
          Questions and free-answer grading run locally with sample logic grounded in your
          uploaded files. Claude is optional and off by default.
          {showKeyEditor ? (
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Input
                  type="password"
                  placeholder="sk-ant-api03-…"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  className="h-9 flex-1 border-emerald-300 bg-white font-mono text-[13px]"
                />
                <Button type="button" onClick={saveKey} className="h-9">
                  Use Claude
                </Button>
                <Button type="button" variant="outline" className="h-9" onClick={stayInDemo}>
                  Stay in demo
                </Button>
              </div>
              <p className="text-[12px] text-emerald-800/80">
                Keys stay in this browser only. You can switch back to demo anytime.
              </p>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setShowKeyEditor(true)}
              >
                Optional: add Anthropic key
              </Button>
              {apiKey ? (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearKey}>
                  Clear saved key
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <span>Claude mode — generating and grading with your API key</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={stayInDemo}>
              Switch to demo
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearKey}>
              Clear key
            </Button>
          </div>
        </div>
      )}

      <ProgressTrack step={step} />

      {/* Step 1 — Upload */}
      {step === 1 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Upload program files</div>
            <p className="mb-3 text-sm text-[var(--ink-2)]">
              Drop your own source, or load the built-in sample to try the full loop in seconds.
            </p>
            <div
              role="button"
              tabIndex={0}
              aria-label="Click to upload files"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
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
                "cursor-pointer rounded-lg border-2 border-dashed border-[var(--line-2)] px-6 py-9 text-center transition-colors",
                dragOver && "border-blue-600 bg-indigo-50",
                "hover:border-blue-600 hover:bg-indigo-50",
              )}
            >
              <span className="mb-2.5 block text-3xl">📂</span>
              <p className="mb-0.5 text-sm font-medium text-[var(--ink-2)]">
                Click to choose files, or drag & drop here
              </p>
              <span className="text-xs text-[var(--ink-3)]">
                Accepts .py .js .ts .java .c .cpp .cs .go .rb .rs .swift .kt .txt and more
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
              <div className="mt-3.5 flex flex-col gap-1.5">
                {files.map((f, i) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 rounded-[5px] border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5 font-mono text-[13px]"
                  >
                    <span>📄</span>
                    <span className="truncate">{f.name}</span>
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
            <Button type="button" disabled={files.length === 0} onClick={() => go(2)}>
              Continue →
            </Button>
          </div>
        </section>
      )}

      {/* Step 2 — Total */}
      {step === 2 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">How many questions in total?</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {[5, 8, 10, 15].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => pickTotal(n)}
                  className={cn(
                    "h-[54px] w-[54px] rounded-lg border-[1.5px] text-lg font-semibold transition-colors",
                    totalQ === n && !customTotal
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-[var(--line-2)] bg-white text-[var(--ink-2)] hover:border-blue-600 hover:bg-indigo-50 hover:text-blue-600",
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
                className="h-9 w-20"
              />
              <span className="text-[13px] text-[var(--ink-3)]">questions (2 – 30)</span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-3">
            <Button type="button" disabled={totalQ < 2} onClick={enterSplit}>
              Continue →
            </Button>
            <Button type="button" variant="outline" onClick={() => go(1)}>
              ← Back
            </Button>
          </div>
        </section>
      )}

      {/* Step 3 — Split */}
      {step === 3 && (
        <section>
          <div className="cqg-card">
            <div className="cqg-card-title">Choose the question mix</div>
            <p className="mb-4 text-sm text-[var(--ink-2)]">
              You&apos;ve chosen <strong>{totalQ}</strong> questions. Select how many should
              be multiple-choice — the rest will be free-answer.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-[13px] font-medium text-[var(--ink-2)]">
                  Multiple-choice questions
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: totalQ + 1 }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setMcCount(i)}
                      className={cn(
                        "rounded-full border-[1.5px] px-3.5 py-1 text-[13px] font-medium transition-colors",
                        mcCount === i
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-[var(--line-2)] bg-white text-[var(--ink-2)] hover:border-blue-600 hover:text-blue-600",
                      )}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-[13px] font-medium text-[var(--ink-2)]">
                  Free-answer questions
                </label>
                <div className="text-[22px] font-semibold text-[var(--green)]">
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
                        mcCount > 0 ? `${mcCount} multiple-choice (1 pt each)` : null,
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
              disabled={mcCount === null || (mcCount === 0 && (faCount ?? 0) === 0) || busy}
              onClick={() => void generateQuiz()}
            >
              {usingMock ? "Generate demo quiz ✦" : "Generate quiz ✦"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => go(2)}>
              ← Back
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
              Answer all questions
              {(mode === "mock" || usingMock) && (
                <span className="ml-2 normal-case tracking-normal text-emerald-700">
                  · demo quiz
                </span>
              )}
            </div>
            <div>
              {(quizData.mc?.length ?? 0) > 0 && (
                <>
                  <div className="cqg-section-head">Multiple-choice — 1 point each</div>
                  {quizData.mc.map((q, i) => (
                    <div key={q.id} className="mb-5 last:mb-0">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-blue-600">
                        MC · Question {i + 1} of {quizData.mc.length}
                      </div>
                      <div className="mb-2.5 text-[15px] leading-relaxed">{q.question}</div>
                      <div className="flex flex-col gap-1.5">
                        {(["A", "B", "C", "D"] as const).map((k) => {
                          const chosen = mcChosen[i] === k;
                          return (
                            <label
                              key={k}
                              className={cn(
                                "flex cursor-pointer items-start gap-2.5 rounded-[5px] border-[1.5px] px-3.5 py-2.5 transition-colors",
                                chosen
                                  ? "border-blue-600 bg-indigo-50"
                                  : "border-[var(--line)] hover:border-blue-600 hover:bg-indigo-50",
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
                                className="mt-0.5 accent-blue-600"
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
                  <div className="cqg-section-head">Free-answer — scored 0–10 each</div>
                  {quizData.fa.map((q, i) => (
                    <div key={q.id} className="mb-5 last:mb-0">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--green)]">
                        FA · Question {i + 1} of {quizData.fa.length}
                      </div>
                      <div className="mb-2.5 text-[15px] leading-relaxed">{q.question}</div>
                      <Textarea
                        rows={3}
                        placeholder="Type your answer here…"
                        value={faAnswers[i] || ""}
                        onChange={(e) =>
                          setFaAnswers((prev) => ({ ...prev, [i]: e.target.value }))
                        }
                        className="min-h-[88px] resize-y text-sm leading-relaxed"
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Button type="button" disabled={busy} onClick={() => void submitAnswers()}>
              Submit answers →
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => go(3)}>
              ← Back
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
            <div className="cqg-card-title">Your results</div>
            <div className="mb-4 flex flex-wrap gap-2">
              {mcMax > 0 && (
                <span className="rounded-full border border-blue-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                  MC: {mcTotal} / {mcMax} pts
                </span>
              )}
              {faMax > 0 && (
                <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-[var(--green)]">
                  FA: {faTotal} / {faMax} pts
                </span>
              )}
              {(mode === "mock" || usingMock) && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                  Demo grading
                </span>
              )}
            </div>

            {mcMax > 0 && (
              <div className="mb-6">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">
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
                            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold",
                            ok
                              ? "bg-green-50 text-[var(--green)]"
                              : "bg-red-50 text-red-600",
                          )}
                        >
                          {ok ? "✓ Correct" : "✗ Wrong"}
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
                          Correct answer:{" "}
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
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">
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
                        : "text-red-600";
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
                        <div className={cn("text-base font-semibold whitespace-nowrap", color)}>
                          {s.score}/10
                        </div>
                      </div>
                      <div className="mb-1.5 h-[3px] overflow-hidden rounded-sm bg-[var(--line)]">
                        <div className={cn("h-full rounded-sm", bar)} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mb-1 text-xs text-[var(--ink-3)]">
                        Your answer:{" "}
                        <span className="text-[var(--ink-2)]">{faAnswerRows[i]?.answer}</span>
                      </div>
                      <div className="text-[13px] leading-relaxed text-[var(--ink-2)]">
                        {s.feedback}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between border-t-2 border-[var(--ink)] pt-4">
              <span className="text-[15px] font-semibold">Total score</span>
              <span className="text-[28px] font-semibold tracking-tight">
                {grand} / {grandMax}
              </span>
            </div>
          </div>
          <Button type="button" variant="outline" className="mt-1" onClick={resetAll}>
            ↺ Start over
          </Button>
        </section>
      )}
    </div>
  );
}
