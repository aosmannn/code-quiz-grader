# Preflight · understanding check before submit

**Preflight** is a research-style **submission gate**: students upload assignment code, clear a short **oral-exam interview** about *their* program, then (and only then) get cleared to turn it in for normal grading.

Understanding ≠ correctness. Those stay separate.

## Student flow (3 screens)

1. **Submit code** (+ optional assignment spec)  
2. **Understanding Check** — one question at a time, ladder: explain → reason → predict → modify → defend, cited to their lines; follow-ups up to 3  
3. **Understanding report** — score breakdown, concepts ✓/△, clearance stamp or retry / instructor review  

## Instructor

| Who | Link |
| --- | --- |
| Student | http://127.0.0.1:43127/ |
| Lab presets | http://127.0.0.1:43127/instructor |
| Understanding sessions (audit) | http://127.0.0.1:43127/instructor/sessions |
| TA verify clearance | http://127.0.0.1:43127/ta |
| Legacy quiz UI | http://127.0.0.1:43127/check |

## Run

```bash
npm install
npm run build
PORT=43127 npm run start
# optional richer local model:
ollama pull llama3.2:3b
```

## Research question

> Can an AI-generated, code-specific questioning process reliably distinguish students who understand their submitted programs from those who do not?

Every turn stores: question, response, expected signals, evaluation, evidence, follow-ups — see `.data/interviews.json`.

## Architecture (MVP)

```
Upload → Code analyzer (understanding map)
      → Question ladder (from map + assignment spec)
      → Student answers
      → Evaluator (+ optional follow-up)
      → Report → clearance / retry / instructor review
```
