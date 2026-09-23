# Code Understanding Quiz (iCollege course tool)

Students open this from **iCollege (D2L)** as a link on the assignment — not a public website.

**Student flow:** click assignment link → upload their code → quiz from *their* symbols → **100%** → mark check complete → **cleared to submit** the real lab. Miss any question → fresh quiz, no penalty. **No cloud LLM / API keys.** Students don’t install Ollama — the course host runs it for the pilot.

## Try tonight (localhost)

```bash
npm install
npm run build
npm run start
```

| Who | Link |
| --- | --- |
| **Student one-click** | [http://127.0.0.1:43127/try](http://127.0.0.1:43127/try) |
| Instructor simulator | [http://127.0.0.1:43127/pilot](http://127.0.0.1:43127/pilot) |
| Direct quiz (no course session) | [http://127.0.0.1:43127](http://127.0.0.1:43127) |

## How students run it (eventual iCollege)

1. Open the assignment in iCollege  
2. Click the **understanding check** link  
3. Upload the code for that lab  
4. Pass the quiz at 100% and mark complete  
5. Return to iCollege and submit the real assignment  

## Pass rule

**100% required** to clear the check (every MC correct; every free-answer full credit). Retries are unlimited and encouraging.

## LTI endpoints (D2L)

| Purpose | URL |
| --- | --- |
| OpenID Connect login | `{BASE}/lti/login` |
| Launch / redirect | `{BASE}/lti/launch` |
| JWKS | `{BASE}/lti/jwks` |
| Student try link | `{BASE}/try` |
| Dev simulator | `{BASE}/pilot` |

See `.env.example` for `LTI_*` vars.

## Smoke

```bash
node scripts/smoke-mock.mjs
```
