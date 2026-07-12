# Feedback intake worker

`feedback-worker.js` is a tiny serverless function that turns a player
suggestion (from the arcade's in-page feedback widget) into a GitLab issue
labelled for triage. It exists so the **static site never ships a GitLab
token** — the token lives only in the worker's environment.

```
player → arcade feedback form → POST → this worker (holds token)
       → GitLab issue  (labels: suggestion, needs-triage, type::<kind>, game::<slug>)
```

You then triage in GitLab: relabel the good ones `accepted` and they appear on
the arcade roadmap (read client-side via the public issues API — no token).

## Deploy (Cloudflare Workers, free tier)

1. Create a **GitLab project access token** on `public-work4/claude-arcade`
   with the `api` (or `Reporter`+`create issue`) scope. Copy it.
2. Install wrangler and deploy:
   ```sh
   npm i -g wrangler
   wrangler login
   cd serverless
   wrangler deploy feedback-worker.js --name arcade-feedback --compatibility-date 2024-01-01
   ```
3. Set the secrets/vars on the worker:
   ```sh
   wrangler secret put GITLAB_TOKEN        # paste the token
   wrangler deploy ... --var GITLAB_PROJECT:public-work4/claude-arcade
   # optional overrides: GITLAB_HOST (default https://gitlab.com), SUGGESTION_LABEL (default "suggestion")
   ```
   (Or set `GITLAB_PROJECT` in the Cloudflare dashboard under the worker's
   Variables, alongside the `GITLAB_TOKEN` secret.)
4. Copy the worker's public URL (e.g. `https://arcade-feedback.<you>.workers.dev`)
   into `games/_common/arcade-config.js` → `feedbackEndpoint`.

Any host that runs a `fetch`-style handler works (Netlify/Deno Deno Deploy/
Vercel Edge); only the deploy command differs. The handler is standard
Web `Request`/`Response`.

## Environment

| var | required | default | purpose |
| --- | --- | --- | --- |
| `GITLAB_TOKEN` | yes | — | project access token with issue-create rights |
| `GITLAB_PROJECT` | yes | — | `namespace/project`, e.g. `public-work4/claude-arcade` |
| `GITLAB_HOST` | no | `https://gitlab.com` | self-managed GitLab host |
| `SUGGESTION_LABEL` | no | `suggestion` | base label on every filed issue |

## Hardening (recommended, not required)

- Add a Cloudflare **Turnstile** check to the form + verify the token here to
  cut bot spam. The worker already ignores submissions that fill the hidden
  `website` honeypot field.
- Add per-IP rate limiting (Cloudflare Rate Limiting rules, or a KV counter).
- Restrict `Access-Control-Allow-Origin` to your Pages origin instead of `*`.

## Test

Pure validation/formatting is unit tested without any network:

```sh
node serverless/test/worker.test.mjs
```
