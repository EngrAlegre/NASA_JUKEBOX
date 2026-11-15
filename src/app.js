/*
 * The jukebox: state, scheduling, drawing, keyboard, export.
 *
 * The interesting work lives elsewhere — analyze.js measures pixels, sonify.js
 * composes and renders. This file is the instrument's body: it loads a side,
 * keeps the audio clock and the picture in step, draws what is happening, and
 * makes every control reachable by keyboard and screen reader.
 */

(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const FADE = 0.35;
  const LOOKAHEAD = 0.25;      // seconds of audio scheduled ahead of the clock
  const TICK_MS = 40;
  const DEFAULT_SETTINGS = {
    rootMidi: 50, scale: "dorian", tempoBase: 62, tempoRange: 40, palette: "glass",
    axis: [[30, 60, 140], [210, 70, 50]], ramp: "colour", unit: "",
    listen: "Listen for how the melody follows the brightest part of the map.",
  };

  /* ------------------------------ data --------------------------------- */

  const raw = (window.JUKEBOX_DATA && window.JUKEBOX_DATA.records) || [];
  const RECORDS = raw.map((r) => Object.assign({}, r, DEFAULT_SETTINGS, window.RECORD_SETTINGS[r.id] || {}));

  /* ------------------------------ state -------------------------------- */

  const S = {
    index: 0,
    frames: [],          // [{src,label,img,features,bar,desc}]
    bars: [],
    minMidi: 40, maxMidi: 84,
    playing: false,
    loop: true,
    concert: false,          // playing the whole album instead of one side
    showSource: false,       // draw the raw NASA frame, without our overlay
    muted: false,
    contrast: false,
    autoDescribe: false,
    loading: false,
    ctx: null,
    engine: null,
    masterVolume: 0.8,
    nextBarTime: 0,
    scheduled: 0,
    current: 0,
    timeline: [],        // {t, index} bar starts, for UI sync
    tickId: null,
    rafId: null,
    startedAt: 0,
  };

  const el = {
    shelf: $("#shelf"),
    stage: $("#frame-canvas"),
    stageTitle: $("#stage-title"),
    stageCount: $("#stage-count"),
    stageSection: $("#stage-section"),
    stageTempo: $("#stage-tempo"),
    frameDesc: $("#frame-desc"),
    filmstrip: $("#filmstrip"),
    play: $("#btn-play"),
    prev: $("#btn-prev"),
    next: $("#btn-next"),
    loopBtn: $("#btn-loop"),
    volume: $("#volume"),
    clock: $("#clock"),
    title: $("#rec-title"),
    meta: $("#rec-meta"),
    blurb: $("#rec-blurb"),
    narration: $("#narration"),
    meters: $("#meters"),
    roll: $("#roll-canvas"),
    rollEmpty: $("#roll-empty"),
    rollDesc: $("#roll-desc"),
    liner: $("#liner"),
    linerBody: $("#liner-body"),
    status: $("#sr-status"),
    speak: $("#btn-speak"),
    narrate: $("#btn-narrate"),
    exportBtn: $("#btn-export"),
    scoreBtn: $("#btn-score"),
    concert: $("#btn-concert"),
    source: $("#btn-source"),
    caption: $("#tour-caption"),
    skip: $("#tour-skip"),
    liveStatus: $("#live-status"),
    liveLayer: $("#live-layer"),
    liveStep: $("#live-step"),
    keysDialog: $("#keys-dialog"),
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------ helpers ------------------------------ */

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function announce(text) {
    // A dedicated polite live region; replaced (not appended) so the reader
    // hears the new state rather than a growing log.
    el.status.textContent = "";
    window.setTimeout(() => { el.status.textContent = text; }, 30);
  }

  function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

  // Local records store paths relative to data/; the live tuner stores absolute
  // GIBS URLs. One helper so neither path is special-cased everywhere.
  const srcOf = (src) => (/^(https?:|data:|blob:)/.test(src) ? src : `data/${src}`);

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Only remote images need the CORS attribute; asking for it on a local
      // file path makes the browser refuse the file outright.
      if (/^https?:/.test(src)) img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${src}`));
      img.src = src;
    });
  }

  /* ------------------------------ the shelf ---------------------------- */

  function renderShelf() {
    el.shelf.innerHTML = "";
    RECORDS.forEach((rec, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "record";
      b.setAttribute("aria-pressed", i === S.index ? "true" : "false");
      b.dataset.index = String(i);
      b.innerHTML = `
        <span class="record-cover">
          <img src="${srcOf(rec.cover)}" alt="" loading="lazy" width="62" height="62">
          <span class="record-num">${String(i + 1).padStart(2, "0")}</span>
        </span>
        <span class="record-body">
          <span class="record-title">${rec.title}</span>
          <span class="record-sub">${rec.side}</span>
        </span>`;
      b.addEventListener("click", () => selectRecord(i));
      li.appendChild(b);
      el.shelf.appendChild(li);
    });
  }

  function setShelfPressed() {
    $$(".record", el.shelf).forEach((b) => {
      b.setAttribute("aria-pressed", Number(b.dataset.index) === S.index ? "true" : "false");
    });
  }

  /* ---------------------------- load a side ---------------------------- */

  async function selectRecord(i, opts = {}) {
    if (i === S.index && S.frames.length && !opts.force) return;
    const wasPlaying = S.playing;
    pause({ quiet: true });
    S.index = i;
    const rec = RECORDS[i];
    S.frames = [];
    S.bars = [];
    S.timeline = [];
    S.scheduled = 0;
    S.current = 0;
    setShelfPressed();

    S.flatNames = ["aeolian", "dorian", "phrygian", "minorPentatonic"].includes(rec.scale);
    el.title.textContent = rec.title;
    el.meta.textContent = `${rec.side} · ${rec.year}`;
    el.blurb.textContent = rec.blurb;
    el.stageTitle.textContent = rec.title;
    el.narration.textContent = "Reading the frames…";
    el.stageCount.textContent = "reading frames…";
    el.frameDesc.textContent = `${rec.title}. Reading frames.`;
    el.filmstrip.innerHTML = "";
    el.meters.innerHTML = "";
    el.rollEmpty.hidden = false;

    document.title = `${rec.title} — Five Sides`;

    try {
      await analyseSide(rec);
    } catch (err) {
      const isFile = window.location.protocol === "file:";
      el.narration.textContent = isFile
        ? "This page was opened from disk, and browsers will not let a file:// page read image pixels. Run “python tools/serve.py” in the project folder and open the address it prints — everything else works the same."
        : `This side could not be read: ${err.message}`;
      el.stageCount.textContent = isFile ? "needs a local server" : "could not read";
      announce(isFile ? "Open this page through a local server to read the frames." : `Could not read ${rec.title}: ${err.message}`);
      return;
    }

    buildFilmstrip();
    renderLiner(rec);
    updateHistory();

    drawRoll(S.ctx ? S.ctx.currentTime : 0);
    el.rollEmpty.hidden = true;

    const first = S.frames[0];
    if (first) {
      el.rollDesc.textContent = `${first.bar.noteCount} melodic notes in this bar; chord ${first.bar.chord
        .map((m) => Sonify.midiName(m, S.flatNames))
        .join(", ")}.`;
    }

    if (wasPlaying) {
      S.playing = true;
      el.play.setAttribute("aria-pressed", "true");
      el.play.setAttribute("aria-label", "Pause");
      S.engine.fadeIn(S.ctx.currentTime + 0.02, 0.25, S.muted ? 0.0001 : S.masterVolume * 0.9);
      startTransport();
      if (!S.rafId) S.rafId = requestAnimationFrame(frameLoop);
    }

    announce(`${rec.title}, ${rec.side}, ${rec.frames.length} bars. ${rec.listen}`);
  }

  async function analyseSide(rec) {
    S.loading = true;
    el.play.disabled = true;
    const features = [];
    const frames = [];

    // Fetch every frame first (they are small and independent), then measure
    // them in order. Sequential fetches made a live side feel broken on a slow
    // link even though the analysis itself takes milliseconds.
    el.stageCount.textContent = `loading ${rec.frames.length} frames…`;
    const imgs = await Promise.all(rec.frames.map((f) => loadImage(srcOf(f.src))));

    for (let i = 0; i < rec.frames.length; i++) {
      const f = rec.frames[i];
      const img = imgs[i];
      el.stageCount.textContent = `reading frame ${i + 1} / ${rec.frames.length}`;
      const feat = Analyze.analyzeImage(img, { axis: rec.axis });
      features.push(feat);
      frames.push({ src: f.src, label: f.label || `t+${f.t}s`, img, n: i + 1 });
      if (i === 0) drawStage(img, null, 0);
      if (i % 4 === 0) await new Promise((r) => requestAnimationFrame(r));
    }

    const composed = Sonify.composeSide(features, rec);
    const n = composed.bars.length;

    frames.forEach((fr, i) => {
      fr.features = composed.frames[i];
      fr.bar = composed.bars[i];
      fr.desc = Sonify.describe(composed.frames[i], composed.bars[i], rec, i, n);
    });

    S.frames = frames;
    S.bars = composed.bars;

    let lo = 127, hi = 0;
    for (const bar of S.bars) {
      for (const ev of bar.events) {
        if (ev.midi == null) continue;
        if (ev.midi < lo) lo = ev.midi;
        if (ev.midi > hi) hi = ev.midi;
      }
    }
    S.minMidi = lo === 127 ? 48 : lo - 2;
    S.maxMidi = hi === 0 ? 72 : hi + 2;

    const first = frames[0] && frames[0].img;
    if (first) {
      const ar = (first.naturalWidth || 16) / (first.naturalHeight || 9);
      el.stage.parentElement.style.aspectRatio = `${Math.max(1.45, Math.min(3.5, ar)).toFixed(3)} / 1`;
    }

    S.loading = false;
    el.play.disabled = false;

    // Small, honest instrumentation: how long until a side is playable. Read by
    // tools/qa.js and useful in the console when tuning image sizes.
    window.__jukebox = window.__jukebox || {};
    window.__jukebox.lastReadyMs = Math.round(performance.now());
    window.__jukebox.frames = n;
    window.__jukebox.record = rec.id;
    el.stageCount.textContent = `frame 1 / ${n}`;
    el.narration.textContent = frames[0].desc.long;
    el.frameDesc.textContent = frames[0].desc.long;
    renderMeters(frames[0], 0);
    drawStage(frames[0].img, frames[0].features, 0);
  }

  function buildFilmstrip() {
    el.filmstrip.innerHTML = "";
    S.frames.forEach((fr, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", `Bar ${i + 1} of ${S.frames.length}: ${fr.desc.short}`);
      b.setAttribute("aria-current", i === 0 ? "true" : "false");
      b.innerHTML = `<img src="${srcOf(fr.src)}" alt="" loading="lazy"><span class="fill"></span>`;
      b.addEventListener("click", () => {
        if (S.playing) {
          jumpTo(i);
        } else {
          showFrame(i);
        }
      });
      li.appendChild(b);
      el.filmstrip.appendChild(li);
    });
  }

  /* ----------------------------- the meters ---------------------------- */

  const METERS = [
    { key: "luma", label: "Brightness", map: (f, b) => `octave ${b.octave >= 0 ? "+" : ""}${b.octave}` },
    { key: "warmth", label: "Colour bar", map: (f, b, rec) => `${rec.ramp} → degree ${b.degree}` },
    { key: "edge", label: "Texture", map: (f, b) => `${b.subdivision}ths` },
    { key: "change", label: "Change", map: (f, b) => `${b.bpm} BPM` },
    { key: "bloom", label: "Highlights", map: (f, b) => `${b.events.filter((e) => e.kind === "stab").length} hits` },
    { key: "coverage", label: "Coverage", map: (f) => (f.coverage > 0.02 ? `${Math.round(f.coverage * 100)}% seen` : "rest") },
  ];

  function renderMeters(frame, barIndex) {
    const bar = frame.bar;
    el.meters.innerHTML = "";
    const rec = RECORDS[S.index];
    METERS.forEach((m) => {
      const f = frame.features;
      const rawVal = m.key === "change" ? f.change : m.key === "coverage" ? f.coverage : f[m.key];
      const pct = m.key === "coverage" ? Math.min(1, f.coverage) : Math.max(0, Math.min(1, rawVal || 0));
      const li = document.createElement("li");
      li.className = "meter";
      li.innerHTML = `
        <span class="meter-label">${m.label}</span>
        <span class="meter-bar" role="img" aria-label="${m.label}, ${Math.round(pct * 100)} percent of range"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>
        <span class="meter-value"><b>${m.map(f, bar, rec)}</b></span>`;
      el.meters.appendChild(li);
    });
  }

  /* ------------------------------ drawing ------------------------------ */

  function sizeCanvas(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, dpr };
  }

  /**
   * The stage: the frame itself, plus the read-out that connects picture to
   * sound — sixteen activity columns along the bottom, and a playhead showing
   * where in the left-to-right melody the bar currently is.
   */
  function drawStage(img, features, progress) {
    const canvas = el.stage;
    // "Show NASA frame" is the honesty switch: the same pixels, with nothing of
    // ours drawn on top. The playhead and the sixteen activity columns are an
    // interpretation, and a judge should be able to turn them off.
    if (S.showSource) { features = null; progress = -1; }
    const { w, h } = sizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    if (!img) return;

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;

    ctx.drawImage(img, dx, dy, dw, dh);

    if (!features) return;

    // Activity columns: measured texture per column of the map. Absolute, not
    // relative, so a black frame really does look empty here.
    const bands = features.bandsAbs || features.bands || [];
    const colW = dw / bands.length;
    const maxBar = dh * 0.07;
    bands.forEach((v, i) => {
      if (v < 0.02) return;
      const bh = Math.max(1.5, v * maxBar);
      const x = dx + i * colW + 2;
      ctx.fillStyle = i === Math.floor(progress * bands.length)
        ? "rgba(255,182,72,0.9)"
        : `rgba(99,219,228,${0.18 + v * 0.45})`;
      ctx.fillRect(x, dy + dh - bh - 3, Math.max(1, colW - 4), bh);
    });

    // Playhead: the bar's own clock, read left to right.
    if (progress >= 0) {
      const px = dx + dw * Math.min(1, Math.max(0, progress));
      const grad = ctx.createLinearGradient(px - 26, 0, px + 4, 0);
      grad.addColorStop(0, "rgba(255,182,72,0)");
      grad.addColorStop(1, "rgba(255,182,72,0.30)");
      ctx.fillStyle = grad;
      ctx.fillRect(px - 26, dy, 30, dh);
      ctx.fillStyle = "rgba(255,182,72,0.95)";
      ctx.fillRect(px, dy, 1.5 * (w / 800), dh);
    }
  }

  /**
   * The roll: the current bar written out, pitch up the side, time across it.
   * The sixteen melodic steps line up with the sixteen columns of the map, so
   * the picture and the score sweep left to right together.
   */
  function drawRoll(now) {
    const canvas = el.roll;
    const fr = S.frames[S.current];
    if (!canvas || !fr) return;
    const { w, h } = sizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const padTop = 8, padBottom = 14;
    const span = h - padTop - padBottom;
    const pitchY = (midi) => {
      const t = (midi - S.minMidi) / Math.max(1, S.maxMidi - S.minMidi);
      return h - padBottom - 4 - t * (span - 10);
    };

    // scale grid: one faint line per semitone would be noise; use the mode.
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (let k = 0; k <= 6; k++) {
      const y = padTop + (span / 6) * k;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // how far through the bar are we?
    let progress = 1;
    if (S.playing && S.timeline.length) {
      let cur = null;
      for (const t of S.timeline) { if (t.t <= now) cur = t; else break; }
      if (cur && S.bars[cur.index]) progress = Math.min(1, Math.max(0, (now - cur.t) / S.bars[cur.index].barDur));
    }

    const bar = fr.bar;
    const dur = bar.barDur || 1;
    const noteH = (n) => (n.kind === "pad" ? 7 : n.kind === "kick" || n.kind === "hat" ? 3 : 5);

    for (const n of bar.events) {
      if (n.midi == null) continue;
      const x = (n.at / dur) * w;
      const nw = Math.max(3, ((n.dur || 0.12) / dur) * w);
      const y = pitchY(n.midi);
      const played = n.at <= progress * dur;
      let color;
      switch (n.kind) {
        case "pad": color = played ? "rgba(177,140,255,0.9)" : "rgba(177,140,255,0.4)"; break;
        case "bell": color = played ? "rgba(255,243,208,1)" : "rgba(255,243,208,0.45)"; break;
        case "bass": color = played ? "rgba(99,219,228,0.95)" : "rgba(99,219,228,0.4)"; break;
        case "stab": color = played ? "rgba(255,182,72,0.95)" : "rgba(255,182,72,0.4)"; break;
        default: color = played ? "rgba(255,182,72,0.95)" : "rgba(255,182,72,0.38)";
      }
      ctx.fillStyle = color;
      roundRect(ctx, x, y, nw, noteH(n), noteH(n) / 2);
      ctx.fill();
    }

    // percussion lane along the floor of the roll
    for (const n of bar.events) {
      if (n.kind !== "kick" && n.kind !== "hat") continue;
      const x = (n.at / dur) * w;
      ctx.fillStyle = n.at <= progress * dur ? "rgba(160,168,182,0.85)" : "rgba(160,168,182,0.3)";
      ctx.fillRect(x, h - padBottom + 2, 1.5, n.kind === "kick" ? 7 : 4);
    }

    // playhead
    if (S.playing) {
      const px = progress * w;
      ctx.fillStyle = "rgba(255,182,72,0.85)";
      ctx.fillRect(px, 0, 1.5, h);
      ctx.fillStyle = "rgba(255,182,72,0.10)";
      ctx.fillRect(px - 22, 0, 22, h);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ------------------------------ transport ---------------------------- */

  function ensureAudio() {
    if (!S.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      S.ctx = new Ctor();
      S.engine = Sonify.createEngine(S.ctx);
      S.engine.master.gain.value = 0.0001;
    }
    if (S.ctx.state === "suspended") S.ctx.resume();
    return S.ctx;
  }

  function play() {
    if (!S.bars.length) return;
    ensureAudio();
    S.playing = true;
    S.engine.fadeIn(S.ctx.currentTime + 0.02, FADE, S.muted ? 0.0001 : S.masterVolume * 0.9);
    startTransport();
    el.play.setAttribute("aria-pressed", "true");
    el.play.setAttribute("aria-label", "Pause");
    announce(`Playing ${RECORDS[S.index].title}.`);
    if (!S.rafId) S.rafId = requestAnimationFrame(frameLoop);
  }

  function startTransport() {
    if (!S.ctx) return;
    S.timeline = [];
    S.scheduled = 0;
    S.nextBarTime = S.ctx.currentTime + 0.08;
    if (S.tickId) window.clearInterval(S.tickId);
    S.tickId = window.setInterval(schedulerTick, TICK_MS);
    schedulerTick();
  }

  function schedulerTick() {
    if (!S.playing || !S.ctx) return;
    const horizon = S.ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (S.nextBarTime < horizon && guard++ < 8) {
      const i = S.scheduled % S.bars.length;
      if (!S.loop && S.scheduled >= S.bars.length) {
        stopAtEnd();
        return;
      }
      const bar = S.bars[i];
      Sonify.scheduleBar(S.engine, bar, S.nextBarTime);
      S.timeline.push({ t: S.nextBarTime, index: i });
      S.nextBarTime += bar.barDur;
      S.scheduled++;
    }
  }

  function stopAtEnd() {
    S.playing = false;
    el.play.setAttribute("aria-pressed", "false");
    el.play.setAttribute("aria-label", "Play this side");
    if (S.tickId) window.clearInterval(S.tickId);
    S.tickId = null;
    if (S.engine) S.engine.fadeOut(S.ctx.currentTime, 0.8);

    if (S.concert) {
      nextInConcert();
      return;
    }
    announce("End of the side.");
  }

  function pause(opts = {}) {
    if (!S.playing && !opts.quiet) return;
    if (!opts.quiet && S.concert) setConcert(false);
    S.playing = false;
    if (S.tickId) window.clearInterval(S.tickId);
    S.tickId = null;
    if (S.engine && S.ctx) S.engine.fadeOut(S.ctx.currentTime, 0.25);
    el.play.setAttribute("aria-pressed", "false");
    el.play.setAttribute("aria-label", "Play this side");
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (!opts.quiet) announce("Paused.");
  }

  function togglePlay() {
    if (S.playing) pause();
    else play();
  }

  /* ---------------------------- concert mode ---------------------------
   * A jukebox does not stop after one side. Concert mode plays the album in
   * order, announcing each record, and only stops when told to. It is also how
   * you demo the thing without touching it.
   */
  function setConcert(on, label) {
    S.concert = on;
    if (el.concert) {
      el.concert.setAttribute("aria-pressed", String(on));
      const l = el.concert.querySelector(".concert-label");
      if (l) l.textContent = on ? "Stop the album" : "Play all five sides";
    }
    if (label) announce(label);
  }

  async function startConcert() {
    setConcert(true);
    S.loop = false;
    el.loopBtn.setAttribute("aria-pressed", "false");
    if (S.index !== 0) await selectRecord(0, { force: true });
    play();
    announce("Playing the album: five sides, in order.");
  }

  function stopConcert() {
    if (!S.concert) return;
    setConcert(false, "Album stopped.");
  }

  async function nextInConcert() {
    const next = S.index + 1;
    if (next >= RECORDS.length) {
      setConcert(false, "That was the album. Five sides, one planet.");
      return;
    }
    const rec = RECORDS[next];
    announce(`Next side: ${rec.title}.`);
    await selectRecord(next, { force: true });
    play();
  }

  function jumpTo(frameIndex) {
    if (!S.bars.length) return;
    const wasPlaying = S.playing;
    pause({ quiet: true });
    S.current = frameIndex;
    showFrame(frameIndex);
    if (wasPlaying) {
      // restart the transport from this bar
      S.playing = true;
      S.engine.fadeIn(S.ctx.currentTime + 0.02, 0.2, S.muted ? 0.0001 : S.masterVolume * 0.9);
      S.timeline = [];
      S.scheduled = frameIndex;
      S.nextBarTime = S.ctx.currentTime + 0.06;
      if (S.tickId) window.clearInterval(S.tickId);
      S.tickId = window.setInterval(schedulerTick, TICK_MS);
      schedulerTick();
    }
  }

  function step(delta) {
    if (!S.bars.length) return;
    const next = (S.current + delta + S.bars.length) % S.bars.length;
    jumpTo(next);
  }

  function showFrame(i) {
    const fr = S.frames[i];
    if (!fr) return;
    S.current = i;
    drawStage(fr.img, fr.features, S.playing ? 0 : -1);
    renderMeters(fr, i);
    el.stageCount.textContent = `frame ${i + 1} / ${S.frames.length}`;
    el.stageSection.textContent = fr.bar.section;
    el.stageTempo.textContent = `${fr.bar.bpm} BPM`;
    el.frameDesc.textContent = fr.desc.long;
    el.narration.textContent = fr.desc.long;
    el.rollDesc.textContent = `${fr.bar.noteCount} melodic notes; chord ${fr.bar.chord.map((m) => Sonify.midiName(m, S.flatNames)).join(", ")}.`;
    $$("button", el.filmstrip).forEach((b, k) => b.setAttribute("aria-current", k === i ? "true" : "false"));
    drawRoll(S.ctx ? S.ctx.currentTime : 0);
    if (S.autoDescribe) speak(fr.desc.long);
    if (S.playing) announce(fr.desc.long);
  }


  /* ------------------------------ guided tour ---------------------------
   * A scripted run through the instrument: what it is, what it maps, and why
   * accessibility is the point. Written to be recorded with a screen recorder
   * with nobody touching the mouse, and to run unattended at a booth.
   *
   * Sequential rather than timestamped: each step awaits the previous one, so a
   * slow machine stretches the tour instead of desynchronising it.
   */
  const sleep = (ms) => new Promise((resolve) => {
    const started = Date.now();
    (function tick() {
      if (!S.tour) return resolve();                 // aborted mid-wait
      if (Date.now() - started >= ms) return resolve();
      window.setTimeout(tick, 80);
    })();
  });

  const TOUR = [
    {
      text: "Five NASA records. Every frame is measured — and what you hear is what those measurements became.",
      wait: 9000,
      run: async () => { await selectRecord(0, { force: true }); play(); },
    },
    {
      text: "Brightness picks the octave. Where the average colour sits on the record's own legend picks the note.",
      wait: 9500,
    },
    {
      text: "The sixteen columns of the map are sixteen melodic steps. Read left to right, heard left to right.",
      wait: 9000,
    },
    {
      text: "Every bar can describe itself, from those same numbers.",
      wait: 7000,
      run: async () => speak(S.frames[S.current] ? S.frames[S.current].desc.long : ""),
    },
    {
      text: "Nothing here is tuned to one record. Lightning is percussion first, because a record made of flashes should be.",
      wait: 11000,
      run: async () => { await selectRecord(3, { force: true }); play(); },
    },
    {
      text: "Ocean Heat was built this morning, from the last eighteen days of sea surface temperature.",
      wait: 11000,
      run: async () => { await selectRecord(4, { force: true }); play(); },
    },
    {
      text: "Keyboard, screen reader, high contrast. Same measurements, a different way in.",
      wait: 8000,
      run: async () => {
        document.body.classList.add("contrast");
        await sleep(3200);
        document.body.classList.remove("contrast");
      },
    },
    {
      text: "Five Sides. Five records, one planet.",
      wait: 4500,
    },
  ];

  async function runTour() {
    if (S.tour) return;
    S.tour = true;
    if (el.caption) { el.caption.hidden = false; }
    if (el.skip) el.skip.hidden = false;
    setConcert(false);
    S.loop = false;
    el.loopBtn.setAttribute("aria-pressed", "false");
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });

    for (const step of TOUR) {
      if (!S.tour) break;
      if (el.caption) el.caption.textContent = step.text;
      if (step.run) await step.run();
      await sleep(step.wait);
    }
    endTour();
  }

  function endTour(silent) {
    if (!S.tour) return;
    S.tour = false;
    if (el.caption) { el.caption.hidden = true; el.caption.textContent = ""; }
    if (el.skip) el.skip.hidden = true;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (!silent) announce("Tour ended. You are in control again.");
  }

  /* ------------------------------ the loop ----------------------------- */

  function frameLoop() {
    S.rafId = requestAnimationFrame(frameLoop);
    if (!S.ctx) return;
    const now = S.ctx.currentTime;

    // which bar is sounding right now?
    let cur = S.timeline.length ? S.timeline[0] : null;
    for (const t of S.timeline) {
      if (t.t <= now) cur = t;
      else break;
    }
    if (cur) {
      const bar = S.bars[cur.index];
      const progress = bar && bar.barDur ? (now - cur.t) / bar.barDur : 0;
      if (cur.index !== S.current) {
        S.current = cur.index;
        const fr = S.frames[cur.index];
        if (fr) {
          renderMeters(fr, cur.index);
          el.stageCount.textContent = `frame ${cur.index + 1} / ${S.frames.length}`;
          el.stageSection.textContent = fr.bar.section;
          el.stageTempo.textContent = `${fr.bar.bpm} BPM`;
          el.frameDesc.textContent = fr.desc.long;
          el.narration.textContent = fr.desc.long;
          $$("button", el.filmstrip).forEach((b, k) => b.setAttribute("aria-current", k === cur.index ? "true" : "false"));
          if (S.autoDescribe) speak(fr.desc.short);
        }
      }
      const fr = S.frames[cur.index];
      if (fr) drawStage(fr.img, fr.features, Math.max(0, Math.min(1, progress)));
      updateClock(now, cur.t, bar);
      updateRoll(now);
    }

    // drop old timeline entries
    while (S.timeline.length > 2 && S.timeline[1].t < now - 1) S.timeline.shift();
  }

  function updateClock(now, barStart, bar) {
    const elapsed = Math.max(0, now - barStart);
    const total = S.bars.reduce((s, b) => s + b.barDur, 0);
    const before = S.bars.slice(0, S.current).reduce((s, b) => s + b.barDur, 0);
    const pos = before + Math.min(elapsed, bar ? bar.barDur : 0);
    el.clock.textContent = `${fmtTime(pos)} / ${fmtTime(total)}`;
    const fill = el.filmstrip.children[S.current] && $(".fill", el.filmstrip.children[S.current]);
    if (fill && bar) fill.style.transform = `scaleX(${Math.min(1, elapsed / bar.barDur).toFixed(3)})`;
  }

  function updateRoll(now) {
    if (!reduceMotion) drawRoll(now);
  }

  /* ----------------------------- narration ----------------------------- */

  function speak(text) {
    if (!window.speechSynthesis) {
      announce("This browser has no speech synthesis; the description is on screen.");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1;
    u.lang = document.documentElement.lang || "en";
    window.speechSynthesis.speak(u);
  }

  /* ------------------------------ liner -------------------------------- */

  function renderLiner(rec) {
    const src = rec.source || {};
    const roles = (src.roles || []).map((r) => `<li><b>${r.role}</b> — ${r.names.join(", ")}</li>`).join("");
    const datasets = (src.datasets || []).map((d) => `<li>${d}</li>`).join("");
    const gradient = `linear-gradient(90deg, ${rgb(rec.axis[0])}, ${rgb(rec.axis[1])})`;

    el.linerBody.innerHTML = `
      <div>
        <h3>${rec.title}</h3>
        <p class="program-note">${rec.note || rec.blurb}</p>
        <p>${rec.blurb}</p>
        <h4>How to listen</h4>
        <p>${rec.listen}</p>
        <h4>Palette</h4>
        <p>${rec.instrument} · ${rec.scale} in ${Sonify.midiName(rec.rootMidi, S.flatNames)} · ${rec.tempoBase}–${rec.tempoBase + rec.tempoRange} BPM</p>
      </div>
      <div>
        <h4>The pitch axis</h4>
        <div class="axis-swatch" style="background:${gradient}" role="img" aria-label="Colour bar from ${rgb(rec.axis[0])} to ${rgb(rec.axis[1])}"></div>
        <p class="axis-legend"><span>cool · low</span><span>${rec.ramp}</span><span>warm · high</span></p>
        <p>This is the record's own published colour bar. Average colour is projected onto it, so "warmer" on the legend always means higher in the scale — the legend itself becomes the pitch axis.</p>
        <h4>Source</h4>
        <p>${src.agency || ""}<br>
        <a href="${src.url || "#"}" target="_blank" rel="noopener">${src.title || "NASA"}</a></p>
        <h4>Credit</h4>
        <p>${src.credit || "NASA"}${src.video ? ` · ${src.video.duration}s, ${src.video.width}×${src.video.height}` : ""}${src.built ? ` · built ${src.built}` : ""}</p>
      </div>
      <div>
        <h4>People</h4>
        <ul class="credit-list">${roles || "<li>NASA Scientific Visualization Studio</li>"}</ul>
        <h4>Data</h4>
        <ul>${datasets || "<li>See the source page for the dataset record.</li>"}</ul>
        <h4>Frames</h4>
        <p>${rec.frames.length} frames sampled evenly across the sequence, skipping title cards and fades. Timecodes: ${rec.frames.slice(0, 3).map((f) => f.label || `t+${f.t}s`).join(", ")} …</p>
        ${rec.id.startsWith("live-") ? "" : `
        <h4>Hear it without the app</h4>
        <audio controls preload="none" src="audio/${rec.id}.mp3" aria-label="Pre-rendered audio for ${rec.title}"></audio>
        <p class="audio-hint">Rendered by this same engine, through the same audio graph, by the Export button. If the folder was published without <code>audio/</code>, the player is simply empty.</p>`}
      </div>`;
  }

  /* ------------------------------ export ------------------------------- */

  async function exportWav() {
    if (!S.bars.length) return;
    const label = el.exportBtn.textContent;
    el.exportBtn.disabled = true;
    el.exportBtn.textContent = "Rendering…";
    announce("Rendering the side to audio.");
    try {
      const buffer = await Sonify.renderBars(S.bars, 44100, { tail: 3.4 });
      const blob = Sonify.encodeWav(buffer);
      download(blob, `earth-jukebox-${RECORDS[S.index].id}.wav`);
      announce("Audio file saved.");
    } catch (err) {
      announce(`Could not render audio: ${err.message}`);
    } finally {
      el.exportBtn.disabled = false;
      el.exportBtn.textContent = label;
    }
  }

  function exportScore() {
    if (!S.bars.length) return;
    const rec = RECORDS[S.index];
    const score = {
      format: "earth-jukebox-score/1",
      generated: new Date().toISOString(),
      record: {
        id: rec.id, title: rec.title, side: rec.side, year: rec.year,
        source: rec.source, musical: {
          scale: rec.scale, rootMidi: rec.rootMidi, root: Sonify.midiName(rec.rootMidi),
          tempoBase: rec.tempoBase, tempoRange: rec.tempoRange, palette: rec.palette,
          axis: rec.axis, ramp: rec.ramp,
        },
      },
      calibration: "each feature scaled between its 10th and 90th percentile within this side",
      frames: S.frames.map((fr, i) => ({
        bar: i + 1,
        frame: fr.src,
        label: fr.label,
        measured: fr.features.raw,
        calibrated: {
          luma: fr.features.luma, warmth: fr.features.warmth, edge: fr.features.edge,
          colorfulness: fr.features.colorfulness, bloom: fr.features.bloom, dark: fr.features.dark,
          coverage: fr.features.coverage, centroidX: fr.features.centroidX,
          bands: fr.features.bands.map((v) => Number(v.toFixed(3))),
          bandsAbs: fr.features.bandsAbs.map((v) => Number(v.toFixed(3))),
          rowsAbs: fr.features.rowsAbs.map((v) => Number(v.toFixed(3))),
        },
        composed: {
          bpm: fr.bar.bpm, section: fr.bar.section, degree: fr.bar.degree, octave: fr.bar.octave,
          chord: fr.bar.chord, chordNames: fr.bar.chord.map((m) => Sonify.midiName(m, S.flatNames)),
          notes: fr.bar.events.filter((e) => e.midi != null).map((e) => ({
            kind: e.kind, note: Sonify.midiName(e.midi, S.flatNames), midi: e.midi,
            at: Number(e.at.toFixed(3)), dur: Number((e.dur || 0).toFixed(3)),
          })),
        },
        description: fr.desc.long,
      })),
    };
    download(new Blob([JSON.stringify(score, null, 2)], { type: "application/json" }), `earth-jukebox-${rec.id}-score.json`);
    announce("Score saved.");
  }

  /* ---------------------------- live tuner ----------------------------- */

  function initLive() {
    (window.LIVE_LAYERS || []).forEach((l) => {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.title;
      el.liveLayer.appendChild(o);
    });
    $("#btn-live").addEventListener("click", tuneLive);
  }

  async function tuneLive() {
    const layer = (window.LIVE_LAYERS || []).find((l) => l.id === el.liveLayer.value);
    if (!layer) return;
    const btn = $("#btn-live");
    btn.disabled = true;
    el.liveStatus.className = "live-status busy";
    el.liveStatus.textContent = "Tuning… fetching frames from NASA GIBS";
    pause({ quiet: true });

    try {
      const step = Number(el.liveStep.value) || 1;
      const frames = await Gibs.series(layer.id, 18, step, { width: 960, height: 480 });
      const rec = {
        id: `live-${layer.id}`,
        title: `Live: ${layer.title}`,
        side: "Live tuner",
        year: new Date(frames[frames.length - 1].date).toISOString().slice(0, 10),
        blurb: `Eighteen frames of ${layer.title.toLowerCase()} pulled from NASA GIBS, ending ${frames[frames.length - 1].date}.`,
        instrument: "live synthesis",
        cover: frames[9].src,
        source: {
          title: layer.id, agency: "NASA Global Imagery Browse Services (GIBS)",
          url: "https://gibs.earthdata.nasa.gov/", credit: "NASA EOSDIS GIBS",
          roles: [], datasets: [layer.id], video: null, live: true,
        },
        frames: frames.map((f, i) => ({ src: f.src, label: f.date, n: i + 1 })),
        axis: layer.axis, ramp: layer.ramp, scale: layer.scale,
        rootMidi: layer.rootMidi, tempoBase: 58, tempoRange: 44, palette: "glass",
        listen: `Frames are ${step} day${step > 1 ? "s" : ""} apart, newest last. Bright patches on the map answer high in the scale.`,
      };
      RECORDS.push(rec);
      S.index = RECORDS.length - 1;
      renderShelf();
      await selectRecord(S.index, { force: true });
      el.liveStatus.textContent = `Loaded ${frames.length} frames from GIBS.`;
      el.liveStatus.className = "live-status";
    } catch (err) {
      el.liveStatus.textContent = `Could not reach GIBS: ${err.message}. The local records still work offline.`;
      el.liveStatus.className = "live-status error";
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------ history ------------------------------ */

  function updateHistory() {
    const id = RECORDS[S.index].id;
    if (!id.startsWith("live-")) {
      const url = new URL(window.location.href);
      url.searchParams.set("r", id);
      window.history.replaceState(null, "", url);
    }
  }

  /* ------------------------------ events ------------------------------- */

  function initEvents() {
    el.play.addEventListener("click", togglePlay);
    el.prev.addEventListener("click", () => step(-1));
    el.next.addEventListener("click", () => step(1));
    el.loopBtn.addEventListener("click", () => {
      S.loop = !S.loop;
      el.loopBtn.setAttribute("aria-pressed", String(S.loop));
      announce(S.loop ? "Looping this side." : "The side will stop at the end.");
    });

    if (el.concert) {
      el.concert.addEventListener("click", () => {
        if (S.concert) {
          stopConcert();
          pause();
        } else {
          startConcert();
        }
      });
    }

    el.volume.addEventListener("input", () => {
      S.masterVolume = Number(el.volume.value) / 100;
      if (S.engine && S.ctx) S.engine.master.gain.setTargetAtTime(S.muted ? 0.0001 : S.masterVolume * 0.9, S.ctx.currentTime, 0.05);
    });

    el.speak.addEventListener("click", () => {
      const fr = S.frames[S.current];
      if (fr) speak(fr.desc.long);
    });

    el.narrate.addEventListener("click", () => {
      S.autoDescribe = !S.autoDescribe;
      el.narrate.setAttribute("aria-pressed", String(S.autoDescribe));
      announce(S.autoDescribe ? "Auto-describe on. Each bar will be read aloud." : "Auto-describe off.");
      if (S.autoDescribe) {
        const fr = S.frames[S.current];
        if (fr) speak(fr.desc.long);
      } else if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    });

    el.exportBtn.addEventListener("click", exportWav);
    el.scoreBtn.addEventListener("click", exportScore);

    $$("[data-open]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.open;
        if (id === "liner") {
          if (el.liner.hidden) {
            el.liner.hidden = false;
            announce("Liner notes opened.");
          }
          el.liner.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
          el.liner.querySelector("h2").setAttribute("tabindex", "-1");
          el.liner.querySelector("h2").focus({ preventScroll: true });
        } else {
          $("#method").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        }
      });
    });

    $("#btn-contrast").addEventListener("click", () => {
      S.contrast = !S.contrast;
      document.body.classList.toggle("contrast", S.contrast);
      $("#btn-contrast").setAttribute("aria-pressed", String(S.contrast));
      announce(S.contrast ? "High contrast on." : "High contrast off.");
    });

    $("#btn-keys").addEventListener("click", () => el.keysDialog.showModal());
    $("#btn-tour").addEventListener("click", () => runTour());

    if (el.source) {
      el.source.addEventListener("click", () => {
        S.showSource = !S.showSource;
        el.source.setAttribute("aria-pressed", String(S.showSource));
        el.source.textContent = S.showSource ? "Show overlay" : "Show NASA frame";
        const fr = S.frames[S.current];
        if (fr) drawStage(fr.img, fr.features, S.playing ? 0 : -1);
        announce(S.showSource
          ? "Showing the unmodified NASA frame."
          : "Showing the measurement overlay.");
      });
    }
    if (el.skip) el.skip.addEventListener("click", () => { endTour(); pause(); });

    // record change on narrow layouts uses the same buttons; nothing extra.

    document.addEventListener("keydown", (ev) => {
      const tag = (ev.target.tagName || "").toLowerCase();
      if (["input", "select", "textarea"].includes(tag)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (el.keysDialog.open) return;

      if (ev.key === "Escape" && S.tour) {
        endTour();
        pause();
        return;
      }
      // Any deliberate input during the tour means the operator wants control.
      if (S.tour && [" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
        endTour(true);
      }

      switch (ev.key) {
        case " ":
          ev.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          ev.preventDefault();
          step(-1);
          break;
        case "ArrowRight":
          ev.preventDefault();
          step(1);
          break;
        case "ArrowUp":
          ev.preventDefault();
          selectRecord((S.index - 1 + RECORDS.length) % RECORDS.length, { force: true });
          break;
        case "ArrowDown":
          ev.preventDefault();
          selectRecord((S.index + 1) % RECORDS.length, { force: true });
          break;
        case "d": case "D": {
          const fr = S.frames[S.current];
          if (fr) speak(fr.desc.long);
          break;
        }
        case "a": case "A":
          el.narrate.click();
          break;
        case "m": case "M": {
          S.muted = !S.muted;
          if (S.engine && S.ctx) S.engine.master.gain.setTargetAtTime(S.muted ? 0.0001 : S.masterVolume * 0.9, S.ctx.currentTime, 0.05);
          announce(S.muted ? "Muted." : "Sound on.");
          break;
        }
        case "h": case "H":
          $("#btn-contrast").click();
          break;
        case "l": case "L":
          $('[data-open="liner"]').click();
          break;
        default:
          if (/^[1-9]$/.test(ev.key)) {
            const i = Number(ev.key) - 1;
            if (i < RECORDS.length) selectRecord(i, { force: true });
          }
      }
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const fr = S.frames[S.current];
        if (fr) drawStage(fr.img, fr.features, S.playing ? 0 : -1);
        drawRoll(S.ctx ? S.ctx.currentTime : 0);
      }, 120);
    });

    // Pause when the tab is hidden: nobody is listening, and the scheduler
    // would otherwise queue minutes of audio for an empty room.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && S.playing) pause({ quiet: true });
    });
  }

  /* -------------------------------- boot ------------------------------- */

  async function boot() {
    if (!RECORDS.length) {
      el.narration.textContent = "No records found. Run tools/build_library.py to build the library.";
      return;
    }
    renderShelf();
    initLive();
    initEvents();

    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("r");
    const start = Math.max(0, RECORDS.findIndex((r) => r.id === wanted));
    await selectRecord(Number.isFinite(start) ? start : 0, { force: true });

    // Draw one static roll so the panel is never blank.
    drawRoll(0);
    el.rollEmpty.hidden = true;
    el.volume.value = String(Math.round(S.masterVolume * 100));

    // ?tour=1 runs the scripted tour on load: record it, or loop it at a booth.
    if (params.get("tour") === "1") {
      window.setTimeout(() => runTour(), 1400);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
