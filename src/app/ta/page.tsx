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
      <div className="mx-auto max-w-lg px-5 py-12 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
          Check a clearance
        </h1>
        <p className="mt-2 text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Paste the code a student shows you after they finish Preflight. You’ll
          see their name, time, and files.
        </p>

        <div className="pf-panel mt-8 space-y-3">
          <label className="block text-sm font-medium text-[var(--ink)]">
            Clearance code
          </label>
          <div className="flex gap-2">
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
              {busy ? "Checking…" : "Check"}
            </Button>
          </div>
          {error && <div className="pf-err">{error}</div>}
        </div>

        {hit && (
          <div className="pf-panel mt-4 space-y-3">
            <p className="text-sm font-medium text-[var(--green)]">
              Cleared · {hit.understandingPct}%
            </p>
            <div>
              <p className="text-lg font-semibold text-[var(--ink)]">
                {hit.userName}
              </p>
              <p className="mt-1 text-sm text-[var(--ink-2)]">
                {hit.assignmentTitle}
              </p>
              <p className="text-sm text-[var(--ink-3)]">{hit.courseTitle}</p>
            </div>
            <p className="text-sm text-[var(--ink-2)]">
              {new Date(hit.submittedAt).toLocaleString()}
            </p>
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">Files</p>
              <ul className="mt-1 space-y-1 text-sm text-[var(--ink-2)]">
                {hit.fileNames.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mt-10">
            <p className="mb-3 text-sm font-medium text-[var(--ink)]">
              Recent clearances
            </p>
            <ul className="space-y-2">
              {recent.slice(0, 8).map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-left text-sm hover:bg-[var(--paper)]"
                    onClick={() => {
                      setCode(c.code);
                      setHit(c);
                      setError(null);
                    }}
                  >
                    <span className="font-medium text-[var(--ink)]">
                      {c.userName}
                    </span>
                    <span className="mt-0.5 block text-[var(--ink-3)]">
                      {c.assignmentTitle} ·{" "}
                      {new Date(c.submittedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-10 text-sm text-[var(--ink-2)]">
          <Link href="/instructor" className="text-[var(--brand)] underline">
            Lab links
          </Link>
          {" · "}
          <Link href="/" className="underline">
            Student home
          </Link>
        </p>
      </div>
    </main>
  );
}
