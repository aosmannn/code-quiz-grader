# Code Quiz Grader

Prove you understand **your own** uploaded code — entirely on your laptop.

Upload source → configure a short quiz → answer → see an understanding score against a threshold (default ~82%). Unlimited retries, no penalty. Nothing is sent to Anthropic, OpenAI, or other cloud LLM APIs.

## How it runs (local-first)

1. **Ollama** (preferred) at `http://127.0.0.1:11434` generates questions and grades free-answer responses with a local model.
2. If Ollama isn’t ready, the app falls back to an **offline heuristic** question generator so the full UI still works for practice.

No API keys. No accounts. No cloud AI on the happy path.

## Setup

```bash
npm install
npm run build
npm run start
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127). Prefer `build` + `start` for a reliable session.

### Optional: local model via Ollama

```bash
# Install from https://ollama.com , then:
ollama serve
ollama pull llama3.2:1b   # or qwen2.5:1.5b / phi3:mini
```

Refresh status in the app. When a model is detected, generate/grade use it automatically.

## Smoke tests

```bash
node scripts/smoke-mock.mjs   # force offline generate + grade
node scripts/e2e-mock.mjs     # browser loop (needs playwright)
```

## Flow

1. Upload one or more source files (or load the sample `grade_book.py`)
2. Choose total question count (2–30)
3. Choose MC vs free-answer mix
4. Generate quiz (Ollama or offline)
5. Answer and submit
6. See understanding % vs threshold → retry or start over

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, Ollama (optional).
