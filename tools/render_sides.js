#!/usr/bin/env node
/*
 * Render every side to a WAV using a real browser and the app's own engine.
 *
 *   node tools/render_sides.js [ids...]
 *
 * Output: audio/<id>.wav (+ stats printed as JSON). The same OfflineAudioContext
 * path the Export button uses, so what lands on disk is what a judge would get
 * from clicking Export — not a separate offline approximation written in Python.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { findChrome, BASE_ARGS } = require("./chrome.js");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "audio");
const PORT = 8177;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ids = process.argv.slice(2);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "records.json"), "utf8"));
  const wanted = catalog.records.filter((r) => !ids.length || ids.includes(r.id)).map((r) => r.id);

  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = path.join(os.tmpdir(), `ej-render-${port}`);
  const chrome = spawn(findChrome(), [
    ...BASE_ARGS,
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank",
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    await sleep(150);
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      wsUrl = j.webSocketDebuggerUrl;
    } catch { /* not up */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error("no CDP"); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (msg) => {
    const d = JSON.parse(msg.data);
    if (d.id && pending.has(d.id)) {
      const { resolve, reject } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result);
    } else if (d.method === "Runtime.exceptionThrown") {
      errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable");
  await S("Runtime.enable");
  await S("Page.navigate", { url: `${BASE}/tools/render.html` });

  // Wait for the harness to define its entry point rather than assuming a fixed
  // load time. A cold browser can take seconds, and a silent "renderRecord is
  // not a function" is a miserable way to find that out.
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    const probe = await S("Runtime.evaluate", { expression: "typeof window.renderRecord", returnByValue: true })
      .catch(() => null);
    if (probe && probe.result && probe.result.value === "function") { ready = true; break; }
  }
  if (!ready) {
    console.error(`render harness never initialised at ${BASE}/tools/render.html — is the server running?`);
    ws.close();
    chrome.kill();
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const report = [];

  for (const id of wanted) {
    process.stdout.write(`rendering ${id} … `);
    const expr = `window.renderRecord(${JSON.stringify(id)}).then(r => { window.__r = r; return JSON.stringify({...r, wav: null}); })`;
    let meta;
    try {
      const res = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, timeout: 120000 });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "render failed");
      meta = JSON.parse(res.result.value);
    } catch (e) {
      console.log("FAILED: " + e.message);
      report.push({ id, error: e.message });
      continue;
    }

    // second call to pull the base64 payload (kept out of the JSON above)
    const b64res = await S("Runtime.evaluate", { expression: "window.__r.wav", returnByValue: true });
    const b64 = b64res.result.value;
    const file = path.join(OUT, `${id}.wav`);
    fs.writeFileSync(file, Buffer.from(b64, "base64"));

    console.log(`${meta.seconds.toFixed(1)}s, peak ${meta.peak}, rms ${meta.rms}, ` +
      `compose ${meta.composeMs}ms, render ${meta.renderMs}ms`);
    report.push({ ...meta, file: path.relative(ROOT, file) });
  }

  fs.writeFileSync(path.join(OUT, "render-report.json"), JSON.stringify(report, null, 2));
  if (errors.length) console.error("page errors:", errors);

  const ok = report.filter((r) => !r.error);
  console.log(`\nwrote ${ok.length} files to audio/`);
  if (!ok.length) {
    console.error("every side failed — is the page reachable at " + BASE + "?");
    ws.close();
    chrome.kill();
    process.exit(1);
  }

  ws.close();
  chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
