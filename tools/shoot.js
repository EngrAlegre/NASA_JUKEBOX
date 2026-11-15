#!/usr/bin/env node
/*
 * Headless QA driver.
 *
 * Launches Chromium, opens a page, collects console errors and page errors,
 * runs an optional expression, and writes a screenshot. No dependencies: the
 * CDP socket is Node's built-in WebSocket.
 *
 *   node tools/shoot.js <url> <out.png> [waitMs] [jsExpression]
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { findChrome, BASE_ARGS } = require("./chrome.js");


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [url, out, waitArg, exprArg] = process.argv.slice(2);
  if (!url || !out) {
    console.error("usage: node tools/shoot.js <url> <out.png> [waitMs] [expr]");
    process.exit(2);
  }
  const waitMs = Number(waitArg || 3500);
  const port = 9200 + Math.floor(Math.random() * 400);
  const profile = path.join(os.tmpdir(), `ej-shot-${port}`);
  const chrome = spawn(findChrome(), [
    ...BASE_ARGS,
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${Number(process.env.SHOT_W || 1600)},${Number(process.env.SHOT_H || 1200)}`,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(150);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await res.json();
      wsUrl = j.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error("chrome did not expose CDP"); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
    } else if (data.method) {
      events.push(data);
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
  await S("Log.enable");

  await S("Page.navigate", { url });
  await sleep(waitMs);

  const report = { url, consoleErrors: [], pageErrors: [], logs: [] };
  for (const ev of events) {
    if (ev.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(ev.params.type)) {
      report.consoleErrors.push(ev.params.args.map((a) => a.value || a.description || a.type).join(" "));
    }
    if (ev.method === "Runtime.exceptionThrown") {
      report.pageErrors.push(ev.params.exceptionDetails.exception?.description || ev.params.exceptionDetails.text);
    }
    if (ev.method === "Log.entryAdded" && ev.params.entry.level === "error") {
      report.logs.push(ev.params.entry.text + " " + (ev.params.entry.url || ""));
    }
  }

  if (exprArg) {
    let expr = exprArg;
    // "@path" reads the expression from a file, which avoids fighting shell
    // quoting for anything longer than a one-liner.
    if (expr.startsWith("@")) {
      expr = fs.readFileSync(expr.slice(1), "utf8");
    }
    try {
      const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      report.eval = r.result ? r.result.value : null;
    } catch (e) {
      report.eval = "EVAL ERROR: " + e.message;
    }
  }

  const shotParams = { format: "png", captureBeyondViewport: false };
  // SHOT_CLIP=1200x630 captures an exact rectangle regardless of the window,
  // which is what social cards need.
  if (process.env.SHOT_CLIP) {
    const [cw, ch] = process.env.SHOT_CLIP.split("x").map(Number);
    shotParams.clip = { x: 0, y: 0, width: cw, height: ch, scale: 1 };
    shotParams.captureBeyondViewport = true;
  }
  const shot = await S("Page.captureScreenshot", shotParams);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));

  // full page height, for a second capture
  const metrics = await S("Page.getLayoutMetrics").catch(() => null);
  if (metrics) {
    report.pageHeight = Math.round(metrics.cssContentSize.height);
  }

  console.log(JSON.stringify(report, null, 2));

  ws.close();
  chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* windows lock */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
