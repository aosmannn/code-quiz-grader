"use client";

import { Suspense } from "react";
import TryPageInner from "./try-inner";

export default function TryPage() {
  return (
    <Suspense
      fallback={
        <main className="pf-shell">
          <div className="mx-auto max-w-md px-5 py-20 text-center">
            <p className="pf-brand mb-4">Preflight</p>
            <p className="text-[var(--ink-2)]">Opening…</p>
          </div>
        </main>
      }
    >
      <TryPageInner />
    </Suspense>
  );
}
