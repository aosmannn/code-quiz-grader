"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Local iCollege / LTI launch simulator.
 * Posts claims to /lti/launch the same way a platform form_post would.
 */
export default function PilotPage() {
  const [userName, setUserName] = useState("Alex Student");
  const [courseTitle, setCourseTitle] = useState("CSc 1301 — Principles of CS I");
  const [assignmentTitle, setAssignmentTitle] = useState(
    "Lab 3 · Code understanding check",
  );
  const [busy, setBusy] = useState(false);

  const launch = async () => {
    setBusy(true);
    try {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/lti/launch";
      const fields: Record<string, string> = {
        isDevSim: "true",
        dev: "1",
        sub: "dev-user-alex",
        name: userName,
        email: "alex.student@university.edu",
        roles: "Learner",
        context_id: "csc1301-fall",
        context_title: courseTitle,
        resource_link_id: "lab3-understanding",
        resource_link_title: assignmentTitle,
        launch_presentation_return_url: "http://127.0.0.1:43127/check",
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="cqg-shell min-h-screen text-[var(--ink)]">
      <div className="mx-auto max-w-[640px] px-4 py-14">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--ink-3)]">
          Instructor / Adam · local only
        </p>
        <h1
          className="mb-3 text-[2.2rem] font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display), serif" }}
        >
          iCollege launch simulator
        </h1>
        <p className="mb-8 text-[1.02rem] leading-relaxed text-[var(--ink-2)]">
          Pretend a student clicked the assignment link in iCollege before
          submitting their lab. This launches the understanding check with
          course context — pass at 100%, mark complete, then they’re cleared
          to submit the real assignment.
        </p>

        <div className="cqg-card space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[var(--ink-2)]">
              Student name
            </label>
            <Input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="bg-[var(--surface)]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[var(--ink-2)]">
              Course
            </label>
            <Input
              value={courseTitle}
              onChange={(e) => setCourseTitle(e.target.value)}
              className="bg-[var(--surface)]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[var(--ink-2)]">
              Assignment
            </label>
            <Input
              value={assignmentTitle}
              onChange={(e) => setAssignmentTitle(e.target.value)}
              className="bg-[var(--surface)]"
            />
          </div>
          <Button
            type="button"
            className="h-10 px-4"
            disabled={busy || !userName.trim()}
            onClick={() => void launch()}
          >
            Launch assignment from course
          </Button>
        </div>

        <p className="mt-6 text-sm text-[var(--ink-3)]">
          Real D2L registration uses{" "}
          <code className="rounded bg-[var(--surface)] px-1">/lti/login</code>,{" "}
          <code className="rounded bg-[var(--surface)] px-1">/lti/launch</code>,
          and{" "}
          <code className="rounded bg-[var(--surface)] px-1">/lti/jwks</code> —
          see the README and store docs.
        </p>
      </div>
    </main>
  );
}
