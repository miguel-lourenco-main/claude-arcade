// Claude Arcade — feedback intake worker.
//
// A tiny serverless function that receives a structured player suggestion from
// the arcade's feedback widget and files it as a GitLab issue labelled for
// triage. It holds the GitLab token (in an env var) so the static site never
// ships a secret. Deploy on Cloudflare Workers (see ./README.md).
//
// The pure helpers (validate / buildIssue) are exported so they can be unit
// tested under node without any network; Cloudflare only calls `default.fetch`.

const MAX = { summary: 120, details: 4000, handle: 80, kind: 20, game: 40 };
const KINDS = new Set(["idea", "bug", "balance", "other"]);

// Clamp + trim a value to a string field length.
function field(v, n) {
  return String(v == null ? "" : v).trim().slice(0, n);
}

// Validate an incoming submission. Returns { ok:true, data } or { ok:false, error }.
// `data.spam` is set true for a tripped honeypot (caller should 200 silently).
function validate(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "bad-body" };
  if (field(body.website, 200)) return { ok: true, data: { spam: true } }; // honeypot
  const kind = field(body.kind, MAX.kind).toLowerCase() || "idea";
  const data = {
    spam: false,
    kind: KINDS.has(kind) ? kind : "other",
    game: field(body.game, MAX.game).toLowerCase() || "general",
    summary: field(body.summary, MAX.summary),
    details: field(body.details, MAX.details),
    handle: field(body.handle, MAX.handle),
  };
  if (data.summary.length < 3) return { ok: false, error: "summary-too-short" };
  if (data.details.length < 3) return { ok: false, error: "details-too-short" };
  return { ok: true, data };
}

// Turn validated data into the GitLab issue payload (title, description, labels).
function buildIssue(data, suggestionLabel) {
  const labels = [suggestionLabel || "suggestion", "needs-triage", `type::${data.kind}`];
  if (data.game && data.game !== "general") labels.push(`game::${data.game}`);
  const title = `[${data.kind}] ${data.summary}`;
  const description =
    `${data.details}\n\n---\n` +
    `Game: ${data.game}\n` +
    `Type: ${data.kind}\n` +
    (data.handle ? `Submitted by: ${data.handle}\n` : "") +
    `Via: arcade feedback widget`;
  return { title, description, labels: labels.join(",") };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const worker = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid-json" }, 400);
    }

    const result = validate(body);
    if (!result.ok) return jsonResponse({ error: result.error }, 400);
    if (result.data.spam) return jsonResponse({ ok: true }, 200); // drop bots quietly

    if (!env || !env.GITLAB_TOKEN || !env.GITLAB_PROJECT) {
      return jsonResponse({ error: "server-misconfigured" }, 500);
    }

    const issue = buildIssue(result.data, env.SUGGESTION_LABEL);
    const host = env.GITLAB_HOST || "https://gitlab.com";
    const url = `${host}/api/v4/projects/${encodeURIComponent(env.GITLAB_PROJECT)}/issues`;

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": env.GITLAB_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(issue),
      });
    } catch {
      return jsonResponse({ error: "upstream-unreachable" }, 502);
    }
    if (!res.ok) return jsonResponse({ error: "gitlab-error", status: res.status }, 502);

    const created = await res.json();
    return jsonResponse({ ok: true, url: created.web_url, iid: created.iid }, 200);
  },
};

export default worker;
export { validate, buildIssue, field };
