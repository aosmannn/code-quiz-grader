"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { LabPreset } from "@/lib/lab-presets";

export default function InstructorPage() {
  const [labs, setLabs] = useState<LabPreset[]>([]);
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:43127";

  useEffect(() => {
    void fetch("/api/labs")
      .then((r) => r.json())
      .then((d: { labs?: LabPreset[] }) => setLabs(d.labs || []))
      .catch(() => setLabs([]));
  }, []);

  return (
    <main className="pf-shell">
      <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
          Lab links
        </h1>
        <p className="mt-2 text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Share one of these links with your class. Students upload their work,
          answer a few questions, and get cleared to submit — no setup on their
          side.
        </p>

        <div className="mt-8 space-y-3">
          {labs.map((lab) => (
            <div key={lab.id} className="pf-panel">
              <h2 className="text-base font-semibold text-[var(--ink)]">
                {lab.title}
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-2)]">{lab.blurb}</p>
              <p className="mt-3 break-all text-sm text-[var(--brand)]">
                <Link href={`/try?lab=${lab.id}`} className="underline">
                  {base}/try?lab={lab.id}
                </Link>
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-sm text-[var(--ink-2)]">
          <Link href="/ta" className="text-[var(--brand)] underline">
            Check a student clearance
          </Link>
          {" · "}
          <Link href="/instructor/sessions" className="text-[var(--brand)] underline">
            View understanding sessions
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
