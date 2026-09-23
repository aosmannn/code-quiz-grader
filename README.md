# Code Understanding Quiz (iCollege course tool)

Students open this from **iCollege (D2L)** as a course assignment — not a public website.

Upload code → local understanding quiz on the student’s laptop → clear threshold → **turn in** to the course. Unlimited retries. **No Ollama, no cloud LLM, no API keys, no student installs.**

## Try tonight (localhost)

```bash
npm install
npm run build
npm run start
```

1. Open the **pilot simulator**: [http://127.0.0.1:43127/pilot](http://127.0.0.1:43127/pilot)
2. Click **Launch assignment from course**
3. Load sample / upload → quiz → clear threshold → **I’m ready to turn in**
4. See **Submitted to course** (AGS stub + local completion record)

Quiz app: [http://127.0.0.1:43127](http://127.0.0.1:43127)

## How students run it

Open the assignment link **inside iCollege**. Complete the quiz in the browser. Nothing else to install.

## LTI endpoints (D2L registration)

| Purpose | URL |
| --- | --- |
| OpenID Connect login | `{BASE}/lti/login` |
| Launch / redirect | `{BASE}/lti/launch` |
| JWKS | `{BASE}/lti/jwks` |
| Dev simulator | `{BASE}/pilot` |

Copy `.env.example` → `.env.local` and set:

- `LTI_TOOL_BASE_URL` — public HTTPS origin D2L can reach
- `LTI_ISSUER`, `LTI_CLIENT_ID`, `LTI_DEPLOYMENT_ID`, `LTI_PLATFORM_JWKS_URL` — from D2L
- `LTI_TOOL_PRIVATE_KEY_PEM`, `LTI_TOOL_KEY_ID` — tool keypair for AGS client assertions

**Tonight:** launch parse → session cookie → quiz → submit stub works end-to-end via `/pilot`.  
**Next wire-up:** verify `id_token` against platform JWKS; POST real AGS scores when `lineItemUrl` + tool key exist.

## Smoke

```bash
node scripts/smoke-mock.mjs
```

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui. On-device heuristic quiz engine. LTI 1.3 scaffolding + AGS stub.
