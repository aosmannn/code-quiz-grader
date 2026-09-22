# Code Quiz Grader

Upload program source files, generate a quiz about *that* code, take it, and get scored feedback. Multiple-choice is graded locally; free-answer is graded by Claude when an API key is available, or by a demo mock grader otherwise.

## Run locally

```bash
npm install
npm run build
npm run start
```

Opens on [http://127.0.0.1:43127](http://127.0.0.1:43127). Prefer `build` + `start` for a reliable interactive session (Turbopack HMR can fail to hydrate in some environments). `npm run dev` works when HMR websockets are healthy.

**Demo mode is the default** — no Anthropic key required. Click **Load sample program** on the upload step to walk the full loop with `grade_book.py`. Claude is optional (use “add Anthropic key” only if you want live generation/grading).

### Smoke / E2E (mock only)

```bash
node scripts/smoke-mock.mjs   # API generate + grade
node scripts/e2e-mock.mjs     # full browser loop (needs playwright)
```

## Flow

1. Upload one or more source files (drag-drop or multi-select)
2. Choose total question count (2–30)
3. Choose MC vs free-answer split
4. Generate quiz (Claude or mock)
5. Answer and submit
6. See results with feedback, then start over

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui.
