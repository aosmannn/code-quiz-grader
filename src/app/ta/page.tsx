"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Clearance = {
  code: string;
  submittedAt: string;
  userName: string;
  courseTitle: string;
  assignmentTitle: string;
  labId?: string | null;
  fileNames: string[];
  fileFingerprint: string;
  understandingPct: number;
  mode: "ags" | "stub";
  isDevSim?: boolean;
};

export default function TaPage() {
  const [code, setCode] = useState("");
  const [hit, setHit] = useState<Clearance | null>(null);
  const [recent, setRecent] = useState<Clearance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshRecent = () => {
    void fetch("/api/clearance")
      .then((r) => r.json())
      .then((d: { clearances?: Clearance[] }) => setRecent(d.clearances || []))
      .catch(() => setRecent([]));
  };

  useEffect(() => {
    refreshRecent();
  }, []);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    setHit(null);
    try {
      const res = await fetch(
        `/api/clearance?code=${encodeURIComponent(code.trim())}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Not found");
      setHit(data.clearance as Clearance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="pf-shell">
      <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
        <p className="text-sm font-medium text-[var(--ink-3)]">Teaching assistant</p>
        <h1 className="mt-2 text-[2rem] font-semibold tracking-tight">
          Verify clearance
        </h1>
        <p className="mt-3 text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Student shows you a clearance code after Preflight. Paste it here to
          see who passed, when, and which files they used — no API keys involved.
        </p>

        <div className="pf-panel mt-8 space-y-3">
          <label className="block text-[12px] font-semibold text-[var(--ink-2)]">
            Clearance code
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="cmp_…"
              className="h-10 flex-1 font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") void lookup();
              }}
            />
            <Button
              type="button"
              className="h-10 px-4"
              disabled={busy || !code.trim()}
              onClick={() => void lookup()}
            >
              {busy ? "Checking…" : "Verify"}
            </Button>
          </div>
          {error && <div className="pf-err">{error}</div>}
        </div>

        {hit && (
          <div className="pf-panel mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--green)]">
              Cleared · {hit.understandingPct}%
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              {hit.userName}
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              {hit.assignmentTitle}
              <br />
              {hit.courseTitle}
              {hit.labId ? ` · lab:${hit.labId}` : ""}
            </p>
            <p className="mt-3 font-mono text-xs text-[var(--ink-3)]">
              {hit.code}
              <br />
              {new Date(hit.submittedAt).toLocaleString()}
              {hit.mode === "ags" ? " · iCollege passback" : " · local / stub"}
              {hit.isDevSim ? " · demo launch" : ""}
            </p>
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                Files
              </p>
              <ul className="mt-1 space-y-1 font-mono text-[12px] text-[var(--ink-2)]">
                {hit.fileNames.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="mt-2 font-mono text-[10px] text-[var(--ink-3)]">
                fingerprint {hit.fileFingerprint}
              </p>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--ink)]">
                Recent clearances
              </p>
              <button
                type="button"
                className="text-xs font-semibold text-[var(--brand)] underline"
                onClick={refreshRecent}
              >
                Refresh
              </button>
            </div>
            <ul className="space-y-2">
              {recent.slice(0, 12).map((c) => (
                <li
                  key={c.code}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm hover:border-[var(--brand)]/40"
                  onClick={() => {
                    setCode(c.code);
                    setHit(c);
                    setError(null);
                  }}
                >
                  <span className="truncate font-medium">{c.userName}</span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--ink-3)]">
                    {c.code.slice(0, 14)}…
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <Link
            className="font-semibold text-[var(--brand)] underline"
            href="/instructor"
          >
            ← Lab presets
          </Link>
          <Link className="text-[var(--ink-3)] underline" href="/">
            Student home
          </Link>
        </div>
      </div>
    </main>
  );
}
