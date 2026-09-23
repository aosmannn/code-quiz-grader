# Preflight · code understanding check (iCollege course tool)

**Preflight** is the pre-submit check students run from **iCollege (D2L)** on the assignment — not a public website.

**Student flow:** assignment link → upload *or paste* code → see in-app preview + “what we’ll ask about” → quiz → **100%** → copy clearance code → **cleared to submit**. Miss any question → fresh quiz, no penalty. Host prefers **`llama3.2:3b`** (falls back to `1b`). Real iCollege AGS passback when `LTI_TOKEN_URL` + key + line item are set.

## Try tonight (localhost)

```bash
npm install
npm run build
npm run start
# optional better quizzes:
ollama pull llama3.2:3b
```

| Who | Link |
| --- | --- |
| **Preflight (home)** | [http://127.0.0.1:43127/](http://127.0.0.1:43127/) |
| **Student one-click** | [http://127.0.0.1:43127/try](http://127.0.0.1:43127/try) |
| Instructor simulator | [http://127.0.0.1:43127/pilot](http://127.0.0.1:43127/pilot) |

LTI launch redirects to `/`. `/try` auto-launches a demo session on the home page.

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
| Launch / redirect | `{BASE}/lti/launch` → `/` |
| JWKS | `{BASE}/lti/jwks` |
| Student try link | `{BASE}/try` |
| Dev simulator | `{BASE}/pilot` |

See `.env.example` for `LTI_*` vars.

## Smoke

```bash
node scripts/smoke-mock.mjs
```
