#!/usr/bin/env node
// Run every game's committed test suite.
//   node run-tests.mjs           — everything (node logic + headless-Chrome browser suites)
//   node run-tests.mjs --logic   — node logic/engine tests only (fast, no Chrome needed)
//   node run-tests.mjs wyrm fuse — only the named games
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const logicOnly = args.includes("--logic");
const only = args.filter((a) => !a.startsWith("--"));

const games = readdirSync(join(root, "games"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, "games", d.name, "test")))
  .map((d) => d.name)
  .filter((g) => only.length === 0 || only.includes(g));

let pass = 0, fail = 0;
const failures = [];
for (const g of games) {
  const dir = join(root, "games", g, "test");
  const suites = readdirSync(dir).filter((f) =>
    logicOnly ? /\.test\.(js|mjs)$/.test(f) && !f.startsWith("browser")
              : /\.(test\.(js|mjs)|mjs)$/.test(f) && f !== "README.md");
  for (const s of suites) {
    const file = join(dir, s);
    process.stdout.write(`${g}/${s} ... `);
    try {
      execFileSync("node", [file], { cwd: root, stdio: "pipe", timeout: 300000 });
      console.log("PASS");
      pass++;
    } catch (e) {
      console.log("FAIL");
      failures.push(`${g}/${s}: ${(e.stdout || e.stderr || e.message).toString().split("\n").filter(Boolean).slice(-3).join(" | ")}`);
      fail++;
    }
  }
}
console.log(`\n${pass} passed, ${fail} failed across ${games.length} games`);
for (const f of failures) console.log("  " + f);
process.exit(fail ? 1 : 0);
