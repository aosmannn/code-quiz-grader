# Preflight · code understanding check (iCollege course tool)

**Preflight** is the pre-submit clearance students run from **iCollege (D2L)** on the assignment — not a public website.

**Student flow:** assignment link → upload their code → quiz from *their* symbols (Symbol Radar) → **100%** → clearance stamp → **cleared to submit** the real lab. Miss any question → fresh quiz, no penalty. **No cloud LLM / API keys.** Students don’t install Ollama — the course host runs it for the pilot.

## Try tonight (localhost)

```bash
npm install
npm run build
npm run start
```

| Who | Link |
| --- | --- |
| **Student desk (home)** | [http://127.0.0.1:43127/](http://127.0.0.1:43127/) |
| **Lab bench (quiz flow)** | [http://127.0.0.1:43127/check](http://127.0.0.1:43127/check) |
| **Student one-click** | [http://127.0.0.1:43127/try](http://127.0.0.1:43127/try) |
| Instructor simulator | [http://127.0.0.1:43127/pilot](http://127.0.0.1:43127/pilot) |

LTI launch redirects to `/check`. `/try` auto-launches a demo session into the lab bench.

## How students run it (eventual iCollege)

1. Open the assignment in iCollege  
2. Click the **Preflight / understanding check** link  
3. Upload the code for that lab  
4. Pass the quiz at 100% and mark complete  
5. Return to iCollege and submit the real assignment  

## Pass rule

**100% required** to clear the check (every MC correct; every free-answer full credit). Retries are unlimited and encouraging.

## LTI endpoints (D2L)

| Purpose | URL |
| --- | --- |
| OpenID Connect login | `{BASE}/lti/login` |
| Launch / redirect | `{BASE}/lti/launch` → `/check` |
| JWKS | `{BASE}/lti/jwks` |
| Student try link | `{BASE}/try` |
| Dev simulator | `{BASE}/pilot` |

See `.env.example` for `LTI_*` vars.

## Smoke

```bash
node scripts/smoke-mock.mjs
```
