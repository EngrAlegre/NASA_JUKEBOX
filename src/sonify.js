/*
 * Sonification engine: measurements -> music -> sound.
 *
 * Three layers, deliberately separable:
 *
 *   buildBar()   pure function. Measurements in, one bar of music out. No Web
 *                Audio, no DOM, so the mapping can be unit-tested.
 *   composeSide() pure function. A whole record in, a list of bars out, with
 *                smoothing carried across bars so the side sounds like one
 *                piece rather than eighteen separate clips.
 *   createEngine() / scheduleBar()  the audio graph. Built from a context, so
 *                the identical code renders live (AudioContext) and to a file
 *                (OfflineAudioContext): the exported WAV is the performance,
 *                not an approximation of it.
 *
 * Musical safety: every pitch is drawn from a fixed mode, so no measurement can
 * produce a wrong note. Extremes in the data change register, density, and
 * timbre — never key.
 */

const Sonify = (() => {
  // In the page, analyze.js has already defined Analyze as a global. Under Node
  // it is a module, so resolve it explicitly. Same code both ways.
  const AnalyzeDep = (typeof Analyze !== "undefined")
    ? Analyze
    : (typeof require === "function" ? require("./analyze.js") : null);

  const SCALES = {
    minorPentatonic: [0, 3, 5, 7, 10],
    majorPentatonic: [0, 2, 4, 7, 9],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };

  // Two spellings. A minor-ish mode is normally written in flats (C aeolian has
  // Ab, not G#), so the record's mode decides which table a name comes from.
  const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const norm = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

  function freq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiName(m, flat = false) {
    const table = flat ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
    return table[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  const FLAT_MODES = new Set(["aeolian", "dorian", "phrygian", "minorPentatonic"]);

  /* ======================= 1. measurements -> bar ========================= */

  /**
   * @param f       features from Analyze (one frame)
   * @param rec     record settings: {rootMidi, scale, tempoBase, tempoRange, palette}
   * @param state   carried across bars: {bpm, register, lastDegree}
   * @param i,n     position in the side, for the arrangement arc
   */
  function buildBar(f, rec, state, i = 0, n = 1) {
    const scale = SCALES[rec.scale] || SCALES.dorian;
    const rootMidi = rec.rootMidi ?? 50;
    const covered = (f.coverage ?? 1) > 0.02;

    // --- tempo: how much the planet changed since the last frame ----------
    const change = clamp01(f.change ?? 0);
    const targetBpm = lerp(rec.tempoBase ?? 64, (rec.tempoBase ?? 64) + (rec.tempoRange ?? 50), Math.pow(change, 0.6));
    // Tempo glides, with a hard ceiling on how far one bar may move: a sudden
    // jump would read as a mistake rather than as the planet rearranging.
    if (state.bpm == null) state.bpm = targetBpm;
    else state.bpm += clamp(targetBpm - state.bpm, -7, 7);
    const bpm = Math.round(state.bpm);
    const barDur = (60 / bpm) * 4;

    // --- register: brightness chooses the octave --------------------------
    const regTarget = clamp01(f.luma ?? 0.5);
    state.register = state.register == null ? regTarget : lerp(state.register, regTarget, 0.38);
    const octave = Math.round((state.register - 0.45) * 2);     // -1 .. +1

    // --- harmony: position along the record's colour bar = scale degree ---
    const warmth = clamp01(f.warmth ?? 0.5);
    const span = scale.length - 1;
    const degree = Math.round(warmth * span);

    // --- arrangement arc: intro, body, chorus, outro ----------------------
    const p = n > 1 ? i / (n - 1) : 0.5;
    const arc = Math.sin(Math.PI * clamp01(p));                  // 0 at ends, 1 mid
    const section = p < 0.18 ? "intro" : p > 0.86 ? "outro" : p > 0.44 && p < 0.82 ? "chorus" : "verse";

    const density = clamp01(f.edge ?? 0.3);
    const subdivision = density > 0.58 ? 16 : density > 0.3 ? 8 : 4;
    const bands = f.bands && f.bands.length ? f.bands : new Array(16).fill(0.25);
    // Absolute texture: how much edge energy is actually there, independent of
    // this frame's own contrast. A black frame with faint noise has a full set
    // of *relative* columns but almost no absolute energy, and must stay quiet.
    const bandsAbs = f.bandsAbs && f.bandsAbs.length ? f.bandsAbs : bands;

    const events = [];
    const beat = (60 / bpm);
    const timbre = rec.palette || pickTimbre(f);

    if (!covered) {
      // No data here. The piece keeps time with a single low pulse and stays
      // otherwise silent: an honest rest, not invented sound.
      return finish({
        bpm, barDur, subdivision: 4, section, arc, covered: false,
        degree, octave, rootMidi, chord: [], noteCount: 0,
        timbre: pickTimbre(f), pan: 0, cutoff: 1200, change,
        events: [{ kind: "drone", midi: rootMidi - 12, at: 0, dur: barDur, gain: 0.05, pan: 0 }],
      });
    }

    /* --- drone: a pedal under the whole side --------------------------- */
    events.push({
      kind: "drone",
      midi: rootMidi - 12 + octave * 12,
      at: 0,
      dur: barDur * 0.99,
      gain: 0.055 + 0.045 * clamp01(f.dark ?? 0.3),
      pan: 0,
    });

    /* --- pad: the chord, voiced by the frame's colour and its vertical spread
       ------------------------------------------------------------------ */
    const openness = clamp01(f.colorfulness ?? 0.25);
    const voicing = openness > 0.5 ? [0, 2, 4, 6] : [0, 2, 4];
    // Where the texture sits vertically on the map decides whether the chord is
    // closed (activity in one latitude band) or spread (activity top to bottom).
    const rowsAbs = f.rowsAbs && f.rowsAbs.length ? f.rowsAbs : [0.4];
    const vertical = rowsAbs.reduce((a, b) => a + b, 0) / rowsAbs.length;
    const inversion = (section === "chorus" ? 1 : 0) + (i % 3 === 2 ? 1 : 0);
    const chordNotes = voicing.map((step, k) => scaleNote(rootMidi, scale, degree + step, octave));
    if (vertical > 0.45 && chordNotes.length > 2) chordNotes[0] -= 12;   // open voicing
    const rotated = chordNotes.map((_, k) => chordNotes[(k + inversion) % chordNotes.length]);
    rotated.forEach((m, k) => {
      events.push({
        kind: "pad",
        midi: m,
        at: 0,
        dur: barDur * (section === "outro" ? 1.02 : 0.96),
        gain: (0.038 + 0.016 * openness) * (section === "intro" ? 1.15 : 1),
        pan: [-0.4, 0.28, -0.1, 0.45][k % 4],
      });
    });

    /* --- bass: the horizontal centre of the map decides the root -------- */
    if (section !== "intro" || arc > 0.1) {
      const bassMid = rootMidi - 12 + octave * 12 + scale[degree % scale.length];
      const steps = density > 0.5 ? 4 : 2;
      for (let s = 0; s < steps; s++) {
        const at = (s / steps) * barDur;
        events.push({
          kind: "bass",
          midi: bassMid - (s === steps - 1 && steps > 2 ? 0 : 0),
          at,
          dur: beat * (steps === 4 ? 0.8 : 1.6),
          gain: (0.09 + 0.06 * density) * (0.5 + 0.5 * arc),
          pan: 0,
        });
      }
    }

    /* --- melody: the map read left to right, in sixteen steps ----------- */
    const stepDur = barDur / bands.length;
    let noteCount = 0;
    const topDegree = Math.round(degree + (1 - warmth) * 2 + 1);
    for (let b = 0; b < bands.length; b++) {
      const a = clamp01(bands[b]);
      const live = clamp01(bandsAbs[b] ?? 0);
      if (a < 0.12 || live < 0.07) continue;        // quiet or empty column -> rest
      const lift = Math.round(a * (scale.length + 2));
      const midi = scaleNote(rootMidi, scale, topDegree + lift, octave + (live > 0.6 ? 1 : 0));
      noteCount++;
      events.push({
        kind: live > 0.62 ? "bell" : "pluck",
        midi,
        at: b * stepDur,
        dur: stepDur * (subdivision === 16 ? 0.85 : 1.7) + 0.06,
        gain: 0.045 + 0.13 * live,
        pan: (b / (bands.length - 1)) * 1.7 - 0.85,
        cutoff: 900 + 6200 * clamp01(f.luma ?? 0.5) + 1300 * a,
        timbre,
      });
    }

    /* --- percussion: texture and highlights ---------------------------- */
    const drumGain = arc * (0.45 + 0.55 * density);
    if (section !== "intro" && section !== "outro") {
      const kicks = density > 0.45 ? 4 : 2;
      for (let k = 0; k < kicks; k++) {
        events.push({
          kind: "kick",
          at: (k / kicks) * barDur,
          gain: (0.16 + 0.2 * density) * drumGain,
          pan: 0,
        });
      }
      const hats = subdivision;
      for (let h = 0; h < hats; h++) {
        const accent = h % (hats / 4) === 0 ? 1 : 0.45;
        events.push({
          kind: "hat",
          at: (h / hats) * barDur,
          gain: 0.03 * accent * (0.4 + density) * (0.5 + arc),
          pan: 0.15,
        });
      }
    }

    // Highlights (city lights, lightning, cloud tops) become transients. This
    // is the one place where a bright pixel is heard as an event rather than a
    // continuous parameter.
    const bloom = clamp01(f.bloom ?? 0);
    if (bloom > 0.07) {
      // A record full of bright transients (lightning, city lights) is percussion
      // first: each strike becomes an event, not a slow parameter change.
      const strikes = Math.max(1, Math.min(8, Math.round(bloom * 9)));
      for (let s = 0; s < strikes; s++) {
        const a = bands[(s * 3) % bands.length] ?? 0.5;
        events.push({
          kind: "stab",
          midi: scaleNote(rootMidi, scale, degree + 4 + Math.round(a * 3), octave + 1),
          at: ((s + 0.5) / strikes) * barDur,
          dur: 0.16,
          gain: 0.05 + 0.14 * bloom,
          pan: (s / Math.max(1, strikes - 1)) * 1.4 - 0.7,
          timbre,
        });
      }
    }

    const bar = {
      bpm, barDur, subdivision, section, arc,
      covered: true,
      degree,
      octave,
      rootMidi,
      chord: rotated,
      events,
      noteCount,
      timbre,
      pan: clamp01(f.centroidX ?? 0.5) * 1.2 - 0.6,
      cutoff: 1200 + 5200 * clamp01(f.luma ?? 0.5) + 900 * density,
      change,
    };
    return finish(bar);
  }

  function finish(bar) {
    bar.events.sort((a, b) => a.at - b.at);
    return bar;
  }

  // Degree (may run past the octave) -> absolute MIDI note inside the mode.
  function scaleNote(rootMidi, scale, degree, octave = 0) {
    const len = scale.length;
    const oct = Math.floor(degree / len);
    const idx = ((degree % len) + len) % len;
    return rootMidi + scale[idx] + 12 * (oct + octave);
  }

  function pickTimbre(f) {
    const h = f.hue ?? 0;
    if (h < 40 || h > 320) return "reed";
    if (h < 90) return "bell";
    if (h < 170) return "flute";
    if (h < 250) return "glass";
    return "reed";
  }

  /* ======================= 2. a whole side =============================== */

  /**
   * Re-scale a side's features against its own dynamic range.
   *
   * Space is black. Air-quality frames and night-light frames both average well
   * under 10% luminance, so a literal 0..255 reading would put every record in
   * the bottom octave and describe every frame as "nearly black". What matters
   * musically — and what the science actually shows over a side — is the change
   * within a record. So each feature is stretched between its own 10th and 90th
   * percentile, the raw value is kept on `raw` for display, and a side with no
   * real variation falls back to a neutral centre instead of amplifying noise.
   */
  const CALIBRATED = ["luma", "warmth", "edge", "colorfulness", "bloom", "dark", "sat"];

  function calibrate(features) {
    const out = features.map((f) => {
      const copy = Object.assign({}, f);
      copy.raw = {};
      for (const k of CALIBRATED) copy.raw[k] = f[k] || 0;
      return copy;
    });

    for (const k of CALIBRATED) {
      const vals = features.map((f) => f[k] || 0).sort((a, b) => a - b);
      if (!vals.length) continue;
      const lo = vals[Math.floor(vals.length * 0.1)];
      const hi = vals[Math.floor(vals.length * 0.9)];
      const span = hi - lo;
      const flat = span < 0.012;
      for (const f of out) {
        const v = f[k] || 0;
        f[k] = flat ? clamp(0.45 + (v - 0.45) * 0.4, 0.25, 0.7) : clamp01((v - lo) / span);
      }
    }
    return out;
  }

  /**
   * @param features array of Analyze results, in order
   * @param rec      record settings
   */
  function composeSide(features, rec) {
    const frames = calibrate(features);
    const state = {};
    const bars = [];
    for (let i = 0; i < frames.length; i++) {
      const f = Object.assign({}, frames[i], {
        change: i === 0 ? 0 : AnalyzeDep.changeBetween(frames[i - 1], frames[i]),
      });
      frames[i].change = f.change;                     // kept for the read-out
      bars.push(buildBar(f, rec, state, i, frames.length));
    }
    return { bars, frames };
  }

  /* ======================= 3. audio graph =============================== */

  function makeNoise(ctx, seconds, seed = 22222) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = seed;
    for (let i = 0; i < len; i++) {
      s = (s * 1664525 + 1013904223) % 4294967296;
      d[i] = (s / 2147483648 - 1) * 0.75;
    }
    return buf;
  }

  // A synthetic impulse response: enough early reflection and tail to place the
  // instruments in a room without shipping a binary asset.
  function makeImpulse(ctx, seconds = 2.6, decay = 2.4) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let s = 977 + ch * 131;
      for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) % 4294967296;
        const n = s / 2147483648 - 1;
        const t = i / len;
        d[i] = n * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function createEngine(ctx, opts = {}) {
    // One mix trim for the whole instrument. The voices are written at polite
    // per-event gains; this is where the side is brought up to listening level
    // so the limiter does musical work instead of the job of a volume knob.
    const mix = opts.mix ?? 2.5;

    const master = ctx.createGain();
    master.gain.value = 0;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -7;
    limiter.knee.value = 14;
    limiter.ratio.value = 3.5;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.2;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -22;
    glue.knee.value = 30;
    glue.ratio.value = 2.2;
    glue.attack.value = 0.02;
    glue.release.value = 0.3;

    const dry = ctx.createGain();
    dry.gain.value = 0.86 * mix;

    const send = ctx.createGain();
    send.gain.value = 0.5 * mix;

    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, opts.reverbSeconds || 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;

    const delay = ctx.createDelay(1.2);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.16;
    const delaySend = ctx.createGain();
    delaySend.gain.value = 0.3 * mix;

    dry.connect(glue);
    send.connect(verb);
    verb.connect(wet);
    wet.connect(glue);
    delaySend.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(glue);
    glue.connect(limiter);
    limiter.connect(master);
    master.connect(ctx.destination);

    const noise = makeNoise(ctx, 2.0);

    return {
      ctx,
      master,
      dry,
      send,
      delaySend,
      noise,
      mix,
      fadeIn(t, seconds = 0.35, peak = 0.95) {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(0.0001, t);
        master.gain.linearRampToValueAtTime(peak, t + seconds);
      },
      fadeOut(t, seconds = 0.5) {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0.0001, t + seconds);
      },
    };
  }

  function panner(ctx, dest, value) {
    if (!ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(value || 0, -1, 1);
    p.connect(dest);
    return p;
  }

  function env(ctx, t, peak, attack, release) {
    const g = ctx.createGain();
    const p = Math.max(peak, 0.0002);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p, t + Math.max(0.004, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, attack + release));
    return g;
  }

  function scheduleBar(engine, bar, t0) {
    const { ctx, dry, send, noise } = engine;
    const t = t0;
    const busOf = (ev) => panner(ctx, dry, ev.pan);

    for (const ev of bar.events) {
      const at = t + ev.at;
      switch (ev.kind) {
        case "drone": {
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, at);
          g.gain.linearRampToValueAtTime(ev.gain, at + 0.5);
          g.gain.linearRampToValueAtTime(0.0001, at + ev.dur);
          const filt = ctx.createBiquadFilter();
          filt.type = "lowpass";
          filt.frequency.value = 420;
          for (const [mult, gain] of [[1, 1], [2, 0.24], [3, 0.08]]) {
            const o = ctx.createOscillator();
            o.type = "sine";
            o.frequency.value = freq(ev.midi) * mult;
            const og = ctx.createGain();
            og.gain.value = gain;
            o.connect(og).connect(filt);
            o.start(at);
            o.stop(at + ev.dur + 0.4);
          }
          filt.connect(g);
          g.connect(busOf(ev));
          g.connect(send);
          break;
        }

        case "pad": {
          const filt = ctx.createBiquadFilter();
          filt.type = "lowpass";
          filt.frequency.setValueAtTime(clamp(bar.cutoff * 0.55, 260, 5200), at);
          filt.frequency.linearRampToValueAtTime(clamp(bar.cutoff * 0.9, 320, 6800), at + ev.dur * 0.6);
          filt.Q.value = 0.7;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, at);
          g.gain.linearRampToValueAtTime(ev.gain, at + Math.min(0.6, ev.dur * 0.35));
          g.gain.linearRampToValueAtTime(0.0001, at + ev.dur);
          for (const detune of [-7, 6]) {
            const o = ctx.createOscillator();
            o.type = bar.timbre === "glass" ? "triangle" : "sawtooth";
            o.frequency.value = freq(ev.midi);
            o.detune.value = detune;
            o.connect(filt);
            o.start(at);
            o.stop(at + ev.dur + 0.1);
          }
          filt.connect(g);
          g.connect(busOf(ev));
          g.connect(send);
          break;
        }

        case "bass": {
          const o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.setValueAtTime(freq(ev.midi), at);
          const o2 = ctx.createOscillator();
          o2.type = "triangle";
          o2.frequency.setValueAtTime(freq(ev.midi + 12), at);
          const sub = ctx.createGain();
          sub.gain.value = 0.3;
          const g = env(ctx, at, ev.gain, 0.02, ev.dur);
          o.connect(g);
          o2.connect(sub).connect(g);
          g.connect(dry);
          o.start(at); o.stop(at + ev.dur + 0.1);
          o2.start(at); o2.stop(at + ev.dur + 0.1);
          break;
        }

        case "pluck":
        case "bell":
        case "stab": {
          const o = ctx.createOscillator();
          const isBell = ev.kind === "bell" || ev.timbre === "bell";
          o.type = ev.timbre === "reed" ? "sawtooth" : ev.timbre === "glass" ? "triangle" : "sine";
          o.frequency.setValueAtTime(freq(ev.midi), at);

          const filt = ctx.createBiquadFilter();
          filt.type = isBell ? "bandpass" : "lowpass";
          filt.frequency.setValueAtTime(clamp(ev.cutoff || bar.cutoff, 400, 9000), at);
          filt.frequency.exponentialRampToValueAtTime(clamp((ev.cutoff || bar.cutoff) * 0.32, 260, 9000), at + ev.dur);
          filt.Q.value = isBell ? 4.2 : 0.9;

          const g = env(ctx, at, ev.gain, 0.008, ev.dur);
          o.connect(filt).connect(g);
          g.connect(busOf(ev));
          g.connect(send);
          if (ev.kind === "stab") g.connect(engine.delaySend);
          o.start(at);
          o.stop(at + ev.dur + 0.2);
          break;
        }

        case "kick": {
          const o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.setValueAtTime(140, at);
          o.frequency.exponentialRampToValueAtTime(44, at + 0.13);
          const g = env(ctx, at, ev.gain, 0.004, 0.24);
          o.connect(g).connect(dry);
          o.start(at);
          o.stop(at + 0.34);
          break;
        }

        case "hat": {
          const src = ctx.createBufferSource();
          src.buffer = noise;
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass";
          hp.frequency.value = 7200;
          const g = env(ctx, at, ev.gain, 0.002, 0.055);
          src.connect(hp).connect(g).connect(panner(ctx, dry, ev.pan));
          src.start(at, (ev.at * 0.37) % 1.2);
          src.stop(at + 0.12);
          break;
        }

        case "tick": {
          const src = ctx.createBufferSource();
          src.buffer = noise;
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = clamp(ev.cutoff || 2400, 300, 8000);
          bp.Q.value = 1.6;
          const g = env(ctx, at, ev.gain, 0.002, 0.07);
          src.connect(bp).connect(g).connect(panner(ctx, dry, ev.pan));
          src.start(at, (ev.at * 0.61) % 1.5);
          src.stop(at + 0.14);
          break;
        }
      }
    }
  }

  /* ======================= 4. offline render + WAV ======================= */

  async function renderBars(bars, sampleRate = 44100, opts = {}) {
    const tail = opts.tail ?? 3.2;
    const total = bars.reduce((s, b) => s + b.barDur, 0) + tail;
    const OfflineCtor = (typeof window !== "undefined" && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) || null;
    if (!OfflineCtor) throw new Error("OfflineAudioContext unavailable");
    const ctx = new OfflineCtor(2, Math.ceil(total * sampleRate), sampleRate);
    const engine = createEngine(ctx, opts);
    engine.fadeIn(0.02, 0.4, 0.95);
    let t = 0.08;
    for (const bar of bars) {
      scheduleBar(engine, bar, t);
      t += bar.barDur;
    }
    engine.fadeOut(t - 0.6, 1.6);
    return ctx.startRendering();
  }

  function encodeWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const length = buffer.length * channels * 2 + 44;
    const view = new DataView(new ArrayBuffer(length));
    const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    str(0, "RIFF");
    view.setUint32(4, length - 8, true);
    str(8, "WAVE");
    str(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, length - 44, true);
    const chans = [];
    for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < channels; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([view], { type: "audio/wav" });
  }

  /* ======================= 5. language ================================== */

  /**
   * A frame described in words. This is not an alt-text afterthought: it is the
   * same measurement vector that drives the music, spoken in the opposite
   * modality, so a blind listener and a sighted listener are told the same
   * facts about the same bar.
   */
  function describe(f, bar, rec, i, n) {
    const words = (v, pairs) => {
      for (const [limit, w] of pairs) if (v < limit) return w;
      return pairs[pairs.length - 1][1];
    };

    const bright = words(f.luma ?? 0, [[0.12, "nearly black"], [0.3, "dark"], [0.55, "mid-toned"], [0.78, "bright"], [2, "blazing"]]);
    // Colour is described against the record's own legend. "Cool" and "warm"
    // only make sense for a blue→red palette; NDVI runs brown→green and night
    // lights run black→amber, so the ramp's own name is the honest word.
    const ramp = rec.ramp || "value";
    const colour = words(f.warmth ?? 0.5, [
      [0.3, `low on the ${ramp} scale`],
      [0.5, `lower-mid on the ${ramp} scale`],
      [0.7, `upper-mid on the ${ramp} scale`],
      [2, `high on the ${ramp} scale`],
    ]);
    const texture = words(f.edge ?? 0, [[0.18, "very smooth"], [0.38, "gently textured"], [0.6, "busy"], [0.8, "visually chaotic"], [2, "churning"]]);
    const spread = words(f.colorfulness ?? 0, [[0.15, "almost monochrome"], [0.35, "subdued colour"], [0.55, "colourful"], [2, "saturated across the spectrum"]]);
    const where = (f.centroidX ?? 0.5) < 0.4 ? "in the west" : (f.centroidX ?? 0.5) > 0.6 ? "in the east" : "across the middle";
    const bass = words(f.dark ?? 0, [[0.3, "little shadow"], [0.55, "deep shadow"], [2, "mostly shadow"]]);

    const short = `${bright}, ${colour}, ${texture}.`;
    const flat = FLAT_MODES.has(rec.scale);
    const chordText = bar.chord.map((m) => midiName(m, flat)).join(" ");
    const notes = bar.covered ? `${bar.noteCount} melodic notes, chord ${chordText}, tempo ${bar.bpm}` : "no sensor coverage, so this bar is a rest";
    const long = `Bar ${i + 1} of ${n} of ${rec.title}. The frame is ${bright}, ${colour}, ${spread}, and ${texture}. Energy concentrates ${where}, with ${bass}. Musically: ${notes}, ${bar.section} section.`;
    return { short, long };
  }

  return {
    SCALES,
    buildBar,
    composeSide,
    calibrate,
    createEngine,
    scheduleBar,
    renderBars,
    encodeWav,
    describe,
    freq,
    midiName,
    scaleNote,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Sonify;
