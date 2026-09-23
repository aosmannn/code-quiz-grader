"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export default function TryPage() {
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const launch = () => {
    setBusy(true);
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/lti/launch";
    const fields: Record<string, string> = {
      isDevSim: "true",
      dev: "1",
      sub: "try-student",
      name: "Student Tester",
      email: "student@university.edu",
      roles: "Learner",
      context_id: "demo-course",
      context_title: "Demo course",
      resource_link_id: "pre-submit-check",
      resource_link_title: "Before you submit · code understanding check",
      launch_presentation_return_url: "http://127.0.0.1:43127/",
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
    started.current = true;
    const t = window.setTimeout(() => launch(), 400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main className="pf-shell">
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="pf-brand mb-4">Preflight</p>
        <p className="mb-8 text-[var(--ink-2)]">Opening your check…</p>
        <Button
          type="button"
          className="h-10 px-4"
          disabled={busy}
          onClick={() => launch()}
        >
          {busy ? "Launching…" : "Start check"}
        </Button>
      </div>
    </main>
  );
}
