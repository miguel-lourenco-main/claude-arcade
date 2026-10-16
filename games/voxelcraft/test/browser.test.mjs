// Headless-Chrome tests for Voxelcraft. Run with: node test/browser.test.mjs
//
// Self-contained (no npm deps): spawns a static http server over the repo
// root (so ../_common resolves as on GitLab Pages), drives
// /usr/bin/google-chrome over raw CDP websockets, boots the game with
// ?nolock (the automated-test handle, window.voxelcraft), and asserts zero
// console errors / page exceptions. Three.js comes from the pinned CDN in
// the import map, so this suite needs network access. Voxelcraft is the
// one ES-module game: it is served over http only (file:// can't load
// modules).

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(GAME_DIR, "..", "..");
const CHROME_BIN = "/usr/bin/google-chrome";

let passed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failures.push(name); console.error(`  FAIL - ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.normalize(path.join(REPO_ROOT, urlPath));
      if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data || ""})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new CDP(ws)));
      ws.addEventListener("error", (e) => reject(new Error(`websocket error: ${e.message || e}`)));
    });
  }
  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 30000);
    });
  }
  on(fn) { this.listeners.push(fn); }
}

function launchChrome(userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME_BIN, [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`,
      "--no-first-run", "--no-default-browser-check", "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio",
      "--window-size=1280,800", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { proc.stderr.off("data", onData); resolve({ proc, wsUrl: m[1] }); }
    };
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`chrome exited early (code ${code})`)));
    setTimeout(() => reject(new Error("chrome did not report DevTools endpoint")), 15000);
  });
}

class Page {
  constructor(cdp, sessionId) { this.cdp = cdp; this.sessionId = sessionId; }
  send(method, params) { return this.cdp.send(method, params, this.sessionId); }
  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.sessionId === this.sessionId && msg.method === "Page.loadEventFired") {
          this.cdp.listeners.splice(this.cdp.listeners.indexOf(fn), 1);
          resolve();
        }
      };
      this.cdp.on(fn);
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page eval failed: ${d.exception?.description || d.text}`);
    }
    return res.result.value;
  }
  async waitFor(expression, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await this.eval(expression)) return true; } catch { /* not yet */ }
      await sleep(200);
    }
    return false;
  }
}

async function openPage(cdp, errors, label) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(`[${label}] exception: ${d.exception?.description || d.text}`);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!/favicon/i.test(text)) errors.push(`[${label}] console.error: ${text}`);
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      const text = `${msg.params.entry.text} ${msg.params.entry.url || ""}`;
      if (!/favicon/i.test(text)) errors.push(`[${label}] log: ${text}`);
    }
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  return page;
}

// ------------------------------------------------------------------- suites

// boot a fresh world and wait for the test handle + some loaded terrain
async function boot(page, url) {
  await page.navigate(url);
  await page.eval("localStorage.clear()");
  await page.navigate(url);
  const up = await page.waitFor("!!(window.voxelcraft && window.voxelcraft.world.chunks.size > 4)", 45000);
  assert(up, "game boots: test handle present and chunks streaming");
  await sleep(1500); // let a few frames of the loop run
  return up;
}

async function smoke(page) {
  console.log("\n== smoke");
  assert(await page.eval("typeof window.voxelcraft.player.update === 'function'"),
    "player is live");
  const t0 = await page.eval("window.voxelcraft.sky.time");
  await sleep(1200);
  const t1 = await page.eval("window.voxelcraft.sky.time");
  assert(t1 !== t0, "the game loop is ticking (sky time advances)");
}

// ---------------------------------------------------------------------- main

const hardTimeout = setTimeout(() => {
  console.error("FATAL: browser test timed out after 240s");
  process.exit(1);
}, 240000);
hardTimeout.unref();

let chrome = null, server = null, userDataDir = null;
const consoleErrors = [];
try {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "voxelcraft-cdp-"));
  server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/games/voxelcraft/index.html?nolock`;
  ({ proc: chrome, wsUrl: globalThis.__wsUrl } = await launchChrome(userDataDir));
  const cdp = await CDP.connect(globalThis.__wsUrl);
  const page = await openPage(cdp, consoleErrors, "http");
  if (await boot(page, url)) {
    await smoke(page);
  }
  console.log("\n== console errors / exceptions");
  assert(consoleErrors.length === 0,
    `zero console errors/exceptions${consoleErrors.length ? `:\n    ${consoleErrors.join("\n    ")}` : ""}`);
} catch (err) {
  failures.push(`suite crashed: ${err.message}`);
  console.error("SUITE ERROR:", err);
} finally {
  if (chrome) chrome.kill("SIGKILL");
  if (server) server.close();
  if (userDataDir) { try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
process.exit(0);
