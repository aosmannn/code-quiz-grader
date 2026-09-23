# Code Understanding Quiz (iCollege course tool)

Students open this from **iCollege (D2L)** as a course assignment — not a public website.

**Flow:** upload code → quiz auto-builds from your symbols → get **100%** → turn in to the course. Miss any question → try a fresh quiz (no penalty). **No Ollama, no cloud LLM, no API keys, no student installs.**

## Try tonight (localhost)

```bash
npm install
npm run build
npm run start
```

1. **Pilot simulator:** [http://127.0.0.1:43127/pilot](http://127.0.0.1:43127/pilot)
2. Launch assignment → upload or load sample → quiz appears → answer → turn in at 100%

Quiz: [http://127.0.0.1:43127](http://127.0.0.1:43127)

## How students run it

Open the assignment **inside iCollege**. Upload files. That’s it — no config screens.

## Pass rule

**100% required** to turn in (every MC correct; every free-answer full credit). Retries are unlimited and encouraging.

## LTI endpoints (D2L)

| Purpose | URL |
| --- | --- |
| OpenID Connect login | `{BASE}/lti/login` |
| Launch / redirect | `{BASE}/lti/launch` |
| JWKS | `{BASE}/lti/jwks` |
| Dev simulator | `{BASE}/pilot` |

See `.env.example` for `LTI_*` vars.

## Smoke

```bash
node scripts/smoke-mock.mjs
```
