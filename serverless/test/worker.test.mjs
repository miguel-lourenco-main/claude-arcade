// Unit tests for the feedback worker's pure helpers (no network).
// Run: node serverless/test/worker.test.mjs
import assert from "node:assert";
import { validate, buildIssue, field } from "../feedback-worker.js";

let n = 0;
function test(name, fn) {
  n++;
  try { fn(); console.log("  ok  " + name); }
  catch (e) { console.error("FAIL  " + name); console.error(e); process.exitCode = 1; }
}

test("field clamps and trims", () => {
  assert.equal(field("  hi  ", 10), "hi");
  assert.equal(field("abcdef", 3), "abc");
  assert.equal(field(undefined, 5), "");
  assert.equal(field(null, 5), "");
});

test("honeypot submissions are marked spam and accepted quietly", () => {
  const r = validate({ website: "http://spam", summary: "x", details: "y" });
  assert.equal(r.ok, true);
  assert.equal(r.data.spam, true);
});

test("valid submission normalises fields", () => {
  const r = validate({ kind: "IDEA", game: "Gloamkeep", summary: "  more torches ",
                       details: "the keep is too dark", handle: "mira" });
  assert.equal(r.ok, true);
  assert.equal(r.data.kind, "idea");
  assert.equal(r.data.game, "gloamkeep");
  assert.equal(r.data.summary, "more torches");
  assert.equal(r.data.handle, "mira");
});

test("unknown kind falls back to other; blank game to general", () => {
  const r = validate({ kind: "rant", summary: "abc", details: "def" });
  assert.equal(r.data.kind, "other");
  assert.equal(r.data.game, "general");
});

test("too-short summary/details rejected", () => {
  assert.equal(validate({ summary: "a", details: "enough here" }).ok, false);
  assert.equal(validate({ summary: "long enough", details: "a" }).ok, false);
});

test("non-object body rejected", () => {
  assert.equal(validate(null).ok, false);
  assert.equal(validate("nope").ok, false);
});

test("buildIssue composes title, labels, description", () => {
  const { data } = validate({ kind: "bug", game: "fuse", summary: "undo breaks",
                              details: "pressing undo twice crashes", handle: "kai" });
  const issue = buildIssue(data, "suggestion");
  assert.equal(issue.title, "[bug] undo breaks");
  const labels = issue.labels.split(",");
  assert.ok(labels.includes("suggestion"));
  assert.ok(labels.includes("needs-triage"));
  assert.ok(labels.includes("type::bug"));
  assert.ok(labels.includes("game::fuse"));
  assert.ok(issue.description.includes("Submitted by: kai"));
  assert.ok(issue.description.includes("Game: fuse"));
});

test("general suggestions omit a game label", () => {
  const { data } = validate({ kind: "idea", summary: "dark mode toggle",
                              details: "let me force dark mode arcade-wide" });
  const issue = buildIssue(data, "suggestion");
  assert.ok(!issue.labels.split(",").some((l) => l.startsWith("game::")));
});

console.log(process.exitCode ? "\nFAILURES" : `\nall ${n} worker tests passed`);
