"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { LabPreset } from "@/lib/lab-presets";

export default function TryPageInner() {
  const search = useSearchParams();
  const labId = search.get("lab");
  const [busy, setBusy] = useState(false);
  const [lab, setLab] = useState<LabPreset | null>(null);
  const started = useRef(false);
  const labReady = useRef(!labId);

  useEffect(() => {
    if (!labId) {
      labReady.current = true;
      return;
    }
    void fetch(`/api/labs?id=${encodeURIComponent(labId)}`)
      .then((r) => r.json())
      .then((d: { lab?: LabPreset }) => {
        setLab(d.lab || null);
        labReady.current = true;
      })
      .catch(() => {
        labReady.current = true;
      });
  }, [labId]);

  const launch = () => {
    setBusy(true);
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/lti/launch";
    const assignmentTitle = lab?.title || "Lab understanding check";
    const courseTitle = lab?.courseHint || "CSc 1301";
    const fields: Record<string, string> = {
      isDevSim: "true",
      dev: "1",
      sub: "try-student",
      name: "Student Tester",
      email: "student@university.edu",
      roles: "Learner",
      context_id: labId || "demo-course",
      context_title: courseTitle,
      resource_link_id: labId ? `lab-${labId}` : "lab-preflight",
      resource_link_title: assignmentTitle,
      launch_presentation_return_url: labId
        ? `http://127.0.0.1:43127/try?lab=${encodeURIComponent(labId)}`
        : "http://127.0.0.1:43127/",
      lab_id: labId || "",
    };
    for (const [k, v] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = k;
      input.value = v;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  };

  useEffect(() => {
    if (started.current) return;
    const t = window.setInterval(() => {
      if (!labReady.current) return;
      window.clearInterval(t);
      if (started.current) return;
      started.current = true;
      launch();
    }, 80);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab]);

  return (
    <main className="pf-shell">
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
          Preflight
        </p>
        <p className="mt-4 mb-2 text-[var(--ink-2)]">
          {lab ? `Opening ${lab.title}…` : "Opening your check…"}
        </p>
        <p className="mb-8 text-sm text-[var(--ink-3)]">
          No setup needed — you’ll upload your code and answer a few questions.
        </p>
        <Button
          type="button"
          className="h-10 px-4"
          disabled={busy}
          onClick={() => launch()}
        >
          {busy ? "Opening…" : "Start"}
        </Button>
      </div>
    </main>
  );
}
