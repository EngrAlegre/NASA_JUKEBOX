#!/usr/bin/env node
/*
 * Record the instrument to a frame sequence.
 *
 * Launches Chromium, opens a record, presses play, then captures the page as
 * fast as CDP will hand frames over. Every frame is written with the wall-clock
 * milliseconds at which it was taken, so the editor can rebuild real timing
 * instead of assuming a frame rate the machine could not sustain.
 *
 *   node tools/record.js <url> <outDir> <seconds> [--play]
 *
 * Writes <outDir>/frame-00000.jpg ... and <outDir>/timing.json
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { findChrome, BASE_ARGS } = require("./chrome.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const play = args.includes("--play");
  const actionsArg = args.find((a) => a.startsWith("--actions="));
  const [url, outDir, secArg] = args.filter((a) => !a.startsWith("--"));
  if (!url || !outDir) {
    console.error("usage: node tools/record.js <url> <outDir> <seconds> [--play]");
    process.exit(2);
  }
  const seconds = Number(secArg || 15);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) {
    if (f.startsWith("frame-") || f === "timing.json") fs.unlinkSync(path.join(outDir, f));
  }

  const port = 9400 + Math.floor(Math.random() * 300);
  const profile = path.join(os.tmpdir(), `ej-rec-${port}`);
  const W = Number(process.env.REC_W || 1600);
  const H = Number(process.env.REC_H || 900);

  const chrome = spawn(findChrome(), [
    ...BASE_ARGS.filter((a) => a !== "--mute-audio"),
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--autoplay-policy=no-user-gesture-required",
    `--window-size=${W},${H}`,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    await sleep(150);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error("chrome did not expose CDP"); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  const frames = [];
  const pageIssues = [];
  let audioState = 'n/a';
  let capturing = false;
  let startMs = 0;
  let pageSession = null;   // acks must go to the page session, not the browser

  ws.onmessage = (msg) => {
    const d = JSON.parse(msg.data);
    if (d.id && pending.has(d.id)) {
      const { resolve, reject } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result);
      return;
    }
    if (d.method === "Runtime.exceptionThrown") {
      const x = d.params.exceptionDetails;
      pageIssues.push((x.exception && x.exception.description) || x.text || "exception");
    }
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
      pageIssues.push(d.params.args.map((a) => a.value || a.description || a.type).join(" "));
    }
    // A screencast frame is pushed, not requested. Write it and acknowledge so
    // Chrome sends the next one — without the ack the stream stalls.
    if (d.method === "Page.screencastFrame") {
      if (capturing) {
        const at = Date.now() - startMs;
        const name = `frame-${String(frames.length).padStart(5, "0")}.jpg`;
        try {
          fs.writeFileSync(path.join(outDir, name), Buffer.from(d.params.data, "base64"));
          frames.push({ file: name, ms: at });
        } catch { /* disk hiccup: drop the frame rather than the stream */ }
      }
      send("Page.screencastFrameAck", { sessionId: d.params.sessionId }, pageSession)
        .catch(() => {});
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  pageSession = sessionId;
  const S = (m, p) => send(m, p, sessionId);

  await S("Page.enable");
  await S("Runtime.enable");

  await S("Page.navigate", { url });

  // The app pauses itself when the tab reports itself hidden — right for a
  // listener who switches tabs, fatal for a recording. Ask Chrome to keep the
  // page focused and active, and shim the flags if it still dissents.
  try {
    await S("Emulation.setFocusEmulationEnabled", { enabled: true });
    await S("Page.setWebLifecycleState", { state: "active" });
  } catch { /* older builds lack one of these */ }

  // Wait for the side to be *composed*, not merely for the button to exist:
  // the play control is not disabled during load, so testing it alone lets the
  // click land on an empty bar list and the page then never starts.
  const READY = `(() => {
    const j = window.__jukebox;
    const b = document.querySelector('#btn-play');
    return !!(j && j.state && j.state.bars && j.state.bars.length > 2 && b && !b.disabled);
  })()`;
  let ready = false;
  for (let i = 0; i < 260; i++) {
    await sleep(150);
    const r = await S("Runtime.evaluate", { expression: READY, returnByValue: true });
    if (r.result && r.result.value) { ready = true; break; }
  }
  if (!ready) console.error("never became ready");

  // Navigation resets overrides, so this has to come after it. A 16:9 viewport
  // matters: the editor crops to 1080p and a 2.1:1 capture would lose the edges.
  await S("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(400);
  const vp = await S("Runtime.evaluate", {
    expression: "JSON.stringify([window.innerWidth, window.innerHeight])",
    returnByValue: true,
  });
  const [vw, vh] = JSON.parse(vp.result.value);

  const evalJson = async (expression) => {
    const r = await S("Runtime.evaluate", { expression, returnByValue: true });
    return r.result ? r.result.value : null;
  };
  const isPlaying = async () => evalJson("!!(window.__jukebox.state && window.__jukebox.state.playing)");

  if (play) {
    // One click, then verify by state. Never click twice on hope: the control is
    // a toggle, so a "retry" click while it is already playing pauses the take
    // and the whole recording shows a frozen instrument.
    await S("Runtime.evaluate", {
      expression: `(() => {
        const s = window.__jukebox.state;
        document.querySelector('#btn-play').click();
        if (s && s.ctx && s.ctx.state !== "running") s.ctx.resume();
      })()`,
      returnByValue: true,
    });
    await sleep(600);

    if (!(await isPlaying())) {
      // Genuinely not started (the click landed before the side was composed):
      // try a trusted input event once.
      const box = await evalJson(`(() => {
        const r = document.querySelector('#btn-play').getBoundingClientRect();
        return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      })()`);
      const { x, y } = JSON.parse(box);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await S("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      }
      await sleep(600);
    }

    audioState = await evalJson("window.__jukebox.state.ctx ? window.__jukebox.state.ctx.state : 'none'");
    if (!(await isPlaying())) console.error("PLAYBACK DID NOT START");
  }

  const clockAt = async () => evalJson("document.querySelector('#clock').textContent");
  const ctxTime = async () => evalJson("window.__jukebox.state.ctx ? window.__jukebox.state.ctx.currentTime : -1");

  let clockStart = await clockAt();
  const ctxStart = await ctxTime();

  if (actionsArg) {
    // Choreography runs inside the page: keyboard presses, toggles, export.
    // Fire-and-forget — the snippet schedules its own timers.
    const body = fs.readFileSync(actionsArg.slice("--actions=".length), "utf8");
    await S("Runtime.evaluate", {
      expression: `(() => { ${body} })()`,
      awaitPromise: false,
      returnByValue: false,
    });
  }

  await S("Runtime.evaluate", {
    expression: `(() => {
      // Recording shim: without this the app pauses ~2 s in and the take shows
      // a frozen instrument while the audio clock keeps running.
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      window.__raf = 0;
      (function tick() { window.__raf++; requestAnimationFrame(tick); })();
      // Trap the exact moment the transport flips to paused, with a stack, so a
      // stray pause() cannot be guessed at from the outside.
      const ST = window.__jukebox.state;
      let pv = ST.playing;
      Object.defineProperty(ST, 'playing', {
        configurable: true,
        get: () => pv,
        set: (nv) => {
          if (nv === false && window.__pauseStack === undefined) {
            window.__pauseStack = new Error('paused').stack;
          }
          pv = nv;
        },
      });
      window.__samples = [];
      window.__errs = [];
      window.addEventListener('error', (e) => window.__errs.push('error: ' + e.message));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push('reject: ' + e.reason));
      window.__sampTimer = setInterval(() => {
        const st = window.__jukebox.state;
        window.__samples.push([
          document.querySelector('#clock').textContent,
          document.querySelector('#stage-count').textContent,
          window.__raf,
          st.playing ? 1 : 0,
          st.scheduled,
          st.bars ? st.bars.length : -1,
          st.timeline ? st.timeline.length : -1,
          st.ctx ? Number(st.ctx.currentTime.toFixed(1)) : -1,
          st.loop ? 1 : 0,
        ]);
      }, 400);
    })()`,
    returnByValue: true,
  });

  startMs = Date.now();
  capturing = true;
  await S("Page.startScreencast", {
    format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1,
  });

  while (Date.now() - startMs < seconds * 1000) await sleep(100);

  await S("Page.stopScreencast");
  capturing = false;
  const t0 = startMs;

  const sampRes = await S("Runtime.evaluate", {
    expression: `(() => { clearInterval(window.__sampTimer);
      return JSON.stringify({ samples: window.__samples || [], errs: window.__errs || [],
        pauseStack: window.__pauseStack || null }); })()`,
    returnByValue: true,
  });
  const clockEnd = await clockAt();
  const ctxEnd = await ctxTime();
  const elapsed = (Date.now() - t0) / 1000;
  if (play && ctxEnd - ctxStart < elapsed * 0.8) {
    console.error(`AUDIO CLOCK LAGGED: ${(ctxEnd - ctxStart).toFixed(1)}s in ${elapsed.toFixed(1)}s of capture`);
  }
  if (play && clockStart === clockEnd) {
    console.error(`TRANSPORT DID NOT MOVE: clock stuck at ${clockStart}`);
  }
  const timing = {
    url, play, width: vw, height: vh,
    frames: frames.length,
    seconds: Number(elapsed.toFixed(2)),
    clockStart, clockEnd, audioState,
    ctxSeconds: Number((ctxEnd - ctxStart).toFixed(2)),
    samples: (JSON.parse(sampRes.result.value || '{}').samples) || [],
    errors: (JSON.parse(sampRes.result.value || '{}').errs) || [],
    pageIssues,
    pauseStack: (JSON.parse(sampRes.result.value || '{}').pauseStack) || null,
    fps: Number((frames.length / elapsed).toFixed(2)),
    frameList: frames,
  };
  fs.writeFileSync(path.join(outDir, "timing.json"), JSON.stringify(timing, null, 1));

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* windows lock */ }

  console.log(JSON.stringify({ out: outDir, frames: frames.length, seconds: timing.seconds, fps: timing.fps }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
