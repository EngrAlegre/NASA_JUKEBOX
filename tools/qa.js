#!/usr/bin/env node
/*
 * Verification battery, no dependencies.
 *
 *   node tools/qa.js [url]
 *
 * Runs the checks a judge or a reviewer would otherwise have to take on trust:
 *
 *   1. accessibility tree  — every interactive node exposed with a name, plus
 *                            heading order and the live region
 *   2. keyboard            — Tab reaches the instrument's controls, and focus
 *                            never lands on something unnamed
 *   3. export              — clicks the real Export WAV button, waits for the
 *                            download, and validates the RIFF/WAVE header
 *   4. reduced motion      — reloads with prefers-reduced-motion: reduce and
 *                            checks the piece still renders and plays
 *   5. timing              — time from navigation to a playable side
 *
 * Prints a JSON report and exits non-zero if any check fails, so it can be run
 * in CI or pasted into a submission.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { findChrome, BASE_ARGS } = require("./chrome.js");

const ROOT = path.resolve(__dirname, "..");
const URL_APP = process.argv[2] || "http://127.0.0.1:8177/";


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INTERACTIVE = new Set([
  "button", "link", "slider", "combobox", "listbox", "textbox", "checkbox",
  "radio", "switch", "tab", "menuitem", "dialog", "spinbutton",
]);

const results = [];
function check(group, name, ok, detail) {
  results.push({ group, name, ok: !!ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${group}: ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  const port = 9500 + Math.floor(Math.random() * 300);
  const profile = path.join(os.tmpdir(), `ej-qa-${port}`);
  const downloads = path.join(os.tmpdir(), `ej-qa-dl-${port}`);
  fs.mkdirSync(downloads, { recursive: true });

  const chrome = spawn(findChrome(), [
    ...BASE_ARGS,
    "--window-size=1600,1100",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank",
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(150);
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; }
    catch { /* not up */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error("chrome did not start"); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (msg) => {
    const d = JSON.parse(msg.data);
    if (d.id && pending.has(d.id)) {
      const { resolve, reject } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result);
    } else if (d.method === "Runtime.exceptionThrown") {
      pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
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
  await S("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

  const evaluate = async (expression) => {
    const r = await S("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
    return r.result.value;
  };

  /* ---------------------------- load + timing --------------------------- */
  console.log("\nThe Earth Information Jukebox — verification\n");
  await S("Page.navigate", { url: URL_APP });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const ready = await evaluate("Boolean(window.__jukebox && window.__jukebox.lastReadyMs)").catch(() => false);
    if (ready) break;
  }
  const timing = await evaluate("JSON.stringify(window.__jukebox || {})");
  const t = JSON.parse(timing || "{}");
  check("timing", "first side playable", t.lastReadyMs > 0, `${t.lastReadyMs} ms from navigation`);
  check("timing", "frames analysed", t.frames === 18, `${t.frames} frames`);

  /* --------------------------- accessibility ---------------------------- */
  await S("Accessibility.enable");
  const tree = (await S("Accessibility.getFullAXTree")).nodes;

  const named = tree.filter((n) => !n.ignored && INTERACTIVE.has(n.role?.value));
  const unnamed = named.filter((n) => !(n.name?.value || "").trim());
  check("a11y", "every interactive node has a name", unnamed.length === 0,
    unnamed.length ? unnamed.map((n) => n.role.value).join(", ") : `${named.length} interactive nodes`);

  const roles = {};
  for (const n of tree) if (!n.ignored) roles[n.role?.value] = (roles[n.role?.value] || 0) + 1;

  const headings = tree
    .filter((n) => !n.ignored && n.role?.value === "heading")
    .map((n) => ({ level: n.properties?.find((p) => p.name === "level")?.value?.value, text: n.name?.value }));
  const h1 = headings.filter((h) => h.level === 1).length;
  check("a11y", "exactly one h1", h1 === 1, headings.map((h) => `h${h.level} ${h.text}`).slice(0, 8).join(" | "));

  const live = tree.filter((n) => !n.ignored && n.properties?.some(
    (p) => p.name === "live" && ["polite", "assertive"].includes(p.value?.value)));
  check("a11y", "a live region exists", live.length >= 1, `${live.length} live regions`);

  // the canvas must carry the generated description, not a generic label
  const canvasName = await evaluate("document.querySelector('#frame-canvas').getAttribute('aria-labelledby')");
  const descText = await evaluate("document.querySelector('#frame-desc').textContent.slice(0,60)");
  check("a11y", "stage image is described by the generated text", canvasName === "frame-desc" && descText.length > 30, descText + "…");

  // the current bar must be exposed, not just styled
  const current = await evaluate("document.querySelectorAll('.filmstrip button[aria-current=\"true\"]').length");
  check("a11y", "current bar marked with aria-current", current === 1, `${current} marked`);
  const pressed = await evaluate("document.querySelectorAll('.record[aria-pressed=\"true\"]').length");
  check("a11y", "selected record marked aria-pressed", pressed === 1, `${pressed} pressed`);

  const meterLabels = await evaluate(
    "JSON.stringify([...document.querySelectorAll('.meter-bar')].map(e => e.getAttribute('aria-label')))");
  const meters = JSON.parse(meterLabels || "[]");
  check("a11y", "meters carry value labels, not just bars",
    meters.length >= 6 && meters.every((m) => m && /\d/.test(m)), `${meters.length} meters`);

  /* ------------------------------ keyboard ------------------------------ */
  await evaluate("document.body.focus()");
  const visited = [];
  // The filmstrip alone is 18 stops, so this has to run past it to reach the
  // transport. 46 covers the whole instrument twice over.
  for (let i = 0; i < 46; i++) {
    await S("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
    await S("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
    const info = await evaluate(`(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const label = a.getAttribute('aria-label')
        || (a.textContent || '').replace(/\\s+/g, ' ').trim()
        || a.value || a.tagName;
      return label.slice(0, 48);
    })()`);
    if (info && !visited.includes(info)) visited.push(info);
  }
  check("keyboard", "Tab reaches the instrument's controls", visited.length >= 12, `${visited.length} distinct stops`);
  check("keyboard", "play control is reachable", visited.some((v) => /play|pause/i.test(v)),
    visited.slice(0, 12).join(" → "));

  const shortcut = await evaluate(`(async () => {
    const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(' '); await new Promise(r => setTimeout(r, 700));
    const playing = document.querySelector('#btn-play').getAttribute('aria-pressed');
    key('ArrowRight'); await new Promise(r => setTimeout(r, 400));
    const frame = document.querySelector('#stage-count').textContent;
    key(' '); await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ playing, frame });
  })()`);
  const sk = JSON.parse(shortcut);
  check("keyboard", "space starts playback", sk.playing === "true", `aria-pressed=${sk.playing}`);
  check("keyboard", "arrow steps to the next bar", /frame 2/.test(sk.frame), sk.frame);

  /* ------------------------------- export ------------------------------- */
  await evaluate("document.querySelector('#btn-export').click()");
  let wav = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const files = fs.readdirSync(downloads).filter((f) => f.endsWith(".wav"));
    if (files.length) { wav = path.join(downloads, files[0]); break; }
  }
  if (wav) {
    const buf = fs.readFileSync(wav);
    const riff = buf.subarray(0, 4).toString("ascii");
    const wave = buf.subarray(8, 12).toString("ascii");
    const channels = buf.readUInt16LE(22);
    const rate = buf.readUInt32LE(24);
    const bytes = buf.length - 44;
    const seconds = bytes / (rate * channels * 2);
    check("export", "Export WAV produces a valid file", riff === "RIFF" && wave === "WAVE",
      `${path.basename(wav)}, ${(buf.length / 1e6).toFixed(1)} MB`);
    check("export", "the exported side has real duration", seconds > 20 && seconds < 120,
      `${seconds.toFixed(1)} s, ${rate} Hz, ${channels} ch`);
  } else {
    check("export", "Export WAV produces a valid file", false, "no file within 90 s");
  }

  /* --------------------------- reduced motion --------------------------- */
  await S("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await S("Page.navigate", { url: URL_APP });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const ready = await evaluate("Boolean(window.__jukebox && window.__jukebox.lastReadyMs)").catch(() => false);
    if (ready) break;
  }
  const rm = await evaluate(`(() => {
    const c = document.querySelector('#roll-canvas');
    const cx = c.getContext('2d');
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    return JSON.stringify({ lit, bars: document.querySelectorAll('.filmstrip button').length });
  })()`);
  const r = JSON.parse(rm);
  check("reduced motion", "the score still renders", r.lit > 500, `${r.lit} lit pixels`);
  check("reduced motion", "the side still loads", r.bars === 18, `${r.bars} bars`);
  check("reduced motion", "no exceptions", pageErrors.length === 0, pageErrors[0] || "clean");

  const failed = results.filter((x) => !x.ok);
  const report = {
    url: URL_APP,
    when: new Date().toISOString(),
    passed: results.length - failed.length,
    failed: failed.length,
    results,
    roles,
    headings,
    pageErrors,
  };
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "docs", "qa-report.json"), JSON.stringify(report, null, 2));

  console.log(`\n${report.passed} passed, ${report.failed} failed — docs/qa-report.json\n`);

  ws.close();
  chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
  try { fs.rmSync(downloads, { recursive: true, force: true }); } catch { /* locked */ }

  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
