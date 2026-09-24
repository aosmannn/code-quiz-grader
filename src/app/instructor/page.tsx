"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { LabPreset } from "@/lib/lab-presets";

export default function InstructorPage() {
  const [labs, setLabs] = useState<LabPreset[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:43127";

  useEffect(() => {
    void fetch("/api/labs")
      .then((r) => r.json())
      .then((d: { labs?: LabPreset[] }) => setLabs(d.labs || []))
      .catch(() => setLabs([]));
  }, []);

  const copyLink = async (labId: string) => {
    const url = `${base}/try?lab=${encodeURIComponent(labId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(labId);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="pf-shell">
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="text-sm font-medium text-[var(--ink-3)]">Instructor</p>
        <h1 className="mt-2 text-[2rem] font-semibold tracking-tight text-[var(--ink)]">
          Lab presets
        </h1>
        <p className="mt-3 max-w-xl text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Pick a lab. Students get a one-click link — no API keys, no question
          knobs. They upload, pass at 100%, and earn a clearance code TAs can
          verify.
        </p>

        <div className="mt-8 space-y-4">
          {labs.map((lab) => (
            <div key={lab.id} className="pf-panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    {lab.title}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-3)]">
                    {lab.courseHint}
                  </p>
                  <p className="mt-2 text-sm text-[var(--ink-2)]">{lab.blurb}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="h-9"
                    onClick={() => void copyLink(lab.id)}
                  >
                    {copied === lab.id ? "Copied" : "Copy student link"}
                  </Button>
                  <Button type="button" variant="outline" className="h-9" asChild>
                    <Link href={`/try?lab=${lab.id}`}>Open as student</Link>
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                  Goals baked into the quiz
                </p>
                <ul className="mt-2 space-y-1 text-sm text-[var(--ink-2)]">
                  {lab.goals.map((g) => (
                    <li key={g}>· {g}</li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 font-mono text-[11px] text-[var(--ink-3)]">
                {base}/try?lab={lab.id}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-[var(--brand)] underline" href="/ta">
            TA verify clearances →
          </Link>
          <Link className="text-[var(--ink-3)] underline" href="/pilot">
            Launch simulator
          </Link>
          <Link className="text-[var(--ink-3)] underline" href="/">
            Student home
          </Link>
        </div>
      </div>
    </main>
  );
}
